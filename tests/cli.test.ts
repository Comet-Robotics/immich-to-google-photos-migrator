import { describe, expect, spyOn, test } from "bun:test";
import { runCli } from "../src/cli";
import { inferCommandFromProcessArgv, parseConfig, usage } from "../src/config";
import { ConfigError } from "../src/types";

describe("runCli", () => {
  test("exits 0 with no arguments", async () => {
    const log = spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(await runCli([])).toBe(0);
    } finally {
      log.mockRestore();
    }
  });
});

describe("parseConfig", () => {
  test("normalizes required inputs and defaults", () => {
    const config = parseConfig(["--source", "library", "--remote", "gphotos"], "/tmp/project");

    expect(config.sourceRoot).toBe("/tmp/project/library");
    expect(config.remote).toBe("gphotos");
    expect(config.concurrency).toBe(2);
    expect(config.planOnly).toBe(false);
  });

  test("rejects missing required inputs", () => {
    expect(() => parseConfig(["--source", "library"])).toThrow(ConfigError);
    expect(() => parseConfig(["--remote", "gphotos"])).toThrow(ConfigError);
  });

  test("rejects invalid concurrency before execution", () => {
    expect(() =>
      parseConfig(["--source", "library", "--remote", "gphotos", "--concurrency", "0"]),
    ).toThrow(ConfigError);
  });

  test("rejects unknown value options", () => {
    expect(() =>
      parseConfig(["--source", "library", "--remote", "gphotos", "--concurency", "8"]),
    ).toThrow(ConfigError);
  });

  test("preserves inline values containing equals signs", () => {
    const config = parseConfig(["--source=/tmp/a=b/library", "--remote", "gphotos"], "/");

    expect(config.sourceRoot).toBe("/tmp/a=b/library");
  });

  test("represents plan-only mode and acknowledgements explicitly", () => {
    const config = parseConfig([
      "--source",
      "library",
      "--remote",
      "gphotos",
      "--plan-only",
      "--acknowledge-non-leaf-media",
      "--acknowledge-unreadable-paths",
      "--acknowledge-unknown-remote",
      "--retry-uncertain",
    ]);

    expect(config.planOnly).toBe(true);
    expect(config.acknowledgeNonLeafMedia).toBe(true);
    expect(config.acknowledgeUnreadablePaths).toBe(true);
    expect(config.acknowledgeUnknownRemote).toBe(true);
    expect(config.retryUncertain).toBe(true);
  });

  test("--yes applies explicit acknowledgements", () => {
    const config = parseConfig(["--source", "library", "--remote", "gphotos", "--yes"]);

    expect(config.acknowledgeNonLeafMedia).toBe(true);
    expect(config.acknowledgeUnreadablePaths).toBe(true);
    expect(config.acknowledgeUnknownRemote).toBe(true);
  });
});

describe("usage", () => {
  test("uses executable and script when run via runtime", () => {
    const command = inferCommandFromProcessArgv([
      "/opt/homebrew/bin/bun",
      "/repo/index.ts",
      "--source",
      "library",
    ]);

    expect(command).toBe("bun index.ts");
    expect(usage(command)).toContain(
      "Usage: bun index.ts --source <immich-library-root> --remote <rclone-remote> [options]",
    );
  });

  test("uses binary name when run as compiled executable", () => {
    const command = inferCommandFromProcessArgv([
      "/repo/out/immich-to-google-photos-migrator",
      "--source",
      "library",
    ]);

    expect(command).toBe("immich-to-google-photos-migrator");
    expect(usage(command)).toContain(
      "Usage: immich-to-google-photos-migrator --source <immich-library-root> --remote <rclone-remote> [options]",
    );
  });
});
