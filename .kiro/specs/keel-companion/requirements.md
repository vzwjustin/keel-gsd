# Requirements Document

## Introduction

Keel is the drift security layer for GSD-managed repositories. It acts as an enforcement wall that protects each GSD stage from scope drift — files touched outside the active plan step, goal statement drift, scope expansion — and blocks stage completion when drift is unresolved. The companion watcher runs as a real-time background process, continuously monitoring the file system and surfacing structured alerts before drift compounds.

GSD orchestrates the keel lifecycle. Keel runs as the enforcement layer beneath GSD stages — it starts automatically when GSD phases begin, enforces drift rules throughout execution, and stops when phases end. Keel surfaces drift data through `.planning/KEEL-STATUS.md` and `.keel/session/` state files that GSD hooks and workflows consume to display status and inject drift warnings into agent context. Users never need to invoke keel directly during normal GSD operation; GSD handles all lifecycle management transparently.

Keel's role is analogous to a security checkpoint: every GSD stage passes through keel's enforcement layer, and keel decides whether the stage is clean enough to proceed. When drift is detected, keel blocks stage completion until the drift is acknowledged or resolved.

This spec covers the keel binary itself: its process lifecycle, real-time companion watcher, drift detection engine, alert management, file output contracts, and the full command surface (`keel companion start/stop/status`, `keel checkpoint`, `keel drift`, `keel done`, `keel goal`, `keel scan`, `keel advance`, `keel install`, `keel init`, `keel watch`).

Key retro findings that shape these requirements:
- Alert storms: a single intentional session pivot generated 7 overlapping alerts — alert consolidation is required
- Stale alerts: alerts persisted after their source condition resolved — auto-clear is required
- Companion start UX broke when the binary was absent — graceful fallback is required
- Binary detection was checking `.keel/` directory presence instead of actual binary — already fixed on the GSD side
- Statusline showing "keel unavailable" when companion should be running — GSD must own the full lifecycle

## Glossary

- **Keel**: The drift security layer — the enforcement wall that protects GSD stages from scope drift
- **Companion**: The real-time background watcher process started by `keel companion start`, responsible for continuous file system monitoring and drift detection
- **Companion_Process**: The real-time background watcher process managed by `keel companion start/stop`
- **Checkpoint**: A snapshot of the current plan state written to `.keel/checkpoints/` that anchors drift detection and defines the enforcement boundary
- **Alert**: A structured drift finding written to `.keel/session/alerts.yaml`, consumed by GSD hooks to block or warn
- **Alert_Cluster**: A group of alerts that share a common `cluster_id` root cause (e.g., a single session pivot triggering multiple rule violations)
- **Parent_Alert**: The consolidated alert that represents an Alert_Cluster, replacing individual child alerts
- **Heartbeat**: A periodic write to `.keel/session/companion-heartbeat.yaml` proving the Companion_Process is alive and the enforcement layer is active
- **Done_Gate**: The `keel done` enforcement check that blocks GSD stage completion when unresolved drift exists
- **Drift**: Any deviation between the current repo state and the active Checkpoint's plan intent — the condition keel is designed to detect and block
- **Session_Pivot**: An intentional change of direction within a session, acknowledged by the user via `keel advance` or `keel checkpoint`
- **KEEL_STATUS_File**: The human/agent-readable enforcement summary written to `.planning/KEEL-STATUS.md` after any state change
- **Keel_Binary**: The `keel` executable on the system PATH
- **Alert_Engine**: The internal subsystem that evaluates drift rules and produces enforcement alerts
- **Checkpoint_Store**: The `.keel/checkpoints/` directory containing checkpoint snapshots that define enforcement boundaries
- **Session_Dir**: The `.keel/session/` directory containing live session state files
- **GSD_Workflow**: Any GSD command or workflow that passes through keel's enforcement layer
- **GSD_Init**: The `gsd-tools.cjs init` call that returns the JSON context block consumed by GSD workflows, including keel enforcement state
- **Watch_Cycle**: A single iteration of the Companion_Process file watcher evaluation loop, triggered by a file system change event
- **Staleness_Threshold**: The 30-second age limit for heartbeat freshness; a heartbeat older than 30 seconds indicates the Companion_Process is dead
- **Consolidation_Window**: The 10-second time window within which alerts sharing a `cluster_id` are merged into a single Parent_Alert

