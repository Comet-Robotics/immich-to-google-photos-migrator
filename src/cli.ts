import * as Command from "@effect/cli/Command";
import * as Options from "@effect/cli/Options";
import { BunContext } from "@effect/platform-bun";
import { inspect } from "node:util";
import { Console, Effect, Option, pipe } from "effect";
import { normalizeConfig, parseRuntimeConfig } from "./config";
import type { GitBuildInfo } from "./git-build-info.macro.ts";
import { gitBuildInfo } from "./git-build-info.macro.ts" with { type: "macro" };
import { BunProcessRunner, RcloneClient } from "./rclone";
import { runMigrationEffect } from "./scheduler";
import { ConfigError } from "./types";

function cliVersionFromGit(info: GitBuildInfo): string {
  const firstLine =
    info.message.split(/\r?\n/).find((line) => line.trim().length > 0)?.trim() ?? "";
  const summary = firstLine.length > 0 ? firstLine : "(no message)";
  return `${info.hash} ${summary}`;
}

const CLI_VERSION = cliVersionFromGit(gitBuildInfo());

export async function runCli(argv = process.argv): Promise<number> {
  return Effect.runPromise(runCliEffect(argv).pipe(Effect.provide(BunContext.layer)));
}

interface MigrationFailedSentinel {
  readonly _tag: "MigrationFailedSentinel";
}

const migrationFailedSentinel: MigrationFailedSentinel = { _tag: "MigrationFailedSentinel" };

const cliCommand = Command.make(
  "immich-to-google-photos-migrator",
  {
    sourceRoot: Options.text("source")
      .pipe(Options.withDescription("Root directory of the Immich library"))
      .pipe(Options.withDefault(process.cwd())),
    remote: Options.text("remote")
      .pipe(Options.withDescription("The name of the rclone remote to use for Google Photos - find using `rclone listremotes`"))
      .pipe(Options.withDefault("gphotos")),
    stateDir: Options.text("state-dir")
      .pipe(Options.withDefault(".immich-google-photos-migrator/state"))
      .pipe(Options.withDescription("Directory to write private checkpoint state to")),
    reportDir: Options.text("report-dir")
      .pipe(Options.withDefault(".immich-google-photos-migrator/reports"))
      .pipe(Options.withDescription("Directory to write migration report to")),
    concurrency: Options.integer("concurrency")
      .pipe(Options.withDescription("Number of concurrent uploads to perform"))
      .pipe(Options.withDefault(2)),
    rcloneBinary: Options.text("rclone-binary")
      .pipe(Options.withDescription("Path to the rclone binary to use"))
      .pipe(Options.withDefault("rclone")),
    planOnly: Options.boolean("plan-only")
      .pipe(Options.withDescription("Only build the plan and not perform any uploads"))
      .pipe(Options.withDefault(true)),
    yes: Options.boolean("yes")
      .pipe(Options.withDescription("Automatically acknowledge all prompts"))
      .pipe(Options.withDefault(false)),
    acknowledgeNonLeafMedia: Options.boolean("acknowledge-non-leaf-media")
      .pipe(Options.withDescription("Continue when media exists outside leaf folders"))
      .pipe(Options.withDefault(false)),
    acknowledgeUnreadablePaths: Options.boolean("acknowledge-unreadable-paths")
      .pipe(Options.withDescription("Continuine paths could not be read"))
      .pipe(Options.withDefault(false)),
    acknowledgeUnknownRemote: Options.boolean("acknowledge-unknown-remote")
      .pipe(Options.withDescription("Continue when remote identity/listing is limited"))
      .pipe(Options.withDefault(false)),
    retryUncertain: Options.boolean("retry-uncertain")
      .pipe(Options.withDescription("Retry failed or uncertain uploads from a previous run"))
      .pipe(Options.withDefault(false)),
    retryFailed: Options.boolean("retry-failed")
      .pipe(Options.withDescription("Alias for --retry-uncertain"))
      .pipe(Options.withDefault(false)),
    retryUncertainOnly: Options.boolean("retry-uncertain-only")
      .pipe(
        Options.withDescription(
          "Retry only failed/uncertain work items; use saved plan snapshot when available (implies --retry-uncertain)",
        ),
      )
      .pipe(Options.withDefault(false)),
    onlyPath: Options.text("only-path")
      .pipe(Options.withDescription("Comma-separated source folder path filter (relative to --source)"))
      .pipe(Options.optional),
    onlyWorkItemId: Options.text("only-work-item-id")
      .pipe(Options.withDescription("Comma-separated work item id filter"))
      .pipe(Options.optional),
    printRemoteFingerprint: Options.boolean("print-remote-fingerprint")
      .pipe(
        Options.withDescription(
          "Run rclone preflight only, print the stable remote fingerprint for checkpoint.json, then exit",
        ),
      )
      .pipe(Options.withDefault(false)),
  },
  (args) =>
    Effect.gen(function* () {
      const config = parseRuntimeConfig(
        normalizeConfig({
          sourceRoot: args.sourceRoot,
          remote: args.remote,
          stateDir: args.stateDir,
          reportDir: args.reportDir,
          concurrency: args.concurrency,
          planOnly: args.planOnly,
          yes: args.yes,
          acknowledgeNonLeafMedia: args.acknowledgeNonLeafMedia || args.yes,
          acknowledgeUnreadablePaths: args.acknowledgeUnreadablePaths || args.yes,
          acknowledgeUnknownRemote: args.acknowledgeUnknownRemote || args.yes,
          retryUncertain: args.retryUncertain,
          retryFailed: args.retryFailed,
          retryUncertainOnly: args.retryUncertainOnly,
          onlyPath: Option.getOrUndefined(args.onlyPath),
          onlyWorkItemId: Option.getOrUndefined(args.onlyWorkItemId),
          rcloneBinary: args.rcloneBinary,
          printRemoteFingerprint: args.printRemoteFingerprint,
        }),
      );
      if (config.printRemoteFingerprint) {
        const runner = new BunProcessRunner();
        const rclone = new RcloneClient({ config, runner });
        const preflight = yield* rclone.preflight();
        yield* Console.log(preflight.remoteFingerprint);
        return;
      }
      const result = yield* runMigrationEffect({ config });
      yield* Console.log(`Plan report: ${result.planReportPath}`);
      if (result.finalReportPath) {
        yield* Console.log(`Final report: ${result.finalReportPath}`);
      } else {
        yield* Console.log("Plan-only run complete; no uploads performed.");
      }
      if (!result.ok) {
        return yield* Effect.fail(migrationFailedSentinel);
      }
    }),
);

