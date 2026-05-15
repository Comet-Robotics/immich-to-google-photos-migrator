import { describe, expect, test } from "bun:test";
import { filterRetryIncompleteWorkItems, filterWorkItems, parseListOption } from "../src/work-item-filter";
import type { WorkItem } from "../src/types";

const ITEM_A: WorkItem = {
  id: "aaaaaaaaaaaaaaaa",
  albumKey: "event",
  albumName: "ImmichBackup: event",
  sourceFolder: "/tmp/event",
  sourceFolderRelativePath: "2025/event",
  supportedFiles: [],
  manifestFingerprint: "fp",
};

const ITEM_B: WorkItem = {
  ...ITEM_A,
  id: "bbbbbbbbbbbbbbbb",
  sourceFolderRelativePath: "2025/other",
};

describe("work item filters", () => {
  test("parseListOption splits comma-separated values", () => {
    expect(parseListOption("a,b, c")).toEqual(["a", "b", "c"]);
  });

  test("filterWorkItems matches exact and nested paths", () => {
    const filtered = filterWorkItems([ITEM_A, ITEM_B], {
      onlyPaths: ["2025/event"],
      onlyWorkItemIds: [],
    });
    expect(filtered).toEqual([ITEM_A]);
  });

  test("filterRetryIncompleteWorkItems keeps failed and uncertain only", () => {
    const filtered = filterRetryIncompleteWorkItems([ITEM_A, ITEM_B], {
      [ITEM_A.id]: { status: "uncertain" },
      [ITEM_B.id]: { status: "complete" },
    });
    expect(filtered).toEqual([ITEM_A]);
  });
});