## Requirements

### Requirement 1: Companion Process Lifecycle

**User Story:** As a GSD workflow, I want the keel enforcement layer to start and stop reliably with each phase, so that real-time drift protection is always active during execution and cleanly shut down when work pauses.

#### Acceptance Criteria

1. WHEN `keel companion start` is invoked AND the Companion_Process is not already running, THE Keel_Binary SHALL start the Companion_Process as a background daemon and write an initial heartbeat to `.keel/session/companion-heartbeat.yaml` within 2 seconds.
2. WHEN `keel companion start` is invoked AND the Companion_Process is already running, THE Keel_Binary SHALL exit with code 0 and write no duplicate process entry (idempotent start).
3. WHEN `keel companion stop` is invoked AND the Companion_Process is running, THE Keel_Binary SHALL send SIGTERM to the Companion_Process and update `.keel/session/companion-heartbeat.yaml` with `running: false` within 2 seconds.
4. WHEN `keel companion stop` is invoked AND no Companion_Process is running, THE Keel_Binary SHALL exit with code 0 and produce no output to stdout or stderr.
5. WHEN `keel companion status` is invoked, THE Keel_Binary SHALL print the companion state to stdout in the format `running: true|false` followed by the `last_beat_at` timestamp.
6. WHILE the Companion_Process is running, THE Companion_Process SHALL update `last_beat_at` in `.keel/session/companion-heartbeat.yaml` every 15 seconds.
7. IF the Companion_Process crashes or is killed externally, THEN THE Companion_Process SHALL remain stopped — the stale heartbeat (age exceeding the Staleness_Threshold) signals the off state to GSD hooks.
8. WHEN `keel companion start` is invoked AND `.keel/` does not exist in the current directory, THE Keel_Binary SHALL print `keel not initialized — run keel install first` to stderr and exit with code 1 without creating partial state.
9. WHEN `keel companion start` is invoked by a GSD_Workflow AND the Companion_Process starts successfully, THE Keel_Binary SHALL exit with code 0 and produce no output to stdout or stderr.
10. WHEN `keel companion stop` is invoked by a GSD_Workflow AND the stop completes, THE Keel_Binary SHALL exit with code 0 and produce no output to stdout or stderr.

### Requirement 2: Heartbeat File Contract

**User Story:** As the GSD statusline hook, I want a reliable heartbeat file with a stable schema, so that I can display ⚓ clean / ⚓ N drift / ⚓ off accurately without false positives.

#### Acceptance Criteria

1. THE Companion_Process SHALL write `.keel/session/companion-heartbeat.yaml` with the fields: `running` (boolean), `last_beat_at` (ISO 8601 UTC string), and `pid` (integer).
2. WHEN the Companion_Process writes a heartbeat, THE `last_beat_at` field SHALL be an ISO 8601 UTC timestamp parseable by JavaScript `new Date()`.
3. WHEN `keel companion stop` completes, THE Keel_Binary SHALL set `running: false` in the heartbeat file and preserve the `last_beat_at` value of the final beat.
4. THE Keel_Binary SHALL write the heartbeat file atomically (write to temp file, then `fs.renameSync`) to prevent partial reads by concurrent hook processes.
5. WHILE the Companion_Process is running AND no alerts exist in `.keel/session/alerts.yaml`, THE `gsd-statusline.js` hook SHALL display `⚓ clean` in green.
6. WHILE the Companion_Process is running AND one or more alerts exist with `deterministic: true` in `.keel/session/alerts.yaml`, THE `gsd-statusline.js` hook SHALL display `⚓ N drift` in red where N is the count of deterministic alerts.
7. WHEN the heartbeat `last_beat_at` is older than the Staleness_Threshold (30 seconds), THE `gsd-statusline.js` hook SHALL display `⚓ stale` in dim regardless of the `running` field value.
8. WHEN the Keel_Binary is not on PATH or `.keel/` does not exist, THE `gsd-statusline.js` hook SHALL display no KEEL indicator rather than displaying an error state.

### Requirement 3: Alert File Contract

