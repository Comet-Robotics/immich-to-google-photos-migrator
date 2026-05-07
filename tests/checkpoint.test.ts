import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { acquireRunLock, initialCheckpoint, loadOrCreateCheckpoint, saveCheckpoint, updateWorkItem } from "../src/checkpoint";
import { discoverSourceTree } from "../src/discovery";
import { buildMigrationPlan } from "../src/plan";
import { createTempFixture } from "./helpers/temp-fixtures";

describe("checkpoint state", () => {
  test("persists completed work and reloads compatible state", async () => {
    const fixture = await createTempFixture();
    try {
      await fixture.writeFile("event/photo.jpg");
      const plan = buildMigrationPlan(await discoverSourceTree(fixture.root));
      const checkpointPath = join(fixture.root, "state/checkpoint.json");
      const complete = updateWorkItem(initialCheckpoint(plan, "gphotos", "fingerprint"), plan.workItems[0]!.id, {
        status: "complete",
        attempts: 1,
      });

      await saveCheckpoint(checkpointPath, complete);
      const loaded = await loadOrCreateCheckpoint(checkpointPath, plan, "gphotos", "fingerprint");

      expect(loaded.workItems[plan.workItems[0]!.id]?.status).toBe("complete");
    } finally {
      await fixture.cleanup();
    }
  });

  test("refuses to resume when migration identity changes", async () => {
    const fixture = await createTempFixture();
    try {
      await fixture.writeFile("event/photo.jpg");
      const plan = buildMigrationPlan(await discoverSourceTree(fixture.root));
      const checkpointPath = join(fixture.root, "state/checkpoint.json");
      await saveCheckpoint(checkpointPath, initialCheckpoint(plan, "gphotos", "fingerprint"));

      await expect(loadOrCreateCheckpoint(checkpointPath, plan, "other", "fingerprint")).rejects.toThrow(
        "Checkpoint identity mismatch",
      );
    } finally {
      await fixture.cleanup();
    }
  });

  test("refuses to resume when remote fingerprint changes", async () => {
    const fixture = await createTempFixture();
    try {
      await fixture.writeFile("event/photo.jpg");
      const plan = buildMigrationPlan(await discoverSourceTree(fixture.root));
      const checkpointPath = join(fixture.root, "state/checkpoint.json");
      await saveCheckpoint(checkpointPath, initialCheckpoint(plan, "gphotos", "fingerprint-a"));

      await expect(loadOrCreateCheckpoint(checkpointPath, plan, "gphotos", "fingerprint-b")).rejects.toThrow(
        "Checkpoint identity mismatch",
      );
    } finally {
      await fixture.cleanup();
    }
  });


  test("normalizes stale running work to uncertain on resume", async () => {
    const fixture = await createTempFixture();
    try {
      await fixture.writeFile("event/photo.jpg");
      const plan = buildMigrationPlan(await discoverSourceTree(fixture.root));
      const checkpointPath = join(fixture.root, "state/checkpoint.json");
      await saveCheckpoint(
        checkpointPath,
        updateWorkItem(initialCheckpoint(plan, "gphotos", "fingerprint"), plan.workItems[0]!.id, {
          status: "running",
          attempts: 1,
        }),
      );

      const loaded = await loadOrCreateCheckpoint(checkpointPath, plan, "gphotos", "fingerprint");

      expect(loaded.workItems[plan.workItems[0]!.id]?.status).toBe("uncertain");
    } finally {
      await fixture.cleanup();
    }
  });

  test("rejects malformed checkpoint JSON", async () => {
    const fixture = await createTempFixture();
    try {
      await fixture.writeFile("event/photo.jpg");
      const plan = buildMigrationPlan(await discoverSourceTree(fixture.root));
      const checkpointPath = join(fixture.root, "state/checkpoint.json");
      await fixture.writeFile("state/checkpoint.json", JSON.stringify({ version: 1, workItems: {} }));

      await expect(loadOrCreateCheckpoint(checkpointPath, plan, "gphotos", "fingerprint")).rejects.toThrow(
        "invalid identity",
      );
    } finally {
      await fixture.cleanup();
    }
  });

  test("prevents a second active run using the same state directory", async () => {
    const fixture = await createTempFixture();
    try {
      const release = await acquireRunLock(join(fixture.root, "state"));
      await expect(acquireRunLock(join(fixture.root, "state"))).rejects.toThrow(
        "Migration lock already exists",
      );
      await release();
    } finally {
      await fixture.cleanup();
    }
  });
});
