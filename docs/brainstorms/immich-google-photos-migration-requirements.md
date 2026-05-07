---
date: 2026-05-06
topic: immich-google-photos-migration
---

# Immich to Google Photos Migration

## Summary

Build a Bun-based migration tool that scans an Immich library tree, groups leaf folders by exact folder name, and uploads their media into Google Photos albums named `ImmichBackup: <folder name>`. The tool should be safe to run as a one-command migration while preserving enough local state to resume after failures or interruptions.

---

## Problem Frame

The source library is already organized into a tree where each leaf folder contains photos and videos that should become album contents in Google Photos. Some leaf folder names repeat across years, and those repeats represent the same desired destination album rather than distinct year-scoped albums.

Google Photos is being accessed through an already-configured rclone Google Photos backend. That backend can create and write albums, but Google Photos is not a normal filesystem: uploads count against account storage, only image/video media is valid, album deletion is limited, and remote metadata is not strong enough to make destructive synchronization a good default.

---

## Actors

- A1. Operator: Runs the migration locally and reviews progress, failures, and skipped files.
- A2. Source library: The local Immich library tree containing leaf folders of photos and videos.
- A3. rclone Google Photos backend: The configured upload mechanism responsible for creating albums and transferring media.

---

## Key Flows

- F1. Plan and migrate
  - **Trigger:** The operator starts a migration for a source library root.
  - **Actors:** A1, A2, A3
  - **Steps:** Preflight the configured rclone remote, discover leaf folders, flag media outside leaf folders, group leaf folders by exact basename, resolve destination albums, classify supported media, upload valid media with bounded concurrency, and record progress as work completes.
  - **Outcome:** Albums exist in Google Photos with media copied from every matching source leaf folder, and the operator receives a summary of what succeeded, failed, and was skipped.
  - **Covered by:** R1, R2, R3, R4, R5, R6, R7, R8, R9, R10, R11, R12, R13, R14, R17, R18

- F2. Resume after interruption
  - **Trigger:** A prior migration exits before all planned work completes.
  - **Actors:** A1, A2, A3
  - **Steps:** Load the local migration state, identify unfinished or failed work, avoid redoing completed units when possible, and continue uploading remaining media.
  - **Outcome:** The operator can continue the migration without manually reconstructing progress.
  - **Covered by:** R11, R13, R14, R15, R16, R17, R18

---

## Requirements

**Source discovery and album mapping**

- R1. The tool must recursively scan a configured source library root and identify leaf folders as migration units.
- R2. The tool must detect media files found outside leaf folders, report them before upload, and require the operator to either confirm the omission or stop the run.
- R3. The tool must derive the destination album key from the exact leaf folder basename only.
- R4. The tool must create destination album names using the format `ImmichBackup: <folder name>`.
- R5. When multiple leaf folders have the same exact basename, the tool must upload all of their valid media into the same destination album.
- R6. Folder names that differ by case, spacing, punctuation, or other exact string differences must be treated as different album keys.
- R7. The tool must show the planned album mapping before upload, including destination album names, contributing source folders, and media counts for each contribution.

**Upload behavior**

- R8. The tool must upload through the existing rclone Google Photos backend by shelling out to the local rclone CLI.
- R9. The tool must invoke rclone through an argument-vector process API without shell command-string evaluation, treating source paths and album names as data.
- R10. The tool must require an explicit rclone remote and must preflight the remote/account identity when rclone can expose it, without logging secrets or full credential contents.
- R11. The tool must preflight destination album names, define behavior for existing albums, fail or require explicit confirmation when duplicate destination album names exist remotely, and avoid concurrent creation of the same destination album.
- R12. Uploads must be additive and must not remove media from Google Photos albums as part of normal migration behavior.
- R13. The tool must classify supported media before upload using a documented Google Photos/rclone-compatible allowlist, skip unsupported files with reason codes, and report leaf folders with no supported media without creating empty albums for them.
- R14. The tool must support bounded parallel upload work, with the operator able to configure the limit; work for the same destination album must be serialized unless planning proves concurrent same-album rclone writes are safe.

**Resumability and reporting**

- R15. The tool must define a checkpointed upload work item and mark it complete only after the corresponding rclone operation succeeds and local progress is persisted.
- R16. The tool must persist local migration progress so an interrupted or failed run can resume without starting from scratch; failed or uncertain work items must be retried or reported as uncertain rather than silently treated as complete.
- R17. Local checkpoint, plan, log, and report artifacts must avoid secrets, use restrictive file permissions where supported, minimize full-path exposure where practical, and document retention or deletion expectations.
- R18. The tool must produce a final report that distinguishes completed upload work, failed or uncertain work, skipped unsupported files, no-supported-media leaf folders, media outside leaf folders, and remaining work if the run did not finish.