**User Story:** As the GSD workflow guard and statusline hook, I want a stable alerts.yaml schema, so that I can inject drift warnings and display accurate counts without parsing failures.

#### Acceptance Criteria

1. THE Alert_Engine SHALL write `.keel/session/alerts.yaml` as a YAML sequence where each entry contains the fields: `rule` (string), `message` (string), `severity` (`high` | `medium` | `low`), `deterministic` (boolean), `created_at` (ISO 8601 UTC string), `source_file` (string or null), and `cluster_id` (string).
2. WHEN no alerts are active, THE Alert_Engine SHALL write an empty YAML sequence (`[]`) to `.keel/session/alerts.yaml` rather than deleting the file.
3. THE Alert_Engine SHALL write alerts.yaml atomically (write to temp file, then `fs.renameSync`) to prevent partial reads by GSD hooks.
4. WHEN `gsd-workflow-guard.js` reads alerts.yaml AND a file being edited matches the `source_file` of an active alert, THE `gsd-workflow-guard.js` hook SHALL append a KEEL drift warning to the advisory output.
5. THE Alert_Engine SHALL include a `cluster_id` field on each alert to enable grouping of related alerts into an Alert_Cluster.
6. FOR ALL valid alert YAML content, parsing then stringifying then parsing SHALL produce an equivalent alert list (round-trip property).

### Requirement 4: Alert Consolidation (Anti-Storm)

**User Story:** As a GSD agent, I want a single consolidated alert when I make an intentional Session_Pivot, so that I am not overwhelmed by 7 overlapping alerts for one deliberate change.

#### Acceptance Criteria

1. WHEN the Alert_Engine generates two or more alerts within the Consolidation_Window (10 seconds) that share the same `cluster_id`, THE Alert_Engine SHALL consolidate the alerts into a single Parent_Alert with `consolidated: true` and a `child_count` field equal to the number of consolidated alerts.
2. WHEN a Parent_Alert is written to alerts.yaml, THE Alert_Engine SHALL replace the individual child alerts with the single Parent_Alert entry.
3. THE Parent_Alert `message` field SHALL contain the child count and the text "related drift findings" (e.g., "3 related drift findings — session pivot detected").
4. WHEN `keel drift` is invoked, THE Keel_Binary SHALL display consolidated alerts with their `child_count` value; WHEN `keel drift --verbose` is invoked, THE Keel_Binary SHALL expand consolidated alerts to show individual child rule identifiers.
5. WHEN a Session_Pivot is acknowledged via `keel advance` or `keel checkpoint`, THE Alert_Engine SHALL clear all alerts sharing the acknowledged `cluster_id`.
6. FOR ALL alert sets generated by a single root cause event, the count of entries in alerts.yaml SHALL be less than or equal to the count of distinct `cluster_id` values (consolidation invariant).

### Requirement 5: Stale Alert Auto-Clear

**User Story:** As a GSD agent, I want alerts to automatically clear when their source condition resolves, so that I am not blocked by ghost alerts for problems that no longer exist.

#### Acceptance Criteria

1. WHEN the Companion_Process evaluates drift rules during a Watch_Cycle AND a previously active alert's source condition no longer holds, THE Alert_Engine SHALL remove that alert from alerts.yaml within one Watch_Cycle.
2. WHEN `unresolved-questions.yaml` is emptied or deleted AND an alert with `rule: VAL-004` is active, THE Alert_Engine SHALL clear that alert within one Watch_Cycle.
3. WHEN an alert is auto-cleared, THE Alert_Engine SHALL append a cleared entry to `.keel/session/alert-history.yaml` with a `cleared_at` ISO 8601 UTC timestamp and `cleared_reason: auto`.
4. THE Companion_Process Watch_Cycle SHALL complete evaluation within 5 seconds of a file system change event.
5. FOR ALL alerts in alerts.yaml, the corresponding source condition SHALL currently hold — no alert SHALL persist after its source condition resolves (staleness invariant).

### Requirement 6: Drift Detection Engine

**User Story:** As a GSD agent, I want the companion to detect meaningful drift from the active plan, so that I know when I am working outside the intended scope before drift compounds.

#### Acceptance Criteria

