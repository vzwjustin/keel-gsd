# Requirements Document

## Introduction

The keel companion is a CLI binary that provides real-time anti-drift guardrails for GSD-managed repositories. It runs as a background process alongside GSD phases, watching for scope drift — files touched outside the active plan step, goal statement drift, scope expansion — and surfaces alerts before they compound. The companion writes structured state files that GSD hooks and workflows read to display status and inject drift warnings into agent context.

This spec covers the companion binary itself: its process lifecycle, drift detection engine, alert management, file output contracts, and the full command surface (`keel companion start/stop/status`, `keel checkpoint`, `keel drift`, `keel done`, `keel goal`, `keel scan`, `keel advance`, `keel install`, `keel init`, `keel watch`).

Key retro findings that shape these requirements:
- Alert storms: a single intentional session pivot generated 7 overlapping alerts — alert consolidation is required
- Stale alerts: alerts persisted after their source condition resolved — auto-clear is required
- Companion start UX broke when the binary was absent — graceful fallback is required
- Binary detection was checking `.keel/` directory presence instead of actual binary — already fixed on the GSD side

## Glossary

- **Companion**: The background watcher process started by `keel companion start`, responsible for real-time drift detection
- **Checkpoint**: A snapshot of the current plan state written to `.keel/checkpoints/` that anchors drift detection
- **Alert**: A structured drift finding written to `.keel/session/alerts.yaml`, consumed by GSD hooks
- **Alert cluster**: A group of alerts that share a common root cause (e.g., a single session pivot triggering multiple rule violations)
- **Parent alert**: The consolidated alert that represents an alert cluster, replacing individual child alerts
- **Heartbeat**: A periodic write to `.keel/session/companion-heartbeat.yaml` proving the companion process is alive
- **Done-gate**: The `keel done` check that blocks phase completion when unresolved drift exists
- **Drift**: Any deviation between the current repo state and the active checkpoint's plan intent
- **Session pivot**: An intentional change of direction within a session, acknowledged by the user
- **KEEL-STATUS.md**: The human/agent-readable summary written to `.planning/KEEL-STATUS.md` after any state change
- **Keel_Binary**: The `keel` executable on the system PATH
- **Companion_Process**: The background process managed by `keel companion start/stop`
- **Alert_Engine**: The internal subsystem that evaluates drift rules and produces alerts
- **Checkpoint_Store**: The `.keel/checkpoints/` directory containing checkpoint snapshots
- **Session_Dir**: The `.keel/session/` directory containing live session state files

## Requirements

### Requirement 1: Companion Process Lifecycle

**User Story:** As a GSD workflow, I want to start and stop the companion watcher reliably, so that drift detection is active during execution phases and cleanly shut down when work pauses.

#### Acceptance Criteria

1. WHEN `keel companion start` is invoked AND the Companion_Process is not already running, THE Keel_Binary SHALL start the Companion_Process as a background daemon and write an initial heartbeat to `.keel/session/companion-heartbeat.yaml` within 2 seconds.
2. WHEN `keel companion start` is invoked AND the Companion_Process is already running, THE Keel_Binary SHALL exit with code 0 and write no duplicate process entry.
3. WHEN `keel companion stop` is invoked AND the Companion_Process is running, THE Keel_Binary SHALL terminate the Companion_Process and update `.keel/session/companion-heartbeat.yaml` with `running: false` within 2 seconds.
4. WHEN `keel companion stop` is invoked AND no Companion_Process is running, THE Keel_Binary SHALL exit with code 0 without error output.
5. WHEN `keel companion status` is invoked, THE Keel_Binary SHALL print the companion state to stdout in the format `running: true|false` followed by the `last_beat_at` timestamp.
6. WHEN the Companion_Process is running, THE Companion_Process SHALL update `last_beat_at` in `.keel/session/companion-heartbeat.yaml` at least once every 15 seconds.
7. IF the Companion_Process crashes or is killed externally, THEN THE Companion_Process SHALL NOT automatically restart — the stale heartbeat (age > 30s) signals the off state to GSD hooks.
8. WHEN `keel companion start` is invoked AND `.keel/` does not exist in the current directory, THE Keel_Binary SHALL print a human-readable error message to stderr and exit with a non-zero code without creating partial state.

### Requirement 2: Heartbeat File Contract

**User Story:** As the GSD statusline hook, I want a reliable heartbeat file with a stable schema, so that I can display ⚓ clean / ⚓ N drift / ⚓ off accurately without false positives.

#### Acceptance Criteria

