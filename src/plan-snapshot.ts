import { join } from "node:path";
import { Schema } from "effect";
import { writePrivateFileAtomically } from "./private-file";
import { CheckpointError, type MigrationPlan } from "./types";

export const PLAN_SNAPSHOT_VERSION = 1;
export const PLAN_SNAPSHOT_FILENAME = "plan-snapshot.json";

const PlanSnapshotSchema = Schema.Struct({
  version: Schema.Literal(PLAN_SNAPSHOT_VERSION),
  savedAt: Schema.String,
  plan: Schema.Unknown,
});

export interface PlanSnapshot {
  readonly version: typeof PLAN_SNAPSHOT_VERSION;
  readonly savedAt: string;
  readonly plan: MigrationPlan;
}

export function planSnapshotPath(stateDir: string): string {
  return join(stateDir, PLAN_SNAPSHOT_FILENAME);
}

export async function savePlanSnapshot(stateDir: string, plan: MigrationPlan): Promise<void> {
  const snapshot: PlanSnapshot = {
    version: PLAN_SNAPSHOT_VERSION,
    savedAt: new Date().toISOString(),
    plan,
  };
  await writePrivateFileAtomically(planSnapshotPath(stateDir), `${JSON.stringify(snapshot, null, 2)}\n`);
}

export async function loadPlanSnapshot(stateDir: string): Promise<MigrationPlan | undefined> {
  const path = planSnapshotPath(stateDir);
  try {
    const raw = await Bun.file(path).text();
    const parsed = Schema.decodeUnknownSync(PlanSnapshotSchema)(JSON.parse(raw));
    if (!isMigrationPlan(parsed.plan)) {
      throw new CheckpointError({ message: "Plan snapshot has an invalid plan shape", path });
    }
    return parsed.plan;
  } catch (error) {
    if (isNotFound(error)) {
      return undefined;
    }
    if (error instanceof CheckpointError) {
      throw error;
    }
    throw new CheckpointError({
      message: `Unable to load plan snapshot: ${error instanceof Error ? error.message : String(error)}`,
      path,
    });
  }
}

function isMigrationPlan(value: unknown): value is MigrationPlan {
  if (!value || typeof value !== "object") {
    return false;
  }
  const plan = value as MigrationPlan;
  return (
    typeof plan.sourceRoot === "string" &&
    typeof plan.planFingerprint === "string" &&
    Array.isArray(plan.workItems) &&
    Array.isArray(plan.albums)
  );
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
