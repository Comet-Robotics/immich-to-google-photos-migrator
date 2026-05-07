import { basename, extname, resolve } from "node:path";
import { Schema } from "effect";
import { ConfigError, type RuntimeConfig } from "./types";

const DEFAULT_CONCURRENCY = 2;
const DEFAULT_RCLONE_BINARY = "rclone";
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
const VALUE_OPTIONS = new Set([
  "source",
  "remote",
  "state-dir",
  "report-dir",
  "concurrency",
  "rclone-binary",
]);

export function parseConfig(argv: readonly string[], cwd = process.cwd()): RuntimeConfig {
  const args = [...argv];
  const values = new Map<string, string>();
  const flags = new Set<string>();

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) {
      continue;
    }

    if (!arg.startsWith("--")) {
      throw new ConfigError({ message: `Unexpected positional argument: ${arg}` });
    }

    const option = arg.slice(2);
    const equalsIndex = option.indexOf("=");
    const rawName = equalsIndex === -1 ? option : option.slice(0, equalsIndex);
    const inlineValue = equalsIndex === -1 ? undefined : option.slice(equalsIndex + 1);
    if (!rawName) {
      throw new ConfigError({ message: `Invalid option: ${arg}` });
    }

    if (isBooleanFlag(rawName)) {
      if (inlineValue !== undefined) {
        throw new ConfigError({ message: `Option --${rawName} does not accept a value` });
      }
      flags.add(rawName);
      continue;
    }

    if (!VALUE_OPTIONS.has(rawName)) {
      throw new ConfigError({ message: `Unknown option --${rawName}` });
    }

    const value = inlineValue ?? args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new ConfigError({ message: `Option --${rawName} requires a value` });
    }
    values.set(rawName, value);
    if (inlineValue === undefined) {
      index += 1;
    }
  }

  const sourceRoot = values.get("source");
  const remote = values.get("remote");

  if (!sourceRoot) {
    throw new ConfigError({ message: "Missing required option --source" });
  }
  if (!remote) {
    throw new ConfigError({ message: "Missing required option --remote" });
  }

  const concurrency = parseConcurrency(values.get("concurrency"));
  const stateDir = values.get("state-dir") ?? ".immich-google-photos-migrator/state";
  const reportDir = values.get("report-dir") ?? ".immich-google-photos-migrator/reports";

  const resolved = normalizeConfig(
    {
      sourceRoot,
      remote,
      stateDir,
      reportDir,
      concurrency,
      planOnly: flags.has("plan-only"),
      yes: flags.has("yes"),
      acknowledgeNonLeafMedia: flags.has("acknowledge-non-leaf-media") || flags.has("yes"),
      acknowledgeUnreadablePaths: flags.has("acknowledge-unreadable-paths") || flags.has("yes"),
      acknowledgeUnknownRemote: flags.has("acknowledge-unknown-remote") || flags.has("yes"),
      retryUncertain: flags.has("retry-uncertain"),
      rcloneBinary: values.get("rclone-binary") ?? DEFAULT_RCLONE_BINARY,
    },
    cwd,
  );
  return parseRuntimeConfig(resolved);
}

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

export function usage(): string {
  return [
    `Usage: immich-to-google-photos-migrator --source <immich-library-root> --remote <rclone-remote> [options]`,
    "",
    "Options:",
    "  --state-dir <path>                 Directory for private checkpoint state",
    "  --report-dir <path>                Directory for migration reports",
    "  --concurrency <n>                  Album-parallel upload workers (default: 2)",
    "  --rclone-binary <path>             rclone executable to run (default: rclone)",
    "  --plan-only                        Build and report the plan without uploading",
    "  --acknowledge-non-leaf-media       Continue when media exists outside leaf folders",
    "  --acknowledge-unreadable-paths     Continue when paths could not be read",
    "  --acknowledge-unknown-remote       Continue when remote identity/listing is limited",
    "  --retry-uncertain                  Retry work that may have partially uploaded previously",
    "  --yes                              Apply all explicit acknowledgements",
  ].join("\n");
}

function isBooleanFlag(name: string): boolean {
  return [
    "plan-only",
    "yes",
    "acknowledge-non-leaf-media",
    "acknowledge-unreadable-paths",
    "acknowledge-unknown-remote",
    "retry-uncertain",
  ].includes(name);
}

function parseConcurrency(value: string | undefined): number {
  if (value === undefined) {
    return DEFAULT_CONCURRENCY;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 16) {
    throw new ConfigError({ message: "--concurrency must be an integer between 1 and 16" });
  }
  return parsed;
}

function looksLikeScriptPath(value: string): boolean {
  if (value.startsWith("-")) {
    return false;
  }
  return [".js", ".mjs", ".cjs", ".ts", ".mts", ".cts", ".tsx", ".jsx"].includes(extname(value));
}
