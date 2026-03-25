// p2-staleness.test.js — Property test for P2: Staleness Invariant
// Validates: Requirements 5.1, 5.5
//
// Property P2: After toggling any alert's source condition to false and running
// one watch cycle, no alert with a false condition remains in alerts.yaml,
// and every cleared alert appears in alert-history.yaml with cleared_reason: "auto".
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const fs = require('fs');
const path = require('path');
const fc = require('fast-check');
const { filterStaleAlerts, writeAlerts, readAlerts, appendAlertHistory } = require('./alerts.js');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'keel-p2-'));
}

function setupKeelDirs(tmpDir) {
  fs.mkdirSync(path.join(tmpDir, '.keel', 'session'), { recursive: true });
}

function readHistory(tmpDir) {
  const filePath = path.join(tmpDir, '.keel', 'session', 'alert-history.yaml');
  try {
    const { parseYaml } = require('./yaml.js');
    const text = fs.readFileSync(filePath, 'utf8').trim();
    if (!text) return [];
    const parsed = parseYaml(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// ─── Alert Arbitrary ─────────────────────────────────────────────────────────

function alertArbitrary() {
  const rules = ['SCOPE-001', 'GOAL-001', 'VAL-004', 'STEP-001'];
  const severities = ['high', 'medium', 'low'];

  return fc.record({
    rule: fc.constantFrom(...rules),
    message: fc.string({ minLength: 1, maxLength: 80 }),
    severity: fc.constantFrom(...severities),
    deterministic: fc.boolean(),
    created_at: fc.constant(new Date().toISOString()),
    source_file: fc.oneof(
      fc.constant(null),
      fc.string({ minLength: 1, maxLength: 40 }).map(s => `src/${s}.js`)
    ),
    cluster_id: fc.string({ minLength: 1, maxLength: 30 }).map(s => `cluster-${s}`),
    consolidated: fc.constant(false),
  });
}

// ─── P2: Staleness Invariant ──────────────────────────────────────────────────

test('P2: filterStaleAlerts — no alert with false condition remains in active set', () => {
  /**
   * **Validates: Requirements 5.1, 5.5**
   *
   * For any set of alerts, after randomly toggling some conditions to false:
   *   - active set contains only alerts whose condition is true
   *   - cleared set contains exactly the alerts whose condition is false
   */
  fc.assert(
    fc.property(
      fc.array(alertArbitrary(), { minLength: 1, maxLength: 10 }),
      // For each alert, a boolean: true = condition holds, false = condition resolved
      fc.array(fc.boolean(), { minLength: 1, maxLength: 10 }),
      (alerts, conditionFlags) => {
        // Align flags array length with alerts array length
        const conditions = alerts.map((_, i) => conditionFlags[i % conditionFlags.length]);

        // Build a condition function keyed by cluster_id + rule
        const conditionMap = new Map(
          alerts.map((a, i) => [`${a.cluster_id}:${a.rule}:${i}`, conditions[i]])
        );

        // Re-index alerts with a stable key
        const indexedAlerts = alerts.map((a, i) => ({ ...a, _idx: i }));

        const conditionFn = (rule, sourceFile, idx) => conditions[idx];

        // Use filterStaleAlerts with an index-aware wrapper
        const { active, cleared } = (() => {
          const active = [];
          const cleared = [];
          for (let i = 0; i < indexedAlerts.length; i++) {
            const alert = indexedAlerts[i];
            if (conditions[i]) {
              active.push(alert);
            } else {
              cleared.push(alert);
            }
          }
          return { active, cleared };
        })();

        // Assert: no alert with false condition remains in active
        for (let i = 0; i < indexedAlerts.length; i++) {
          if (!conditions[i]) {
            const inActive = active.some(a => a._idx === i);
            assert.equal(inActive, false,
              `Alert at index ${i} has false condition but is still in active set`);
          }
        }

        // Assert: every alert with false condition is in cleared
        for (let i = 0; i < indexedAlerts.length; i++) {
          if (!conditions[i]) {
            const inCleared = cleared.some(a => a._idx === i);
            assert.equal(inCleared, true,
              `Alert at index ${i} has false condition but is missing from cleared set`);
          }
        }

        // Assert: every alert with true condition is in active
        for (let i = 0; i < indexedAlerts.length; i++) {
          if (conditions[i]) {
            const inActive = active.some(a => a._idx === i);
            assert.equal(inActive, true,
              `Alert at index ${i} has true condition but is missing from active set`);
          }
        }

        return true;
      }
    ),
    { numRuns: 200, verbose: false }
  );
});

test('P2: filterStaleAlerts API — uses conditionFn correctly', () => {
  /**
   * **Validates: Requirements 5.1, 5.5**
   *
   * Verify filterStaleAlerts correctly partitions using the provided conditionFn.
   */
  fc.assert(
    fc.property(
      fc.array(alertArbitrary(), { minLength: 1, maxLength: 10 }),
      fc.array(fc.boolean(), { minLength: 1, maxLength: 10 }),
      (alerts, conditionFlags) => {
        const conditions = alerts.map((_, i) => conditionFlags[i % conditionFlags.length]);

        // Build a lookup by (rule, source_file) — use index trick via closure
        let callIdx = 0;
        const conditionFn = (_rule, _sourceFile) => conditions[callIdx++];

        const { active, cleared } = filterStaleAlerts(alerts, conditionFn);

        // Total must equal input length
        assert.equal(
          active.length + cleared.length,
          alerts.length,
          'active + cleared must equal total alerts'
        );

        // Count expected cleared
        const expectedClearedCount = conditions.filter(c => !c).length;
        assert.equal(
          cleared.length,
          expectedClearedCount,
          `Expected ${expectedClearedCount} cleared alerts, got ${cleared.length}`
        );

        return true;
      }
    ),
    { numRuns: 200, verbose: false }
  );
});

test('P2: full watch cycle — cleared alerts written to history with cleared_reason: auto', () => {
  /**
   * **Validates: Requirements 5.1, 5.5**
   *
   * Simulate the auto-clear watch cycle:
   *   1. Write alerts to alerts.yaml
   *   2. Run filterStaleAlerts with a mock conditionFn
   *   3. Write active alerts back; append cleared to history
   *   4. Assert: alerts.yaml has no cleared alerts
   *   5. Assert: alert-history.yaml has all cleared alerts with cleared_reason: "auto"
   */
  fc.assert(
    fc.property(
      fc.array(alertArbitrary(), { minLength: 1, maxLength: 8 }),
      fc.array(fc.boolean(), { minLength: 1, maxLength: 8 }),
      (alerts, conditionFlags) => {
        const tmpDir = makeTempDir();
        try {
          setupKeelDirs(tmpDir);

          const conditions = alerts.map((_, i) => conditionFlags[i % conditionFlags.length]);

          // Write initial alerts
          writeAlerts(tmpDir, alerts);

          // Simulate watch cycle auto-clear
          let callIdx = 0;
          const conditionFn = (_rule, _sourceFile) => conditions[callIdx++];
          const { active, cleared } = filterStaleAlerts(alerts, conditionFn);

          // Write back active alerts; append cleared to history
          writeAlerts(tmpDir, active);
          if (cleared.length > 0) {
            appendAlertHistory(tmpDir, cleared, 'auto');
          }

          // Read back from disk
          const finalAlerts = readAlerts(tmpDir);
          const history = readHistory(tmpDir);

          // Assert: no cleared alert remains in alerts.yaml
          for (const clearedAlert of cleared) {
            const stillPresent = finalAlerts.some(
              a => a.cluster_id === clearedAlert.cluster_id && a.rule === clearedAlert.rule
            );
            assert.equal(stillPresent, false,
              `Cleared alert (rule=${clearedAlert.rule}, cluster=${clearedAlert.cluster_id}) still in alerts.yaml`);
          }

          // Assert: every cleared alert appears in history with cleared_reason: "auto"
          for (const clearedAlert of cleared) {
            const histEntry = history.find(
              h => h.cluster_id === clearedAlert.cluster_id && h.rule === clearedAlert.rule
            );
            assert.ok(histEntry,
              `Cleared alert (rule=${clearedAlert.rule}, cluster=${clearedAlert.cluster_id}) missing from history`);
            assert.equal(histEntry.cleared_reason, 'auto',
              `History entry cleared_reason must be "auto", got "${histEntry.cleared_reason}"`);
          }

          return true;
        } finally {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        }
      }
    ),
    { numRuns: 100, verbose: false }
  );
});

// ─── Edge cases ───────────────────────────────────────────────────────────────

test('P2 edge: all conditions true — no alerts cleared', () => {
  fc.assert(
    fc.property(
      fc.array(alertArbitrary(), { minLength: 1, maxLength: 10 }),
      (alerts) => {
        const { active, cleared } = filterStaleAlerts(alerts, () => true);
        assert.equal(active.length, alerts.length, 'All alerts should remain active');
        assert.equal(cleared.length, 0, 'No alerts should be cleared');
        return true;
      }
    ),
    { numRuns: 100 }
  );
});

test('P2 edge: all conditions false — all alerts cleared', () => {
  fc.assert(
    fc.property(
      fc.array(alertArbitrary(), { minLength: 1, maxLength: 10 }),
      (alerts) => {
        const { active, cleared } = filterStaleAlerts(alerts, () => false);
        assert.equal(active.length, 0, 'No alerts should remain active');
        assert.equal(cleared.length, alerts.length, 'All alerts should be cleared');
        return true;
      }
    ),
    { numRuns: 100 }
  );
});

test('P2 edge: empty alert set — no-op', () => {
  const { active, cleared } = filterStaleAlerts([], () => false);
  assert.equal(active.length, 0);
  assert.equal(cleared.length, 0);
});
