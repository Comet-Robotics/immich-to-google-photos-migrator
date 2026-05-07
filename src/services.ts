import { Context, Layer } from "effect";
import { BunProcessRunner, RcloneClient } from "./rclone";
import type { ProcessRunner, RuntimeConfig } from "./types";

export class ProcessRunnerService extends Context.Tag("ProcessRunnerService")<
  ProcessRunnerService,
  ProcessRunner
>() {}

export class RcloneService extends Context.Tag("RcloneService")<
  RcloneService,
  RcloneClient
>() {}

export const processRunnerLayer = Layer.succeed(ProcessRunnerService, new BunProcessRunner());

export function rcloneLayer(
  config: RuntimeConfig,
  runner?: ProcessRunner,
): Layer.Layer<RcloneService> {
  return Layer.succeed(
    RcloneService,
    new RcloneClient({ config, runner: runner ?? new BunProcessRunner() }),
  );
}
