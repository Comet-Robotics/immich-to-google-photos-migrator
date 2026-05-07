import { mkdir, open, rename, rm, stat } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { dirname } from "node:path";
import { CheckpointError } from "./types";

export async function ensurePrivateDirectory(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  try {
    const info = await stat(directory);
    if ((info.mode & 0o077) !== 0) {
      throw new CheckpointError({
        message: `State directory is group/world accessible: ${directory}`,
        path: directory,
      });
    }
  } catch (error) {
    if (error instanceof CheckpointError) {
      throw error;
    }
  }
}

export async function writePrivateFileAtomically(path: string, contents: string): Promise<void> {
  const directory = dirname(path);
  await ensurePrivateDirectory(directory);
  const tmpPath = `${path}.tmp-${process.pid}`;
  const handle = await open(tmpPath, "w", 0o600);
  try {
    await handle.writeFile(contents);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(tmpPath, path);
  await syncDirectory(directory);
}

export async function writePrivateFileAtomicallyHidden(
  path: string,
  contents: string,
): Promise<void> {
  const directory = dirname(path);
  await ensurePrivateDirectory(directory);
  const filename = path.slice(directory.length + 1);
  const tmpPath = `${directory}/.${filename}.tmp-${process.pid}`;
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
}

async function syncDirectory(directory: string): Promise<void> {
  let handle: FileHandle | undefined;
  try {
    handle = await open(directory, "r");
    await handle.sync();
  } catch {
    // Some platforms do not allow directory fsync; file fsync plus rename is still best effort.
  } finally {
    await handle?.close();
  }
}
