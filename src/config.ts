import { resolve } from "node:path";
import { Schema } from "effect";
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
  rcloneBinary: Schema.String,
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
  readonly rcloneBinary: string;
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
  try {
    return Schema.decodeUnknownSync(RuntimeConfigSchema)(raw) as RuntimeConfig;
  } catch {
    throw new ConfigError({ message: "Invalid runtime configuration values" });
  }
}
