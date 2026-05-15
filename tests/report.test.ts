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
      const checkpoint = updateWorkItem(initialCheckpoint(plan, "gphotos", "fingerprint"), plan.workItems[0]!.id, {
        status: "failed",
        attempts: 1,
        message: "rclone failed",
      });
      const report = buildReport(plan, checkpoint);
      const planSummary = renderPlanSummary(plan);
      const finalReport = renderFinalReport(report);

      expect(planSummary).toContain("Skipped unsupported files: 2");
      expect(planSummary).toContain("event/metadata.json: unsupported-extension");
      expect(planSummary).not.toContain(fixture.root);
      expect(finalReport).toContain("Failed: 1");
      expect(finalReport).toContain("(event -> ImmichBackup: event)");
      expect(finalReport).toContain("ImmichBackup: event");
      expect(finalReport).toContain("## Next Steps");
      expect(finalReport).toContain("Remaining: 0");
      expect(finalReport).toContain("No-supported-media folders: 1");
    } finally {
      await fixture.cleanup();
    }
  });
});
