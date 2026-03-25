# KEEL Integration Gaps Bugfix Design

## Overview

KEEL is an invisible anti-drift guardrail that runs underneath GSD. The majority of the integration contract defined in `get-shit-done/references/keel-guardrails.md` and `keel/guardrails.md` has already been implemented: 17 workflow files have KEEL wiring, `init.cjs` injects `keel_installed` and `keel_status` into all init JSON outputs, and `gsd-workflow-guard.js` reads `.keel/session/alerts.yaml` for scope-aware drift warnings.

Four narrow gaps were identified and have been resolved:

1. `health.md` used an incomplete KEEL presence guard (`[ -d ".keel" ]` only, missing `command -v keel`) — **fixed**
2. `execute-phase.md` didn't surface `.planning/KEEL-STATUS.md` at session start — **fixed**
3. `gsd-workflow-guard.js` matched alert files by basename only, causing false positives and missed matches on path collisions — **fixed**
4. `new-project.md` used a binary-only guard (intentional for bootstrap, but undocumented) — **documented**

## Glossary

- **KEEL presence guard**: The standard two-part check `command -v keel >/dev/null 2>&1 && [ -d ".keel" ]` that gates all KEEL operations on existing projects
- **Bootstrap guard**: The binary-only check `command -v keel >/dev/null 2>&1` used exclusively in `new-project.md` where `.keel` doesn't exist yet
- **Fire-and-forget**: KEEL commands run with `2>/dev/null` error suppression, never blocking GSD execution
- **`keel_installed`**: Boolean field injected into all init JSON by `init.cjs` — workflows use this instead of independent shell checks
- **`.planning/KEEL-STATUS.md`**: Primary state channel between KEEL and GSD — contains goal, phase, blockers, active alerts
- **`.keel/session/alerts.yaml`**: Real-time drift alerts written by the KEEL companion, read by `gsd-workflow-guard.js` and `gsd-statusline.js`

## Bug Details

### Bug Condition

**Formal Specification:**
```
FUNCTION isBugCondition(input)
  INPUT: input of type { file: string, check: string }
  OUTPUT: boolean

  RETURN (
    // health.md uses incomplete guard
    (input.file == "health.md" AND input.check == "keel_presence_guard"
     AND NOT containsBinaryCheck(input.file))

    // execute-phase.md doesn't surface KEEL state at session start
    OR (input.file == "execute-phase.md" AND input.check == "keel_status_surface"
        AND NOT surfacesKeelStatus(input.file))

    // workflow guard uses basename-only matching
    OR (input.file == "gsd-workflow-guard.js" AND input.check == "keel_alert_match"
        AND NOT usesPathAwareMatch(input.file))

    // new-project.md bootstrap guard is undocumented exception
    OR (input.file == "new-project.md" AND input.check == "guard_comment"
        AND NOT hasBootstrapComment(input.file))
  )
END FUNCTION
```

### Examples (pre-fix behavior)

- `health.md` ran on a machine where `.keel/` exists but `keel` binary is not in PATH → the incomplete guard `[ -d ".keel" ]` passed → `cat .planning/KEEL-STATUS.md` ran but KEEL was not actually installed
- `/gsd:execute-phase` started a session → no KEEL-STATUS.md was surfaced → agent proceeded blind to any drift alerts that accumulated since the last session, unlike `resume-project.md` and `progress.md` which both surface KEEL state
- User edited `src/auth/login.js` → KEEL alert referenced `src/auth/login.js` → guard checked `path.basename("src/auth/login.js")` = `"login.js"` → also matched `src/legacy/login.js` (false positive) or missed if alert used full path
- Developer read `new-project.md` and saw `command -v keel >/dev/null 2>&1` without `[ -d ".keel" ]` → unclear whether this was intentional or a bug

## Expected Behavior

### Preservation Requirements

All existing KEEL wiring across the 17 wired workflow files must remain unchanged. Specifically:

