import { open, rename, rm } from "node:fs/promises";
import { join, relative } from "node:path";
import { ensurePrivateDirectory } from "./checkpoint";
import type { CheckpointState, MigrationPlan, MigrationReport, WorkItem, WorkItemState } from "./types";

export function buildReport(plan: MigrationPlan, checkpoint: CheckpointState): MigrationReport {
  const states = Object.values(checkpoint.workItems);
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
  ].join("\n")}\n`;
}

export async function writeReport(reportDir: string, filename: string, contents: string): Promise<string> {
  await ensurePrivateDirectory(reportDir);
  const path = join(reportDir, filename);
  const tmpPath = join(reportDir, `.${filename}.tmp-${process.pid}`);
  const handle = await open(tmpPath, "w", 0o600);
  try {
    await handle.writeFile(contents);
    await handle.sync();
    await handle.close();
    await rename(tmpPath, path);
  } catch (error) {
    await handle.close().catch(() => undefined);
    await rm(tmpPath, { force: true });
    throw error;
  }
  return path;
}

function stateLines(title: string, states: readonly WorkItemState[]): string[] {
  if (states.length === 0) {
    return [];
  }
  return [
    `## ${title}`,
    "",
    ...states.map((state) => `- ${state.id}: ${state.message ?? state.status}`),
    "",
  ];
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
