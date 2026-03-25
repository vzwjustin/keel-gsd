# Bugfix Requirements Document

## Introduction

KEEL is an invisible anti-drift guardrail that runs underneath GSD as a protective wrapper. Users never interact with KEEL directly — they only use GSD commands (`/gsd:*`). KEEL's companion, drift detection, checkpoints, scope guard, and done-gate are all managed automatically by GSD's internal workflow machinery at phase boundaries and session transitions. The user's only visible indicator is the ⚓ anchor icon in the statusline (rendered by `hooks/gsd-statusline.js` which reads `.keel/session/companion-heartbeat.yaml` and `.keel/session/alerts.yaml`).

Two reference documents define the integration contract: `get-shit-done/references/keel-guardrails.md` and `keel/guardrails.md`. Together they specify a complete lifecycle mapping where every GSD workflow boundary has a corresponding KEEL action.

### Current Integration Status (as of 2026-03-25, all gaps resolved)

The following workflows have KEEL wiring:

- `new-project.md` — `keel init`, `keel scan`, `keel companion start` (bootstrap); binary-only guard is intentional and now documented inline
- `execute-phase.md` — companion start + checkpoint at phase open; KEEL-STATUS.md surfaced at session start; `keel drift` before verify; `keel checkpoint` at phase close
- `execute-plan.md` — `keel_installed` from init JSON; KEEL-STATUS.md display; pre-task drift advisory; `keel advance` at plan completion
- `verify-phase.md` — `keel_done_gate` advisory step
- `verify-work.md` — `keel_done_precheck` step with `keel done`
- `resume-project.md` — companion restart; KEEL-STATUS.md display
- `discuss-phase.md` — `keel goal` sync
- `plan-phase.md` — `keel plan` sync after planning
- `transition.md` — `keel checkpoint` at phase completion
- `complete-milestone.md` — `keel checkpoint` + `keel companion stop`
- `pause-work.md` — `keel checkpoint` + `keel companion stop`
- `new-milestone.md` — `keel scan` + `keel goal`
- `autonomous.md` — companion start; `keel drift` before verify; `keel checkpoint` between phases; `keel checkpoint` + `keel companion stop` at end
- `fast.md` — companion start (fire-and-forget)
- `quick.md` — companion start (fire-and-forget)
- `progress.md` — companion start; `keel_installed` from init JSON; KEEL-STATUS.md display
- `health.md` — full two-part guard `command -v keel >/dev/null 2>&1 && [ -d ".keel" ]`; KEEL-STATUS.md display

The CLI layer (`get-shit-done/bin/lib/init.cjs`) detects KEEL presence and injects `keel_installed` and `keel_status` into all init JSON outputs. The hook layer (`hooks/gsd-workflow-guard.js`) reads `.keel/session/alerts.yaml` for scope-aware drift warnings using full relative path matching with basename fallback.

All four integration gaps identified in this bugfix have been resolved.

## Bug Analysis

### Current Behavior (Defect)

These defects existed prior to the fix and have since been resolved.

**Consistency Gaps — Existing KEEL wiring used inconsistent patterns:**

