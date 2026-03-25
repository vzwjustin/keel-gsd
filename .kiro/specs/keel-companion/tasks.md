# Implementation Plan: keel-companion

## Overview

Build the `keel` CLI binary as a Node.js zero-runtime-dependency tool. Implementation follows the dependency graph: foundation utilities first, then core state modules, then the daemon, then commands, then the entry point wiring everything together, then install/init, then the done-gate, and finally tests.

All code lives under `keel/bin/` with lib modules in `keel/bin/lib/`. State files live under `.keel/` and `.planning/`. Framework: `node:test` for unit tests, `fast-check` (dev dep) for property-based tests.

## Tasks

- [x] 1. Scaffold project structure and foundation utilities
  - Create `keel/bin/lib/` directory with placeholder files for all 7 lib modules
  - Implement `yaml.js`: `parseYaml(text)` and `stringifyYaml(value)` covering strings, numbers, booleans, arrays of objects, and nested objects — no external deps
  - Implement `atomic.js`: `writeAtomic(filePath, content)` using write-to-temp + `fs.renameSync`
  - _Requirements: 2.4, 3.3_
  - _Design: `yaml.js`, `atomic.js` component interfaces_

  - [x] 1.1 Write unit tests for `yaml.js` round-trip
    - Test parse → stringify → parse identity for all YAML shapes used in state files (heartbeat, alerts, checkpoint, scope, goal, keel.yaml)
    - _Requirements: 2.1, 3.1_

  - [x] 1.2 Write unit tests for `atomic.js`
    - Verify temp file is cleaned up on success
    - Verify no partial file is observable when write is interrupted
    - _Requirements: 2.4, 3.3_

- [x] 2. Implement `alerts.js` — Alert Engine
  - Implement `readAlerts(cwd)`: read `.keel/session/alerts.yaml`; return `[]` if absent or empty
  - Implement `writeAlerts(cwd, alerts)`: write atomically via `atomic.js`
  - Implement `evaluateDriftRules(cwd, changedFile)`: evaluate SCOPE-001, GOAL-001, VAL-004, STEP-001 in order; return `Alert[]`
  - Implement `ruleConditionHolds(rule, sourceFile, cwd)`: re-evaluate a single rule's condition against current repo state
  - Implement `consolidateAlerts(alerts, windowMs)`: group by `cluster_id`, replace clusters of ≥2 alerts within window with a single parent alert
  - Implement `appendAlertHistory(cwd, clearedAlerts, clearedReason)`: append to `.keel/session/alert-history.yaml`
  - _Requirements: 3.1, 3.2, 3.3, 3.5, 4.1, 4.2, 4.3, 5.1, 5.2, 5.3_
  - _Design: `alerts.js` component interface, Consolidation Algorithm, Auto-Clear Mechanism_

  - [x] 2.1 Write property test for P1 — Alert Consolidation Invariant
    - **Property P1: For any N alerts sharing a `cluster_id` within a 10s window, `consolidateAlerts` returns exactly 1 entry with `consolidated: true` and `child_count == N`**
    - **Validates: Requirements 4.1, 4.2, 4.6**
    - Use `fc.array(alertArbitrary(), { minLength: 2, maxLength: 10 })` with all alerts mapped to the same `cluster_id`

  - [x] 2.2 Write property test for P2 — Staleness Invariant
    - **Property P2: After toggling any alert's source condition to false and running one watch cycle, no alert with a false condition remains in `alerts.yaml`**
    - **Validates: Requirements 5.1, 5.5**
    - Generate arbitrary alert sets; randomly toggle conditions; assert cleared alerts are absent from output and present in history

  - [x] 2.3 Write property test for P6 — Alert History Completeness
    - **Property P6: Every alert removed from `alerts.yaml` appears in `alert-history.yaml` with a valid `cleared_at` ISO 8601 timestamp and `cleared_reason ∈ { "auto", "advance", "checkpoint" }`**
    - **Validates: Requirements 5.3**
    - Trigger clearing via auto/advance/checkpoint paths; assert every removed alert has a corresponding history entry

  - [x] 2.4 Write unit tests for `alerts.js`
    - `consolidateAlerts`: 1 alert (no consolidation), 2 alerts same cluster, 2 alerts different clusters, window boundary (just inside / just outside 10s)
    - `ruleConditionHolds`: each of SCOPE-001, GOAL-001, VAL-004, STEP-001 with true and false conditions
    - _Requirements: 4.1, 4.2, 5.1, 5.2_