---

## Acceptance Examples

- AE1. **Covers R3, R4, R5.** Given source leaf folders `2023/SRP photos all` and `2024/SRP photos all`, when the migration runs, both folders contribute media to the album `ImmichBackup: SRP photos all`.
- AE2. **Covers R6.** Given source leaf folders `SRP photos all` and `SRP Photos All`, when the migration runs, the folders map to two separate albums because their basenames are not exact matches.
- AE3. **Covers R11, R12, R14.** Given one source folder has already uploaded media into an album, when another source folder with the same album key is processed later, the later upload does not remove the earlier media and same-album work is not run concurrently.
- AE4. **Covers R13, R18.** Given a leaf folder contains photos, videos, and unsupported files, when the migration runs, supported media is uploaded and unsupported files appear in the final skipped-files report with reasons.
- AE5. **Covers R15, R16.** Given the migration exits after some upload work completes, when the operator reruns the tool with the same migration state, completed work is recognized and failed or uncertain work is retried or reported.
- AE6. **Covers R2, R7, R18.** Given the source tree contains media files in a non-leaf directory, when the migration is planned, those files are reported before upload and included in the final report if omitted.
- AE7. **Covers R10, R11.** Given a destination album name already exists more than once on the rclone remote, when the migration preflight runs, the tool fails or requires explicit operator confirmation before uploading to that album name.
- AE8. **Covers R13, R18.** Given a leaf folder has no supported media after classification, when the migration runs, the tool does not create an empty album and reports the folder as no-supported-media.

---

## Success Criteria

- The operator can migrate the Immich library into Google Photos albums without hand-creating albums or manually grouping repeated folder names.
- Re-running after failure is routine rather than risky; the tool preserves enough local state to continue and clearly shows what remains.
- The generated plan and final report make it easy to audit where media will go, where media actually went, and what still needs attention.
- Upload concurrency improves throughput when safe while remaining bounded and understandable to the operator.
- A planner or implementer can proceed without inventing album naming, grouping, deletion behavior, unsupported-file handling, or resumability expectations.

---

## Scope Boundaries

- The tool will not deduplicate media beyond whatever Google Photos and rclone already do.
- The tool will not normalize, rename, or manually merge near-duplicate folder names.
- The tool will not integrate directly with the Google Photos API.
- The tool will not delete Google Photos media or albums.
- The tool will not attempt to upload unsupported file types.
- The tool will not guarantee recovery of original-quality downloads from Google Photos after upload; this migration is upload-focused.

---

## Key Decisions

- Exact basename grouping: This matches the stated album identity rule and avoids silently merging names that only look similar.
- Additive upload behavior: Repeated folder names must accumulate into one album, so migration must avoid any behavior that treats one source folder as the complete desired state for that album.
- Preflight before upload: Album mapping, remote identity, destination album ambiguity, and source-tree anomalies should be visible before media starts moving.
- Serialized same-album work: Parallelism is useful across independent albums, but repeated folder names make same-album writes a correctness boundary.
- Local checkpointing: A large media migration is likely to be interrupted or rate-limited, so resumability is part of v1 rather than a later polish item.
- Skip-and-report unsupported files: The migration should keep moving while preserving visibility into source files that need separate handling.
- Secret-safe local artifacts: Checkpoints and reports are useful, but they should not leak rclone credentials or unnecessary private library metadata.

---

## Dependencies / Assumptions

- A writable rclone Google Photos remote is already configured on the machine running the tool, and the operator will provide the intended remote explicitly.
- The source tree is expected to use leaf folders as the intended album membership boundary, and the tool will report evidence that violates that expectation.
- Source media is not expected to contain meaningful duplicates that the tool itself must detect.
- Google Photos storage usage and API limitations are acceptable for this migration.
- The implementation may use Effect for concurrency, error handling, retries, and structured task orchestration.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R8, R10][Technical] How should the operator provide the rclone remote name and source root: CLI flags, config file, environment variables, or a combination?
- [Affects R13][Needs research] What exact media extension or MIME allowlist best matches Google Photos and rclone upload support?
- [Affects R14][Needs research] What default concurrency should be conservative enough for Google Photos while still improving throughput?
- [Affects R15, R16][Technical] What concrete work-item granularity best supports retry safety, checkpoint durability, and understandable reporting?
