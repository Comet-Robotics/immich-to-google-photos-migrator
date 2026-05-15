import { join, relative } from "node:path";
import { writePrivateFileAtomicallyHidden } from "./private-file";
import type {
  CheckpointState,
  MigrationPlan,
  MigrationReport,
  ReportWorkItemState,
  WorkItem,
  WorkItemState,
} from "./types";

export function buildReport(plan: MigrationPlan, checkpoint: CheckpointState): MigrationReport {
  const workItemById = new Map(plan.workItems.map((item) => [item.id, item]));
  const enrich = (state: WorkItemState): ReportWorkItemState => {
    const item = workItemById.get(state.id);
    return {
      ...state,
      sourceFolderRelativePath: item?.sourceFolderRelativePath,
      albumName: item?.albumName,
    };
  };

  const states = Object.values(checkpoint.workItems).map(enrich);
  const completed = states.filter((state) => state.status === "complete");
  const failed = states.filter((state) => state.status === "failed");
  const uncertain = states.filter((state) => state.status === "uncertain");
  const nonRemainingIds = new Set([...completed, ...failed, ...uncertain].map((state) => state.id));
  const remaining = plan.workItems.filter((item) => {
    const state = checkpoint.workItems[item.id];
    return !nonRemainingIds.has(item.id) && (!state || state.status === "planned" || state.status === "running");
  });

  return {
    completed,
    failed,
    uncertain,
    remaining,
    skippedFiles: plan.skippedFiles,
    outsideLeafMedia: plan.outsideLeafMedia,
    noSupportedMediaFolders: plan.noSupportedMediaFolders,
    unreadablePaths: relativeUnreadablePaths(plan),
  };
}

export function renderPlanSummary(plan: MigrationPlan): string {
  const lines = [
    "# Migration Plan",
    "",
    `Source root fingerprint: ${fingerprintDisplay(plan.planFingerprint)}`,
    `Albums: ${plan.albums.length}`,
    `Upload work items: ${plan.workItems.length}`,
    `Skipped unsupported files: ${plan.skippedFiles.length}`,
    `Outside-leaf media files: ${plan.outsideLeafMedia.length}`,
    `No-supported-media folders: ${plan.noSupportedMediaFolders.length}`,
    `Unreadable paths: ${plan.unreadablePaths.length}`,
    `Plan fingerprint: ${plan.planFingerprint}`,
    "",
    "## Albums",
    "",
  ];

  for (const album of plan.albums) {
    lines.push(`- ${album.albumName}: ${album.supportedFileCount} file(s) from ${album.contributions.length} folder(s)`);
    for (const contribution of album.contributions) {
      lines.push(`  - ${contribution.sourceFolder.relativePath}: ${contribution.supportedFiles.length} supported file(s)`);
    }
  }

  lines.push(
    "",
    ...skippedFileLines("Skipped Files", plan.skippedFiles),
    ...mediaFileLines("Outside-Leaf Media", plan.outsideLeafMedia),
    ...unreadablePathLines("Unreadable Paths", relativeUnreadablePaths(plan)),
  );

  return `${lines.join("\n")}\n`;
}

export function renderFinalReport(report: MigrationReport): string {
  const incomplete = report.failed.length + report.uncertain.length + report.remaining.length;
  return `${[
    "# Migration Report",
    "",
    `Completed: ${report.completed.length}`,
    `Failed: ${report.failed.length}`,
    `Uncertain: ${report.uncertain.length}`,
    `Remaining: ${report.remaining.length}`,
    `Skipped unsupported files: ${report.skippedFiles.length}`,
    `Outside-leaf media files: ${report.outsideLeafMedia.length}`,
    `No-supported-media folders: ${report.noSupportedMediaFolders.length}`,
    `Unreadable paths: ${report.unreadablePaths.length}`,
    "",
    ...stateLines("Failed Work", report.failed),
    ...stateLines("Uncertain Work", report.uncertain),
    ...workItemLines("Remaining Work", report.remaining),
    ...skippedFileLines("Skipped Files", report.skippedFiles),
    ...mediaFileLines("Outside-Leaf Media", report.outsideLeafMedia),
    ...unreadablePathLines("Unreadable Paths", report.unreadablePaths),
    ...nextStepsLines(incomplete),
  ].join("\n")}\n`;
}

export async function writeReport(reportDir: string, filename: string, contents: string): Promise<string> {
  const path = join(reportDir, filename);
  await writePrivateFileAtomicallyHidden(path, contents);
  return path;
}

function stateLines(title: string, states: readonly ReportWorkItemState[]): string[] {
  if (states.length === 0) {
    return [];
  }
  return [
    `## ${title}`,
    "",
    ...states.map((state) => `- ${formatReportWorkItemLine(state)}`),
    "",
  ];
}

function formatReportWorkItemLine(state: ReportWorkItemState): string {
  const location =
    state.sourceFolderRelativePath !== undefined
      ? `${state.sourceFolderRelativePath}${state.albumName ? ` -> ${state.albumName}` : ""}`
      : state.id;
  const detail = state.message ?? state.status;
  return `${state.id} (${location}): ${detail}`;
}

function workItemLines(title: string, items: readonly WorkItem[]): string[] {
  if (items.length === 0) {
    return [];
  }
  return [
    `## ${title}`,
    "",
    ...items.map((item) => `- ${item.id}: ${item.sourceFolderRelativePath} -> ${item.albumName}`),
    "",
  ];
}

function nextStepsLines(incompleteCount: number): string[] {
  if (incompleteCount === 0) {
    return [];
  }
  return [
    "## Next Steps",
    "",
    "Some work did not finish cleanly. Re-run the same command with your existing `--state-dir` and add:",
    "",
    "- `--retry-uncertain` (or `--retry-failed`) to retry failed and uncertain folders",
    "- `--retry-uncertain-only` to skip full library discovery when `plan-snapshot.json` exists in the state directory",
    "- `--only-path <folder>` or `--only-work-item-id <id>` to retry a subset while debugging",
    "- `--concurrency 1` if failures look rate-limit or timeout related",
    "",
    "Review rclone stderr in the messages above, then spot-check matching `ImmichBackup:` albums in Google Photos.",
    "",
  ];
}

function skippedFileLines(title: string, files: readonly { readonly relativePath: string; readonly reason: string; readonly detail: string }[]): string[] {
  if (files.length === 0) {
    return [];
  }
  return [
    `## ${title}`,
    "",
    ...files.map((file) => `- ${file.relativePath}: ${file.reason} (${file.detail})`),
    "",
  ];
}

function mediaFileLines(title: string, files: readonly { readonly relativePath: string; readonly kind: string }[]): string[] {
  if (files.length === 0) {
    return [];
  }
  return [
    `## ${title}`,
    "",
    ...files.map((file) => `- ${file.relativePath}: ${file.kind}`),
    "",
  ];
}

function unreadablePathLines(title: string, paths: readonly { readonly path: string; readonly reason: string }[]): string[] {
  if (paths.length === 0) {
    return [];
  }
  return [
    `## ${title}`,
    "",
    ...paths.map((path) => `- ${path.path}: ${path.reason}`),
    "",
  ];
}

function fingerprintDisplay(fingerprint: string): string {
  return fingerprint.slice(0, 12);
}

function relativeUnreadablePaths(plan: MigrationPlan): readonly { readonly path: string; readonly reason: string }[] {
  return plan.unreadablePaths.map((entry) => {
    const path = relative(plan.sourceRoot, entry.path);
    return {
      path: path === "" || path.startsWith("..") ? "<source-root>" : path,
      reason: entry.reason,
    };
  });
}