- [x] 3. Implement `checkpoint.js` — Checkpoint Store
  - Implement `writeCheckpoint(cwd, data)`: write to `.keel/checkpoints/<YYYY-MM-DDTHH-MM-SS>.yaml` atomically
  - Implement `loadLatestCheckpoint(cwd)`: read most recent file from `.keel/checkpoints/`; return `null` if none
  - Implement `computeDrift(cwd, checkpoint)`: find files modified since checkpoint, check goal drift (Levenshtein > 20%), check VAL-004; return `{ drifted, alerts, blockers }`
  - _Requirements: 6.1, 6.5, 7.3_
  - _Design: `checkpoint.js` component interface, Checkpoint Diffing algorithm_

  - [x] 3.1 Write unit tests for `checkpoint.js`
    - `computeDrift`: clean state (no drift), single out-of-scope file, goal text drift > 20%, VAL-004 present
    - `loadLatestCheckpoint`: empty directory returns null, multiple checkpoints returns most recent
    - _Requirements: 6.1, 6.2, 6.4_

- [x] 4. Implement `status.js` — KEEL-STATUS.md writer
  - Implement `writeKeelStatus(cwd)`: write `.planning/KEEL-STATUS.md` with goal, phase, next step, active alerts, blockers, and `Last updated` timestamp
  - Skip silently if `.planning/` does not exist
  - Write "No active alerts" when alert list is empty
  - _Requirements: 8.1, 8.2, 8.3, 8.5_
  - _Design: `.planning/KEEL-STATUS.md` file contract_

- [x] 5. Implement `daemon.js` — Process Lifecycle
  - Implement `startDaemon(cwd)`: check `.keel/` exists; read heartbeat PID; if alive exit 0 (idempotent); otherwise spawn detached child with `--daemon` flag and `child.unref()`
  - Implement `stopDaemon(cwd)`: read PID from heartbeat; send SIGTERM; wait up to 2s; write `running: false` to heartbeat; idempotent if not running
  - Implement `getStatus(cwd)`: read heartbeat; return `{ running, pid, last_beat_at, stale }` where `stale = age > 30s`; return `{ running: false }` if file absent
  - Implement `runDaemonLoop(cwd)`: write initial heartbeat; start `fs.watch` with recursive option (fallback to per-directory watch on unsupported platforms); run heartbeat `setInterval` every 15s; call `watchCycle` on file events; refresh KEEL-STATUS.md when alert state changes
  - Apply debounce (500ms) and ignore `.keel/**`, `.git/**`, `node_modules/**` in watch cycle
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 2.1, 2.2, 2.3, 2.4, 8.4_
  - _Design: Daemon Model, PID File and Idempotency, Stop Sequence, Watch Cycle algorithm_

  - [x] 5.1 Write property test for P4 — Idempotent Start
    - **Property P4: Calling `startDaemon(cwd)` N times (1–5) results in exactly one running daemon process**
    - **Validates: Requirements 1.2**
    - Use `fc.integer({ min: 1, max: 5 })` for call count; assert process count == 1 after all calls

  - [x] 5.2 Write property test for P7 — Heartbeat Monotonicity
    - **Property P7: `last_beat_at` in the heartbeat file is non-decreasing across successive writes**
    - **Validates: Requirements 1.6, 2.2**
    - Simulate N heartbeat writes with arbitrary clock values; assert each successive timestamp ≥ previous

  - [x] 5.3 Write property test for P3 — Atomic Write Integrity
    - **Property P3: Every read of `companion-heartbeat.yaml` or `alerts.yaml` during a concurrent `writeAtomic` either parses successfully or returns the previous valid content — never a partial/corrupt state**
    - **Validates: Requirements 2.4, 3.3**
    - Run `writeAtomic` while reading in a tight loop; assert every read result is valid parseable YAML

  - [x] 5.4 Write unit tests for `daemon.js`
    - `getStatus`: absent heartbeat file, `running: true` fresh, `running: true` stale (>30s), `running: false`
    - `startDaemon`: throws when `.keel/` absent
    - _Requirements: 1.5, 1.7, 1.8_

