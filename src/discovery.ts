import type { Dirent } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";
import { Effect } from "effect";
import type { DiscoveryResult, FileEntry, LeafFolder } from "./types";

interface DirectoryScan {
  readonly leafFolders: readonly LeafFolder[];
  readonly outsideLeafFiles: readonly FileEntry[];
  readonly unreadablePaths: readonly { readonly path: string; readonly reason: string }[];
}

export async function discoverSourceTree(sourceRoot: string): Promise<DiscoveryResult> {
  return Effect.runPromise(discoverSourceTreeEffect(sourceRoot));
}

export function discoverSourceTreeEffect(sourceRoot: string): Effect.Effect<DiscoveryResult> {
  return Effect.gen(function* () {
  const resolvedRoot = resolve(sourceRoot);
    const scan = yield* scanDirectory(resolvedRoot, resolvedRoot);

    return {
      sourceRoot: resolvedRoot,
      ...scan,
    };
  });
}

function scanDirectory(directory: string, sourceRoot: string): Effect.Effect<DirectoryScan> {
  return Effect.gen(function* () {
  const unreadablePaths: { path: string; reason: string }[] = [];
  let entries: Dirent[];

  try {
      entries = yield* Effect.tryPromise({
        try: () => readdir(directory, { withFileTypes: true }),
        catch: (error) => new Error(errorMessage(error)),
      });
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
      const file = yield* fileEntry(sourceRoot, absolutePath);
    if ("reason" in file) {
      unreadablePaths.push(file);
    } else {
      files.push(file);
    }
  }

    const childScans = yield* Effect.all(
      childDirectories.map((childDirectory) => scanDirectory(childDirectory, sourceRoot)),
      { concurrency: "unbounded" },
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
  }).pipe(
    Effect.catchAll((error) =>
      Effect.succeed({
        leafFolders: [],
        outsideLeafFiles: [],
        unreadablePaths: [{ path: directory, reason: errorMessage(error) }],
      })),
  );
}

function fileEntry(
  sourceRoot: string,
  absolutePath: string,
): Effect.Effect<FileEntry | { path: string; reason: string }> {
  return Effect.tryPromise({
    try: async () => {
      const info = await stat(absolutePath);
      return {
        absolutePath,
        relativePath: relativePath(sourceRoot, absolutePath),
        size: info.size,
        mtimeMs: info.mtimeMs,
      };
    },
    catch: () => ({
      path: absolutePath,
      reason: `Unable to stat file: ${absolutePath}`,
    }),
  }).pipe(
    Effect.catchAll((failure) => Effect.succeed(failure)),
  );
}

function relativePath(sourceRoot: string, absolutePath: string): string {
  const path = relative(sourceRoot, absolutePath);
  return path === "" ? "." : path;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
