// p5-done-gate.test.js — Property test for P5: Done-Gate Soundness
// Validates: Requirements 7.1, 7.2, 7.3
//
// Property P5: doneGate().passed == true if and only if all 4 checks pass simultaneously
//   passed == (heartbeatFresh && noHighAlerts && goalNotDrifted && allStepsComplete)
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { doneGate } = require('./done.js');
const { writeAlerts } = require('./alerts.js');
const { writeCheckpoint } = require('./checkpoint.js');
const { stringifyYaml } = require('./yaml.js');
const { writeAtomic } = require('./atomic.js');

// ─── Filesystem setup helpers ─────────────────────────────────────────────────

function makeTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'keel-p5-'));
  fs.mkdirSync(path.join(dir, '.keel', 'session'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.keel', 'checkpoints'), { recursive: true });
  return dir;
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

/**
 * Set up heartbeat state.
 * heartbeatFresh=true  → running:true, last_beat_at within 30s
 * heartbeatFresh=false → running:false (companion stopped)
 */
function setupHeartbeat(dir, heartbeatFresh) {
  const hbPath = path.join(dir, '.keel', 'session', 'companion-heartbeat.yaml');
  if (heartbeatFresh) {
    writeAtomic(hbPath, stringifyYaml({
      running: true,
      pid: process.pid,
      last_beat_at: new Date().toISOString(),
      started_at: new Date().toISOString(),
      version: '1.0.0',
    }));
  } else {
    writeAtomic(hbPath, stringifyYaml({
      running: false,
      pid: null,
      last_beat_at: new Date(Date.now() - 60_000).toISOString(),
      started_at: new Date(Date.now() - 120_000).toISOString(),
      version: '1.0.0',
    }));
  }
}

/**
 * Set up alerts state.
 * noHighAlerts=true  → empty alerts.yaml
 * noHighAlerts=false → one high-severity deterministic alert
 */
function setupAlerts(dir, noHighAlerts) {
  if (noHighAlerts) {
    writeAlerts(dir, []);
  } else {
    writeAlerts(dir, [{
      rule: 'SCOPE-001',
      message: 'File outside-scope.js is outside active plan scope',
      severity: 'high',
      deterministic: true,
      created_at: new Date().toISOString(),
      source_file: 'outside-scope.js',
      cluster_id: 'pivot-test-123',
      consolidated: false,
    }]);
  }
}

const CHECKPOINT_GOAL = 'Implement the keel companion binary with drift detection';

/**
 * Set up checkpoint state.
 * allStepsComplete=true  → all plan_steps have completed: true
 * allStepsComplete=false → at least one plan_step has completed: false
 */
function setupCheckpoint(dir, allStepsComplete) {
  writeCheckpoint(dir, {
    goal: CHECKPOINT_GOAL,
    phase: '1.0',
    in_scope_files: [],
    in_scope_dirs: [],
    plan_steps: allStepsComplete
      ? [{ id: '1', description: 'Step one', completed: true }]
      : [
          { id: '1', description: 'Step one', completed: true },
          { id: '2', description: 'Step two', completed: false },
        ],
  });
}

/**
 * Set up goal state.
 * goalNotDrifted=true  → goal.yaml matches checkpoint goal exactly
 * goalNotDrifted=false → goal.yaml has a completely different goal (>20% Levenshtein distance)
 */
function setupGoal(dir, goalNotDrifted) {
  const goalPath = path.join(dir, '.keel', 'goal.yaml');
  if (goalNotDrifted) {
    writeAtomic(goalPath, stringifyYaml({
      goal: CHECKPOINT_GOAL,
      source: 'ROADMAP.md',
      phase: '1.0',
      captured_at: new Date().toISOString(),
    }));
  } else {
    // Completely different goal — well over 20% Levenshtein distance
    writeAtomic(goalPath, stringifyYaml({
      goal: 'Refactor the entire database schema and migrate all legacy tables to new format',
      source: 'ROADMAP.md',
      phase: '1.0',
      captured_at: new Date().toISOString(),
    }));
  }
}

/**
 * Set up all 4 check states in the temp directory.
 */
function setupState(dir, { heartbeatFresh, noHighAlerts, goalNotDrifted, allStepsComplete }) {
  setupHeartbeat(dir, heartbeatFresh);
  setupAlerts(dir, noHighAlerts);
  setupCheckpoint(dir, allStepsComplete);
  setupGoal(dir, goalNotDrifted);
}

// ─── P5: Done-Gate Soundness ──────────────────────────────────────────────────

test('P5: doneGate — passed iff all 4 checks pass (all 16 combinations)', () => {
  /**
   * **Validates: Requirements 7.1, 7.2, 7.3**
   *
   * Property P5: doneGate().passed == true if and only if all 4 checks pass simultaneously.
   *   passed == (heartbeatFresh && noHighAlerts && goalNotDrifted && allStepsComplete)
   *
   * We enumerate all 16 combinations of the 4 boolean check states exhaustively.
   */
  fc.assert(
    fc.property(
      fc.boolean(), // heartbeatFresh
      fc.boolean(), // noHighAlerts
      fc.boolean(), // goalNotDrifted
      fc.boolean(), // allStepsComplete
      (heartbeatFresh, noHighAlerts, goalNotDrifted, allStepsComplete) => {
        const dir = makeTempDir();
        try {
          setupState(dir, { heartbeatFresh, noHighAlerts, goalNotDrifted, allStepsComplete });

          const result = doneGate(dir);

          const expectedPassed = heartbeatFresh && noHighAlerts && goalNotDrifted && allStepsComplete;

          // Core property: passed == conjunction of all 4 conditions
          assert.equal(
            result.passed,
            expectedPassed,
            `passed=${result.passed} but expected ${expectedPassed} for ` +
            `{heartbeatFresh=${heartbeatFresh}, noHighAlerts=${noHighAlerts}, ` +
            `goalNotDrifted=${goalNotDrifted}, allStepsComplete=${allStepsComplete}}`
          );

          // If passed == false, blockers must be non-empty
          if (!result.passed) {
            assert.ok(
              result.blockers.length > 0,
              `passed=false but blockers is empty for ` +
              `{heartbeatFresh=${heartbeatFresh}, noHighAlerts=${noHighAlerts}, ` +
              `goalNotDrifted=${goalNotDrifted}, allStepsComplete=${allStepsComplete}}`
            );
          }

          // If passed == true, blockers must be empty
          if (result.passed) {
            assert.equal(
              result.blockers.length,
              0,
              `passed=true but blockers is non-empty: ${JSON.stringify(result.blockers)}`
            );
          }

          return true;
        } finally {
          cleanup(dir);
        }
      }
    ),
    {
      // 16 combinations exhaustively covered with 4 booleans
      // fast-check will enumerate all 16 combinations within numRuns
      numRuns: 100,
      verbose: false,
    }
  );
});

// ─── Explicit exhaustive enumeration of all 16 combinations ──────────────────

test('P5: exhaustive — all 16 combinations of check states', () => {
  /**
   * **Validates: Requirements 7.1, 7.2, 7.3**
   *
   * Explicitly test all 16 combinations to guarantee full coverage.
   */
  const bools = [true, false];
  for (const heartbeatFresh of bools) {
    for (const noHighAlerts of bools) {
      for (const goalNotDrifted of bools) {
        for (const allStepsComplete of bools) {
          const dir = makeTempDir();
          try {
            setupState(dir, { heartbeatFresh, noHighAlerts, goalNotDrifted, allStepsComplete });

            const result = doneGate(dir);
            const expectedPassed = heartbeatFresh && noHighAlerts && goalNotDrifted && allStepsComplete;

            assert.equal(
              result.passed,
              expectedPassed,
              `Combination {heartbeatFresh=${heartbeatFresh}, noHighAlerts=${noHighAlerts}, ` +
              `goalNotDrifted=${goalNotDrifted}, allStepsComplete=${allStepsComplete}}: ` +
              `expected passed=${expectedPassed}, got ${result.passed}`
            );

            if (!result.passed) {
              assert.ok(result.blockers.length > 0,
                `passed=false must have non-empty blockers`);
            } else {
              assert.equal(result.blockers.length, 0,
                `passed=true must have empty blockers`);
            }
          } finally {
            cleanup(dir);
          }
        }
      }
    }
  }
});
