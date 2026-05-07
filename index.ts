import { runCli } from "./src/cli";

const exitCode = await runCli();
process.exitCode = exitCode;