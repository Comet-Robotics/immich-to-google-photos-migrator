import { join } from "node:path";
import { Deferred, Effect, Queue, Ref } from "effect";
import { acquireRunLock, initialCheckpoint, loadOrCreateCheckpoint, saveCheckpoint, updateWorkItem } from "./checkpoint";
import { discoverSourceTreeEffect } from "./discovery";
import { buildMigrationPlan } from "./plan";
import { buildReport, renderFinalReport, renderPlanSummary, writeReport } from "./report";
import { BunProcessRunner } from "./rclone";
import { RcloneClient } from "./rclone";
import { CheckpointError, RcloneError, type AppError, type CheckpointState, type MigrationPlan, type ProcessRunner, type RuntimeConfig, type WorkItem } from "./types";

export interface RunMigrationOptions {
  readonly config: RuntimeConfig;
  readonly runner?: ProcessRunner;
}

export interface RunMigrationResult {
  readonly plan: MigrationPlan;
  readonly checkpoint: CheckpointState;
  readonly planReportPath: string;
  readonly finalReportPath?: string;
  readonly ok: boolean;
}

export async function runMigration(options: RunMigrationOptions): Promise<RunMigrationResult> {
  return Effect.runPromise(runMigrationEffect(options));
}

export function runMigrationEffect(options: RunMigrationOptions): Effect.Effect<RunMigrationResult, AppError> {
  return Effect.gen(function* () {
    const { config } = options;
    const runner = options.runner ?? new BunProcessRunner();
    const rclone = new RcloneClient({ config, runner });
    yield* Effect.acquireRelease(
      Effect.tryPromise({
        try: () => acquireRunLock(config.stateDir),
        catch: (error) =>
          new CheckpointError({
            message: error instanceof Error ? error.message : String(error),
          }),
      }),
      (release) => Effect.promise(() => release()),
    );

    const preflight = yield* rclone.preflight();
    const discovery = yield* discoverSourceTreeEffect(config.sourceRoot).pipe(
      Effect.mapError((error) => new CheckpointError({ message: String(error) })),
    );
    const plan = buildMigrationPlan(discovery);
    const planReportPath = yield* Effect.tryPromise({
      try: () => writeReport(config.reportDir, "migration-plan.md", renderPlanSummary(plan)),
      catch: (error) => new CheckpointError({ message: String(error) }),
    });

    if (config.planOnly) {
      const checkpoint = initialCheckpoint(plan, config.remote, preflight.remoteFingerprint);
      return { plan, checkpoint, planReportPath, ok: true };
    }

    if (plan.unreadablePaths.length > 0 && !config.acknowledgeUnreadablePaths) {
      return yield* Effect.fail(
        new CheckpointError({
          message: "Some source paths could not be read. Review the plan report and re-run with --acknowledge-unreadable-paths to omit them.",
        }),
      );
    }

    if (plan.outsideLeafMedia.length > 0 && !config.acknowledgeNonLeafMedia) {
      return yield* Effect.fail(
        new CheckpointError({
          message: "Media files were found outside leaf folders. Re-run with --acknowledge-non-leaf-media to omit them.",
        }),
      );
    }

    const checkpointPath = join(config.stateDir, "checkpoint.json");
    let checkpoint = yield* Effect.tryPromise({
      try: () =>
        loadOrCreateCheckpoint(checkpointPath, plan, config.remote, preflight.remoteFingerprint),
      catch: (error) => new CheckpointError({ message: String(error) }),
    });
    yield* Effect.tryPromise({
      try: () => saveCheckpoint(checkpointPath, checkpoint),
      catch: (error) => new CheckpointError({ message: String(error) }),
    });

    const visibleAlbums = yield* rclone.listAlbums();
    if (visibleAlbums === "listing-unavailable" && !config.acknowledgeUnknownRemote) {
      return yield* Effect.fail(
        new RcloneError({
          message: "rclone album listing is unavailable. Re-run with --acknowledge-unknown-remote if you accept best-effort album preflight.",
        }),
      );
    }

    const albumResolutions = rclone.resolveAlbums(
      plan.albums.map((album) => album.albumName),
      visibleAlbums,
    );

    const duplicate = albumResolutions.find((resolution) => resolution.status === "duplicate-visible");
    if (duplicate) {
      return yield* Effect.fail(
        new RcloneError({
          message: `Duplicate visible destination album: ${duplicate.albumName}`,
        }),
      );
    }

    for (const resolution of albumResolutions) {
      if (resolution.status === "needs-create" || resolution.status === "listing-unavailable") {
        yield* rclone.createAlbum(resolution.albumName);
      }
    }

    checkpoint = yield* runWorkItems({
      config,
      checkpoint,
      checkpointPath,
      rclone,
      workItems: plan.workItems,
    });

    const report = buildReport(plan, checkpoint);
    const finalReportPath = yield* Effect.tryPromise({
      try: () => writeReport(config.reportDir, "migration-report.md", renderFinalReport(report)),
      catch: (error) => new CheckpointError({ message: String(error) }),
    });
    const ok = report.failed.length === 0 && report.uncertain.length === 0 && report.remaining.length === 0;

    return { plan, checkpoint, planReportPath, finalReportPath, ok };
  }).pipe(Effect.scoped);
}

