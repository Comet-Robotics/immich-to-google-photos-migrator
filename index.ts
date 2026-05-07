import { BunContext, BunRuntime } from "@effect/platform-bun";
import { Effect } from "effect";
import { runCliEffect } from "./src/cli";

const program = runCliEffect().pipe(
  Effect.tap((exitCode) => Effect.sync(() => {
    process.exitCode = exitCode;
  })),
);

BunRuntime.runMain(program.pipe(Effect.provide(BunContext.layer)));