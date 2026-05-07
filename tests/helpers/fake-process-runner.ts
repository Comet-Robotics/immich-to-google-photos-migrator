import type { ProcessResult, ProcessRunOptions, ProcessRunner } from "../../src/types";

export interface FakeProcessCall {
  readonly command: readonly string[];
  readonly options?: ProcessRunOptions;
}

export interface FakeProcessResult extends Partial<ProcessResult> {
  readonly delayMs?: number;
}

export class FakeProcessRunner implements ProcessRunner {
  readonly calls: FakeProcessCall[] = [];
  private readonly results: FakeProcessResult[] = [];

  constructor(results: readonly FakeProcessResult[] = []) {
    this.results = results.map((result) => ({
      command: result.command ?? [],
      exitCode: result.exitCode ?? 0,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      timedOut: result.timedOut,
      signalCode: result.signalCode,
      delayMs: result.delayMs,
    }));
  }

  queue(result: FakeProcessResult): void {
    this.results.push({
      command: result.command ?? [],
      exitCode: result.exitCode ?? 0,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      timedOut: result.timedOut,
      signalCode: result.signalCode,
      delayMs: result.delayMs,
    });
  }

  async run(command: readonly string[], options?: ProcessRunOptions): Promise<ProcessResult> {
    this.calls.push({ command, options });
    const result = this.results.shift();

    if (!result) {
      return {
        command,
        exitCode: 0,
        stdout: "",
        stderr: "",
      };
    }

    if (result.delayMs) {
      await Bun.sleep(result.delayMs);
    }

    return {
      exitCode: result.exitCode ?? 0,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      timedOut: result.timedOut,
      signalCode: result.signalCode,
      command,
    };
  }
}