- `new-project.md` bootstrap (`keel init`, `keel scan`, `keel companion start`) continues using binary-only guard — `.keel` doesn't exist yet at that point
- `execute-phase.md` existing wiring (`validate_phase` companion start + checkpoint, `keel_pre_verify_drift`, `keel_phase_close` checkpoint) continues unchanged
- `execute-plan.md` full KEEL lifecycle (status display, pre-task drift advisory, `keel advance`) continues unchanged
- `verify-phase.md` `keel_done_gate` advisory step continues unchanged
- `verify-work.md` `keel_done_precheck` step continues unchanged
- `resume-project.md` companion restart + KEEL-STATUS.md display continues unchanged
- `autonomous.md` full lifecycle (companion start, inter-phase checkpoints, drift check, final stop) continues unchanged
- `pause-work.md`, `complete-milestone.md` checkpoint + companion stop continues unchanged
- `discuss-phase.md` `keel goal`, `plan-phase.md` `keel plan`, `transition.md` `keel checkpoint`, `new-milestone.md` `keel scan + goal` continue unchanged
- `fast.md`, `quick.md`, `progress.md` companion start continues unchanged
- `init.cjs` `detectKeel()` + `parseKeelStatus()` injection into all init JSON continues unchanged
- `gsd-workflow-guard.js` soft advisory behavior (never blocks edits) continues unchanged
- `gsd-statusline.js` ⚓ statusline display continues unchanged
- All wiring is no-op when KEEL is not installed

## Root Cause Analysis

1. **Incomplete guard in `health.md`**: The `keel_status_check` step was written with `[ -d ".keel" ]` only, likely copied from an early draft before the two-part guard was standardized. All other workflows use the full guard. **Fixed.**

2. **Missing status surface in `execute-phase.md`**: The `validate_phase` step wired companion start and checkpoint but didn't read KEEL-STATUS.md. This was an oversight — `execute-plan.md` (which runs inside execute-phase) does surface KEEL state, but the outer `execute-phase.md` session entry did not. **Fixed.**

3. **Basename-only matching in `gsd-workflow-guard.js`**: The alert check used `path.basename(filePath)` which was a reasonable first approximation but broke when multiple files shared a name or when KEEL alerts referenced full relative paths. **Fixed — now uses `path.relative(cwd, filePath)` with basename fallback.**

