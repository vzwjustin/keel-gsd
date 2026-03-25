// p1-consolidation.test.js — Property test for P1: Alert Consolidation Invariant
// Validates: Requirements 4.1, 4.2, 4.6
//
// Property P1: For any N alerts sharing a cluster_id within a 10s window,
// consolidateAlerts returns exactly 1 entry with consolidated: true and child_count == N
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fc = require('fast-check');
const { consolidateAlerts } = require('./alerts.js');

// ─── Alert Arbitrary ─────────────────────────────────────────────────────────

/**
 * Generate a valid alert object with all required fields.
 * cluster_id will be overridden in the property test.
 */
function alertArbitrary() {
  const rules = ['SCOPE-001', 'GOAL-001', 'VAL-004', 'STEP-001'];
  const severities = ['high', 'medium', 'low'];

  return fc.record({
    rule: fc.constantFrom(...rules),
    message: fc.string({ minLength: 1, maxLength: 100 }),
    severity: fc.constantFrom(...severities),
    deterministic: fc.boolean(),
    // created_at: ISO 8601 timestamp within the last 10 seconds
    created_at: fc.integer({ min: 0, max: 9000 }).map(offsetMs => {
      return new Date(Date.now() - offsetMs).toISOString();
    }),
    source_file: fc.oneof(
      fc.constant(null),
      fc.string({ minLength: 1, maxLength: 50 }).map(s => `src/${s}.js`)
    ),
    cluster_id: fc.string({ minLength: 1, maxLength: 30 }),
    consolidated: fc.constant(false),
  });
}

// ─── P1: Alert Consolidation Invariant ───────────────────────────────────────

test('P1: consolidateAlerts — N alerts same cluster_id within 10s window → 1 consolidated entry', () => {
  /**
   * **Validates: Requirements 4.1, 4.2, 4.6**
   *
   * For any N (2–10) alerts sharing a cluster_id within a 10s window,
   * consolidateAlerts must return exactly 1 entry with:
   *   - consolidated: true
   *   - child_count == N
   */
  fc.assert(
    fc.property(
      fc.array(alertArbitrary(), { minLength: 2, maxLength: 10 }),
      (alerts) => {
        // Override all alerts to share the same cluster_id
        const clusterId = 'test-cluster-pivot';
        const sameCluster = alerts.map(a => ({ ...a, cluster_id: clusterId }));

        const result = consolidateAlerts(sameCluster, 10_000);

        // Must return exactly 1 entry
        assert.equal(result.length, 1, `Expected 1 consolidated alert, got ${result.length}`);

        const parent = result[0];

        // Must be marked consolidated
        assert.equal(parent.consolidated, true, 'Parent alert must have consolidated: true');

        // child_count must equal N
        assert.equal(
          parent.child_count,
          sameCluster.length,
          `child_count ${parent.child_count} must equal N=${sameCluster.length}`
        );

        // cluster_id must be preserved
        assert.equal(parent.cluster_id, clusterId, 'cluster_id must be preserved on parent');

        return true;
      }
    ),
    { numRuns: 200, verbose: false }
  );
});

// ─── Edge case: single alert is never consolidated ────────────────────────────

test('P1 edge: single alert is never consolidated', () => {
  fc.assert(
    fc.property(
      alertArbitrary(),
      (alert) => {
        const result = consolidateAlerts([alert], 10_000);
        assert.equal(result.length, 1);
        assert.equal(result[0].consolidated, false, 'Single alert must not be consolidated');
        return true;
      }
    ),
    { numRuns: 100 }
  );
});

// ─── Edge case: alerts with different cluster_ids are not merged ──────────────

test('P1 edge: alerts with distinct cluster_ids are kept separate', () => {
  fc.assert(
    fc.property(
      fc.array(alertArbitrary(), { minLength: 2, maxLength: 5 }),
      (alerts) => {
        // Give each alert a unique cluster_id
        const distinct = alerts.map((a, i) => ({ ...a, cluster_id: `cluster-${i}` }));
        const result = consolidateAlerts(distinct, 10_000);

        // Each cluster has only 1 alert → no consolidation
        assert.equal(result.length, distinct.length, 'Each distinct cluster should remain separate');
        for (const r of result) {
          assert.equal(r.consolidated, false, 'No alert should be consolidated when clusters are distinct');
        }
        return true;
      }
    ),
    { numRuns: 100 }
  );
});
