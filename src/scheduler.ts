import { join } from "node:path";
import { Effect } from "effect";
import { acquireRunLock, initialCheckpoint, loadOrCreateCheckpoint, saveCheckpoint, updateWorkItem } from "./checkpoint";
import { discoverSourceTree } from "./discovery";
import { buildMigrationPlan } from "./plan";
import { buildReport, renderFinalReport, renderPlanSummary, writeReport } from "./report";
import { BunProcessRunner } from "./rclone";
import { RcloneClient } from "./rclone";
import { CheckpointError, RcloneError, type CheckpointState, type MigrationPlan, type ProcessRunner, type RuntimeConfig, type WorkItem } from "./types";

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

export function runMigrationEffect(options: RunMigrationOptions): Effect.Effect<RunMigrationResult, Error> {
  return Effect.gen(function* () {
    const { config } = options;
    const runner = options.runner ?? new BunProcessRunner();
    const rclone = new RcloneClient({ config, runner });
    const releaseLock = yield* Effect.acquireRelease(
      Effect.tryPromise({
        try: () => acquireRunLock(config.stateDir),
        catch: (error) => (error instanceof Error ? error : new Error(String(error))),
      }),
      (release) => Effect.promise(() => release()),
    );

    const preflight = yield* rclone.preflight();
    const discovery = yield* Effect.tryPromise({
      try: () => discoverSourceTree(config.sourceRoot),
      catch: (error) => (error instanceof Error ? error : new Error(String(error))),
    });
    const plan = buildMigrationPlan(discovery);
    const planReportPath = yield* Effect.tryPromise({
      try: () => writeReport(config.reportDir, "migration-plan.md", renderPlanSummary(plan)),
      catch: (error) => (error instanceof Error ? error : new Error(String(error))),
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
      catch: (error) => (error instanceof Error ? error : new Error(String(error))),
    });
    yield* Effect.tryPromise({
      try: () => saveCheckpoint(checkpointPath, checkpoint),
      catch: (error) => (error instanceof Error ? error : new Error(String(error))),
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
      catch: (error) => (error instanceof Error ? error : new Error(String(error))),
    });
    const ok = report.failed.length === 0 && report.uncertain.length === 0 && report.remaining.length === 0;

    return { plan, checkpoint, planReportPath, finalReportPath, ok };
  }).pipe(
    Effect.scoped,
    Effect.mapError((error) => (error instanceof Error ? error : new Error(String(error)))),
  );
}

interface RunWorkItemsOptions {
  readonly config: RuntimeConfig;
  readonly checkpoint: CheckpointState;
  readonly checkpointPath: string;
  readonly rclone: RcloneClient;
  readonly workItems: readonly WorkItem[];
}

function runWorkItems(options: RunWorkItemsOptions): Effect.Effect<CheckpointState, Error> {
  const grouped = groupByAlbum(options.workItems);
  let checkpoint = options.checkpoint;
  return Effect.gen(function* () {
    const lock = yield* Effect.makeSemaphore(1);
    const updateAndSave = (
      item: WorkItem,
      update: Parameters<typeof updateWorkItem>[2],
    ): Effect.Effect<void, Error> =>
      lock.withPermits(1)(
        Effect.tryPromise({
          try: async () => {
            checkpoint = updateWorkItem(checkpoint, item.id, update);
            await saveCheckpoint(options.checkpointPath, checkpoint);
          },
          catch: (error) => (error instanceof Error ? error : new Error(String(error))),
        }),
      );

    yield* Effect.forEach(
      [...grouped.values()],
      (items) =>
        Effect.gen(function* () {
          for (const item of items) {
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
              checkpoint = updateWorkItem(checkpoint, item.id, {
                status: "uncertain",
                message: `rclone copy completed but checkpoint persistence failed: ${message}`,
              });
              yield* Effect.tryPromise({
                try: () => saveCheckpoint(options.checkpointPath, checkpoint),
                catch: (error) => (error instanceof Error ? error : new Error(String(error))),
              });
            }
          }
        }),
      { concurrency: options.config.concurrency },
    );

    return checkpoint;
  });
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
