import { describe, expect, test } from "bun:test";
import { stat } from "node:fs/promises";
import { Effect } from "effect";
import {
  GOOGLE_PHOTOS_REMOTE_TYPE,
  googlePhotosRemoteIdentityFingerprint,
  RcloneClient,
  remotePath,
  validateRemoteName,
} from "../src/rclone";
import type { RuntimeConfig, WorkItem } from "../src/types";
import { createTempFixture } from "./helpers/temp-fixtures";
import { FakeProcessRunner } from "./helpers/fake-process-runner";

describe("rclone boundary", () => {
  test("builds album list, mkdir, and copy commands without shell strings", async () => {
    const fixture = await createTempFixture();
    try {
      const sourceFile = await fixture.writeFile("source/photo.jpg");
      const runner = new FakeProcessRunner([{ stdout: "ImmichBackup: Event/\n" }, {}, {}]);
      const client = new RcloneClient({ config: config(fixture.root), runner });

      await Effect.runPromise(client.listAlbums());
      await Effect.runPromise(client.createAlbum("ImmichBackup: Event"));
      await Effect.runPromise(
        client.copyWorkItem(await workItem(fixture.root, sourceFile), `${fixture.root}/state/manifests`),
      );

      expect(runner.calls[0]?.command).toEqual(["rclone", "lsf", "gphotos:album", "--dirs-only"]);
      expect(runner.calls[1]?.command).toEqual(["rclone", "mkdir", "gphotos:album/ImmichBackup: Event"]);
      expect(runner.calls[2]?.command.slice(0, 4)).toEqual([
        "rclone",
        "copy",
        `${fixture.root}/source`,
        "gphotos:album/ImmichBackup: Event",
      ]);
      expect(runner.calls[2]?.command).toContain("--files-from-raw");
    } finally {
      await fixture.cleanup();
    }
  });

  test("manifest includes only planned supported files", async () => {
    const fixture = await createTempFixture();
    try {
      const supported = await fixture.writeFile("source/photo.jpg");
      await fixture.writeFile("source/metadata.json");
      const runner = new FakeProcessRunner([{}]);
      const client = new RcloneClient({ config: config(fixture.root), runner });

      await Effect.runPromise(
        client.copyWorkItem(await workItem(fixture.root, supported), `${fixture.root}/state/manifests`),
      );

      const manifestFlagIndex = runner.calls[0]?.command.indexOf("--files-from-raw") ?? -1;
      const manifestPath = runner.calls[0]?.command[manifestFlagIndex + 1];
      expect(typeof manifestPath).toBe("string");
      if (!manifestPath) {
        throw new Error("manifest path was not captured");
      }
      const manifest = await Bun.file(manifestPath).text();
      expect(manifest).toContain("photo.jpg");
      expect(manifest).not.toContain("metadata.json");
    } finally {
      await fixture.cleanup();
    }
  });

  test("detects duplicate visible albums", () => {
    const runner = new FakeProcessRunner();
    const client = new RcloneClient({ config: config("/tmp"), runner });

    expect(
      client.resolveAlbums(["ImmichBackup: Event"], [
        "ImmichBackup: Event",
        "ImmichBackup: Event",
      ]),
    ).toEqual([
      {
        albumName: "ImmichBackup: Event",
        status: "duplicate-visible",
        matches: ["ImmichBackup: Event", "ImmichBackup: Event"],
      },
    ]);
  });

  test("rejects unsafe remotes and control characters", () => {
    expect(() => validateRemoteName("-bad")).toThrow();
    expect(() => validateRemoteName("bad remote")).toThrow();
    expect(() => remotePath("gphotos", "album/bad\u0000name")).toThrow();
  });

  test("Google Photos fingerprint ignores token and client_secret", () => {
    const base = `[gphotos]
type = ${GOOGLE_PHOTOS_REMOTE_TYPE}
token = {"access_token":"a","refresh_token":"b"}
client_id = same.apps.googleusercontent.com
client_secret = secret-one
`;
    const rotated = `[gphotos]
type = ${GOOGLE_PHOTOS_REMOTE_TYPE}
token = {"access_token":"z","refresh_token":"y","expiry":"2099-01-01"}
client_id = same.apps.googleusercontent.com
client_secret = secret-two
`;
    expect(googlePhotosRemoteIdentityFingerprint(base)).toBe(googlePhotosRemoteIdentityFingerprint(rotated));
  });

  test("Google Photos fingerprint changes when client_id changes", () => {
    const a = `[gphotos]
type = google photos
client_id = a.apps.googleusercontent.com
`;
    const b = `[gphotos]
type = google photos
client_id = b.apps.googleusercontent.com
`;
    expect(googlePhotosRemoteIdentityFingerprint(a)).not.toBe(googlePhotosRemoteIdentityFingerprint(b));
  });

  test("rejects non-Google Photos remote type", () => {
    const drive = `[x]
type = drive
client_id = x
`;
    expect(() => googlePhotosRemoteIdentityFingerprint(drive)).toThrow(
      /only supports Google Photos remotes/,
    );
  });

  test("rejects Google Photos remote missing client_id", () => {
    expect(() =>
      googlePhotosRemoteIdentityFingerprint(`[gphotos]
type = google photos
`),
    ).toThrow(/missing client_id/);
  });
});

function config(root: string): RuntimeConfig {
  return {
    sourceRoot: root,
    remote: "gphotos",
    stateDir: `${root}/state`,
    reportDir: `${root}/reports`,
    concurrency: 2,
    planOnly: false,
    yes: false,
    acknowledgeNonLeafMedia: false,
    acknowledgeUnreadablePaths: false,
    acknowledgeUnknownRemote: false,
    retryUncertain: false,
    rcloneBinary: "rclone",
    printRemoteFingerprint: false,
  };
}

async function workItem(root: string, supportedFile: string): Promise<WorkItem> {
  const fileStat = await stat(supportedFile);
  return {
    id: "work",
    albumKey: "Event",
    albumName: "ImmichBackup: Event",
    sourceFolder: `${root}/source`,
    sourceFolderRelativePath: "source",
    manifestFingerprint: "fingerprint",
    supportedFiles: [
      {
        absolutePath: supportedFile,
        relativePath: "source/photo.jpg",
        size: fileStat.size,
        mtimeMs: fileStat.mtimeMs,
        kind: "image",
        extension: ".jpg",
      },
    ],
  };
}