1. WHEN `keel checkpoint` is invoked, THE Keel_Binary SHALL snapshot the current plan state (active phase, goal statement, in-scope files, in-scope directories, plan steps) to `.keel/checkpoints/` with a filename in the format `YYYY-MM-DDTHH-MM-SS.yaml`.
2. WHEN the Companion_Process detects a file write to a path not covered by the active Checkpoint's `in_scope_files` or `in_scope_dirs` lists, THE Alert_Engine SHALL generate a drift alert with `rule: SCOPE-001`, `severity: high`, and `deterministic: true`.
3. WHEN `keel scan` is invoked, THE Keel_Binary SHALL analyze the repository structure and write a scope manifest to `.keel/scope.yaml` listing files and directories relevant to the active plan.
4. WHEN `keel goal` is invoked, THE Keel_Binary SHALL read the current goal from `ROADMAP.md` or `.planning/` state files and write the goal to `.keel/goal.yaml`.
5. WHEN `keel drift` is invoked, THE Keel_Binary SHALL compare the current repo state against the active Checkpoint and print a drift report to stdout listing each drifted file and rule violation.
6. WHEN `keel drift --json` is invoked, THE Keel_Binary SHALL output a JSON object with the fields: `drifted` (boolean), `alerts` (array), and `blockers` (array).
7. WHEN `keel watch` is invoked, THE Keel_Binary SHALL start the file watcher in the foreground (non-daemonized) and print drift events to stdout as they occur.

### Requirement 7: Done-Gate

**User Story:** As a GSD verify-work workflow, I want `keel done` to enforce a hard block on stage completion when unresolved drift exists, so that keel's security layer ensures reality matches intent before a GSD stage is declared complete.

#### Acceptance Criteria

1. WHEN `keel done` is invoked AND all Done_Gate checks pass, THE Keel_Binary SHALL exit with code 0 and print `✓ done-gate passed`.
2. WHEN `keel done` is invoked AND one or more Done_Gate checks fail, THE Keel_Binary SHALL exit with code 1 and print which specific check failed and the command that resolves the blocker.
3. THE Done_Gate SHALL evaluate four checks in order: (a) Companion_Process heartbeat is fresh (within the Staleness_Threshold of 30 seconds), (b) no alerts with `severity: high` AND `deterministic: true` exist in alerts.yaml, (c) goal statement has not drifted more than 20% (Levenshtein distance ratio) from the active Checkpoint, (d) all plan steps in the active Checkpoint are marked `completed: true` or have a recorded `delta` field.
4. WHEN `keel done --json` is invoked, THE Keel_Binary SHALL output `{"passed": boolean, "reason": "string", "blockers": []}` to stdout.
5. IF the Companion_Process is not running or the heartbeat is stale when `keel done` is invoked, THEN THE Keel_Binary SHALL include a stale-companion blocker in the output and exit with code 1.
6. WHEN `keel advance` is invoked, THE Keel_Binary SHALL mark the first incomplete plan step as `completed: true`, write a new Checkpoint, clear all alerts associated with that step's `cluster_id`, and append cleared alerts to alert-history.yaml with `cleared_reason: advance`.

### Requirement 8: KEEL-STATUS.md Output

**User Story:** As a GSD agent, I want a readable status file I can read without calling keel directly, so that I can understand KEEL's current view during execution without spawning subprocesses.

#### Acceptance Criteria

1. WHEN any keel command that changes state completes (checkpoint, advance, drift evaluation, companion start), THE Keel_Binary SHALL write `.planning/KEEL-STATUS.md` with the current goal, active phase, next step, active alerts, and blockers.
2. THE KEEL_STATUS_File SHALL include a `Last updated` field containing an ISO 8601 UTC timestamp so agents can determine freshness.
3. WHEN no alerts are active, THE KEEL_STATUS_File SHALL contain the text "No active alerts" in the alerts section rather than omitting the section.
4. WHEN the Companion_Process writes a heartbeat AND the alert state has changed since the last KEEL_STATUS_File write, THE Companion_Process SHALL refresh the KEEL_STATUS_File.
5. IF `.planning/` does not exist in the current directory, THEN THE Keel_Binary SHALL skip writing the KEEL_STATUS_File without error output.

