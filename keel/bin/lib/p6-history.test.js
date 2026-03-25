// p6-history.test.js — Property test for P6: Alert History Completeness
// Validates: Requirements 5.3
//
// Property P6: Every alert removed from alerts.yaml must appear in
// alert-history.yaml with a valid cleared_at ISO 8601 timestamp and
// cleared_reason ∈ { "auto", "advance", "checkpoint" }.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const fs = require('fs');
const path = require('path');
const fc = require('fast-check');
const { readAlerts, writeAlerts, appendAlertHistory, filterStaleAlerts } = require('./alerts.js');
const { parseYaml } = require('./yaml.js');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'keel-p6-'));
}

function setupKeelDirs(tmpDir) {
  fs.mkdirSync(path.join(tmpDir, '.keel', 'session'), { recursive: true });
}

function readHistory(tmpDir) {
  const filePath = path.join(tmpDir, '.keel', 'session', 'alert-history.yaml');
  try {
    const text = fs.readFileSync(filePath, 'utf8').trim();
    if (!text) return [];
    const parsed = parseYaml(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function isValidIso8601(str) {
  if (typeof str !== 'string') return false;
  const d = new Date(str);
  return !isNaN(d.getTime());
}

const VALID_CLEARED_REASONS = new Set(['auto', 'advance', 'checkpoint']);

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
    cluster_id: fc.uniqueArray(
      fc.string({ minLength: 1, maxLength: 20 }),
      { minLength: 1, maxLength: 1 }
    ).map(parts => `cluster-${parts[0]}`),
    consolidated: fc.constant(false),
  });
}

// ─── P6: Alert History Completeness — auto path ───────────────────────────────

test('P6: auto-clear path — every removed alert appears in history with cleared_reason: auto', () => {
  /**
   * **Validates: Requirements 5.3**
   *
   * For any set of alerts, when some are cleared via the auto path:
   *   - Every cleared alert appears in alert-history.yaml
   *   - cleared_at is a valid ISO 8601 timestamp
   *   - cleared_reason is "auto"
   *   - rule and cluster_id match the original alert
   */
  fc.assert(
    fc.property(
      fc.array(alertArbitrary(), { minLength: 1, maxLength: 10 }),
      fc.array(fc.boolean(), { minLength: 1, maxLength: 10 }),
      (alerts, conditionFlags) => {
        const tmpDir = makeTempDir();
        try {
          setupKeelDirs(tmpDir);

          const conditions = alerts.map((_, i) => conditionFlags[i % conditionFlags.length]);

          // Write initial alerts
          writeAlerts(tmpDir, alerts);

          // Simulate auto-clear: partition into active/cleared
          let callIdx = 0;
          const { active, cleared } = filterStaleAlerts(alerts, () => conditions[callIdx++]);

          // Write back active; append cleared to history
          writeAlerts(tmpDir, active);
          if (cleared.length > 0) {
            appendAlertHistory(tmpDir, cleared, 'auto');
          }

          const history = readHistory(tmpDir);

          // Assert: every cleared alert appears in history
          for (const clearedAlert of cleared) {
            const entry = history.find(
              h => h.cluster_id === clearedAlert.cluster_id && h.rule === clearedAlert.rule
            );
            assert.ok(entry,
              `Cleared alert (rule=${clearedAlert.rule}, cluster=${clearedAlert.cluster_id}) missing from history`);

            // cleared_at must be valid ISO 8601
            assert.ok(isValidIso8601(entry.cleared_at),
              `cleared_at "${entry.cleared_at}" is not a valid ISO 8601 timestamp`);

            // cleared_reason must be "auto"
            assert.equal(entry.cleared_reason, 'auto',
              `Expected cleared_reason "auto", got "${entry.cleared_reason}"`);

            // rule must match
            assert.equal(entry.rule, clearedAlert.rule,
              `History entry rule mismatch: expected "${clearedAlert.rule}", got "${entry.rule}"`);

            // cluster_id must match
            assert.equal(entry.cluster_id, clearedAlert.cluster_id,
              `History entry cluster_id mismatch`);
          }

          return true;
        } finally {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        }
      }
    ),
    { numRuns: 150, verbose: false }
  );
});

// ─── P6: Alert History Completeness — advance path ───────────────────────────

