import type { Dirent } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";
import type { DiscoveryResult, FileEntry, LeafFolder } from "./types";

interface DirectoryScan {
  readonly leafFolders: readonly LeafFolder[];
  readonly outsideLeafFiles: readonly FileEntry[];
  readonly unreadablePaths: readonly { readonly path: string; readonly reason: string }[];
}

export async function discoverSourceTree(sourceRoot: string): Promise<DiscoveryResult> {
  const resolvedRoot = resolve(sourceRoot);
  const scan = await scanDirectory(resolvedRoot, resolvedRoot);

  return {
    sourceRoot: resolvedRoot,
    ...scan,
  };
}

async function scanDirectory(directory: string, sourceRoot: string): Promise<DirectoryScan> {
  const unreadablePaths: { path: string; reason: string }[] = [];
  let entries: Dirent[];

  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    return {
      leafFolders: [],
      outsideLeafFiles: [],
      unreadablePaths: [{ path: directory, reason: errorMessage(error) }],
    };
  }

  const childDirectories = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(directory, entry.name));

  const files: FileEntry[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) {
      if (entry.isSymbolicLink()) {
        unreadablePaths.push({
          path: join(directory, entry.name),
          reason: "Symlink skipped",
        });
      }
      continue;
    }

    const absolutePath = join(directory, entry.name);
    const file = await fileEntry(sourceRoot, absolutePath);
    if ("reason" in file) {
      unreadablePaths.push(file);
    } else {
      files.push(file);
    }
  }

  const childScans = await Promise.all(
    childDirectories.map((childDirectory) => scanDirectory(childDirectory, sourceRoot)),
  );

  const childLeafFolders = childScans.flatMap((scan) => scan.leafFolders);
  const childOutsideLeafFiles = childScans.flatMap((scan) => scan.outsideLeafFiles);
  const childUnreadablePaths = childScans.flatMap((scan) => scan.unreadablePaths);

  if (childDirectories.length === 0) {
    return {
      leafFolders: [
        {
          absolutePath: directory,
          relativePath: relativePath(sourceRoot, directory),
          basename: basename(directory),
          files,
        },
      ],
      outsideLeafFiles: childOutsideLeafFiles,
      unreadablePaths: [...unreadablePaths, ...childUnreadablePaths],
    };
  }

  return {
    leafFolders: childLeafFolders,
    outsideLeafFiles: [...files, ...childOutsideLeafFiles],
    unreadablePaths: [...unreadablePaths, ...childUnreadablePaths],
  };
}

async function fileEntry(
  sourceRoot: string,
  absolutePath: string,
): Promise<FileEntry | { path: string; reason: string }> {
  try {
    const info = await stat(absolutePath);
    return {
      absolutePath,
      relativePath: relativePath(sourceRoot, absolutePath),
      size: info.size,
      mtimeMs: info.mtimeMs,
    };
  } catch (error) {
    return {
      path: absolutePath,
      reason: errorMessage(error),
    };
  }
}

function relativePath(sourceRoot: string, absolutePath: string): string {
  const path = relative(sourceRoot, absolutePath);
  return path === "" ? "." : path;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