interface RunWorkItemsOptions {
  readonly config: RuntimeConfig;
  readonly checkpoint: CheckpointState;
  readonly checkpointPath: string;
  readonly rclone: RcloneClient;
  readonly workItems: readonly WorkItem[];
}

interface CheckpointWriteRequest {
  readonly item: WorkItem;
  readonly update: Parameters<typeof updateWorkItem>[2];
  readonly done: Deferred.Deferred<void, CheckpointError>;
}

function runWorkItems(options: RunWorkItemsOptions): Effect.Effect<CheckpointState, CheckpointError> {
  const grouped = groupByAlbum(options.workItems);
  return Effect.gen(function* () {
    const stateRef = yield* Ref.make(options.checkpoint);
    const writeQueue = yield* Queue.unbounded<CheckpointWriteRequest>();
    const writerEffect = Effect.forever(
      Effect.gen(function* () {
        const request = yield* Queue.take(writeQueue);
        const result = yield* Effect.exit(
          Effect.gen(function* () {
            const current = yield* Ref.get(stateRef);
            const next = updateWorkItem(current, request.item.id, request.update);
            yield* Effect.tryPromise({
              try: () => saveCheckpoint(options.checkpointPath, next),
              catch: (error) => new CheckpointError({ message: String(error) }),
            });
            yield* Ref.set(stateRef, next);
          }),
        );
        if (result._tag === "Failure") {
          yield* Deferred.fail(request.done, new CheckpointError({ message: String(result.cause) }));
          return;
        }
        yield* Deferred.succeed(request.done, undefined);
      }),
    );
    yield* Effect.forkScoped(writerEffect);

    const updateAndSave = (item: WorkItem, update: Parameters<typeof updateWorkItem>[2]) =>
      Effect.gen(function* () {
        const done = yield* Deferred.make<void, CheckpointError>();
        yield* Queue.offer(writeQueue, { item, update, done });
        yield* Deferred.await(done);
      });

    yield* Effect.forEach(
      [...grouped.values()],
      (items) =>
        Effect.gen(function* () {
          for (const item of items) {
            const checkpoint = yield* Ref.get(stateRef);
            const state = checkpoint.workItems[item.id];
            if (state?.status === "complete") {
              continue;
            }
            if (state?.status === "uncertain" && !options.config.retryUncertain) {
              continue;
            }

            yield* updateAndSave(item, {
              status: "running",
              attempts: (state?.attempts ?? 0) + 1,
            });

            const copyResult = yield* Effect.exit(
              options.rclone.copyWorkItem(item, join(options.config.stateDir, "manifests")),
            );

            if (copyResult._tag === "Failure") {
              const message = String(copyResult.cause);
              yield* updateAndSave(item, {
                status: "uncertain",
                message,
              });
              continue;
            }

            const saveResult = yield* Effect.exit(
              updateAndSave(item, {
                status: "complete",
                message: "rclone copy completed",
              }),
            );

            if (saveResult._tag === "Failure") {
              const message = String(saveResult.cause);
              const checkpoint = yield* Ref.get(stateRef);
              const next = updateWorkItem(checkpoint, item.id, {
                status: "uncertain",
                message: `rclone copy completed but checkpoint persistence failed: ${message}`,
              });
              yield* Effect.tryPromise({
                try: async () => {
                  await saveCheckpoint(options.checkpointPath, next);
                  await Effect.runPromise(Ref.set(stateRef, next));
                },
                catch: (error) => new CheckpointError({ message: String(error) }),
              });
            }
          }
        }),
      { concurrency: options.config.concurrency },
    );

    return yield* Ref.get(stateRef);
  }).pipe(Effect.scoped);
}


function groupByAlbum(workItems: readonly WorkItem[]): Map<string, WorkItem[]> {
  const grouped = new Map<string, WorkItem[]>();
  for (const item of workItems) {
    const existing = grouped.get(item.albumName) ?? [];
    existing.push(item);
    grouped.set(item.albumName, existing);
  }
  return grouped;
}