- [x] 6. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Implement `scan.js` and `goal` reader
  - Implement `scan.js`: walk repo, infer scope from active checkpoint `in_scope_files`, containing directories, recent git-modified files, and `.planning/` phase task files; write `.keel/scope.yaml` atomically
  - Implement goal reader (inline in `keel.js` or extracted): read goal from `ROADMAP.md` or `.planning/` state; write `.keel/goal.yaml`
  - _Requirements: 6.3, 6.4_
  - _Design: `scan.js`, Scope Manifest section, `keel goal` command_

- [x] 8. Implement `keel.js` — Entry Point and Command Router
  - Create `keel/bin/keel.js` with shebang `#!/usr/bin/env node`
  - Parse `process.argv` and dispatch to the correct lib module function for each command in the command table
  - Handle `--daemon` internal flag to call `runDaemonLoop` (daemon child entry point)
  - Implement `keel companion start/stop/status`, `keel checkpoint`, `keel drift` (+ `--json`, `--verbose`), `keel goal`, `keel scan`, `keel advance`, `keel watch` commands
  - Print human-readable errors to stderr and exit with correct codes per the command table
  - _Requirements: 1.1–1.5, 2.5, 2.6, 3.4, 4.4, 6.1–6.7, 7.1–7.6_
  - _Design: Command Table, Binary Entry Point_

- [x] 9. Implement `keel install` and `keel init` commands
  - Implement `keel init`: create `.keel/session/`, `.keel/checkpoints/`, write `.keel/keel.yaml` with defaults; add `.keel/session/` to `.gitignore`
  - Implement `keel install`: check if `.keel/` already exists (print advisory + exit 0 if so); create directory structure; call init → scan → goal → checkpoint → companion start in sequence; print confirmation with next suggested command
  - Implement `keel install --link`: symlink `keel/bin/keel.js` to `/usr/local/bin/keel` (fallback to `~/bin/keel`); print resolved path
  - Handle permission errors with descriptive stderr output and exit 1
  - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 10.2_
  - _Design: `keel install` Sequence, PATH Installation_

  - [x] 9.1 Write unit tests for `keel init` and `keel install`
    - `keel init`: creates expected directory structure and `keel.yaml` with correct defaults
    - `keel install`: idempotent when `.keel/` already exists; prints advisory
    - `keel install`: exits 1 with descriptive error on permission failure
    - _Requirements: 9.1, 9.2, 9.3, 9.4_

