import { Cause, Option } from "effect";
import { RcloneError, type WorkItemStatus } from "./types";

export function formatRcloneErrorMessage(error: RcloneError): string {
  const parts = [error.message];
  if (error.exitCode !== undefined) {
    parts.push(`exit=${error.exitCode}`);
  }
  const stderr = error.stderr?.trim();
  if (stderr) {
    parts.push(`stderr: ${stderr}`);
  }
  const stdout = error.stdout?.trim();
  if (stdout && !stderr) {
    parts.push(`stdout: ${stdout}`);
  }
  return parts.join(" | ").slice(0, 4000);
}

export function workItemFailureUpdate(cause: Cause.Cause<unknown>): {
  readonly status: WorkItemStatus;
  readonly message: string;
} {
  const rclone = Cause.failureOption(cause).pipe(
    Option.filter((error): error is RcloneError => error instanceof RcloneError),
  );
  if (Option.isSome(rclone)) {
    return { status: "failed", message: formatRcloneErrorMessage(rclone.value) };
  }
  return { status: "failed", message: Cause.pretty(cause).slice(0, 4000) };
}

export function isRetryEligibleStatus(
  status: WorkItemStatus | undefined,
  retryIncomplete: boolean,
): boolean {
  if (status === "complete") {
    return false;
  }
  if (status === "failed" || status === "uncertain") {
    return retryIncomplete;
  }
  return true;
}