### Requirement 9: Installation and Initialization

**User Story:** As a developer, I want `keel install` and `keel init` to bootstrap the keel environment reliably, so that I can add drift protection to any GSD project without manual setup.

#### Acceptance Criteria

1. WHEN `keel install` is invoked in a directory without `.keel/`, THE Keel_Binary SHALL create the `.keel/` directory structure, run `keel init`, run `keel scan`, run `keel goal`, run `keel checkpoint`, and start the Companion_Process — in that order.
2. WHEN `keel install` is invoked in a directory that already has `.keel/`, THE Keel_Binary SHALL skip re-initialization, print an advisory message to stdout, and exit with code 0.
3. WHEN `keel init` is invoked, THE Keel_Binary SHALL create `.keel/session/`, `.keel/checkpoints/`, and write an initial `.keel/keel.yaml` config file with default values.
4. IF `keel install` fails to create `.keel/` due to a permission error, THEN THE Keel_Binary SHALL print the failing path and the OS error message to stderr and exit with code 1.
5. WHEN `keel install` completes successfully, THE Keel_Binary SHALL print a confirmation message listing the created directories and the next suggested command (`keel drift`).
6. WHEN `keel install` is invoked, THE Keel_Binary SHALL add `.keel/session/` to `.gitignore` if the pattern is not already present, so session state files are not committed to version control.
7. WHEN `keel install` is invoked, THE Keel_Binary SHALL install git hooks (`post-checkout`, `post-commit`) into `.git/hooks/` that invoke the appropriate keel commands; IF `.git/` does not exist, THEN THE Keel_Binary SHALL skip git hook installation without error.

### Requirement 10: Graceful Fallback When Binary Is Absent

**User Story:** As a GSD workflow running in an environment without keel installed, I want all keel invocations to fail silently, so that GSD continues to function identically without drift protection.

#### Acceptance Criteria

1. WHEN `command -v keel` fails in any GSD_Workflow, THE GSD_Workflow SHALL skip all keel command blocks entirely without surfacing errors to the agent.
2. WHEN `keel companion start` is invoked AND the Keel_Binary is present but `.keel/` does not exist, THE Keel_Binary SHALL print `keel not initialized — run keel install first` to stderr and exit with code 1.
3. THE GSD_Init KEEL detection function SHALL check for binary presence via `which keel` before checking for `.keel/` directory presence, and SHALL return `{ keel_installed: false }` when the binary is absent regardless of `.keel/` directory state.
4. WHEN `keel_installed` is `false` in the GSD_Init JSON, THE GSD_Workflow SHALL treat all KEEL state as unavailable and display no KEEL status indicators.
5. IF the heartbeat file exists but the Keel_Binary is no longer on PATH, THEN THE `gsd-statusline.js` hook SHALL read `.keel/session/companion-heartbeat.yaml` directly from disk and display the last known state without attempting to invoke the Keel_Binary.
6. WHEN `keel_installed` is `false`, THE GSD_Init JSON SHALL include `"keel_installed": false` as a top-level field so all GSD workflows can gate keel blocks with a single JSON field check.

### Requirement 11: GSD Phase Lifecycle Integration

**User Story:** As a GSD workflow, I want keel's enforcement layer to automatically activate and deactivate in sync with GSD phase execution, so that every GSD stage is protected by real-time drift detection without requiring manual companion management.

#### Acceptance Criteria

1. WHEN a GSD phase begins execution (via `execute-phase` or phase-start hook), THE GSD_Workflow SHALL invoke `keel companion start` before any phase work begins, gated by the `keel_installed` field from GSD_Init.
2. WHEN a GSD phase ends (via phase completion or `verify-work`), THE GSD_Workflow SHALL invoke `keel companion stop` after all phase work is complete.
3. WHEN a GSD phase begins AND `keel companion start` succeeds, THE GSD_Workflow SHALL invoke `keel checkpoint` to anchor the phase start state before any phase work begins.
4. WHEN `keel_installed` is `true` in GSD_Init AND the Companion_Process is not running at phase start, THE GSD_Workflow SHALL invoke `keel companion start` unconditionally rather than checking `keel companion status` first — start is idempotent and the status check adds latency.
5. IF the Keel_Binary is not on PATH when a GSD phase hook attempts to invoke a keel command, THEN THE GSD_Workflow SHALL skip the companion lifecycle call silently and continue phase execution without drift protection.
6. WHEN a GSD_Workflow invokes any keel command, THE GSD_Workflow SHALL redirect both stdout and stderr to `/dev/null` (via `2>/dev/null`) unless the command output is explicitly consumed by the workflow logic.

