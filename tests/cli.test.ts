import { describe, expect, test } from "bun:test";
import { parseConfig } from "../src/config";
import { ConfigError } from "../src/types";

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

  test("represents plan-only mode and acknowledgements explicitly", () => {
    const config = parseConfig([
      "--source",
      "library",
      "--remote",
      "gphotos",
      "--plan-only",
      "--acknowledge-non-leaf-media",
      "--acknowledge-unknown-remote",
    ]);

    expect(config.planOnly).toBe(true);
    expect(config.acknowledgeNonLeafMedia).toBe(true);
    expect(config.acknowledgeUnknownRemote).toBe(true);
  });
});
