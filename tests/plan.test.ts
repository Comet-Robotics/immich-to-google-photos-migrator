import { describe, expect, test } from "bun:test";
import { discoverSourceTree } from "../src/discovery";
import { buildMigrationPlan } from "../src/plan";
import { createTempFixture } from "./helpers/temp-fixtures";

describe("buildMigrationPlan", () => {
  test("merges exact repeated basenames into one album", async () => {
    const fixture = await createTempFixture();
    try {
      await fixture.writeFile("2023/SRP photos all/a.jpg");
      await fixture.writeFile("2024/SRP photos all/b.jpg");

      const plan = buildMigrationPlan(await discoverSourceTree(fixture.root));

      expect(plan.albums).toHaveLength(1);
      expect(plan.albums[0]?.albumName).toBe("ImmichBackup: SRP photos all");
      expect(plan.albums[0]?.contributions).toHaveLength(2);
    } finally {
      await fixture.cleanup();
    }
  });

  test("keeps case variants separate", async () => {
    const fixture = await createTempFixture();
    try {
      await fixture.writeFile("2023/SRP photos all/a.jpg");
      await fixture.writeFile("2024/SRP Photos All/b.jpg");

      const plan = buildMigrationPlan(await discoverSourceTree(fixture.root));

      expect(plan.albums.map((album) => album.albumName).sort()).toEqual([
        "ImmichBackup: SRP Photos All",
        "ImmichBackup: SRP photos all",
      ]);
    } finally {
      await fixture.cleanup();
    }
  });

  test("reports unsupported files and no-supported-media folders", async () => {
    const fixture = await createTempFixture();
    try {
      await fixture.writeFile("event/photo.jpg");
      await fixture.writeFile("event/metadata.json");
      await fixture.writeFile("sidecars/info.json");

      const plan = buildMigrationPlan(await discoverSourceTree(fixture.root));

      expect(plan.albums).toHaveLength(1);
      expect(plan.skippedFiles.map((file) => file.relativePath)).toContain("event/metadata.json");
      expect(plan.noSupportedMediaFolders[0]?.folder.relativePath).toBe("sidecars");
    } finally {
      await fixture.cleanup();
    }
  });

  test("surfaces supported media outside leaf folders", async () => {
    const fixture = await createTempFixture();
    try {
      await fixture.writeFile("2024/outside.jpg");
      await fixture.writeFile("2024/day/inside.jpg");

      const plan = buildMigrationPlan(await discoverSourceTree(fixture.root));

      expect(plan.outsideLeafMedia.map((file) => file.relativePath)).toEqual(["2024/outside.jpg"]);
    } finally {
      await fixture.cleanup();
    }
  });
});
