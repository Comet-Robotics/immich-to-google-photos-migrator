import { describe, expect, test } from "bun:test";
import { discoverSourceTree } from "../src/discovery";
import { createTempFixture } from "./helpers/temp-fixtures";

describe("discoverSourceTree", () => {
  test("identifies leaf folders and media outside leaf folders", async () => {
    const fixture = await createTempFixture();
    try {
      await fixture.writeFile("2024/SRP photos all/a.jpg");
      await fixture.writeFile("2024/SRP photos all/b.mp4");
      await fixture.writeFile("2024/root-level.jpg");
      await fixture.writeFile("2024/2024-01-Jan/2024-01-01/c.jpg");

      const discovery = await discoverSourceTree(fixture.root);

      expect(discovery.leafFolders.map((folder) => folder.relativePath).sort()).toEqual([
        "2024/2024-01-Jan/2024-01-01",
        "2024/SRP photos all",
      ]);
      expect(discovery.outsideLeafFiles.map((file) => file.relativePath)).toContain("2024/root-level.jpg");
    } finally {
      await fixture.cleanup();
    }
  });

  test("treats an empty directory as a leaf folder with no files", async () => {
    const fixture = await createTempFixture();
    try {
      await fixture.mkdir("empty");

      const discovery = await discoverSourceTree(fixture.root);

      expect(discovery.leafFolders).toHaveLength(1);
      expect(discovery.leafFolders[0]?.relativePath).toBe("empty");
      expect(discovery.leafFolders[0]?.files).toHaveLength(0);
    } finally {
      await fixture.cleanup();
    }
  });
});