4. **Undocumented bootstrap exception in `new-project.md`**: The binary-only guard is correct behavior (`.keel` doesn't exist before `keel init` runs), but there was no inline comment explaining why it differed from the standard pattern. **Documented.**

## Correctness Properties

**Property 1: Guard Consistency**

_For any_ GSD workflow file that checks KEEL presence on an existing project, the guard SHALL be `command -v keel >/dev/null 2>&1 && [ -d ".keel" ]`. The sole exception is `new-project.md` which SHALL use `command -v keel >/dev/null 2>&1` only, with an inline comment explaining the bootstrap rationale.

**Validates: Requirements 2.1, 2.2**

**Property 2: KEEL State Surfacing at Session Entry**

_For any_ GSD workflow that serves as a session entry point and already has KEEL wiring, it SHALL also read `.planning/KEEL-STATUS.md` (guarded by `keel_installed`) and surface active alerts/blockers, consistent with the pattern in `execute-plan.md`, `resume-project.md`, `progress.md`, and `health.md`.

**Validates: Requirement 2.3**

**Property 3: Path-Aware Alert Matching**

_For any_ file edit event processed by `gsd-workflow-guard.js`, the KEEL alert check SHALL match against the full relative path of the file being edited (not just the basename), falling back to basename only when the alert entry does not contain a path separator.

**Validates: Requirement 2.4**

**Property 4: Preservation**

_For any_ GSD workflow execution where KEEL is not installed, the fixed code SHALL produce exactly the same behavior as the original code. All existing KEEL wiring in the 17 wired files SHALL remain byte-identical after the fix.

**Validates: Requirements 3.1–3.16**

## Fix Implementation

### Change 1 — Fix `health.md` guard

**File**: `get-shit-done/workflows/health.md`

**Current:**
```bash
if [ -d ".keel" ]; then
```

**Fixed:**
```bash
if command -v keel >/dev/null 2>&1 && [ -d ".keel" ]; then
```

### Change 2 — Surface KEEL state in `execute-phase.md`

**File**: `get-shit-done/workflows/execute-phase.md`

Add after the existing `validate_phase` KEEL companion start block:

```bash
# Surface KEEL state awareness if available
if [ "$keel_installed" = "true" ]; then
  KEEL_STATUS=$(cat .planning/KEEL-STATUS.md 2>/dev/null || echo "")
  if [ -n "$KEEL_STATUS" ]; then
    echo "--- KEEL Status ---"
    echo "$KEEL_STATUS"
    echo "---"
  fi
fi
```

Note: `keel_installed` is already available from the init JSON parsed earlier in `validate_phase`.

### Change 3 — Path-aware matching in `gsd-workflow-guard.js`

**File**: `hooks/gsd-workflow-guard.js`

**Current:**
```javascript
if (alertsContent && filePath && alertsContent.includes(path.basename(filePath))) {
  keelDriftWarning = ` KEEL drift alert: file may be outside active plan scope.`;
}
```

**Fixed:**
```javascript
if (alertsContent && filePath) {
  const relPath = path.relative(cwd, filePath);
  const baseName = path.basename(filePath);
  // Prefer full relative path match; fall back to basename for alerts without path separators
  const matched = alertsContent.includes(relPath) ||
    (!relPath.includes(path.sep) && alertsContent.includes(baseName));
  if (matched) {
    keelDriftWarning = ` KEEL drift alert: file may be outside active plan scope.`;
  }
}
```

### Change 4 — Document bootstrap exception in `new-project.md`

**File**: `get-shit-done/workflows/new-project.md`

**Current:**
```bash
if command -v keel >/dev/null 2>&1; then
  keel init 2>/dev/null
```

**Fixed:**
```bash
# Bootstrap guard: .keel/ doesn't exist yet, so we check binary only (not [ -d ".keel" ])
if command -v keel >/dev/null 2>&1; then
  keel init 2>/dev/null
```

## Testing Strategy

### Exploratory Checks (run on unfixed code first)

1. **Guard audit**: Grep `health.md` for `command -v keel` — expect 0 matches (confirms bug)
2. **Status surface audit**: Grep `execute-phase.md` for `KEEL-STATUS.md` — expect 0 matches in `validate_phase` context (confirms bug)
3. **Path match audit**: Read `gsd-workflow-guard.js` alert check — expect `path.basename` only (confirms bug)
4. **Bootstrap comment audit**: Read `new-project.md` KEEL block — expect no inline comment (confirms gap)

### Fix Verification

1. After Change 1: `health.md` guard matches `command -v keel >/dev/null 2>&1 && [ -d ".keel" ]`
2. After Change 2: `execute-phase.md` `validate_phase` step contains `KEEL-STATUS.md` read block
3. After Change 3: `gsd-workflow-guard.js` uses `path.relative(cwd, filePath)` for primary match
4. After Change 4: `new-project.md` KEEL block has inline comment explaining bootstrap rationale

### Preservation Checks

- All 17 previously-wired workflow files: KEEL blocks are byte-identical before and after fix (except `execute-phase.md` which gets an additive block, and `new-project.md` which gets a comment)
- `gsd-workflow-guard.js`: still soft advisory (never blocks), still reads same `.keel/session/alerts.yaml` path
- `init.cjs`: `detectKeel()` and `parseKeelStatus()` unchanged
- All wiring is no-op when KEEL not installed

### Unit Tests

- `gsd-workflow-guard.js` alert matching: full path match, basename fallback, no false positive on shared basename, no match when file not in alerts
- `health.md` guard: no-op when `keel` binary absent, no-op when `.keel/` absent, reads status when both present
- `execute-phase.md` status block: surfaces KEEL-STATUS.md content when `keel_installed=true`, silent when `keel_installed=false`
