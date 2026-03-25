// done.test.js — Unit tests for doneGate()
// Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Create a temp directory with a minimal .keel/ structure.
 * Returns the cwd path.
 */
function makeTempKeelDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'keel-done-test-'));
  fs.mkdirSync(path.join(dir, '.keel', 'session'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.keel', 'checkpoints'), { recursive: true });
  return dir;
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

/** Write a fresh (non-stale) heartbeat with running: true */
function writeFreshHeartbeat(dir) {
  const hb = {
    running: true,
    pid: process.pid,
    last_beat_at: new Date().toISOString(),
    started_at: new Date().toISOString(),
    version: '1.0.0',
  };
  const { stringifyYaml } = require('./yaml.js');
  const { writeAtomic } = require('./atomic.js');
  writeAtomic(path.join(dir, '.keel', 'session', 'companion-heartbeat.yaml'), stringifyYaml(hb));
}

/** Write a stale heartbeat (last_beat_at 60s ago) */
function writeStaleHeartbeat(dir) {
  const staleTime = new Date(Date.now() - 60_000).toISOString();
  const hb = {
    running: true,
    pid: process.pid,
    last_beat_at: staleTime,
    started_at: staleTime,
    version: '1.0.0',
  };
  const { stringifyYaml } = require('./yaml.js');
  const { writeAtomic } = require('./atomic.js');
  writeAtomic(path.join(dir, '.keel', 'session', 'companion-heartbeat.yaml'), stringifyYaml(hb));
}

/** Write a heartbeat with running: false */
function writeStoppedHeartbeat(dir) {
  const hb = {
    running: false,
    pid: null,
    last_beat_at: new Date().toISOString(),
    started_at: new Date().toISOString(),
    version: '1.0.0',
  };
  const { stringifyYaml } = require('./yaml.js');
  const { writeAtomic } = require('./atomic.js');
  writeAtomic(path.join(dir, '.keel', 'session', 'companion-heartbeat.yaml'), stringifyYaml(hb));
}

/** Write alerts.yaml with a high-severity deterministic alert */
function writeHighAlert(dir) {
  const { writeAlerts } = require('./alerts.js');
  writeAlerts(dir, [{
    rule: 'SCOPE-001',
    message: 'File foo.js is outside active plan scope',
    severity: 'high',
    deterministic: true,
    created_at: new Date().toISOString(),
    source_file: 'foo.js',
    cluster_id: 'pivot-123',
    consolidated: false,
  }]);
}

/** Write empty alerts.yaml */
function writeNoAlerts(dir) {
  const { writeAlerts } = require('./alerts.js');
  writeAlerts(dir, []);
}

/** Write a checkpoint with matching goal and all steps complete */
function writeCleanCheckpoint(dir, goal = 'Implement feature X') {
  const { writeCheckpoint } = require('./checkpoint.js');
  writeCheckpoint(dir, {
    goal,
    phase: '1.0',
    in_scope_files: [],
    in_scope_dirs: [],
    plan_steps: [{ id: '1', description: 'Step one', completed: true }],
  });
}

/** Write goal.yaml matching the checkpoint goal */
function writeMatchingGoal(dir, goal = 'Implement feature X') {
  const { stringifyYaml } = require('./yaml.js');
  const { writeAtomic } = require('./atomic.js');
  writeAtomic(path.join(dir, '.keel', 'goal.yaml'), stringifyYaml({
    goal,
    source: 'ROADMAP.md',
    phase: '1.0',
    captured_at: new Date().toISOString(),
  }));
}

/** Write goal.yaml with a very different goal (>20% drift) */
function writeDriftedGoal(dir) {
  const { stringifyYaml } = require('./yaml.js');
  const { writeAtomic } = require('./atomic.js');
  writeAtomic(path.join(dir, '.keel', 'goal.yaml'), stringifyYaml({
    goal: 'Completely different unrelated goal that has nothing to do with the original',
    source: 'ROADMAP.md',
    phase: '1.0',
    captured_at: new Date().toISOString(),
  }));
}

/** Write a checkpoint with incomplete plan steps */
function writeIncompleteCheckpoint(dir, goal = 'Implement feature X') {
  const { writeCheckpoint } = require('./checkpoint.js');
  writeCheckpoint(dir, {
    goal,
    phase: '1.0',
    in_scope_files: [],
    in_scope_dirs: [],
    plan_steps: [
      { id: '1', description: 'Step one', completed: true },
      { id: '2', description: 'Step two', completed: false },
    ],
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

const { doneGate } = require('./done.js');

test('all 4 checks passing returns { passed: true }', () => {
  const dir = makeTempKeelDir();
  try {
    writeFreshHeartbeat(dir);
    writeNoAlerts(dir);
    writeCleanCheckpoint(dir);
    writeMatchingGoal(dir);

    const result = doneGate(dir);
    assert.equal(result.passed, true);
    assert.equal(result.reason, '✓ done-gate passed');
    assert.deepEqual(result.blockers, []);
  } finally {
    cleanup(dir);
  }
});

test('check 1 fails: companion not running produces heartbeat blocker', () => {
  const dir = makeTempKeelDir();
  try {
    writeStoppedHeartbeat(dir);
    writeNoAlerts(dir);
    writeCleanCheckpoint(dir);
    writeMatchingGoal(dir);

    const result = doneGate(dir);
    assert.equal(result.passed, false);
    const hbBlocker = result.blockers.find(b => b.check === 'heartbeat');
    assert.ok(hbBlocker, 'should have a heartbeat blocker');
    assert.match(hbBlocker.message, /not running/);
    assert.equal(result.reason, hbBlocker.message);
  } finally {
    cleanup(dir);
  }
});

test('check 1 fails: stale heartbeat produces heartbeat blocker', () => {
  const dir = makeTempKeelDir();
  try {
    writeStaleHeartbeat(dir);
    writeNoAlerts(dir);
    writeCleanCheckpoint(dir);
    writeMatchingGoal(dir);

    const result = doneGate(dir);
    assert.equal(result.passed, false);
    const hbBlocker = result.blockers.find(b => b.check === 'heartbeat');
    assert.ok(hbBlocker, 'should have a heartbeat blocker');
    assert.match(hbBlocker.message, /stale/);
  } finally {
    cleanup(dir);
  }
});

test('check 1 fails: missing heartbeat file produces heartbeat blocker', () => {
  const dir = makeTempKeelDir();
  try {
    // No heartbeat written — file absent
    writeNoAlerts(dir);
    writeCleanCheckpoint(dir);
    writeMatchingGoal(dir);

    const result = doneGate(dir);
    assert.equal(result.passed, false);
    const hbBlocker = result.blockers.find(b => b.check === 'heartbeat');
    assert.ok(hbBlocker, 'should have a heartbeat blocker');
    assert.match(hbBlocker.message, /not running/);
  } finally {
    cleanup(dir);
  }
});

test('check 2 fails: high-severity deterministic alert produces alerts blocker', () => {
  const dir = makeTempKeelDir();
  try {
    writeFreshHeartbeat(dir);
    writeHighAlert(dir);
    writeCleanCheckpoint(dir);
    writeMatchingGoal(dir);

    const result = doneGate(dir);
    assert.equal(result.passed, false);
    const alertBlocker = result.blockers.find(b => b.check === 'alerts');
    assert.ok(alertBlocker, 'should have an alerts blocker');
    assert.match(alertBlocker.message, /outside active plan scope/);
    assert.equal(alertBlocker.rule, 'SCOPE-001');
  } finally {
    cleanup(dir);
  }
});

test('check 2 passes: low-severity alert does not block', () => {
  const dir = makeTempKeelDir();
  try {
    writeFreshHeartbeat(dir);
    // Write a low-severity non-deterministic alert
    const { writeAlerts } = require('./alerts.js');
    writeAlerts(dir, [{
      rule: 'STEP-001',
      message: 'Step not verified',
      severity: 'medium',
      deterministic: false,
      created_at: new Date().toISOString(),
      source_file: null,
      cluster_id: 'step-123',
      consolidated: false,
    }]);
    writeCleanCheckpoint(dir);
    writeMatchingGoal(dir);

    const result = doneGate(dir);
    // Only check 2 should not block; other checks pass
    const alertBlocker = result.blockers.find(b => b.check === 'alerts');
    assert.equal(alertBlocker, undefined, 'low-severity alert should not block');
  } finally {
    cleanup(dir);
  }
});

test('check 3 fails: drifted goal produces goal blocker', () => {
  const dir = makeTempKeelDir();
  try {
    writeFreshHeartbeat(dir);
    writeNoAlerts(dir);
    writeCleanCheckpoint(dir, 'Implement feature X');
    writeDriftedGoal(dir);

    const result = doneGate(dir);
    assert.equal(result.passed, false);
    const goalBlocker = result.blockers.find(b => b.check === 'goal');
    assert.ok(goalBlocker, 'should have a goal blocker');
    assert.match(goalBlocker.message, /drifted/);
  } finally {
    cleanup(dir);
  }
});

test('check 4 fails: incomplete plan steps produces steps blocker', () => {
  const dir = makeTempKeelDir();
  try {
    writeFreshHeartbeat(dir);
    writeNoAlerts(dir);
    writeIncompleteCheckpoint(dir);
    writeMatchingGoal(dir);

    const result = doneGate(dir);
    assert.equal(result.passed, false);
    const stepsBlocker = result.blockers.find(b => b.check === 'steps');
    assert.ok(stepsBlocker, 'should have a steps blocker');
    assert.match(stepsBlocker.message, /incomplete/);
    assert.match(stepsBlocker.message, /keel advance/);
  } finally {
    cleanup(dir);
  }
});

test('check 4 passes: step with delta field is not considered incomplete', () => {
  const dir = makeTempKeelDir();
  try {
    writeFreshHeartbeat(dir);
    writeNoAlerts(dir);
    // Write checkpoint with a step that has delta (not completed but has delta)
    const { writeCheckpoint } = require('./checkpoint.js');
    writeCheckpoint(dir, {
      goal: 'Implement feature X',
      phase: '1.0',
      in_scope_files: [],
      in_scope_dirs: [],
      plan_steps: [
        { id: '1', description: 'Step one', completed: false, delta: 'some recorded delta' },
      ],
    });
    writeMatchingGoal(dir);

    const result = doneGate(dir);
    const stepsBlocker = result.blockers.find(b => b.check === 'steps');
    assert.equal(stepsBlocker, undefined, 'step with delta should not block');
  } finally {
    cleanup(dir);
  }
});

test('result schema matches { passed, reason, blockers }', () => {
  const dir = makeTempKeelDir();
  try {
    writeFreshHeartbeat(dir);
    writeNoAlerts(dir);
    writeCleanCheckpoint(dir);
    writeMatchingGoal(dir);

    const result = doneGate(dir);
    assert.ok('passed' in result, 'result must have passed field');
    assert.ok('reason' in result, 'result must have reason field');
    assert.ok('blockers' in result, 'result must have blockers field');
    assert.equal(typeof result.passed, 'boolean');
    assert.equal(typeof result.reason, 'string');
    assert.ok(Array.isArray(result.blockers));
  } finally {
    cleanup(dir);
  }
});

test('failed result schema: blockers contain check and message fields', () => {
  const dir = makeTempKeelDir();
  try {
    writeStoppedHeartbeat(dir);
    writeHighAlert(dir);
    writeIncompleteCheckpoint(dir);
    writeDriftedGoal(dir);

    const result = doneGate(dir);
    assert.equal(result.passed, false);
    assert.ok(result.blockers.length > 0);
    for (const b of result.blockers) {
      assert.ok('check' in b, 'blocker must have check field');
      assert.ok('message' in b, 'blocker must have message field');
      assert.equal(typeof b.check, 'string');
      assert.equal(typeof b.message, 'string');
    }
    // reason should equal first blocker's message
    assert.equal(result.reason, result.blockers[0].message);
  } finally {
    cleanup(dir);
  }
});

test('no checkpoint: checks 3 and 4 are skipped (no false blockers)', () => {
  const dir = makeTempKeelDir();
  try {
    writeFreshHeartbeat(dir);
    writeNoAlerts(dir);
    // No checkpoint written, no goal.yaml

    const result = doneGate(dir);
    const goalBlocker = result.blockers.find(b => b.check === 'goal');
    const stepsBlocker = result.blockers.find(b => b.check === 'steps');
    assert.equal(goalBlocker, undefined, 'no checkpoint means no goal blocker');
    assert.equal(stepsBlocker, undefined, 'no checkpoint means no steps blocker');
    assert.equal(result.passed, true);
  } finally {
    cleanup(dir);
  }
});