### Requirement 12: Drift Data Feedback into GSD Context

**User Story:** As a GSD agent, I want keel drift data automatically surfaced in GSD planning files and agent context, so that I can see drift status without explicitly invoking keel commands during execution.

#### Acceptance Criteria

1. WHEN the Companion_Process detects a drift state change (new alert generated or alert cleared), THE Companion_Process SHALL refresh the KEEL_STATUS_File within one Watch_Cycle.
2. WHEN a GSD_Workflow reads agent context files from `.planning/`, THE GSD_Workflow SHALL include the content of the KEEL_STATUS_File in the agent context if the file exists and the `Last updated` timestamp is within 60 seconds.
3. WHEN `keel companion start` is invoked AND `.planning/` exists, THE Keel_Binary SHALL write an initial KEEL_STATUS_File before the first Watch_Cycle completes.
4. WHEN the Companion_Process writes the KEEL_STATUS_File AND one or more alerts with `severity: high` are active, THE KEEL_STATUS_File SHALL include a `## ⚠ Drift Warning` section listing each blocker with the resolution command.
5. IF the KEEL_STATUS_File does not exist when a GSD_Workflow reads context, THEN THE GSD_Workflow SHALL proceed without KEEL context and produce no error output.
6. WHEN `keel drift --json` is invoked, THE Keel_Binary SHALL write the JSON output to `.keel/session/drift-report.json` in addition to stdout, so GSD hooks can read the last drift report without re-invoking the Keel_Binary.
7. WHEN GSD_Init is called with `keel_installed: true`, THE GSD_Init response SHALL include a `keel_status` field containing the parsed content of `.keel/session/companion-heartbeat.yaml` (or `null` if the file is absent).

### Requirement 13: GSD Command Blocking on High-Severity Drift

**User Story:** As a GSD workflow, I want keel to enforce hard blocks on phase and milestone completion when high-severity drift is detected, so that keel's security layer prevents scope integrity violations at GSD workflow boundaries.

#### Acceptance Criteria

1. WHEN `verify-work` is invoked AND `keel done` exits with a non-zero code, THE GSD_Workflow SHALL surface the `keel done` blocker output to the agent and halt phase completion.
2. WHEN `complete-milestone` is invoked AND `.keel/session/alerts.yaml` contains one or more alerts with `severity: high` AND `deterministic: true`, THE GSD_Workflow SHALL invoke `keel done` and block milestone completion if `keel done` exits with code 1.
3. WHEN a GSD command is blocked by keel drift, THE GSD_Workflow SHALL print the specific keel blocker message and the resolution command (e.g., `keel advance` or `keel checkpoint`) before halting.
4. IF the Keel_Binary is not on PATH when `verify-work` or `complete-milestone` attempts a drift check, THEN THE GSD_Workflow SHALL skip the drift gate entirely and proceed without blocking.
5. IF `.keel/session/alerts.yaml` does not exist or contains an empty sequence when `verify-work` runs, THEN THE GSD_Workflow SHALL treat the drift gate as passed and proceed with phase completion.
6. WHEN `keel done` blocks a GSD command AND the user resolves the drift (via `keel advance` or `keel checkpoint`), THE GSD_Workflow SHALL allow the blocked command to be re-invoked and complete successfully.

### Requirement 14: Git Event Integration

**User Story:** As a GSD agent, I want keel to respond to git events (branch switches and commits) so that Checkpoint state stays anchored to the actual git context and context changes are detected automatically.

#### Acceptance Criteria

