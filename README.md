# immich-to-google-photos-migrator

A Bun/TypeScript CLI for uploading an Immich library export into Google Photos albums through an existing rclone Google Photos remote.

The migrator scans leaf folders in an Immich library tree, groups folders by exact basename, and uploads supported media into albums named `ImmichBackup: <folder name>`. Repeated names across years, such as `2023/SRP photos all` and `2024/SRP photos all`, feed the same destination album.

## Requirements

- Bun 1.3+
- A writable rclone Google Photos remote
- Enough Google account storage for original-quality uploads

Google Photos uploads through rclone count against account storage. rclone can create and write Google Photos albums, but Google Photos is not a normal filesystem: listing and metadata verification are limited, album deletion is limited, and rclone can only upload into albums it can create or see as app-writable.

## Install

```bash
bun install
```

## Dry Run

Start with a plan-only run:

```bash
bun run start --source /path/to/ImmichLibrary/library/admin --remote gphotos --plan-only
```

By default, local state and reports are written under `.immich-google-photos-migrator/`, which is gitignored. Treat these files as private: they can contain media filenames, album mappings, checkpoint state, and sanitized rclone diagnostics.

The plan report includes:

- Destination album names
- Source leaf folders contributing to each album
- Supported media counts
- Unsupported files skipped with reasons
- Media found outside leaf folders
- Leaf folders with no supported media

Plan-only runs always write the report so you can inspect what would happen. Uploads stop if media is found outside leaf folders unless you explicitly acknowledge that omission:

```bash
bun run start --source /path/to/library --remote gphotos --plan-only --acknowledge-non-leaf-media
```

## Upload

After reviewing the plan, remove `--plan-only`:

```bash
bun run start --source /path/to/ImmichLibrary/library/admin --remote gphotos --acknowledge-non-leaf-media
```

Useful options:

- `--state-dir <path>`: private checkpoint state directory
- `--report-dir <path>`: report output directory
- `--concurrency <n>`: album-parallel upload workers, default `2`
- `--rclone-binary <path>`: explicit rclone executable, default `rclone`
- `--acknowledge-unreadable-paths`: continue when some source paths could not be read
- `--acknowledge-unknown-remote`: continue when rclone cannot prove album listing or account identity
- `--retry-uncertain` / `--retry-failed`: retry failed or uncertain uploads from a previous run
- `--retry-uncertain-only`: retry only failed/uncertain work items; skip full library discovery when `plan-snapshot.json` exists in `--state-dir` (implies `--retry-uncertain`)
- `--only-path <paths>`: comma-separated source folder paths (relative to `--source`) to limit which work items run
- `--only-work-item-id <ids>`: comma-separated checkpoint work item ids to limit which work items run
- `--print-remote-fingerprint`: run rclone preflight only, print the stable `v2:` remote fingerprint (for `checkpoint.json`), then exit
- `--yes`: apply all explicit acknowledgements

Uploads are additive. The tool uses rclone copy-style behavior and does not delete Google Photos media or albums.

## Resume

The migrator writes checkpoint state after each successful upload work item. Re-run the same command with the same state directory to continue after an interruption.

Completed work is skipped only when the checkpoint identity still matches the current source root, remote name, stable Google Photos remote fingerprint (`v2:` prefix), album policy, media allowlist, and planned file manifests. The fingerprint is derived from the remote `type` and OAuth `client_id` only (tokens and `client_secret` are ignored), so OAuth refresh does not invalidate resume. If you upgrade from an older tool version that stored a legacy full-config hash, update `identity.remoteFingerprint` in `checkpoint.json` once—use `--print-remote-fingerprint` to print the current value.

Work left `running` by an interrupted process is normalized to `uncertain` on resume. Definitive rclone upload failures are recorded as `failed`. Both `failed` and `uncertain` items are skipped on resume unless you pass `--retry-uncertain` (or `--retry-failed`).

After any upload run, the tool writes `plan-snapshot.json` into `--state-dir`. On later finish-up runs, `--retry-uncertain-only` loads that snapshot instead of scanning the full library. If the snapshot is missing (for example, after upgrading before any new upload run), the tool falls back to full discovery automatically—no manual state edits required.

The final `migration-report.md` lists folder paths and album names for failed/uncertain work, includes rclone stderr when available, and adds a **Next Steps** section when work remains incomplete.

Only one run may use a state directory at a time. If a previous process was interrupted, inspect the lock file and active processes before removing the lock manually.

## Testing

Run the automated suite with:

```bash
bun test
```

Run TypeScript checks with:

```bash
bun run typecheck
```

The default tests use temp fixtures and fake rclone behavior. They verify orchestration, command construction, checkpointing, reports, and edge cases without contacting Google Photos. They are not proof that the current live Google Photos API will accept a real upload.

## Manual Google Photos Check

Before a full migration, run a small real-world check:

1. Create a tiny source tree with one or two supported media files.
2. Run a plan-only command and review the album mapping.
3. Run an upload with low concurrency.
4. Confirm the `ImmichBackup: <folder name>` album appears in Google Photos.
5. Re-run the same command and confirm completed work is skipped.
6. Review the final report for failed, uncertain, skipped, and remaining work.

Do not use a large source tree until this small check behaves as expected for your rclone remote.

## Notes

- Folder matching is exact. `SRP photos all` and `SRP Photos All` are different albums.
- Unsupported files are skipped before upload and reported.
- Leaf folders with no supported media do not create empty albums.
- Media outside leaf folders and unreadable source paths are reported and require acknowledgement before upload.
- Source files are re-stat checked immediately before upload; changed files are marked uncertain rather than uploaded under a stale plan.
- The tool does not normalize folder names, deduplicate media, delete Google Photos content, or integrate directly with the Google Photos API.
