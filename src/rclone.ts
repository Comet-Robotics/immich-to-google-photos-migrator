import { mkdir, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { RcloneError, type AlbumName, type ProcessResult, type ProcessRunOptions, type ProcessRunner, type RcloneAlbumResolution, type RuntimeConfig, type WorkItem } from "./types";

export class BunProcessRunner implements ProcessRunner {
  async run(command: readonly string[], options: ProcessRunOptions = {}): Promise<ProcessResult> {
    const proc = Bun.spawn([...command], {
      cwd: options.cwd,
      env: options.env,
      stdout: "pipe",
      stderr: "pipe",
      signal: options.signal,
    });

    const timeout = options.timeoutMs
      ? setTimeout(() => {
          proc.kill("SIGTERM");
        }, options.timeoutMs)
      : undefined;

    try {
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);

      return {
        command,
        exitCode,
        stdout,
        stderr,
      };
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
    }
  }
}

export interface RcloneClientOptions {
  readonly config: RuntimeConfig;
  readonly runner: ProcessRunner;
}

export class RcloneClient {
  private readonly config: RuntimeConfig;
  private readonly runner: ProcessRunner;

  constructor(options: RcloneClientOptions) {
    this.config = options.config;
    this.runner = options.runner;
  }

  async preflight(): Promise<ProcessResult> {
    validateRemoteName(this.config.remote);
    validateBinary(this.config.rcloneBinary);
    const result = await this.run([this.config.rcloneBinary, "version"]);
    if (result.exitCode !== 0) {
      throw rcloneFailure("Unable to run rclone", result);
    }
    return result;
  }

  async listAlbums(): Promise<readonly string[] | "listing-unavailable"> {
    const result = await this.run([
      this.config.rcloneBinary,
      "lsf",
      remotePath(this.config.remote, "album"),
      "--dirs-only",
    ]);

    if (result.exitCode !== 0) {
      return "listing-unavailable";
    }

    return result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim().replace(/\/$/, ""))
      .filter((line) => line.length > 0);
  }

  resolveAlbums(albumNames: readonly AlbumName[], visibleAlbums: readonly string[] | "listing-unavailable"): readonly RcloneAlbumResolution[] {
    return albumNames.map((albumName) => {
      validateAlbumName(albumName);
      if (visibleAlbums === "listing-unavailable") {
        return {
          albumName,
          status: "listing-unavailable",
          matches: [],
          message: "rclone album listing unavailable; uniqueness cannot be proven",
        };
      }

      const matches = visibleAlbums.filter((visibleAlbum) => visibleAlbum === albumName);
      if (matches.length === 0) {
        return { albumName, status: "needs-create", matches };
      }
      if (matches.length === 1) {
        return { albumName, status: "visible-existing", matches };
      }
      return { albumName, status: "duplicate-visible", matches };
    });
  }

  async createAlbum(albumName: AlbumName): Promise<void> {
    validateAlbumName(albumName);
    const result = await this.run([
      this.config.rcloneBinary,
      "mkdir",
      remotePath(this.config.remote, `album/${albumName}`),
    ]);
    if (result.exitCode !== 0) {
      throw rcloneFailure(`Unable to create album ${albumName}`, result);
    }
  }

  async copyWorkItem(workItem: WorkItem, manifestDir: string): Promise<void> {
    validateAlbumName(workItem.albumName);
    const manifestPath = await writeManifest(workItem, manifestDir);
    const result = await this.run([
      this.config.rcloneBinary,
      "copy",
      workItem.sourceFolder,
      remotePath(this.config.remote, `album/${workItem.albumName}`),
      "--files-from-raw",
      manifestPath,
      "--gphotos-batch-mode",
      "sync",
      "--transfers",
      "1",
      "--checkers",
      "1",
    ]);

    if (result.exitCode !== 0) {
      throw rcloneFailure(`Unable to upload ${workItem.sourceFolderRelativePath}`, result);
    }
  }

  private async run(command: readonly string[]): Promise<ProcessResult> {
    return this.runner.run(command, {
      env: minimalRcloneEnv(process.env),
      timeoutMs: 30 * 60 * 1000,
    });
  }
}

export function remotePath(remote: string, path: string): string {
  validateRemoteName(remote);
  validatePathComponent(path);
  return `${remote}:${path}`;
}

export function validateRemoteName(remote: string): void {
  if (remote.length === 0 || remote.startsWith("-") || /[\p{C}\s:]/u.test(remote)) {
    throw new RcloneError({ message: `Invalid rclone remote name: ${remote}` });
  }
}

export function validateAlbumName(albumName: string): void {
  validatePathComponent(albumName);
  if (albumName.startsWith("-")) {
    throw new RcloneError({ message: `Invalid album name: ${albumName}` });
  }
}

export function validateBinary(binary: string): void {
  if (binary.length === 0 || /[\p{C}]/u.test(binary)) {
    throw new RcloneError({ message: `Invalid rclone binary path: ${binary}` });
  }
}

export function minimalRcloneEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const allowed = new Map<string, string>();
  for (const key of ["PATH", "HOME", "USERPROFILE", "APPDATA", "XDG_CONFIG_HOME"]) {
    const value = env[key];
    if (value) {
      allowed.set(key, value);
    }
  }

  for (const [key, value] of Object.entries(env)) {
    if (key.startsWith("RCLONE_") && value !== undefined) {
      allowed.set(key, value);
    }
  }

  return Object.fromEntries(allowed.entries());
}

async function writeManifest(workItem: WorkItem, manifestDir: string): Promise<string> {
  await mkdir(manifestDir, { recursive: true, mode: 0o700 });
  const manifestPath = join(manifestDir, `${workItem.id}.files-from-raw`);
  const lines = workItem.supportedFiles.map((file) => {
    validateManifestPath(workItem.sourceFolder, file.absolutePath);
    return relative(workItem.sourceFolder, file.absolutePath);
  });
  await writeFile(manifestPath, `${lines.join("\n")}\n`, { mode: 0o600 });
  return manifestPath;
}

function validateManifestPath(sourceFolder: string, filePath: string): void {
  const absoluteSource = resolve(sourceFolder);
  const absoluteFile = resolve(filePath);
  if (!isAbsolute(filePath) || !absoluteFile.startsWith(`${absoluteSource}/`)) {
    throw new RcloneError({ message: `Manifest file is outside source folder: ${filePath}` });
  }
  validatePathComponent(relative(absoluteSource, absoluteFile));
}

function validatePathComponent(value: string): void {
  if (value.length === 0 || /[\p{C}]/u.test(value)) {
    throw new RcloneError({ message: `Invalid rclone path component: ${value}` });
  }
}

function rcloneFailure(message: string, result: ProcessResult): RcloneError {
  return new RcloneError({
    message,
    command: result.command,
    exitCode: result.exitCode,
    stdout: sanitizeOutput(result.stdout),
    stderr: sanitizeOutput(result.stderr),
  });
}

function sanitizeOutput(output: string): string {
  return output.replace(/token[=:]\S+/gi, "token=<redacted>").slice(0, 4000);
}