- [x] 10. Implement `keel done` — Done-Gate
  - Implement `doneGate(cwd)`: run 4 checks in order — (1) heartbeat freshness, (2) no high-severity deterministic alerts, (3) goal not drifted from checkpoint, (4) all plan steps completed or have recorded delta
  - Exit 0 with `✓ done-gate passed` when all checks pass; exit 1 with specific failing check and resolution action when any check fails; exit 2 on internal error
  - Implement `--json` flag: output `{ passed, reason, blockers }`
  - Implement `keel advance`: mark first incomplete plan step as `completed: true`, write new checkpoint, clear step alerts, refresh KEEL-STATUS.md
  - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_
  - _Design: Done-Gate algorithm, `keel advance` Sequence, Exit Codes_

  - [x] 10.1 Write property test for P5 — Done-Gate Soundness
    - **Property P5: `doneGate().passed == true` if and only if all 4 checks pass simultaneously**
    - **Validates: Requirements 7.1, 7.2, 7.3**
    - Generate all 16 combinations of the 4 boolean check states; assert `passed` equals the conjunction of all 4 conditions

  - [x] 10.2 Write unit tests for `keel done`
    - Each of the 4 checks failing in isolation produces the correct blocker message and exit code
    - `--json` output matches `{ passed, reason, blockers }` schema
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

- [x] 11. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 12. Implement Git Event Integration
  - Add `keel git-event` command to `keel.js` command router with two subcommands: `branch-switch` and `commit`
  - Implement `handleBranchSwitch(prevHead, newHead, isBranchSwitch, cwd)`: skip if not a branch switch; get current branch name; compare against active checkpoint phase; write GIT-001 alert on mismatch or clear GIT-001 + write clean checkpoint on match; refresh KEEL-STATUS.md
  - Implement `handleCommit(cwd)`: if companion is running, write a new checkpoint anchored to `HEAD` commit hash; refresh KEEL-STATUS.md
  - Add GIT-001 rule to `alerts.js` `evaluateDriftRules` — severity: medium, deterministic: false
  - Update `keel drift` output to include branch context (branch at checkpoint vs current branch, mismatch flag)
  - Update `keel drift --json` output to include `branch: { at_checkpoint, current, mismatch }` field
  - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.6_
  - _Design: Git Event Integration, Branch Switch Handling, Commit Auto-Checkpoint, Git Rule Definition, Drift Report Branch Context_

  - [x] 12.1 Install git hooks during `keel install`
    - Write `.git/hooks/post-checkout` and `.git/hooks/post-commit` scripts that invoke `keel git-event` with `|| true` to never block git
    - Skip hook installation silently if `.git/` does not exist
    - _Requirements: 9.7, 14.5_
    - _Design: Git Hook Installation_

  - [ ]* 12.2 Write unit tests for git event handling
    - `handleBranchSwitch`: branch matches phase → GIT-001 cleared + checkpoint written; branch mismatches → GIT-001 alert written
    - `handleCommit`: companion running → new checkpoint written; companion not running → no-op
    - Git hooks: exit 0 even when keel command fails
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5_

- [x] 13. Enhance KEEL-STATUS.md with Drift Warning section
  - Update `buildStatusMarkdown` in `status.js` to include a `## ⚠ Drift Warning` section when one or more `severity: high` alerts are active, listing each blocker with its resolution command
  - _Requirements: 12.4_
  - _Design: High-Severity Warning Section_

- [x] 14. Implement drift-report.json persistence
  - Update `cmdDrift` in `keel.js` to write the JSON output to `.keel/session/drift-report.json` in addition to stdout when `--json` flag is used
  - _Requirements: 12.6_
  - _Design: Drift Report JSON Persistence_

- [x] 15. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 16. Implement GSD integration touchpoints
  - [x] 16.1 Update `keel companion start` to write initial KEEL-STATUS.md
    - When `keel companion start` succeeds and `.planning/` exists, call `writeKeelStatus(cwd)` before the first watch cycle completes
    - _Requirements: 12.3_
    - _Design: KEEL-STATUS.md Refresh Contract_

  - [x] 16.2 Add `keel_status` field to GSD_Init context
    - In `get-shit-done/bin/gsd-tools.cjs` (or the relevant init module), update `detectKeel` to return `keel_status` containing parsed heartbeat data (or `null` if absent) alongside `keel_installed`
    - Ensure `keel_installed` is derived from `which keel` binary presence, not `.keel/` directory presence
    - _Requirements: 10.3, 12.7, 15.4_
    - _Design: GSD_Init Binary Detection, GSD_Init Context Enrichment_

  - [x] 16.3 Add context freshness gate for KEEL-STATUS.md
    - In GSD workflow context assembly, include KEEL-STATUS.md content only when the file exists and `Last updated` timestamp is within 60 seconds
    - _Requirements: 12.2, 12.5_
    - _Design: Context Freshness Gate_

  - [ ]* 16.4 Write unit tests for GSD integration touchpoints
    - `detectKeel`: returns `keel_installed: true` with `keel_status` when binary on PATH and heartbeat exists; returns `keel_installed: false` when binary absent
    - Context freshness gate: includes KEEL-STATUS.md when fresh, excludes when stale or absent
    - _Requirements: 10.3, 12.2, 12.7_

