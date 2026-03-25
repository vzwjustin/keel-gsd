# Implementation Plan

- [x] 1. Write bug condition exploration test
  - **Property 1: Bug Condition** - Four KEEL integration gaps in existing wiring
  - **CRITICAL**: This test MUST FAIL on unfixed code - failure confirms the bugs exist
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected behavior - it will validate the fix when it passes after implementation
  - **GOAL**: Surface counterexamples that demonstrate each of the 4 integration gaps
  - Write a property-based test that asserts:
    1. `health.md` contains `command -v keel >/dev/null 2>&1 && [ -d ".keel" ]` (not just `[ -d ".keel" ]`)
    2. `execute-phase.md` `validate_phase` step contains a `KEEL-STATUS.md` read block
    3. `gsd-workflow-guard.js` alert check uses `path.relative(cwd, filePath)` (not just `path.basename`)
    4. `new-project.md` KEEL bootstrap block contains an inline comment explaining the bootstrap rationale
  - Run test on UNFIXED code
  - **EXPECTED OUTCOME**: Test FAILS for all 4 gaps (confirms bugs exist)
  - Document counterexamples: record exact current content of each failing assertion
  - Mark task complete when test is written, run, and failure is documented
  - _Requirements: 1.1, 1.2, 1.3, 1.4_

- [x] 2. Write preservation property tests (BEFORE implementing fix)
  - **Property 2: Preservation** - Existing KEEL Wiring and KEEL-Absent Behavior Unchanged
  - **IMPORTANT**: Follow observation-first methodology
  - Observe on UNFIXED code:
    - `execute-phase.md` existing KEEL blocks in `validate_phase` and `keel_phase_close` — record exact content
    - `new-project.md` bootstrap KEEL block (`keel init`, `keel scan`, `keel companion start`) — record exact content
    - `gsd-workflow-guard.js` soft advisory behavior and `.keel/session/alerts.yaml` read path — record exact content
    - `gsd-statusline.js` reads `.keel/session/companion-heartbeat.yaml` and `.keel/session/alerts.yaml` — record exact content
    - All 17 wired workflow files — record that their KEEL blocks are present
  - Write property-based tests that:
    - For `execute-phase.md`, assert existing `validate_phase` companion start + checkpoint block is byte-identical after fix (additive only)
    - For `new-project.md`, assert bootstrap KEEL block content is byte-identical after fix (comment added, no content changed)
    - For `gsd-workflow-guard.js`, assert it remains a soft advisory guard (never blocks edits) and still reads `.keel/session/alerts.yaml`
    - For all KEEL guard blocks, assert they are complete no-ops when KEEL is not installed
  - Run tests on UNFIXED code
  - **EXPECTED OUTCOME**: Tests PASS (confirms baseline behavior to preserve)
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.11, 3.12, 3.13, 3.14, 3.15, 3.16_

- [x] 3. Fix the 4 KEEL integration gaps

  - [x] 3.1 Fix `health.md` incomplete guard (Change 1)
    - Change `if [ -d ".keel" ]; then` to `if command -v keel >/dev/null 2>&1 && [ -d ".keel" ]; then` in `health.md` `keel_status_check` step
    - _Bug_Condition: isBugCondition({ file: "health.md", check: "keel_presence_guard" })_
    - _Expected_Behavior: Guard consistent with all other workflows per design Change 1_
    - _Preservation: health.md KEEL behavior unchanged (guard is stricter, not looser)_
    - _Requirements: 2.2_

  - [x] 3.2 Surface KEEL state in `execute-phase.md` at session start (Change 2)
    - After the existing `validate_phase` KEEL companion start block, add a `keel_installed`-gated block that reads `.planning/KEEL-STATUS.md` and surfaces its content
    - Pattern: `if [ "$keel_installed" = "true" ]; then KEEL_STATUS=$(cat .planning/KEEL-STATUS.md 2>/dev/null || echo ""); if [ -n "$KEEL_STATUS" ]; then echo "--- KEEL Status ---"; echo "$KEEL_STATUS"; echo "---"; fi; fi`
    - _Bug_Condition: isBugCondition({ file: "execute-phase.md", check: "keel_status_surface" })_
    - _Expected_Behavior: KEEL state surfaced at session entry consistent with execute-plan.md, resume-project.md, progress.md per design Change 2_
    - _Preservation: Existing validate_phase companion start + checkpoint block unchanged (additive only)_
    - _Requirements: 2.3_

  - [x] 3.3 Fix path-aware alert matching in `gsd-workflow-guard.js` (Change 3)
    - Replace `alertsContent.includes(path.basename(filePath))` with full relative path match with basename fallback
    - Pattern: compute `relPath = path.relative(cwd, filePath)`, match on `relPath` first, fall back to `baseName` only when `relPath` contains no path separator
    - _Bug_Condition: isBugCondition({ file: "gsd-workflow-guard.js", check: "keel_alert_match" })_
    - _Expected_Behavior: No false positives on shared basenames, correct match on full relative paths per design Change 3_
    - _Preservation: Guard remains soft advisory, never blocks edits, still reads same alerts.yaml path_
    - _Requirements: 2.4_

  - [x] 3.4 Document bootstrap exception in `new-project.md` (Change 4)
    - Add inline comment `# Bootstrap guard: .keel/ doesn't exist yet, so we check binary only (not [ -d ".keel" ])` immediately before the `if command -v keel >/dev/null 2>&1; then` line in the KEEL bootstrap block
    - _Bug_Condition: isBugCondition({ file: "new-project.md", check: "guard_comment" })_
    - _Expected_Behavior: Bootstrap exception is documented and clearly intentional per design Change 4_
    - _Preservation: new-project.md KEEL bootstrap content byte-identical (comment added only)_
    - _Requirements: 2.1_

  - [x] 3.5 Verify bug condition exploration test now passes
    - **Property 1: Expected Behavior** - All 4 integration gaps are fixed
    - **IMPORTANT**: Re-run the SAME test from task 1 - do NOT write a new test
    - Run bug condition exploration test from step 1
    - **EXPECTED OUTCOME**: Test PASSES (confirms all 4 changes are correctly implemented)
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

  - [x] 3.6 Verify preservation tests still pass
    - **Property 2: Preservation** - Existing KEEL Wiring and KEEL-Absent Behavior Unchanged
    - **IMPORTANT**: Re-run the SAME tests from task 2 - do NOT write new tests
    - Run preservation property tests from step 2
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions)
    - Confirm `execute-phase.md` existing KEEL blocks are byte-identical (additive only)
    - Confirm `new-project.md` bootstrap content unchanged (comment added only)
    - Confirm `gsd-workflow-guard.js` remains soft advisory
    - Confirm all KEEL wiring is no-op when KEEL not installed

- [x] 4. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.
  - Verify bug condition exploration test (Property 1) passes on fixed code
  - Verify preservation tests (Property 2) pass on fixed code
  - Verify unit tests for `gsd-workflow-guard.js` alert matching pass (full path match, basename fallback, no false positive on shared basename)
  - Run full test suite to confirm no regressions
