/**
 * KEEL Integration Gaps — Bug Condition Exploration Test
 *
 * Property 1: Bug Condition — Four KEEL integration gaps in existing wiring
 *
 * **Validates: Requirements 1.1, 1.2, 1.3, 1.4**
 *
 * CRITICAL: This test MUST FAIL on unfixed code — failure confirms the bugs exist.
 * DO NOT attempt to fix the test or the code when it fails.
 *
 * This test encodes the EXPECTED (fixed) behavior. It will:
 *   - FAIL on unfixed code (confirming each bug exists)
 *   - PASS on fixed code (confirming each fix is correct)
 *
 * The 4 gaps being tested:
 *   1. health.md uses incomplete guard ([ -d ".keel" ] only, missing command -v keel)
 *   2. execute-phase.md validate_phase does not surface KEEL-STATUS.md
 *   3. gsd-workflow-guard.js uses path.basename only (not path.relative)
 *   4. new-project.md KEEL bootstrap block has no inline comment explaining the exception
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const WORKFLOWS_DIR = path.join(__dirname, '..', 'get-shit-done', 'workflows');
const HEALTH_MD = path.join(WORKFLOWS_DIR, 'health.md');
const EXECUTE_PHASE_MD = path.join(WORKFLOWS_DIR, 'execute-phase.md');
const NEW_PROJECT_MD = path.join(WORKFLOWS_DIR, 'new-project.md');
const GUARD_JS = path.join(__dirname, '..', 'hooks', 'gsd-workflow-guard.js');

describe('Property 1: Bug Condition — Four KEEL Integration Gaps', () => {

  // ---------------------------------------------------------------------------
  // Gap 1: health.md uses incomplete KEEL presence guard
  //
  // Expected (fixed): if command -v keel >/dev/null 2>&1 && [ -d ".keel" ]; then
  // Current (buggy):  if [ -d ".keel" ]; then
  //
  // Requirement 1.2 / Expected Behavior 2.2
  // ---------------------------------------------------------------------------
  test('Gap 1: health.md keel_status_check uses full guard (command -v keel && [ -d ".keel" ])', () => {
    assert.ok(fs.existsSync(HEALTH_MD), `health.md must exist at ${HEALTH_MD}`);
    const content = fs.readFileSync(HEALTH_MD, 'utf-8');

    // The full two-part guard that health.md SHOULD use (but currently does NOT)
    const FULL_GUARD = 'command -v keel >/dev/null 2>&1 && [ -d ".keel" ]';

    // Document the current (buggy) content for the counterexample record
    const keel_status_check_match = content.match(/<step name="keel_status_check">[^]*?<\/step>/);
    const currentBlock = keel_status_check_match ? keel_status_check_match[0] : '(keel_status_check step not found)';

    assert.ok(
      content.includes(FULL_GUARD),
      `health.md keel_status_check must use the full two-part guard: ${FULL_GUARD}\n` +
      `COUNTEREXAMPLE — Current keel_status_check block:\n${currentBlock}`
    );
  });

  // ---------------------------------------------------------------------------
  // Gap 2: execute-phase.md validate_phase does not surface KEEL-STATUS.md
  //
  // Expected (fixed): validate_phase contains a keel_installed-gated block that
  //                   reads .planning/KEEL-STATUS.md and surfaces its content
  // Current (buggy):  no KEEL-STATUS.md read in validate_phase
  //
  // Requirement 1.3 / Expected Behavior 2.3
  // ---------------------------------------------------------------------------
  test('Gap 2: execute-phase.md validate_phase contains KEEL-STATUS.md read block', () => {
    assert.ok(fs.existsSync(EXECUTE_PHASE_MD), `execute-phase.md must exist at ${EXECUTE_PHASE_MD}`);
    const content = fs.readFileSync(EXECUTE_PHASE_MD, 'utf-8');

    // The KEEL-STATUS.md reference that validate_phase SHOULD contain (but currently does NOT)
    const KEEL_STATUS_REF = 'KEEL-STATUS.md';

    // Document the current validate_phase block for the counterexample record
    const validate_phase_match = content.match(/<step name="validate_phase">[^]*?<\/step>/);
    const currentBlock = validate_phase_match ? validate_phase_match[0] : '(validate_phase step not found)';

    // Check that KEEL-STATUS.md appears in the validate_phase step specifically
    const hasKeelStatusInValidatePhase = validate_phase_match &&
      validate_phase_match[0].includes(KEEL_STATUS_REF);

    assert.ok(
      hasKeelStatusInValidatePhase,
      `execute-phase.md validate_phase must contain a KEEL-STATUS.md read block\n` +
      `COUNTEREXAMPLE — Current validate_phase block:\n${currentBlock}`
    );
  });

  // ---------------------------------------------------------------------------
  // Gap 3: gsd-workflow-guard.js uses path.basename only (not path.relative)
  //
  // Expected (fixed): uses path.relative(cwd, filePath) for primary match,
  //                   falls back to path.basename only when no path separator
  // Current (buggy):  uses path.basename(filePath) only — false positives on
  //                   shared basenames, misses full-path alerts
  //
  // Requirement 1.4 / Expected Behavior 2.4
  // ---------------------------------------------------------------------------
  test('Gap 3: gsd-workflow-guard.js alert check uses path.relative(cwd, filePath)', () => {
    assert.ok(fs.existsSync(GUARD_JS), `gsd-workflow-guard.js must exist at ${GUARD_JS}`);
    const content = fs.readFileSync(GUARD_JS, 'utf-8');

    // The path-aware match that the guard SHOULD use (but currently does NOT)
    const PATH_RELATIVE_CALL = 'path.relative(cwd, filePath)';

    // Document the current alert check block for the counterexample record
    const alertBlockMatch = content.match(/\/\/ Check if the file being edited[^]*?keelDriftWarning[^;]+;/);
    const currentBlock = alertBlockMatch ? alertBlockMatch[0] : '(KEEL alert check block not found)';

    assert.ok(
      content.includes(PATH_RELATIVE_CALL),
      `gsd-workflow-guard.js must use path.relative(cwd, filePath) for alert matching\n` +
      `COUNTEREXAMPLE — Current alert check block:\n${currentBlock}`
    );
  });

  // ---------------------------------------------------------------------------
  // Gap 4: new-project.md KEEL bootstrap block has no inline comment
  //
  // Expected (fixed): inline comment before the if-guard explaining why the
  //                   bootstrap uses binary-only check (no [ -d ".keel" ])
  // Current (buggy):  no comment — the intentional exception is undocumented
  //
  // Requirement 1.1 / Expected Behavior 2.1
  // ---------------------------------------------------------------------------
  test('Gap 4: new-project.md KEEL bootstrap block contains inline comment explaining bootstrap rationale', () => {
    assert.ok(fs.existsSync(NEW_PROJECT_MD), `new-project.md must exist at ${NEW_PROJECT_MD}`);
    const content = fs.readFileSync(NEW_PROJECT_MD, 'utf-8');

    // The inline comment that the bootstrap block SHOULD have (but currently does NOT)
    // Per design Change 4: "# Bootstrap guard: .keel/ doesn't exist yet, so we check binary only"
    const BOOTSTRAP_COMMENT = "Bootstrap guard: .keel/ doesn't exist yet";

    // Document the current bootstrap block for the counterexample record
    const bootstrapBlockMatch = content.match(/KEEL guardrail bootstrap[^]*?fi\n/);
    const currentBlock = bootstrapBlockMatch ? bootstrapBlockMatch[0] : '(KEEL bootstrap block not found)';

    assert.ok(
      content.includes(BOOTSTRAP_COMMENT),
      `new-project.md KEEL bootstrap block must contain an inline comment explaining the bootstrap rationale\n` +
      `Expected comment to include: "${BOOTSTRAP_COMMENT}"\n` +
      `COUNTEREXAMPLE — Current bootstrap block:\n${currentBlock}`
    );
  });

});