1. THE Companion_Process SHALL write `.keel/session/companion-heartbeat.yaml` with at minimum the fields: `running`, `last_beat_at`, and `pid`.
2. WHEN the Companion_Process writes a heartbeat, THE `last_beat_at` field SHALL be an ISO 8601 UTC timestamp parseable by JavaScript's `new Date()`.
3. WHEN `keel companion stop` completes, THE Keel_Binary SHALL set `running: false` in the heartbeat file and preserve the `last_beat_at` of the final beat.
4. THE Keel_Binary SHALL write the heartbeat file atomically (write to temp file, then rename) to prevent partial reads by the statusline hook.
5. WHILE the Companion_Process is running AND no alerts exist, THE `gsd-statusline.js` hook SHALL display `⚓ clean` in green.
6. WHILE the Companion_Process is running AND one or more alerts exist with `deterministic: true`, THE `gsd-statusline.js` hook SHALL display `⚓ N drift` in red where N is the alert count.
7. WHEN the heartbeat `last_beat_at` is more than 30 seconds old, THE `gsd-statusline.js` hook SHALL display `⚓ stale` in dim regardless of the `running` field value.

### Requirement 3: Alert File Contract

**User Story:** As the GSD workflow guard and statusline hook, I want a stable alerts.yaml schema, so that I can inject drift warnings and display accurate counts without parsing failures.

#### Acceptance Criteria

1. THE Alert_Engine SHALL write `.keel/session/alerts.yaml` as a YAML sequence where each entry contains at minimum: `rule`, `message`, `severity`, `deterministic`, `created_at`, and `source_file` (when applicable).
2. WHEN no alerts are active, THE Alert_Engine SHALL write an empty YAML sequence (`[]`) to `.keel/session/alerts.yaml` rather than omitting the file.
3. THE Alert_Engine SHALL write alerts.yaml atomically to prevent partial reads by GSD hooks.
4. WHEN `gsd-workflow-guard.js` reads alerts.yaml AND a file being edited matches the `source_file` of an active alert, THE `gsd-workflow-guard.js` hook SHALL append a KEEL drift warning to its advisory output.
5. THE Alert_Engine SHALL include a `cluster_id` field on each alert to enable grouping of related alerts.

### Requirement 4: Alert Consolidation (Anti-Storm)

**User Story:** As a GSD agent, I want a single consolidated alert when I make an intentional session pivot, so that I am not overwhelmed by 7 overlapping alerts for one deliberate change.

#### Acceptance Criteria

1. WHEN the Alert_Engine generates two or more alerts within a 10-second window that share the same `cluster_id`, THE Alert_Engine SHALL consolidate them into a single parent alert with `consolidated: true` and a `child_count` field.
2. WHEN a parent alert is written to alerts.yaml, THE Alert_Engine SHALL replace the individual child alerts with the single parent alert entry.
3. THE parent alert `message` SHALL summarize the cluster (e.g., "3 related drift findings — session pivot detected") rather than repeating individual messages.
4. WHEN `keel drift` is invoked, THE Keel_Binary SHALL display consolidated alerts with their child count and offer to expand details with a `--verbose` flag.
5. WHEN a session pivot is acknowledged via `keel advance` or `keel checkpoint`, THE Alert_Engine SHALL clear all alerts sharing the acknowledged cluster_id.
6. FOR ALL alert sets generated by a single root cause event, the count of entries in alerts.yaml SHALL be less than or equal to the count of distinct root causes (consolidation invariant).

### Requirement 5: Stale Alert Auto-Clear

**User Story:** As a GSD agent, I want alerts to automatically clear when their source condition resolves, so that I am not blocked by ghost alerts for problems that no longer exist.

#### Acceptance Criteria

1. WHEN the Companion_Process evaluates drift rules AND a previously active alert's source condition is no longer true, THE Alert_Engine SHALL remove that alert from alerts.yaml within one watch cycle.
2. WHEN `unresolved-questions.yaml` is emptied or deleted AND an alert with `rule: VAL-004` (or equivalent unresolved-questions rule) is active, THE Alert_Engine SHALL clear that alert within one watch cycle.
3. WHEN an alert is auto-cleared, THE Alert_Engine SHALL append a cleared entry to `.keel/session/alert-history.yaml` with `cleared_at` timestamp and `cleared_reason: auto`.
4. THE Companion_Process watch cycle SHALL complete within 5 seconds of a file system change event.
5. FOR ALL alerts in alerts.yaml, a corresponding source condition SHALL currently be true — no alert SHALL persist after its source condition resolves (staleness invariant).

### Requirement 6: Drift Detection Engine

**User Story:** As a GSD agent, I want the companion to detect meaningful drift from the active plan, so that I know when I am working outside the intended scope before it compounds.

#### Acceptance Criteria

1. WHEN `keel checkpoint` is invoked, THE Keel_Binary SHALL snapshot the current plan state (active phase, goal statement, in-scope files) to `.keel/checkpoints/` with a timestamp-based filename.
2. WHEN the Companion_Process detects a file write to a path not covered by the active checkpoint's in-scope file list, THE Alert_Engine SHALL generate a drift alert with `deterministic: true`.
3. WHEN `keel scan` is invoked, THE Keel_Binary SHALL analyze the repository structure and write a scope manifest to `.keel/scope.yaml` listing files and directories relevant to the active plan.
4. WHEN `keel goal` is invoked, THE Keel_Binary SHALL read the current goal from `ROADMAP.md` (or `.planning/` state) and write it to `.keel/goal.yaml`.
5. WHEN `keel drift` is invoked, THE Keel_Binary SHALL compare current repo state against the active checkpoint and print a human-readable drift report to stdout.
6. WHEN `keel drift` is invoked with `--json`, THE Keel_Binary SHALL output a JSON object with `drifted: boolean`, `alerts: []`, and `blockers: []` fields.
7. WHEN `keel watch` is invoked, THE Keel_Binary SHALL start the file watcher in the foreground (non-daemonized) and print drift events to stdout as they occur.