1.1 WHEN `new-project.md` bootstrapped a new project THEN it used `command -v keel >/dev/null 2>&1` without the `[ -d ".keel" ]` directory check, inconsistent with all other workflows which use `command -v keel >/dev/null 2>&1 && [ -d ".keel" ]`. The inconsistency was intentional for bootstrap (`.keel` doesn't exist yet), but was undocumented and could cause confusion.

1.2 WHEN `health.md` checked for KEEL status THEN it used `[ -d ".keel" ]` without `command -v keel >/dev/null 2>&1`, inconsistent with the standard two-part guard used everywhere else.

**State Awareness Gaps — Some workflows did not surface KEEL state:**

1.3 WHEN `/gsd:execute-phase` ran THEN it did not read `.planning/KEEL-STATUS.md` to surface accumulated drift alerts at session start, unlike `execute-plan.md`, `resume-project.md`, `progress.md`, and `health.md` which all surface KEEL status.

**Hook Layer Gap — Scope guard integration was partial:**

1.4 WHEN `gsd-workflow-guard.js` (PreToolUse hook) detected a file edit and KEEL was installed THEN it checked `.keel/session/alerts.yaml` for the filename but only matched on `path.basename(filePath)` — a bare filename match that missed files in subdirectories where the alert referenced a full relative path, and produced false positives when two files shared the same basename.

### Expected Behavior (Correct)

These behaviors are now confirmed in the fixed codebase.

**Consistency — All KEEL wiring uses the same pattern:**

2.1 WHEN any GSD workflow internally checks for KEEL presence on an existing project THEN it SHALL use the consistent guard pattern `command -v keel >/dev/null 2>&1 && [ -d ".keel" ]`. The sole exception is `new-project.md` which intentionally omits the directory check because `.keel` does not yet exist at bootstrap time — this exception is now documented inline with a comment.

2.2 WHEN `health.md` checks for KEEL status THEN it SHALL use the full guard `command -v keel >/dev/null 2>&1 && [ -d ".keel" ]` consistent with all other workflows. ✓ Fixed.

**State Awareness — execute-phase surfaces KEEL state:**

2.3 WHEN `/gsd:execute-phase` runs THEN it SHALL read `.planning/KEEL-STATUS.md` (guarded by `keel_installed`) and surface any active alerts or blockers in the phase status presentation, consistent with the pattern already used in `execute-plan.md`, `resume-project.md`, `progress.md`, and `health.md`. ✓ Fixed.

**Hook Layer — Scope guard uses path-aware matching:**

2.4 WHEN `gsd-workflow-guard.js` checks `.keel/session/alerts.yaml` for a file being edited THEN it SHALL match against both the full relative path and the basename, preferring the full path match to avoid false positives from files sharing the same name in different directories. ✓ Fixed — now uses `path.relative(cwd, filePath)` with basename fallback.

### Unchanged Behavior (Regression Prevention)

3.1 WHEN KEEL is not installed (`command -v keel` fails or `.keel` directory does not exist) THEN GSD SHALL CONTINUE TO function identically — all KEEL wiring is no-ops with no errors, warnings, or behavioral changes.

3.2 WHEN `new-project.md` bootstraps a new project THEN GSD SHALL CONTINUE TO internally run `keel init`, `keel scan`, and `keel companion start` as fire-and-forget operations using only the binary check (no `.keel` directory check).

3.3 WHEN `execute-phase.md` validates a phase THEN GSD SHALL CONTINUE TO internally start the companion and open a checkpoint as fire-and-forget operations.

3.4 WHEN `execute-phase.md` closes a phase in the `keel_phase_close` step THEN GSD SHALL CONTINUE TO internally run `keel checkpoint` as a fire-and-forget operation.

3.5 WHEN `verify-phase.md` runs the done-gate in the `keel_done_gate` step THEN GSD SHALL CONTINUE TO internally run `keel done` as an advisory check that does not override GSD status.

3.6 WHEN `resume-project.md` detects KEEL is installed THEN GSD SHALL CONTINUE TO restart the companion if it is not running.

3.7 WHEN any KEEL command fails or produces unexpected output THEN GSD SHALL CONTINUE TO suppress errors via `2>/dev/null` and not block GSD workflow execution.

3.8 WHEN KEEL drift is detected THEN GSD SHALL CONTINUE TO treat drift as advisory — drift alerts surface as warnings but do not interrupt or block GSD execution, consistent with "KEEL is advisory by default".

3.9 WHEN the KEEL done-gate blocks in `verify-phase.md` THEN GSD SHALL CONTINUE TO include the reason in the verification report as an additional gap without overriding the GSD verification status.

3.10 WHEN GSD workflows are run in environments without KEEL THEN GSD SHALL CONTINUE TO function identically to the current behavior — KEEL is purely additive, never required.

3.11 WHEN `hooks/gsd-statusline.js` reads KEEL state from `.keel/session/companion-heartbeat.yaml` and `.keel/session/alerts.yaml` THEN it SHALL CONTINUE TO display the ⚓ anchor icon with the correct color (green=clean, yellow=warn, red=drift, dim=off/stale).

3.12 WHEN `hooks/gsd-workflow-guard.js` detects edits outside a GSD workflow context THEN it SHALL CONTINUE TO function as a soft advisory guard that does not block edits.

3.13 WHEN `pause-work.md` pauses a session THEN GSD SHALL CONTINUE TO run `keel checkpoint` and `keel companion stop` as fire-and-forget operations.

3.14 WHEN `complete-milestone.md` finishes a milestone THEN GSD SHALL CONTINUE TO run `keel checkpoint` and `keel companion stop` as fire-and-forget operations.

3.15 WHEN `autonomous.md` drives multiple phases THEN GSD SHALL CONTINUE TO ensure the companion is running at the start, run `keel checkpoint` between phases, run `keel drift` before each verification, and run `keel checkpoint` + `keel companion stop` when autonomous mode ends.

3.16 WHEN `gsd-tools.cjs init` runs for any workflow THEN it SHALL CONTINUE TO detect KEEL presence and include `keel_installed` and `keel_status` in the returned JSON.
