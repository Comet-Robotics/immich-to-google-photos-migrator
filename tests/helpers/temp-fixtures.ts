import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

export interface TempFixture {
  readonly root: string;
  readonly writeFile: (relativePath: string, contents?: string) => Promise<string>;
  readonly mkdir: (relativePath: string) => Promise<string>;
  readonly cleanup: () => Promise<void>;
}

export async function createTempFixture(prefix = "immich-gphotos-"): Promise<TempFixture> {
  const root = await mkdtemp(join(tmpdir(), prefix));

  return {
    root,
    async writeFile(relativePath: string, contents = "fixture") {
      const absolutePath = join(root, relativePath);
      await mkdir(dirname(absolutePath), { recursive: true });
      await Bun.write(absolutePath, contents);
      return absolutePath;
    },
    async mkdir(relativePath: string) {
      const absolutePath = join(root, relativePath);
      await mkdir(absolutePath, { recursive: true });
      return absolutePath;
    },
    async cleanup() {
      await rm(root, { recursive: true, force: true });
    },
  };
}
