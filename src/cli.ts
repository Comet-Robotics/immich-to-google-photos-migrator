import { Console, Effect } from "effect";
import { ConfigError } from "./types";
import { parseConfig, usage } from "./config";
import { runMigrationEffect } from "./scheduler";

export async function runCli(argv = process.argv.slice(2)): Promise<number> {
  return Effect.runPromise(runCliEffect(argv));
}

export function runCliEffect(argv = process.argv.slice(2)): Effect.Effect<number, never> {
  if (argv.includes("--help") || argv.includes("-h")) {
    return Console.log(usage()).pipe(Effect.as(0), Effect.orDie);
  }

  return Effect.gen(function* () {
    const config = parseConfig(argv);
    const result = yield* runMigrationEffect({ config });
    yield* Console.log(`Plan report: ${result.planReportPath}`);
    if (result.finalReportPath) {
      yield* Console.log(`Final report: ${result.finalReportPath}`);
    } else {
      yield* Console.log("Plan-only run complete; no uploads performed.");
    }
    return result.ok ? 0 : 1;
  }).pipe(
    Effect.catchAll((error) =>
      Console.error(renderError(error)).pipe(
        Effect.as(1),
      )),
    Effect.orDie,
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
