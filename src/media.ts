import { extname } from "node:path";
import type { FileEntry, MediaKind, SkippedFile, SupportedMediaFile } from "./types";

const IMAGE_EXTENSIONS = new Set([
  ".avif",
  ".bmp",
  ".gif",
  ".heic",
  ".heif",
  ".jpeg",
  ".jpg",
  ".png",
  ".tif",
  ".tiff",
  ".webp",
]);

const VIDEO_EXTENSIONS = new Set([
  ".3gp",
  ".avi",
  ".m4v",
  ".mkv",
  ".mov",
  ".mp4",
  ".mpeg",
  ".mpg",
  ".webm",
]);

export function classifyMedia(file: FileEntry): SupportedMediaFile | SkippedFile {
  const extension = extname(file.relativePath).toLowerCase();
  const kind = mediaKindForExtension(extension);

  if (!kind) {
    return {
      ...file,
      reason: "unsupported-extension",
      detail: extension ? `Unsupported extension ${extension}` : "File has no extension",
    };
  }

  return {
    ...file,
    kind,
    extension,
  };
}

export function mediaKindForExtension(extension: string): MediaKind | undefined {
  if (IMAGE_EXTENSIONS.has(extension)) {
    return "image";
  }
  if (VIDEO_EXTENSIONS.has(extension)) {
    return "video";
  }
  return undefined;
}

export function supportedExtensions(): readonly string[] {
  return [...IMAGE_EXTENSIONS, ...VIDEO_EXTENSIONS].sort();
}