test('P6: advance path — every removed alert appears in history with cleared_reason: advance', () => {
  /**
   * **Validates: Requirements 5.3**
   *
   * When alerts are cleared via the advance path (keel advance):
   *   - Every cleared alert appears in alert-history.yaml
   *   - cleared_at is a valid ISO 8601 timestamp
   *   - cleared_reason is "advance"
   */
  fc.assert(
    fc.property(
      fc.array(alertArbitrary(), { minLength: 1, maxLength: 10 }),
      // How many alerts to clear (at least 1)
      fc.integer({ min: 1, max: 10 }),
      (alerts, clearCount) => {
        const tmpDir = makeTempDir();
        try {
          setupKeelDirs(tmpDir);

          const toClear = alerts.slice(0, Math.min(clearCount, alerts.length));
          const remaining = alerts.slice(toClear.length);

          // Write initial alerts
          writeAlerts(tmpDir, alerts);

          // Simulate advance: clear toClear, keep remaining
          appendAlertHistory(tmpDir, toClear, 'advance');
          writeAlerts(tmpDir, remaining);

          const history = readHistory(tmpDir);

          for (const clearedAlert of toClear) {
            const entry = history.find(
              h => h.cluster_id === clearedAlert.cluster_id && h.rule === clearedAlert.rule
            );
            assert.ok(entry,
              `Advance-cleared alert (rule=${clearedAlert.rule}, cluster=${clearedAlert.cluster_id}) missing from history`);

            assert.ok(isValidIso8601(entry.cleared_at),
              `cleared_at "${entry.cleared_at}" is not a valid ISO 8601 timestamp`);

            assert.equal(entry.cleared_reason, 'advance',
              `Expected cleared_reason "advance", got "${entry.cleared_reason}"`);

            assert.equal(entry.rule, clearedAlert.rule);
            assert.equal(entry.cluster_id, clearedAlert.cluster_id);
          }

          return true;
        } finally {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        }
      }
    ),
    { numRuns: 150, verbose: false }
  );
});

// ─── P6: Alert History Completeness — checkpoint path ────────────────────────

test('P6: checkpoint path — every removed alert appears in history with cleared_reason: checkpoint', () => {
  /**
   * **Validates: Requirements 5.3**
   *
   * When alerts are cleared via the checkpoint path (keel checkpoint):
   *   - Every cleared alert appears in alert-history.yaml
   *   - cleared_at is a valid ISO 8601 timestamp
   *   - cleared_reason is "checkpoint"
   */
  fc.assert(
    fc.property(
      fc.array(alertArbitrary(), { minLength: 1, maxLength: 10 }),
      fc.integer({ min: 1, max: 10 }),
      (alerts, clearCount) => {
        const tmpDir = makeTempDir();
        try {
          setupKeelDirs(tmpDir);

          const toClear = alerts.slice(0, Math.min(clearCount, alerts.length));
          const remaining = alerts.slice(toClear.length);

          writeAlerts(tmpDir, alerts);

          // Simulate checkpoint: clear toClear, keep remaining
          appendAlertHistory(tmpDir, toClear, 'checkpoint');
          writeAlerts(tmpDir, remaining);

          const history = readHistory(tmpDir);

          for (const clearedAlert of toClear) {
            const entry = history.find(
              h => h.cluster_id === clearedAlert.cluster_id && h.rule === clearedAlert.rule
            );
            assert.ok(entry,
              `Checkpoint-cleared alert (rule=${clearedAlert.rule}, cluster=${clearedAlert.cluster_id}) missing from history`);

            assert.ok(isValidIso8601(entry.cleared_at),
              `cleared_at "${entry.cleared_at}" is not a valid ISO 8601 timestamp`);

            assert.equal(entry.cleared_reason, 'checkpoint',
              `Expected cleared_reason "checkpoint", got "${entry.cleared_reason}"`);

            assert.equal(entry.rule, clearedAlert.rule);
            assert.equal(entry.cluster_id, clearedAlert.cluster_id);
          }

          return true;
        } finally {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        }
      }
    ),
    { numRuns: 150, verbose: false }
  );
});

// ─── P6: History is append-only — multiple clearing events accumulate ─────────

