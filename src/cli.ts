import * as Command from "@effect/cli/Command";
import * as Options from "@effect/cli/Options";
import { BunContext } from "@effect/platform-bun";
import { Console, Effect, pipe } from "effect";
import { ConfigError } from "./types";
import { normalizeConfig, parseRuntimeConfig, usage } from "./config";
import { runMigrationEffect } from "./scheduler";

export async function runCli(argv = process.argv.slice(2)): Promise<number> {
  return Effect.runPromise(runCliEffect(argv).pipe(Effect.provide(BunContext.layer)));
}

interface MigrationFailedSentinel {
  readonly _tag: "MigrationFailedSentinel";
}

const migrationFailedSentinel: MigrationFailedSentinel = { _tag: "MigrationFailedSentinel" };

const cliCommand = Command.make(
  "immich-to-google-photos-migrator",
  {
    sourceRoot: Options.text("source"),
    remote: Options.text("remote"),
    stateDir: pipe(Options.text("state-dir"), Options.withDefault(".immich-google-photos-migrator/state")),
    reportDir: pipe(Options.text("report-dir"), Options.withDefault(".immich-google-photos-migrator/reports")),
    concurrency: pipe(Options.integer("concurrency"), Options.withDefault(2)),
    rcloneBinary: pipe(Options.text("rclone-binary"), Options.withDefault("rclone")),
    planOnly: pipe(Options.boolean("plan-only"), Options.withDefault(false)),
    yes: pipe(Options.boolean("yes"), Options.withDefault(false)),
    acknowledgeNonLeafMedia: pipe(
      Options.boolean("acknowledge-non-leaf-media"),
      Options.withDefault(false),
    ),
    acknowledgeUnreadablePaths: pipe(
      Options.boolean("acknowledge-unreadable-paths"),
      Options.withDefault(false),
    ),
    acknowledgeUnknownRemote: pipe(
      Options.boolean("acknowledge-unknown-remote"),
      Options.withDefault(false),
    ),
    retryUncertain: pipe(Options.boolean("retry-uncertain"), Options.withDefault(false)),
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
          rcloneBinary: args.rcloneBinary,
        }),
      );
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

export function runCliEffect(argv = process.argv.slice(2)): Effect.Effect<number, never, never> {
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
    return Console.log(usage()).pipe(Effect.as(0), Effect.orDie);
  }

  return Command.run(cliCommand, {
    name: "immich-to-google-photos-migrator",
    version: "0.1.0",
  })(argv).pipe(
    Effect.as(0),
    Effect.catchAll((error) =>
      error === migrationFailedSentinel
        ? Effect.succeed(1)
        : Console.error(renderError(error)).pipe(Effect.as(1))),
    Effect.orDie,
    Effect.provide(BunContext.layer),
  );
}

function renderError(error: unknown): string {
  if (error instanceof ConfigError) {
    return `Configuration error: ${error.message}\n\n${usage()}`;
  }
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }
  return String(error);
}
