import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CheckpointState, MigrationPlan, MigrationReport, WorkItem, WorkItemState } from "./types";

export function buildReport(plan: MigrationPlan, checkpoint: CheckpointState): MigrationReport {
  const states = Object.values(checkpoint.workItems);
  const completed = states.filter((state) => state.status === "complete");
  const failed = states.filter((state) => state.status === "failed");
  const uncertain = states.filter((state) => state.status === "uncertain");
  const completeIds = new Set(completed.map((state) => state.id));
  const remaining = plan.workItems.filter((item) => !completeIds.has(item.id));

  return {
    completed,
    failed,
    uncertain,
    remaining,
    skippedFiles: plan.skippedFiles,
    outsideLeafMedia: plan.outsideLeafMedia,
    noSupportedMediaFolders: plan.noSupportedMediaFolders,
  };
}

export function renderPlanSummary(plan: MigrationPlan): string {
  const lines = [
    "# Migration Plan",
    "",
    `Source root: ${plan.sourceRoot}`,
    `Albums: ${plan.albums.length}`,
    `Upload work items: ${plan.workItems.length}`,
    `Skipped unsupported files: ${plan.skippedFiles.length}`,
    `Outside-leaf media files: ${plan.outsideLeafMedia.length}`,
    `No-supported-media folders: ${plan.noSupportedMediaFolders.length}`,
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
    "",
    ...stateLines("Failed Work", report.failed),
    ...stateLines("Uncertain Work", report.uncertain),
    ...workItemLines("Remaining Work", report.remaining),
  ].join("\n")}\n`;
}

export async function writeReport(reportDir: string, filename: string, contents: string): Promise<string> {
  await mkdir(reportDir, { recursive: true, mode: 0o700 });
  const path = join(reportDir, filename);
  await writeFile(path, contents, { mode: 0o600 });
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