### Requirement 7: Done-Gate

**User Story:** As a GSD verify-work workflow, I want `keel done` to block phase completion when unresolved drift exists, so that reality matches intent before a phase is declared complete.

#### Acceptance Criteria

1. WHEN `keel done` is invoked AND all done-gate checks pass, THE Keel_Binary SHALL exit with code 0 and print `✓ done-gate passed`.
2. WHEN `keel done` is invoked AND one or more done-gate checks fail, THE Keel_Binary SHALL exit with a non-zero code and print which specific check failed and what action resolves it.
3. THE done-gate SHALL check: (a) goal statement has not drifted from the checkpoint, (b) all plan steps are completed or have a recorded delta, (c) no high-severity unresolved alerts exist, (d) companion heartbeat is fresh (within 30 seconds).
4. WHEN `keel done` is invoked with `--json`, THE Keel_Binary SHALL output `{"passed": boolean, "reason": "string", "blockers": []}`.
5. IF the Companion_Process is not running when `keel done` is invoked, THEN THE Keel_Binary SHALL include a stale-companion blocker in the output and exit with a non-zero code.
6. WHEN `keel advance` is invoked, THE Keel_Binary SHALL mark the current plan step as complete, write a checkpoint, and clear alerts associated with that step's cluster_id.

### Requirement 8: KEEL-STATUS.md Output

**User Story:** As a GSD agent, I want a human-readable status file I can read without calling keel directly, so that I can understand KEEL's current view during execution without spawning subprocesses.

#### Acceptance Criteria

1. WHEN any keel command that changes state completes, THE Keel_Binary SHALL write `.planning/KEEL-STATUS.md` with the current goal, active phase, next step, active alerts, and blockers.
2. THE KEEL-STATUS.md file SHALL include a `Last updated` timestamp so agents can determine freshness.
3. WHEN no alerts are active, THE KEEL-STATUS.md SHALL explicitly state "No active alerts" rather than omitting the alerts section.
4. WHEN the Companion_Process writes a heartbeat, THE Companion_Process SHALL also refresh KEEL-STATUS.md if the alert state has changed since the last write.
5. IF `.planning/` does not exist in the current directory, THEN THE Keel_Binary SHALL skip writing KEEL-STATUS.md without error.

### Requirement 9: Installation and Initialization

**User Story:** As a developer, I want `keel install` and `keel init` to bootstrap the keel environment reliably, so that I can add drift protection to any GSD project without manual setup.

#### Acceptance Criteria

1. WHEN `keel install` is invoked in a directory without `.keel/`, THE Keel_Binary SHALL create the `.keel/` directory structure, run `keel init`, run `keel scan`, and start the companion.
2. WHEN `keel install` is invoked in a directory that already has `.keel/`, THE Keel_Binary SHALL skip re-initialization and print an advisory that keel is already installed.
3. WHEN `keel init` is invoked, THE Keel_Binary SHALL create `.keel/session/`, `.keel/checkpoints/`, and write an initial `keel.yaml` config file.
4. IF `keel install` fails to create `.keel/` (e.g., permission error), THEN THE Keel_Binary SHALL print a descriptive error to stderr and exit with a non-zero code.
5. WHEN `keel install` completes successfully, THE Keel_Binary SHALL print a confirmation message listing what was created and the next suggested command.
6. WHERE the `keel` binary is not on PATH, THE GSD workflows SHALL suppress all keel command invocations silently via `2>/dev/null` and continue without drift protection.

### Requirement 10: Graceful Fallback When Binary Is Absent

**User Story:** As a GSD workflow running in an environment without keel installed, I want all keel invocations to fail silently, so that GSD continues to function identically without drift protection.

#### Acceptance Criteria

1. WHEN `command -v keel` fails in any GSD workflow, THE GSD workflow SHALL skip all keel command blocks entirely without surfacing errors to the agent.
2. WHEN `keel companion start` is invoked AND the binary is present but `.keel/` does not exist, THE Keel_Binary SHALL print a human-readable advisory to stderr (`keel not initialized — run keel install first`) and exit with a non-zero code.
3. THE `init.cjs` KEEL detection function SHALL check for binary presence via `which keel` before checking for `.keel/` directory presence, and SHALL return `{ keel_installed: false }` when the binary is absent regardless of directory state.
4. WHEN `keel_installed` is `false` in the GSD init JSON, THE GSD workflows SHALL treat all KEEL state as unavailable and display no KEEL status indicators.
5. IF the companion heartbeat file exists but the `keel` binary is no longer on PATH, THEN THE `gsd-statusline.js` hook SHALL continue to display the last known state from the heartbeat file without attempting to invoke the binary.
