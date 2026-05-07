import { mkdir, open, rename, rm, stat } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { dirname, join } from "node:path";
import { ALBUM_POLICY_VERSION, CheckpointError, MEDIA_ALLOWLIST_VERSION, type CheckpointState, type MigrationIdentity, type MigrationPlan, type WorkItemId, type WorkItemState } from "./types";

const CHECKPOINT_VERSION = 1;
const WORK_ITEM_STATUSES = new Set(["planned", "running", "complete", "failed", "uncertain"]);

export function migrationIdentity(
  plan: MigrationPlan,
  remote: string,
  remoteFingerprint: string,
): MigrationIdentity {
  return {
    sourceRoot: plan.sourceRoot,
    remote,
    remoteFingerprint,
    albumPolicyVersion: ALBUM_POLICY_VERSION,
    mediaAllowlistVersion: MEDIA_ALLOWLIST_VERSION,
    planFingerprint: plan.planFingerprint,
  };
}

export function initialCheckpoint(
  plan: MigrationPlan,
  remote: string,
  remoteFingerprint: string,
): CheckpointState {
  const now = new Date().toISOString();
  return {
    version: CHECKPOINT_VERSION,
    identity: migrationIdentity(plan, remote, remoteFingerprint),
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
  remoteFingerprint: string,
): Promise<CheckpointState> {
  try {
    const raw = await Bun.file(checkpointPath).text();
    const parsed = parseCheckpoint(JSON.parse(raw));
    assertCompatibleIdentity(parsed.identity, migrationIdentity(plan, remote, remoteFingerprint));
    return normalizeRunningWork(mergeNewWorkItems(parsed, plan));
  } catch (error) {
    if (isNotFound(error)) {
      return initialCheckpoint(plan, remote, remoteFingerprint);
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
  const directory = dirname(checkpointPath);
  await ensurePrivateDirectory(directory);
  const tmpPath = `${checkpointPath}.tmp-${process.pid}`;
  const contents = `${JSON.stringify(state, null, 2)}\n`;
  const handle = await open(tmpPath, "w", 0o600);
  try {
    await handle.writeFile(contents);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(tmpPath, checkpointPath);
  await syncDirectory(directory);
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
  let handle: FileHandle;
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

export async function ensurePrivateDirectory(directory: string): Promise<void> {
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

function normalizeRunningWork(state: CheckpointState): CheckpointState {
  const now = new Date().toISOString();
  const workItems = Object.fromEntries(
    Object.entries(state.workItems).map(([id, item]) => [
      id,
      item.status === "running"
        ? {
            ...item,
            status: "uncertain" as const,
            updatedAt: now,
            message: "Previous run ended while this work item was running",
          }
        : item,
    ]),
  );

  return { ...state, workItems };
}

function assertCompatibleIdentity(actual: MigrationIdentity, expected: MigrationIdentity): void {
  const mismatches = [
    ["source root", actual.sourceRoot, expected.sourceRoot],
    ["remote", actual.remote, expected.remote],
    ["remote fingerprint", actual.remoteFingerprint, expected.remoteFingerprint],
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

async function syncDirectory(directory: string): Promise<void> {
  let handle: FileHandle | undefined;
  try {
    handle = await open(directory, "r");
    await handle.sync();
  } catch {
    // Some platforms do not allow directory fsync; the file fsync plus rename is still the best effort.
  } finally {
    await handle?.close();
  }
}

function parseCheckpoint(value: unknown): CheckpointState {
  if (!isRecord(value) || value.version !== CHECKPOINT_VERSION) {
    throw new CheckpointError({ message: "Checkpoint has an unsupported version or shape" });
  }
  if (!isIdentity(value.identity) || !isRecord(value.workItems)) {
    throw new CheckpointError({ message: "Checkpoint has an invalid identity or work item map" });
  }

  return {
    version: CHECKPOINT_VERSION,
    identity: value.identity,
    workItems: Object.fromEntries(
      Object.entries(value.workItems).map(([id, item]) => [id, parseWorkItemState(id, item)]),
    ),
  };
}

function parseWorkItemState(id: string, value: unknown): WorkItemState {
  if (!isRecord(value)) {
    throw new CheckpointError({ message: `Checkpoint work item ${id} is invalid` });
  }
  if (
    value.id !== id ||
    typeof value.status !== "string" ||
    !WORK_ITEM_STATUSES.has(value.status) ||
    typeof value.attempts !== "number" ||
    !Number.isInteger(value.attempts) ||
    value.attempts < 0 ||
    typeof value.updatedAt !== "string"
  ) {
    throw new CheckpointError({ message: `Checkpoint work item ${id} has invalid fields` });
  }

  return {
    id,
    status: value.status as WorkItemState["status"],
    attempts: value.attempts,
    updatedAt: value.updatedAt,
    message: typeof value.message === "string" ? value.message : undefined,
  };
}

function isIdentity(value: unknown): value is MigrationIdentity {
  return (
    isRecord(value) &&
    typeof value.sourceRoot === "string" &&
    typeof value.remote === "string" &&
    typeof value.remoteFingerprint === "string" &&
    typeof value.albumPolicyVersion === "number" &&
    typeof value.mediaAllowlistVersion === "number" &&
    typeof value.planFingerprint === "string"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
