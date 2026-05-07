import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { runMigration } from "../src/scheduler";
import type { RuntimeConfig } from "../src/types";
import { createTempFixture } from "./helpers/temp-fixtures";
import { FakeProcessRunner } from "./helpers/fake-process-runner";

describe("fake rclone integration", () => {
  test("runs a repeated-basename migration and resumes from checkpoint", async () => {
    const fixture = await createTempFixture();
    try {
      await fixture.writeFile("2023/SRP photos all/a.jpg");
      await fixture.writeFile("2024/SRP photos all/b.jpg");
      await fixture.writeFile("2024/SRP photos all/sidecar.json");
      const firstRunner = new FakeProcessRunner([{}, { stdout: "" }, {}, {}, {}]);

      const first = await runMigration({ config: config(fixture.root), runner: firstRunner });
      const secondRunner = new FakeProcessRunner([{}, { stdout: "ImmichBackup: SRP photos all/\n" }]);
      const second = await runMigration({ config: config(fixture.root), runner: secondRunner });

      expect(first.plan.albums).toHaveLength(1);
      expect(first.plan.skippedFiles.map((file) => file.relativePath)).toContain(
        "2024/SRP photos all/sidecar.json",
      );
      expect(secondRunner.calls.filter((call) => call.command[1] === "copy")).toHaveLength(0);
      expect(Object.values(second.checkpoint.workItems).every((state) => state.status === "complete")).toBe(true);
    } finally {
      await fixture.cleanup();
    }
  });

  test("run lock blocks a second invocation", async () => {
    const fixture = await createTempFixture();
    try {
      await fixture.writeFile("event/photo.jpg");
      const firstRunner = new FakeProcessRunner([{}, { stdout: "" }, {}, { delayMs: 100 }]);
      const firstRun = runMigration({ config: config(fixture.root), runner: firstRunner });

      await Bun.sleep(20);

      await expect(
        runMigration({ config: config(fixture.root), runner: new FakeProcessRunner([{}]) }),
      ).rejects.toThrow("Migration lock already exists");

      await firstRun;
    } finally {
      await fixture.cleanup();
    }
  });
});

function config(root: string): RuntimeConfig {
  return {
    sourceRoot: root,
    remote: "gphotos",
    stateDir: join(root, "state"),
    reportDir: join(root, "reports"),
    concurrency: 2,
    planOnly: false,
    yes: false,
    acknowledgeNonLeafMedia: false,
    acknowledgeUnknownRemote: false,
    rcloneBinary: "rclone",
  };
}

