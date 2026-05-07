import { resolve } from "node:path";
import { ConfigError, type RuntimeConfig } from "./types";

const DEFAULT_CONCURRENCY = 2;
const DEFAULT_RCLONE_BINARY = "rclone";

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

    const [rawName, inlineValue] = arg.slice(2).split("=", 2);
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

  return {
    sourceRoot: resolve(cwd, sourceRoot),
    remote,
    stateDir: resolve(cwd, stateDir),
    reportDir: resolve(cwd, reportDir),
    concurrency,
    planOnly: flags.has("plan-only"),
    yes: flags.has("yes"),
    acknowledgeNonLeafMedia: flags.has("acknowledge-non-leaf-media") || flags.has("yes"),
    acknowledgeUnknownRemote: flags.has("acknowledge-unknown-remote") || flags.has("yes"),
    rcloneBinary: values.get("rclone-binary") ?? DEFAULT_RCLONE_BINARY,
  };
}

export function usage(): string {
  return [
    "Usage: bun run index.ts --source <immich-library-root> --remote <rclone-remote> [options]",
    "",
    "Options:",
    "  --state-dir <path>                 Directory for private checkpoint state",
    "  --report-dir <path>                Directory for migration reports",
    "  --concurrency <n>                  Album-parallel upload workers (default: 2)",
    "  --rclone-binary <path>             rclone executable to run (default: rclone)",
    "  --plan-only                        Build and report the plan without uploading",
    "  --acknowledge-non-leaf-media       Continue when media exists outside leaf folders",
    "  --acknowledge-unknown-remote       Continue when remote identity/listing is limited",
    "  --yes                              Apply all explicit acknowledgements",
  ].join("\n");
}

function isBooleanFlag(name: string): boolean {
  return [
    "plan-only",
    "yes",
    "acknowledge-non-leaf-media",
    "acknowledge-unknown-remote",
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
