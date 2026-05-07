import { Data } from "effect";

export const ALBUM_PREFIX = "ImmichBackup: ";
export const ALBUM_POLICY_VERSION = 1;
export const MEDIA_ALLOWLIST_VERSION = 1;

export type AbsolutePath = string;
export type RelativePath = string;
export type AlbumKey = string;
export type AlbumName = string;
export type WorkItemId = string;

export class ConfigError extends Data.TaggedError("ConfigError")<{
  readonly message: string;
}> {}

export class DiscoveryError extends Data.TaggedError("DiscoveryError")<{
  readonly message: string;
  readonly path?: string;
}> {}

export class RcloneError extends Data.TaggedError("RcloneError")<{
  readonly message: string;
  readonly command?: readonly string[];
  readonly exitCode?: number;
  readonly stdout?: string;
  readonly stderr?: string;
}> {}

export class CheckpointError extends Data.TaggedError("CheckpointError")<{
  readonly message: string;
  readonly path?: string;
}> {}

export type AppError = ConfigError | DiscoveryError | RcloneError | CheckpointError;

export interface RuntimeConfig {
  readonly sourceRoot: AbsolutePath;
  readonly remote: string;
  readonly stateDir: AbsolutePath;
  readonly reportDir: AbsolutePath;
  readonly concurrency: number;
  readonly planOnly: boolean;
  readonly yes: boolean;
  readonly acknowledgeNonLeafMedia: boolean;
  readonly acknowledgeUnreadablePaths: boolean;
  readonly acknowledgeUnknownRemote: boolean;
  readonly retryUncertain: boolean;
  readonly rcloneBinary: string;
}

export interface FileEntry {
  readonly absolutePath: AbsolutePath;
  readonly relativePath: RelativePath;
  readonly size: number;
  readonly mtimeMs: number;
}

export interface LeafFolder {
  readonly absolutePath: AbsolutePath;
  readonly relativePath: RelativePath;
  readonly basename: string;
  readonly files: readonly FileEntry[];
}

export interface DiscoveryResult {
  readonly sourceRoot: AbsolutePath;
  readonly leafFolders: readonly LeafFolder[];
  readonly outsideLeafFiles: readonly FileEntry[];
  readonly unreadablePaths: readonly { readonly path: string; readonly reason: string }[];
}

export type MediaKind = "image" | "video";

export interface SupportedMediaFile extends FileEntry {
  readonly kind: MediaKind;
  readonly extension: string;
}

export interface SkippedFile extends FileEntry {
  readonly reason: "unsupported-extension" | "outside-leaf" | "unreadable" | "invalid-path";
  readonly detail: string;
}

export interface NoSupportedMediaFolder {
  readonly folder: LeafFolder;
  readonly skippedFiles: readonly SkippedFile[];
}

export interface AlbumContribution {
  readonly sourceFolder: LeafFolder;
  readonly albumKey: AlbumKey;
  readonly albumName: AlbumName;
  readonly supportedFiles: readonly SupportedMediaFile[];
  readonly skippedFiles: readonly SkippedFile[];
}

export interface AlbumPlan {
  readonly albumKey: AlbumKey;
  readonly albumName: AlbumName;
  readonly contributions: readonly AlbumContribution[];
  readonly supportedFileCount: number;
}

export interface MigrationPlan {
  readonly sourceRoot: AbsolutePath;
  readonly albums: readonly AlbumPlan[];
  readonly workItems: readonly WorkItem[];
  readonly skippedFiles: readonly SkippedFile[];
  readonly outsideLeafMedia: readonly SupportedMediaFile[];
  readonly noSupportedMediaFolders: readonly NoSupportedMediaFolder[];
  readonly unreadablePaths: readonly { readonly path: AbsolutePath; readonly reason: string }[];
  readonly planFingerprint: string;
}

export interface WorkItem {
  readonly id: WorkItemId;
  readonly albumKey: AlbumKey;
  readonly albumName: AlbumName;
  readonly sourceFolder: AbsolutePath;
  readonly sourceFolderRelativePath: RelativePath;
  readonly supportedFiles: readonly SupportedMediaFile[];
  readonly manifestFingerprint: string;
}

export type WorkItemStatus = "planned" | "running" | "complete" | "failed" | "uncertain";

export interface WorkItemState {
  readonly id: WorkItemId;
  readonly status: WorkItemStatus;
  readonly attempts: number;
  readonly updatedAt: string;
  readonly message?: string;
}

export interface MigrationIdentity {
  readonly sourceRoot: AbsolutePath;
  readonly remote: string;
  readonly remoteFingerprint: string;
  readonly albumPolicyVersion: number;
  readonly mediaAllowlistVersion: number;
  readonly planFingerprint: string;
}

export interface CheckpointState {
  readonly version: 1;
  readonly identity: MigrationIdentity;
  readonly workItems: Record<WorkItemId, WorkItemState>;
}

export interface ProcessResult {
  readonly command: readonly string[];
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut?: boolean;
  readonly signalCode?: string;
}

export interface ProcessRunner {
  run(command: readonly string[], options?: ProcessRunOptions): Promise<ProcessResult>;
}

export interface ProcessRunOptions {
  readonly cwd?: string;
  readonly env?: Record<string, string>;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

export interface RcloneAlbumResolution {
  readonly albumName: AlbumName;
  readonly status: "visible-existing" | "needs-create" | "duplicate-visible" | "listing-unavailable";
  readonly matches: readonly string[];
  readonly message?: string;
}

export interface MigrationReport {
  readonly completed: readonly WorkItemState[];
  readonly failed: readonly WorkItemState[];
  readonly uncertain: readonly WorkItemState[];
  readonly remaining: readonly WorkItem[];
  readonly skippedFiles: readonly SkippedFile[];
  readonly outsideLeafMedia: readonly SupportedMediaFile[];
  readonly noSupportedMediaFolders: readonly NoSupportedMediaFolder[];
  readonly unreadablePaths: readonly { readonly path: AbsolutePath; readonly reason: string }[];
}
