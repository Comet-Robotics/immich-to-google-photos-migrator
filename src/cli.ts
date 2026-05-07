import { ConfigError } from "./types";
import { parseConfig, usage } from "./config";
import { runMigration } from "./scheduler";

export async function runCli(argv = process.argv.slice(2)): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(usage());
    return 0;
  }

  try {
    const config = parseConfig(argv);
    const result = await runMigration({ config });
    console.log(`Plan report: ${result.planReportPath}`);
    if (result.finalReportPath) {
      console.log(`Final report: ${result.finalReportPath}`);
    } else {
      console.log("Plan-only run complete; no uploads performed.");
    }
    return result.ok ? 0 : 1;
  } catch (error) {
    console.error(renderError(error));
    return 1;
  }
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
