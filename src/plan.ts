import { createHash } from "node:crypto";
import { ALBUM_PREFIX, type AlbumContribution, type AlbumPlan, type DiscoveryResult, type MigrationPlan, type NoSupportedMediaFolder, type SkippedFile, type SupportedMediaFile, type WorkItem } from "./types";
import { classifyMedia } from "./media";

export function buildMigrationPlan(discovery: DiscoveryResult): MigrationPlan {
  const contributions: AlbumContribution[] = [];
  const skippedFiles: SkippedFile[] = [];
  const noSupportedMediaFolders: NoSupportedMediaFolder[] = [];

  for (const folder of [...discovery.leafFolders].sort(compareRelativePath)) {
    const supported: SupportedMediaFile[] = [];
    const skipped: SkippedFile[] = [];

    for (const file of [...folder.files].sort(compareRelativePath)) {
      const classified = classifyMedia(file);
      if ("kind" in classified) {
        supported.push(classified);
      } else {
        skipped.push(classified);
      }
    }

    skippedFiles.push(...skipped);

    if (supported.length === 0) {
      noSupportedMediaFolders.push({ folder, skippedFiles: skipped });
      continue;
    }

    const albumName = `${ALBUM_PREFIX}${folder.basename}`;
    contributions.push({
      sourceFolder: folder,
      albumKey: folder.basename,
      albumName,
      supportedFiles: supported,
      skippedFiles: skipped,
    });
  }

  const outsideLeafMedia: SupportedMediaFile[] = [];
  for (const file of [...discovery.outsideLeafFiles].sort(compareRelativePath)) {
    const classified = classifyMedia(file);
    if ("kind" in classified) {
      outsideLeafMedia.push(classified);
    } else {
      skippedFiles.push({ ...classified, reason: "unsupported-extension" });
    }
  }

  const albums = albumPlans(contributions);
  const workItems = albums.flatMap((album) =>
    album.contributions.map((contribution) => workItemForContribution(contribution)),
  );
  const planFingerprint = fingerprint(
    workItems.map((item) => ({
      id: item.id,
      manifestFingerprint: item.manifestFingerprint,
    })),
  );

  return {
    sourceRoot: discovery.sourceRoot,
    albums,
    workItems,
    skippedFiles,
    outsideLeafMedia,
    noSupportedMediaFolders,
    unreadablePaths: discovery.unreadablePaths,
    planFingerprint,
  };
}

function albumPlans(contributions: readonly AlbumContribution[]): AlbumPlan[] {
  const grouped = new Map<string, AlbumContribution[]>();

  for (const contribution of contributions) {
    const existing = grouped.get(contribution.albumKey) ?? [];
    existing.push(contribution);
    grouped.set(contribution.albumKey, existing);
  }

  return [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([albumKey, albumContributions]) => ({
      albumKey,
      albumName: `${ALBUM_PREFIX}${albumKey}`,
      contributions: albumContributions.sort((left, right) =>
        left.sourceFolder.relativePath.localeCompare(right.sourceFolder.relativePath),
      ),
      supportedFileCount: albumContributions.reduce(
        (total, contribution) => total + contribution.supportedFiles.length,
        0,
      ),
    }));
}

function workItemForContribution(contribution: AlbumContribution): WorkItem {
  const manifestFingerprint = fingerprint(
    contribution.supportedFiles.map((file) => ({
      relativePath: file.relativePath,
      size: file.size,
      mtimeMs: Math.trunc(file.mtimeMs),
    })),
  );
  const id = fingerprint({
    albumName: contribution.albumName,
    sourceFolder: contribution.sourceFolder.relativePath,
    manifestFingerprint,
  }).slice(0, 16);

  return {
    id,
    albumKey: contribution.albumKey,
    albumName: contribution.albumName,
    sourceFolder: contribution.sourceFolder.absolutePath,
    sourceFolderRelativePath: contribution.sourceFolder.relativePath,
    supportedFiles: contribution.supportedFiles,
    manifestFingerprint,
  };
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function compareRelativePath(
  left: { readonly relativePath: string },
  right: { readonly relativePath: string },
): number {
  return left.relativePath.localeCompare(right.relativePath);
}
