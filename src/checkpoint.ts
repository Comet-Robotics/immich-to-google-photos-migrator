import { open, rm } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { join } from "node:path";
import { Schema } from "effect";
import { ensurePrivateDirectory, writePrivateFileAtomically } from "./private-file";
import { ALBUM_POLICY_VERSION, CheckpointError, MEDIA_ALLOWLIST_VERSION, type CheckpointState, type MigrationIdentity, type MigrationPlan, type WorkItemId, type WorkItemState } from "./types";

const CHECKPOINT_VERSION = 1;
const WorkItemStatusSchema = Schema.Literal("planned", "running", "complete", "failed", "uncertain");
const MigrationIdentitySchema = Schema.Struct({
  sourceRoot: Schema.String,
  remote: Schema.String,
  remoteFingerprint: Schema.String,
  albumPolicyVersion: Schema.Number,
  mediaAllowlistVersion: Schema.Number,
  planFingerprint: Schema.String,
});
const WorkItemStateSchema = Schema.Struct({
  id: Schema.String,
  status: WorkItemStatusSchema,
  attempts: Schema.NonNegativeInt,
  updatedAt: Schema.String,
  message: Schema.optional(Schema.String),
});
const CheckpointStateSchema = Schema.Struct({
  version: Schema.Literal(CHECKPOINT_VERSION),
  identity: MigrationIdentitySchema,
  workItems: Schema.Record({ key: Schema.String, value: WorkItemStateSchema }),
});

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
  const contents = `${JSON.stringify(state, null, 2)}\n`;
  await writePrivateFileAtomically(checkpointPath, contents);
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

function parseCheckpoint(value: unknown): CheckpointState {
  try {
    const decoded = Schema.decodeUnknownSync(CheckpointStateSchema)(value);
    for (const [id, item] of Object.entries(decoded.workItems)) {
      if (item.id !== id) {
        throw new CheckpointError({ message: `Checkpoint work item ${id} has mismatched id` });
      }
    }
    return decoded as CheckpointState;
  } catch (error) {
    if (error instanceof CheckpointError) {
      throw error;
    }
    throw new CheckpointError({ message: "Checkpoint has an unsupported version or shape" });
  }
}
