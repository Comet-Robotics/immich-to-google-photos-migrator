import { mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ALBUM_POLICY_VERSION, CheckpointError, MEDIA_ALLOWLIST_VERSION, type CheckpointState, type MigrationIdentity, type MigrationPlan, type WorkItemId, type WorkItemState } from "./types";

const CHECKPOINT_VERSION = 1;

export function migrationIdentity(plan: MigrationPlan, remote: string): MigrationIdentity {
  return {
    sourceRoot: plan.sourceRoot,
    remote,
    albumPolicyVersion: ALBUM_POLICY_VERSION,
    mediaAllowlistVersion: MEDIA_ALLOWLIST_VERSION,
    planFingerprint: plan.planFingerprint,
  };
}

export function initialCheckpoint(plan: MigrationPlan, remote: string): CheckpointState {
  const now = new Date().toISOString();
  return {
    version: CHECKPOINT_VERSION,
    identity: migrationIdentity(plan, remote),
    workItems: Object.fromEntries(
      plan.workItems.map((item) => [
        item.id,
        {
          id: item.id,
          status: "planned",
          attempts: 0,
          updatedAt: now,
        } satisfies WorkItemState,
      ]),
    ),
  };
}

export async function loadOrCreateCheckpoint(
  checkpointPath: string,
  plan: MigrationPlan,
  remote: string,
): Promise<CheckpointState> {
  try {
    const raw = await readFile(checkpointPath, "utf8");
    const parsed = JSON.parse(raw) as CheckpointState;
    assertCompatibleIdentity(parsed.identity, migrationIdentity(plan, remote));
    return mergeNewWorkItems(parsed, plan);
  } catch (error) {
    if (isNotFound(error)) {
      return initialCheckpoint(plan, remote);
    }
    if (error instanceof CheckpointError) {
      throw error;
    }
    throw new CheckpointError({
      message: `Unable to load checkpoint: ${errorMessage(error)}`,
      path: checkpointPath,
    });
  }
}

export async function saveCheckpoint(checkpointPath: string, state: CheckpointState): Promise<void> {
  await ensurePrivateDirectory(checkpointPath.slice(0, checkpointPath.lastIndexOf("/")));
  const tmpPath = `${checkpointPath}.tmp-${process.pid}`;
  const contents = `${JSON.stringify(state, null, 2)}\n`;
  await writeFile(tmpPath, contents, { mode: 0o600 });
  await rename(tmpPath, checkpointPath);
}

export function updateWorkItem(
  state: CheckpointState,
  id: WorkItemId,
  update: Omit<Partial<WorkItemState>, "id" | "updatedAt">,
): CheckpointState {
  const existing = state.workItems[id];
  if (!existing) {
    throw new CheckpointError({ message: `Unknown work item ${id}` });
  }
  return {
    ...state,
    workItems: {
      ...state.workItems,
      [id]: {
        ...existing,
        ...update,
        attempts: update.attempts ?? existing.attempts,
        updatedAt: new Date().toISOString(),
      },
    },
  };
}

export async function acquireRunLock(stateDir: string): Promise<() => Promise<void>> {
  await ensurePrivateDirectory(stateDir);
  const lockPath = join(stateDir, "migration.lock");
  let handle;
  try {
    handle = await open(lockPath, "wx", 0o600);
  } catch (error) {
    if (isAlreadyExists(error)) {
      throw new CheckpointError({
        message: `Migration lock already exists at ${lockPath}. Remove it only after confirming no migration is running.`,
        path: lockPath,
      });
    }
    throw error;
  }

  await handle.writeFile(
    JSON.stringify(
      {
        pid: process.pid,
        startedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
  await handle.close();

  return async () => {
    await rm(lockPath, { force: true });
  };
}

async function ensurePrivateDirectory(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  try {
    const info = await stat(directory);
    if ((info.mode & 0o077) !== 0) {
      throw new CheckpointError({
        message: `State directory is group/world accessible: ${directory}`,
        path: directory,
      });
    }
  } catch (error) {
    if (error instanceof CheckpointError) {
      throw error;
    }
  }
}

function mergeNewWorkItems(state: CheckpointState, plan: MigrationPlan): CheckpointState {
  const now = new Date().toISOString();
  const workItems = { ...state.workItems };
  for (const item of plan.workItems) {
    workItems[item.id] ??= {
      id: item.id,
      status: "planned",
      attempts: 0,
      updatedAt: now,
    };
  }
  return { ...state, workItems };
}

function assertCompatibleIdentity(actual: MigrationIdentity, expected: MigrationIdentity): void {
  const mismatches = [
    ["source root", actual.sourceRoot, expected.sourceRoot],
    ["remote", actual.remote, expected.remote],
    ["album policy version", actual.albumPolicyVersion, expected.albumPolicyVersion],
    ["media allowlist version", actual.mediaAllowlistVersion, expected.mediaAllowlistVersion],
    ["plan fingerprint", actual.planFingerprint, expected.planFingerprint],
  ].filter(([, actualValue, expectedValue]) => actualValue !== expectedValue);

  if (mismatches.length > 0) {
    throw new CheckpointError({
      message: `Checkpoint identity mismatch: ${mismatches.map(([label]) => label).join(", ")}`,
    });
  }
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function isAlreadyExists(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