export function runCliEffect(argv = process.argv): Effect.Effect<number, never, never> {
 return Command.run(cliCommand, {
    name: "immich-to-google-photos-migrator",
    version: CLI_VERSION,
  })(argv).pipe(
    Effect.as(0),
    Effect.catchAll((error) =>
      error === migrationFailedSentinel
        ? Effect.succeed(1)
        : isCliValidationError(error)
          ? Effect.succeed(1)
        : Console.error(renderError(error)).pipe(Effect.as(1))),
    Effect.orDie,
    Effect.provide(BunContext.layer),
  );
}

function renderError(error: unknown): string {
  if (error instanceof ConfigError) {
    return `Configuration error: ${error.message}`;
  }
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }
  if (
    typeof error === "object" &&
    error !== null &&
    "error" in error &&
    typeof (error as { error?: unknown }).error === "object"
  ) {
    const rendered = renderCliDoc((error as { error: unknown }).error);
    if (rendered) {
      return rendered;
    }
  }
  try {
    return JSON.stringify(error, null, 2);
  } catch {
    return inspect(error);
  }
}

function renderCliDoc(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || !("_tag" in value)) {
    return undefined;
  }
  const tagged = value as { _tag: string; value?: unknown; left?: unknown; right?: unknown };
  switch (tagged._tag) {
    case "Text":
      return typeof tagged.value === "string" ? tagged.value : undefined;
    case "Paragraph":
      return renderCliDoc(tagged.value);
    case "Sequence": {
      const left = renderCliDoc(tagged.left);
      const right = renderCliDoc(tagged.right);
      return [left, right].filter(Boolean).join(" ").trim() || undefined;
    }
    default:
      return undefined;
  }
}

function isCliValidationError(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("_tag" in error)) {
    return false;
  }
  return ["MissingValue", "InvalidArgument", "CommandMismatch", "ValidationError"].includes(
    String((error as { _tag: unknown })._tag),
  );
}
