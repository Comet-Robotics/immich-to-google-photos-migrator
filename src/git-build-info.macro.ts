import { execSync } from "node:child_process";

export interface GitBuildInfo {
  readonly hash: string;
  readonly message: string;
}

/** Runs at bundle time only; result is inlined into the bundle. */
export function gitBuildInfo(): GitBuildInfo {
  try {
    const hash = execSync("git rev-parse HEAD", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const message = execSync("git log -1 --pretty=%B", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return { hash, message };
  } catch {
    return { hash: "unknown", message: "unknown" };
  }
}
