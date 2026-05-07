import { describe, expect, test } from "bun:test";
import { classifyMedia, isGooglePhotosRcloneUpload, supportedExtensions } from "../src/media";
import type { FileEntry, SupportedMediaFile } from "../src/types";

describe("media classification", () => {
  test("classifies common image and video extensions case-insensitively", () => {
    expect(classifyMedia(file("photo.JPG"))).toMatchObject({ kind: "image", extension: ".jpg" });
    expect(classifyMedia(file("clip.MP4"))).toMatchObject({ kind: "video", extension: ".mp4" });
  });

  test("skips unsupported files with a reason", () => {
    expect(classifyMedia(file("metadata.json"))).toMatchObject({
      reason: "unsupported-extension",
      detail: "Unsupported extension .json",
    });
  });

  test("exposes a documented allowlist", () => {
    expect(supportedExtensions()).toContain(".jpg");
    expect(supportedExtensions()).toContain(".mp4");
    expect(supportedExtensions()).toContain(".xmp");
  });

  test("classifies XMP as supported image but excludes it from Google Photos rclone uploads", () => {
    const xmp = classifyMedia(file("sidecar.xmp"));
    expect(xmp).toMatchObject({ kind: "image", extension: ".xmp" });
    expect(isGooglePhotosRcloneUpload(xmp as SupportedMediaFile)).toBe(false);
  });
});

function file(relativePath: string): FileEntry {
  return {
    absolutePath: `/library/${relativePath}`,
    relativePath,
    size: 1,
    mtimeMs: 1,
  };
}
