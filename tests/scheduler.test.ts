import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { runMigration } from "../src/scheduler";
import type { RuntimeConfig } from "../src/types";
import { createTempFixture } from "./helpers/temp-fixtures";
import { FakeProcessRunner } from "./helpers/fake-process-runner";

describe("runMigration", () => {
  test("plan-only mode writes a plan without upload calls", async () => {
    const fixture = await createTempFixture();
    try {
      await fixture.writeFile("event/photo.jpg");
      const runner = new FakeProcessRunner([{}]);

      const result = await runMigration({
        config: config(fixture.root, { planOnly: true }),
        runner,
      });

      expect(result.plan.workItems).toHaveLength(1);
      expect(result.finalReportPath).toBeUndefined();
      expect(runner.calls.map((call) => call.command[1])).toEqual(["version", "config"]);
    } finally {
      await fixture.cleanup();
    }
  });

  test("uploads independent work and writes final report", async () => {
    const fixture = await createTempFixture();
    try {
      await fixture.writeFile("2023/SRP photos all/a.jpg");
      await fixture.writeFile("2024/SRP photos all/b.jpg");
      const runner = new FakeProcessRunner([
        {},
        { stdout: "" },
        {},
        {},
      ]);

      const result = await runMigration({
        config: config(fixture.root),
        runner,
      });

      expect(result.finalReportPath).toBe(`${fixture.root}/reports/migration-report.md`);
      expect(Object.values(result.checkpoint.workItems).every((state) => state.status === "complete")).toBe(true);
      expect(runner.calls.filter((call) => call.command[1] === "copy")).toHaveLength(2);
    } finally {
      await fixture.cleanup();
    }
  });

  test("plan-only writes report when outside-leaf media needs acknowledgement", async () => {
    const fixture = await createTempFixture();
    try {
      await fixture.writeFile("2024/outside.jpg");
      await fixture.writeFile("2024/day/inside.jpg");

      const result = await runMigration({
        config: config(fixture.root, { planOnly: true }),
        runner: new FakeProcessRunner([{}]),
      });

      expect(result.ok).toBe(true);
      expect(result.finalReportPath).toBeUndefined();
      expect(result.plan.outsideLeafMedia).toHaveLength(1);
    } finally {
      await fixture.cleanup();
    }
  });

  test("blocks upload when outside-leaf media is not acknowledged", async () => {
    const fixture = await createTempFixture();
    try {
      await fixture.writeFile("2024/outside.jpg");
      await fixture.writeFile("2024/day/inside.jpg");

      await expect(
        runMigration({
          config: config(fixture.root),
          runner: new FakeProcessRunner([{}]),
        }),
      ).rejects.toThrow("Media files were found outside leaf folders");
    } finally {
      await fixture.cleanup();
    }
  });

  test("duplicate visible albums block upload", async () => {
    const fixture = await createTempFixture();
    try {
      await fixture.writeFile("event/photo.jpg");
      const runner = new FakeProcessRunner([
        {},
        {},
        { stdout: "ImmichBackup: event/\nImmichBackup: event/\n" },
      ]);

      await expect(
        runMigration({
          config: config(fixture.root),
          runner,
        }),
      ).rejects.toThrow("Duplicate visible destination album");
    } finally {
      await fixture.cleanup();
    }
  });

  test("copy failure produces report and unsuccessful result", async () => {
    const fixture = await createTempFixture();
    try {
      await fixture.writeFile("event/photo.jpg");
      const runner = new FakeProcessRunner([
        {},
        { stdout: "" },
        {},
        {},
        { exitCode: 1, stderr: "network failure" },
      ]);

      const result = await runMigration({
        config: config(fixture.root),
        runner,
      });

      expect(result.ok).toBe(false);
      expect(Object.values(result.checkpoint.workItems)[0]?.status).toBe("uncertain");
      expect(result.finalReportPath).toBe(`${fixture.root}/reports/migration-report.md`);
    } finally {
      await fixture.cleanup();
    }
  });

  test("blocks upload when source root is unreadable", async () => {
    const fixture = await createTempFixture();
    try {
      await expect(
        runMigration({
          config: config(`${fixture.root}/missing`, {
            stateDir: join(fixture.root, "state"),
            reportDir: join(fixture.root, "reports"),
          }),
          runner: new FakeProcessRunner([{}]),
        }),
      ).rejects.toThrow("Some source paths could not be read");
    } finally {
      await fixture.cleanup();
    }
  });
});

function config(root: string, overrides: Partial<RuntimeConfig> = {}): RuntimeConfig {
  return {
    sourceRoot: root,
    remote: "gphotos",
    stateDir: join(root, "state"),
    reportDir: join(root, "reports"),
    concurrency: 2,
    planOnly: false,
    yes: false,
    acknowledgeNonLeafMedia: false,
    acknowledgeUnreadablePaths: false,
    acknowledgeUnknownRemote: false,
    retryUncertain: false,
    rcloneBinary: "rclone",
    ...overrides,
  };
}
