import { resolve } from "node:path";
import { Schema } from "effect";
import { parseListOption } from "./work-item-filter";
import { ConfigError, type RuntimeConfig } from "./types";

const RuntimeConfigSchema = Schema.Struct({
  sourceRoot: Schema.String,
  remote: Schema.String,
  stateDir: Schema.String,
  reportDir: Schema.String,
  concurrency: Schema.Int.pipe(Schema.between(1, 16)),
  planOnly: Schema.Boolean,
  yes: Schema.Boolean,
  acknowledgeNonLeafMedia: Schema.Boolean,
  acknowledgeUnreadablePaths: Schema.Boolean,
  acknowledgeUnknownRemote: Schema.Boolean,
  retryUncertain: Schema.Boolean,
  retryUncertainOnly: Schema.Boolean,
  onlyPaths: Schema.Array(Schema.String),
  onlyWorkItemIds: Schema.Array(Schema.String),
  rcloneBinary: Schema.String,
  printRemoteFingerprint: Schema.Boolean,
});


export interface RawRuntimeConfig {
  readonly sourceRoot: string;
  readonly remote: string;
  readonly stateDir: string;
  readonly reportDir: string;
  readonly concurrency: number;
  readonly planOnly: boolean;
  readonly yes: boolean;
  readonly acknowledgeNonLeafMedia: boolean;
  readonly acknowledgeUnreadablePaths: boolean;
  readonly acknowledgeUnknownRemote: boolean;
  readonly retryUncertain: boolean;
  readonly retryFailed: boolean;
  readonly retryUncertainOnly: boolean;
  readonly onlyPath?: string;
  readonly onlyWorkItemId?: string;
  readonly rcloneBinary: string;
  readonly printRemoteFingerprint: boolean;
}

export function normalizeConfig(raw: RawRuntimeConfig, cwd = process.cwd()): RawRuntimeConfig {
  return {
    ...raw,
    sourceRoot: resolve(cwd, raw.sourceRoot),
    stateDir: resolve(cwd, raw.stateDir),
    reportDir: resolve(cwd, raw.reportDir),
  };
}

export function parseRuntimeConfig(raw: RawRuntimeConfig): RuntimeConfig {
  const retryUncertain = raw.retryUncertain || raw.retryFailed || raw.retryUncertainOnly;
  const onlyPaths = parseListOption(raw.onlyPath);
  const onlyWorkItemIds = parseListOption(raw.onlyWorkItemId);

  try {
    return Schema.decodeUnknownSync(RuntimeConfigSchema)({
      sourceRoot: raw.sourceRoot,
      remote: raw.remote,
      stateDir: raw.stateDir,
      reportDir: raw.reportDir,
      concurrency: raw.concurrency,
      planOnly: raw.planOnly,
      yes: raw.yes,
      acknowledgeNonLeafMedia: raw.acknowledgeNonLeafMedia,
      acknowledgeUnreadablePaths: raw.acknowledgeUnreadablePaths,
      acknowledgeUnknownRemote: raw.acknowledgeUnknownRemote,
      retryUncertain,
      retryUncertainOnly: raw.retryUncertainOnly,
      onlyPaths,
      onlyWorkItemIds,
      rcloneBinary: raw.rcloneBinary,
      printRemoteFingerprint: raw.printRemoteFingerprint,
    }) as RuntimeConfig;
  } catch {
    throw new ConfigError({ message: "Invalid runtime configuration values" });
  }
}