test('P6: history is append-only — multiple clearing events accumulate', () => {
  /**
   * **Validates: Requirements 5.3**
   *
   * Multiple clearing events (auto, advance, checkpoint) must all accumulate
   * in alert-history.yaml — history is never truncated.
   */
  fc.assert(
    fc.property(
      fc.array(alertArbitrary(), { minLength: 3, maxLength: 9 }),
      (alerts) => {
        const tmpDir = makeTempDir();
        try {
          setupKeelDirs(tmpDir);

          // Split into 3 batches for 3 clearing events
          const batchSize = Math.floor(alerts.length / 3) || 1;
          const batch1 = alerts.slice(0, batchSize);
          const batch2 = alerts.slice(batchSize, batchSize * 2);
          const batch3 = alerts.slice(batchSize * 2);

          // Three separate clearing events
          if (batch1.length > 0) appendAlertHistory(tmpDir, batch1, 'auto');
          if (batch2.length > 0) appendAlertHistory(tmpDir, batch2, 'advance');
          if (batch3.length > 0) appendAlertHistory(tmpDir, batch3, 'checkpoint');

          const history = readHistory(tmpDir);

          // Total history entries must equal total cleared alerts
          const totalCleared = batch1.length + batch2.length + batch3.length;
          assert.equal(history.length, totalCleared,
            `Expected ${totalCleared} history entries, got ${history.length}`);

          // Verify each batch's cleared_reason
          const autoEntries = history.filter(h => h.cleared_reason === 'auto');
          const advanceEntries = history.filter(h => h.cleared_reason === 'advance');
          const checkpointEntries = history.filter(h => h.cleared_reason === 'checkpoint');

          assert.equal(autoEntries.length, batch1.length,
            `Expected ${batch1.length} auto entries, got ${autoEntries.length}`);
          assert.equal(advanceEntries.length, batch2.length,
            `Expected ${batch2.length} advance entries, got ${advanceEntries.length}`);
          assert.equal(checkpointEntries.length, batch3.length,
            `Expected ${batch3.length} checkpoint entries, got ${checkpointEntries.length}`);

          return true;
        } finally {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        }
      }
    ),
    { numRuns: 150, verbose: false }
  );
});

// ─── P6: History entries have all required fields ─────────────────────────────

test('P6: history entries have all required fields', () => {
  /**
   * **Validates: Requirements 5.3**
   *
   * Every history entry must have: rule, message, cluster_id, cleared_at, cleared_reason.
   */
  fc.assert(
    fc.property(
      fc.array(alertArbitrary(), { minLength: 1, maxLength: 10 }),
      fc.constantFrom('auto', 'advance', 'checkpoint'),
      (alerts, reason) => {
        const tmpDir = makeTempDir();
        try {
          setupKeelDirs(tmpDir);

          appendAlertHistory(tmpDir, alerts, reason);

          const history = readHistory(tmpDir);

          assert.equal(history.length, alerts.length,
            `Expected ${alerts.length} history entries, got ${history.length}`);

          for (const entry of history) {
            // Required fields must be present
            assert.ok('rule' in entry, 'History entry missing "rule" field');
            assert.ok('message' in entry, 'History entry missing "message" field');
            assert.ok('cluster_id' in entry, 'History entry missing "cluster_id" field');
            assert.ok('cleared_at' in entry, 'History entry missing "cleared_at" field');
            assert.ok('cleared_reason' in entry, 'History entry missing "cleared_reason" field');

            // cleared_at must be valid ISO 8601
            assert.ok(isValidIso8601(entry.cleared_at),
              `cleared_at "${entry.cleared_at}" is not a valid ISO 8601 timestamp`);

            // cleared_reason must be one of the valid values
            assert.ok(VALID_CLEARED_REASONS.has(entry.cleared_reason),
              `cleared_reason "${entry.cleared_reason}" not in { "auto", "advance", "checkpoint" }`);
          }

          return true;
        } finally {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        }
      }
    ),
    { numRuns: 150, verbose: false }
  );
});

// ─── P6: cleared_reason must be one of the valid values ──────────────────────

test('P6: cleared_reason is always in { "auto", "advance", "checkpoint" }', () => {
  /**
   * **Validates: Requirements 5.3**
   *
   * For all three clearing paths, the cleared_reason in history must be
   * exactly one of the three valid values.
   */
  const reasons = ['auto', 'advance', 'checkpoint'];

  fc.assert(
    fc.property(
      fc.array(alertArbitrary(), { minLength: 1, maxLength: 10 }),
      fc.constantFrom(...reasons),
      (alerts, reason) => {
        const tmpDir = makeTempDir();
        try {
          setupKeelDirs(tmpDir);

          appendAlertHistory(tmpDir, alerts, reason);

          const history = readHistory(tmpDir);

          for (const entry of history) {
            assert.ok(VALID_CLEARED_REASONS.has(entry.cleared_reason),
              `cleared_reason "${entry.cleared_reason}" is not valid`);
            assert.equal(entry.cleared_reason, reason,
              `Expected cleared_reason "${reason}", got "${entry.cleared_reason}"`);
          }

          return true;
        } finally {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        }
      }
    ),
    { numRuns: 150, verbose: false }
  );
});
