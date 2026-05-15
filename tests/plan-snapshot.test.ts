import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { loadPlanSnapshot, savePlanSnapshot } from "../src/plan-snapshot";
import { discoverSourceTree } from "../src/discovery";
import { buildMigrationPlan } from "../src/plan";
import { createTempFixture } from "./helpers/temp-fixtures";

describe("plan snapshot", () => {
  test("round-trips a migration plan", async () => {
    const fixture = await createTempFixture();
    try {
      await fixture.writeFile("event/photo.jpg");
      const plan = buildMigrationPlan(await discoverSourceTree(fixture.root));
      const stateDir = join(fixture.root, "state");
      await savePlanSnapshot(stateDir, plan);
      const loaded = await loadPlanSnapshot(stateDir);
      expect(loaded?.planFingerprint).toBe(plan.planFingerprint);
      expect(loaded?.workItems).toHaveLength(plan.workItems.length);
    } finally {
      await fixture.cleanup();
    }
  });

  test("returns undefined when snapshot is missing", async () => {
    const fixture = await createTempFixture();
    try {
      expect(await loadPlanSnapshot(join(fixture.root, "state"))).toBeUndefined();
    } finally {
      await fixture.cleanup();
    }
  });
});
