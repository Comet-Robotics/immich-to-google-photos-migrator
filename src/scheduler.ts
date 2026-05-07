import { join } from "node:path";
import { Effect } from "effect";
import { acquireRunLock, loadOrCreateCheckpoint, saveCheckpoint, updateWorkItem } from "./checkpoint";
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
}

export async function runMigration(options: RunMigrationOptions): Promise<RunMigrationResult> {
  return Effect.runPromise(runMigrationEffect(options));
}

export function runMigrationEffect(options: RunMigrationOptions): Effect.Effect<RunMigrationResult, Error> {
  return Effect.tryPromise({
    try: async () => {
    const { config } = options;
    const runner = options.runner ?? new BunProcessRunner();
    const rclone = new RcloneClient({ config, runner });
    const releaseLock = await acquireRunLock(config.stateDir);

    try {
      await rclone.preflight();
      const discovery = await discoverSourceTree(config.sourceRoot);
      const plan = buildMigrationPlan(discovery);

      if (plan.outsideLeafMedia.length > 0 && !config.acknowledgeNonLeafMedia) {
        throw new CheckpointError({
          message: "Media files were found outside leaf folders. Re-run with --acknowledge-non-leaf-media to omit them.",
        });
      }

      const planReportPath = await writeReport(config.reportDir, "migration-plan.md", renderPlanSummary(plan));
      const checkpointPath = join(config.stateDir, "checkpoint.json");
      let checkpoint = await loadOrCreateCheckpoint(checkpointPath, plan, config.remote);
      await saveCheckpoint(checkpointPath, checkpoint);

      if (config.planOnly) {
        return { plan, checkpoint, planReportPath };
      }

      const visibleAlbums = await rclone.listAlbums();
      if (visibleAlbums === "listing-unavailable" && !config.acknowledgeUnknownRemote) {
        throw new RcloneError({
          message: "rclone album listing is unavailable. Re-run with --acknowledge-unknown-remote if you accept best-effort album preflight.",
        });
      }

      const albumResolutions = rclone.resolveAlbums(
        plan.albums.map((album) => album.albumName),
        visibleAlbums,
      );

      const duplicate = albumResolutions.find((resolution) => resolution.status === "duplicate-visible");
      if (duplicate) {
        throw new RcloneError({
          message: `Duplicate visible destination album: ${duplicate.albumName}`,
        });
      }

      for (const resolution of albumResolutions) {
        if (resolution.status === "needs-create") {
          await rclone.createAlbum(resolution.albumName);
        }
      }

      checkpoint = await runWorkItems({
        config,
        checkpoint,
        checkpointPath,
        rclone,
        workItems: plan.workItems,
      });

      const report = buildReport(plan, checkpoint);
      const finalReportPath = await writeReport(config.reportDir, "migration-report.md", renderFinalReport(report));

      return { plan, checkpoint, planReportPath, finalReportPath };
    } finally {
      await releaseLock();
    }
    },
    catch: (error) => (error instanceof Error ? error : new Error(String(error))),
  });
}

interface RunWorkItemsOptions {
  readonly config: RuntimeConfig;
  readonly checkpoint: CheckpointState;
  readonly checkpointPath: string;
  readonly rclone: RcloneClient;
  readonly workItems: readonly WorkItem[];
}

async function runWorkItems(options: RunWorkItemsOptions): Promise<CheckpointState> {
  const grouped = groupByAlbum(options.workItems);
  let checkpoint = options.checkpoint;
  let checkpointWrite = Promise.resolve();

  const updateAndSave = async (
    item: WorkItem,
    update: Parameters<typeof updateWorkItem>[2],
  ): Promise<void> => {
    checkpointWrite = checkpointWrite.then(async () => {
      checkpoint = updateWorkItem(checkpoint, item.id, update);
      await saveCheckpoint(options.checkpointPath, checkpoint);
    });
    await checkpointWrite;
  };

  await Effect.runPromise(
    Effect.forEach(
      [...grouped.values()],
      (items) =>
        Effect.promise(async () => {
          for (const item of items) {
            const state = checkpoint.workItems[item.id];
            if (state?.status === "complete") {
              continue;
            }

            await updateAndSave(item, {
              status: "running",
              attempts: (state?.attempts ?? 0) + 1,
            });

            try {
              await options.rclone.copyWorkItem(item, join(options.config.stateDir, "manifests"));
              await updateAndSave(item, {
                status: "complete",
                message: "rclone copy completed",
              });
            } catch (error) {
              await updateAndSave(item, {
                status: "failed",
                message: error instanceof Error ? error.message : String(error),
              });
            }
          }
        }),
      { concurrency: options.config.concurrency },
    ),
  );

  return checkpoint;
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
