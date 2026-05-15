import type { RuntimeConfig, WorkItem, WorkItemId } from "./types";

export function parseListOption(value: string | undefined): readonly string[] {
  if (!value) {
    return [];
  }
  return value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

export function filterWorkItems(
  workItems: readonly WorkItem[],
  config: Pick<RuntimeConfig, "onlyPaths" | "onlyWorkItemIds">,
): readonly WorkItem[] {
  let filtered = workItems;

  if (config.onlyWorkItemIds.length > 0) {
    const ids = new Set(config.onlyWorkItemIds);
    filtered = filtered.filter((item) => ids.has(item.id));
  }

  if (config.onlyPaths.length > 0) {
    filtered = filtered.filter((item) =>
      config.onlyPaths.some((path) => matchesWorkItemPath(item.sourceFolderRelativePath, path)),
    );
  }

  return filtered;
}

export function filterRetryIncompleteWorkItems(
  workItems: readonly WorkItem[],
  checkpointStatuses: Readonly<Record<WorkItemId, { readonly status: string } | undefined>>,
): readonly WorkItem[] {
  return workItems.filter((item) => {
    const status = checkpointStatuses[item.id]?.status;
    return status === "failed" || status === "uncertain";
  });
}

function matchesWorkItemPath(relativePath: string, filterPath: string): boolean {
  const normalizedFilter = normalizePathFilter(filterPath);
  const normalizedItem = normalizePathFilter(relativePath);
  return normalizedItem === normalizedFilter || normalizedItem.startsWith(`${normalizedFilter}/`);
}

function normalizePathFilter(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\/+/, "").replace(/\/+$/, "");
}
