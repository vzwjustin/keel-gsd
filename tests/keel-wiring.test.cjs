/**
 * KEEL Integration Wiring — Bug Condition Exploration Test
 *
 * Property 1: Bug Condition — Missing KEEL Wiring at Workflow Boundaries
 *
 * For every (workflow, expectedCommand) pair in the reference contract mapping,
 * the workflow file MUST contain:
 *   1. The standard KEEL presence guard: command -v keel >/dev/null 2>&1 && [ -d ".keel" ]
 *   2. The expected KEEL command with fire-and-forget pattern (2>/dev/null)
 *
 * Additionally:
 *   - init.cjs must contain a keel_installed field
 *   - gsd-workflow-guard.js must reference .keel/session/alerts.yaml
 *   - execute-phase.md guard must use && [ -d ".keel" ] (consistency check)
 *
 * **Validates: Requirements 1.1, 1.2, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10, 1.11, 1.12, 1.13, 1.14, 1.15, 1.16, 1.17, 1.19**
 *
 * CRITICAL: This test MUST FAIL on unfixed code — failure confirms the bug exists.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const WORKFLOWS_DIR = path.join(__dirname, '..', 'get-shit-done', 'workflows');
const INIT_CJS = path.join(__dirname, '..', 'get-shit-done', 'bin', 'lib', 'init.cjs');
const GUARD_JS = path.join(__dirname, '..', 'hooks', 'gsd-workflow-guard.js');
const EXECUTE_PHASE = path.join(WORKFLOWS_DIR, 'execute-phase.md');

/**
 * Reference contract mapping: (workflow filename stem, expected KEEL command substring)
 * Derived from keel/guardrails.md and get-shit-done/references/keel-guardrails.md
 */
const CONTRACT_MAPPING = [
  ['discuss-phase', 'keel goal'],
  ['plan-phase', 'keel plan'],
  ['execute-plan', 'keel advance'],
  ['transition', 'keel checkpoint'],
  ['complete-milestone', 'keel checkpoint'],
  ['verify-work', 'keel done'],
  ['autonomous', 'keel companion'],
  ['new-milestone', 'keel scan'],
  ['pause-work', 'keel checkpoint'],
  ['do', 'keel companion'],
  ['quick', 'keel companion'],
  ['fast', 'keel companion'],
  ['next', 'keel companion'],
  ['progress', 'keel companion'],
];

const STANDARD_GUARD = 'command -v keel >/dev/null 2>&1 && [ -d ".keel" ]';
const FIRE_AND_FORGET = '2>/dev/null';

describe('Property 1: Bug Condition — Missing KEEL Wiring at Workflow Boundaries', () => {

  // Property-based: for ALL (workflow, expectedCommand) in the contract mapping,
  // the workflow file must contain the standard guard AND the expected command
  for (const [workflow, expectedCommand] of CONTRACT_MAPPING) {
    test(`${workflow}.md contains KEEL guard and "${expectedCommand}" command`, () => {
      const filePath = path.join(WORKFLOWS_DIR, `${workflow}.md`);
      assert.ok(fs.existsSync(filePath), `Workflow file ${workflow}.md must exist`);

      const content = fs.readFileSync(filePath, 'utf-8');

      // Assert 1: Standard KEEL presence guard
      assert.ok(
        content.includes(STANDARD_GUARD),
        `${workflow}.md must contain the standard KEEL presence guard: ${STANDARD_GUARD}`
      );

      // Assert 2: Expected KEEL command with fire-and-forget pattern
      assert.ok(
        content.includes(expectedCommand),
        `${workflow}.md must contain the expected KEEL command: ${expectedCommand}`
      );

      // Assert 3: Fire-and-forget pattern on the expected command
      // Find lines containing the expected command and verify they use 2>/dev/null
      const lines = content.split('\n');
      const commandLines = lines.filter(line => line.includes(expectedCommand));
      const hasFireAndForget = commandLines.some(line => line.includes(FIRE_AND_FORGET));
      assert.ok(
        hasFireAndForget,
        `${workflow}.md must use fire-and-forget pattern (${FIRE_AND_FORGET}) with "${expectedCommand}"`
      );
    });
  }

  // Additional assertion: init.cjs must contain keel_installed field
  test('init.cjs contains keel_installed field', () => {
    assert.ok(fs.existsSync(INIT_CJS), 'init.cjs must exist');
    const content = fs.readFileSync(INIT_CJS, 'utf-8');
    assert.ok(
      content.includes('keel_installed'),
      'init.cjs must contain keel_installed field for centralized KEEL detection'
    );
  });

  // Additional assertion: gsd-workflow-guard.js must reference .keel/session/alerts.yaml
  test('gsd-workflow-guard.js contains .keel/session/alerts.yaml reference', () => {
    assert.ok(fs.existsSync(GUARD_JS), 'gsd-workflow-guard.js must exist');
    const content = fs.readFileSync(GUARD_JS, 'utf-8');
    assert.ok(
      content.includes('.keel/session/alerts.yaml'),
      'gsd-workflow-guard.js must reference .keel/session/alerts.yaml for KEEL drift alert integration'
    );
  });

  // Additional assertion: execute-phase.md guard consistency check
  test('execute-phase.md uses consistent guard pattern with && [ -d ".keel" ]', () => {
    assert.ok(fs.existsSync(EXECUTE_PHASE), 'execute-phase.md must exist');
    const content = fs.readFileSync(EXECUTE_PHASE, 'utf-8');

    // Find all lines with "command -v keel" and verify they ALL include the directory check
    const lines = content.split('\n');
    const keelGuardLines = lines.filter(line => line.includes('command -v keel'));

    assert.ok(keelGuardLines.length > 0, 'execute-phase.md must have at least one KEEL guard');

    for (const line of keelGuardLines) {
      assert.ok(
        line.includes('[ -d ".keel" ]'),
        `execute-phase.md guard must include directory check: ${line.trim()}`
      );
    }
  });
});