1. WHEN a git branch switch is detected (via `post-checkout` git hook), THE Keel_Binary SHALL write a branch-switch alert to `.keel/session/alerts.yaml` with `rule: GIT-001`, `severity: medium`, and `deterministic: false`.
2. WHEN a git commit is made AND the Companion_Process is running, THE Companion_Process SHALL write a new Checkpoint to anchor the committed state as the new drift baseline.
3. WHEN a git branch switch is detected AND the new branch name contains the active GSD phase identifier, THE Keel_Binary SHALL clear any existing `GIT-001` alert and write a clean Checkpoint for the new branch context.
4. WHEN a git branch switch is detected AND the new branch name does not contain the active GSD phase identifier, THE Keel_Binary SHALL preserve the `GIT-001` alert until the user explicitly acknowledges the context change via `keel checkpoint` or `keel advance`.
5. IF a git hook invocation fails (e.g., Keel_Binary not on PATH or keel command returns non-zero), THEN THE git hook script SHALL exit with code 0 to avoid blocking git operations.
6. WHEN `keel drift` is invoked, THE Keel_Binary SHALL include the current git branch name and the branch recorded at Checkpoint time in the drift report, flagging a mismatch as a context warning.

### Requirement 15: Claude Code CLI Compatibility

**User Story:** As a developer using Claude Code CLI to run GSD workflows, I want keel to start and operate correctly within the Claude Code execution environment, so that drift protection works without manual intervention.

#### Acceptance Criteria

1. WHEN a GSD_Workflow is executed inside Claude Code CLI AND `keel_installed` is `true`, THE GSD_Workflow SHALL invoke `keel companion start` as a fire-and-forget bash command so the Companion_Process daemon starts without blocking the Claude Code agent's execution.
2. WHEN `keel companion start` forks the daemon process, THE Keel_Binary SHALL use `child_process.spawn` with `detached: true`, `stdio: 'ignore'`, and `child.unref()` so the daemon survives the parent process exiting and does not inherit Claude Code's stdio handles.
3. WHEN the Companion_Process is running inside a Claude Code session AND Claude Code exits or is interrupted, THE Companion_Process SHALL continue running as an independent OS process until explicitly stopped via `keel companion stop`.
4. WHEN GSD_Init is called from within a Claude Code workflow, THE GSD_Init response SHALL derive `keel_installed` from `which keel` resolution, not from `.keel/` directory presence, so the field is accurate in all Claude Code working directory contexts.
5. WHEN a GSD_Workflow running in Claude Code invokes `keel companion start` AND the Companion_Process starts successfully, THE GSD_Workflow SHALL consume only the exit code 0 as the success signal and read no stdout or stderr output from the command.
6. WHEN the `gsd-statusline.js` hook runs inside a Claude Code terminal AND the Companion_Process is running, THE hook SHALL read `.keel/session/companion-heartbeat.yaml` directly from disk rather than invoking `keel companion status`, so the statusline displays correctly regardless of PATH resolution in the hook's execution context.
7. WHEN `keel install` is invoked in a Claude Code project, THE Keel_Binary SHALL support a `--link` flag that creates a symlink from `/usr/local/bin/keel` (or `~/bin/keel` if `/usr/local/bin` is not writable) to `keel/bin/keel.js` and print the resolved symlink path to stdout.

### Requirement 16: YAML State File Round-Trip Integrity

**User Story:** As the keel binary, I want the internal YAML parser and serializer to preserve data integrity across parse-stringify cycles, so that state files are never corrupted by serialization.

#### Acceptance Criteria

1. FOR ALL valid Checkpoint YAML content, THE `yaml.js` module SHALL produce an equivalent JavaScript object when parsing, stringifying, and parsing again (round-trip property).
2. FOR ALL valid heartbeat YAML content, THE `yaml.js` module SHALL produce an equivalent JavaScript object when parsing, stringifying, and parsing again (round-trip property).
3. FOR ALL valid alert YAML content, THE `yaml.js` module SHALL produce an equivalent JavaScript object when parsing, stringifying, and parsing again (round-trip property).
4. WHEN `yaml.js` receives malformed YAML input, THE `yaml.js` module SHALL throw an error with a message indicating the line number or character position of the parse failure.
5. THE `yaml.js` module SHALL correctly handle the YAML subset used by keel state files: strings, numbers, booleans, null, arrays of objects, and nested objects.
