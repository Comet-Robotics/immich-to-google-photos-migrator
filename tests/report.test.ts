import { describe, expect, test } from "bun:test";
import { initialCheckpoint, updateWorkItem } from "../src/checkpoint";
import { discoverSourceTree } from "../src/discovery";
import { buildMigrationPlan } from "../src/plan";
import { buildReport, renderFinalReport, renderPlanSummary } from "../src/report";
import { createTempFixture } from "./helpers/temp-fixtures";

describe("reports", () => {
  test("renders plan and final report counts", async () => {
    const fixture = await createTempFixture();
    try {
      await fixture.writeFile("event/photo.jpg");
      await fixture.writeFile("event/metadata.json");
      await fixture.writeFile("empty/info.json");
      const plan = buildMigrationPlan(await discoverSourceTree(fixture.root));
      const checkpoint = updateWorkItem(initialCheckpoint(plan, "gphotos"), plan.workItems[0]!.id, {
        status: "failed",
        attempts: 1,
        message: "rclone failed",
      });
      const report = buildReport(plan, checkpoint);

      expect(renderPlanSummary(plan)).toContain("Skipped unsupported files: 2");
      expect(renderFinalReport(report)).toContain("Failed: 1");
      expect(renderFinalReport(report)).toContain("No-supported-media folders: 1");
    } finally {
      await fixture.cleanup();
    }
  });
});