- [x] 17. Wire GSD phase lifecycle hooks
  - [x] 17.1 Add keel companion start/checkpoint to GSD phase start
    - In the GSD `execute-phase` workflow (or phase-start hook), add gated calls: `keel companion start 2>/dev/null` then `keel checkpoint 2>/dev/null`, gated by `keel_installed` from GSD_Init
    - Use fire-and-forget pattern; consume only exit code
    - _Requirements: 11.1, 11.3, 11.4, 11.6, 15.1, 15.5_
    - _Design: Phase Start Sequence, Silent Invocation Contract, Fire-and-Forget Invocation Pattern_

  - [x] 17.2 Add keel done gate to GSD verify-work
    - In the GSD `verify-work` workflow, invoke `keel done` when `keel_installed` is true; if exit code is non-zero, surface blocker output and halt phase completion; if exit 0, invoke `keel companion stop 2>/dev/null`
    - _Requirements: 11.2, 13.1, 13.3, 13.4, 13.5_
    - _Design: Phase End Sequence_

  - [x] 17.3 Add keel drift gate to GSD complete-milestone
    - In the GSD `complete-milestone` workflow, read `.keel/session/alerts.yaml`; if any alert has `severity: high` AND `deterministic: true`, invoke `keel done` and block milestone completion on non-zero exit
    - Skip drift gate entirely if keel binary not on PATH or alerts.yaml absent/empty
    - _Requirements: 13.2, 13.4, 13.5, 13.6_
    - _Design: Milestone Completion Blocking_

  - [x] 17.4 Add fallback handling for absent keel binary in GSD workflows
    - Ensure all GSD workflow keel invocation points check `keel_installed` from GSD_Init and skip keel blocks silently when false
    - Ensure `gsd-statusline.js` reads heartbeat directly from disk (no subprocess) and displays no KEEL indicator when binary absent
    - _Requirements: 10.1, 10.4, 10.5, 10.6, 15.6_
    - _Design: Fallback When Binary Is Absent, Statusline Hook Compatibility_

  - [ ]* 17.5 Write unit tests for GSD phase lifecycle hooks
    - Phase start: `keel companion start` + `keel checkpoint` called when `keel_installed` is true; skipped when false
    - Verify-work: `keel done` blocks phase completion on non-zero exit; passes on exit 0
    - Complete-milestone: blocked when high-severity deterministic alerts exist; passes when alerts empty
    - Fallback: all keel blocks skipped silently when binary absent
    - _Requirements: 11.1, 11.2, 11.5, 13.1, 13.2, 13.4_

- [x] 18. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP
- Each task references specific requirements for traceability
- Property tests (P1–P7) use `fast-check`; unit tests use `node:test` + `assert`
- `fast-check` is a dev dependency only — zero runtime deps is a hard constraint
- Node.js ≥ 18.0.0 required for `fs.watch` recursive option and `node:test`
- Tasks 1–11 are completed from the initial implementation pass
- Tasks 12–18 cover Requirements 11–15 (GSD lifecycle integration, drift data feedback, command blocking, git event integration, Claude Code compatibility)
