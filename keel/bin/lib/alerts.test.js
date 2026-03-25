// alerts.test.js — Unit tests for alerts.js
// Requirements: 4.1, 4.2, 5.1, 5.2
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { consolidateAlerts, ruleConditionHolds } = require('./alerts.js');
const { stringifyYaml } = require('./yaml.js');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'keel-alerts-test-'));
}

function cleanup(cwd) {
  fs.rmSync(cwd, { recursive: true, force: true });
}

function setupKeelDirs(cwd) {
  fs.mkdirSync(path.join(cwd, '.keel', 'checkpoints'), { recursive: true });
  fs.mkdirSync(path.join(cwd, '.keel', 'session'), { recursive: true });
}

/**
 * Write a checkpoint file to .keel/checkpoints/ and return the cwd.
 */
function writeCheckpointFile(cwd, data) {
  const ts = '2025-01-15T10-00-00';
  const filePath = path.join(cwd, '.keel', 'checkpoints', `${ts}.yaml`);
  fs.writeFileSync(filePath, stringifyYaml({ created_at: '2025-01-15T10:00:00.000Z', ...data }));
}

/**
 * Build a minimal alert object for consolidation tests.
 */
function makeAlert(overrides = {}) {
  return {
    rule: 'SCOPE-001',
    message: 'test alert',
    severity: 'high',
    deterministic: true,
    created_at: new Date().toISOString(),
    source_file: 'src/foo.js',
    cluster_id: 'test-cluster',
    consolidated: false,
    ...overrides,
  };
}

// ─── consolidateAlerts ────────────────────────────────────────────────────────

test('consolidateAlerts: single alert is returned as-is with consolidated: false', () => {
  const alert = makeAlert();
  const result = consolidateAlerts([alert], 10_000);
  assert.equal(result.length, 1);
  assert.equal(result[0].consolidated, false);
  assert.deepEqual(result[0], alert);
});

test('consolidateAlerts: two alerts with same cluster_id within 10s window → 1 consolidated parent', () => {
  const now = Date.now();
  const a1 = makeAlert({ cluster_id: 'pivot-1', created_at: new Date(now - 1000).toISOString() });
  const a2 = makeAlert({ cluster_id: 'pivot-1', created_at: new Date(now - 2000).toISOString() });

  const result = consolidateAlerts([a1, a2], 10_000);
  assert.equal(result.length, 1);
  assert.equal(result[0].consolidated, true);
  assert.equal(result[0].child_count, 2);
  assert.equal(result[0].cluster_id, 'pivot-1');
});

test('consolidateAlerts: two alerts with different cluster_ids → both returned separately, no consolidation', () => {
  const a1 = makeAlert({ cluster_id: 'cluster-A' });
  const a2 = makeAlert({ cluster_id: 'cluster-B' });

  const result = consolidateAlerts([a1, a2], 10_000);
  assert.equal(result.length, 2);
  for (const r of result) {
    assert.equal(r.consolidated, false);
  }
});

test('consolidateAlerts: window boundary — oldest alert exactly at windowMs → consolidated', () => {
  const now = Date.now();
  // oldest is exactly at the boundary (now - windowMs), which is <= windowMs → inside window
  const windowMs = 10_000;
  const a1 = makeAlert({ cluster_id: 'pivot-2', created_at: new Date(now - windowMs).toISOString() });
  const a2 = makeAlert({ cluster_id: 'pivot-2', created_at: new Date(now - 1000).toISOString() });

  const result = consolidateAlerts([a1, a2], windowMs);
  assert.equal(result.length, 1);
  assert.equal(result[0].consolidated, true);
  assert.equal(result[0].child_count, 2);
});

test('consolidateAlerts: window boundary — oldest alert just outside windowMs → NOT consolidated', () => {
  const now = Date.now();
  const windowMs = 10_000;
  // oldest is 1ms beyond the window
  const a1 = makeAlert({ cluster_id: 'pivot-3', created_at: new Date(now - windowMs - 1).toISOString() });
  const a2 = makeAlert({ cluster_id: 'pivot-3', created_at: new Date(now - 1000).toISOString() });

  const result = consolidateAlerts([a1, a2], windowMs);
  assert.equal(result.length, 2);
  for (const r of result) {
    assert.equal(r.consolidated, false);
  }
});

// ─── ruleConditionHolds — SCOPE-001 ──────────────────────────────────────────

test('ruleConditionHolds SCOPE-001: returns true when file is outside scope', () => {
  const cwd = makeTempDir();
  setupKeelDirs(cwd);
  try {
    writeCheckpointFile(cwd, {
      in_scope_files: ['src/index.js'],
      in_scope_dirs: ['src/'],
    });
    // 'docs/readme.md' is not in scope
    const result = ruleConditionHolds('SCOPE-001', 'docs/readme.md', cwd);
    assert.equal(result, true);
  } finally {
    cleanup(cwd);
  }
});

test('ruleConditionHolds SCOPE-001: returns false when file is in in_scope_files', () => {
  const cwd = makeTempDir();
  setupKeelDirs(cwd);
  try {
    writeCheckpointFile(cwd, {
      in_scope_files: ['src/index.js'],
      in_scope_dirs: [],
    });
    const result = ruleConditionHolds('SCOPE-001', 'src/index.js', cwd);
    assert.equal(result, false);
  } finally {
    cleanup(cwd);
  }
});

test('ruleConditionHolds SCOPE-001: returns false when file is inside an in_scope_dir', () => {
  const cwd = makeTempDir();
  setupKeelDirs(cwd);
  try {
    writeCheckpointFile(cwd, {
      in_scope_files: [],
      in_scope_dirs: ['src/'],
    });
    const result = ruleConditionHolds('SCOPE-001', 'src/utils.js', cwd);
    assert.equal(result, false);
  } finally {
    cleanup(cwd);
  }
});

test('ruleConditionHolds SCOPE-001: returns false when no checkpoint exists', () => {
  const cwd = makeTempDir();
  setupKeelDirs(cwd);
  try {
    // No checkpoint written
    const result = ruleConditionHolds('SCOPE-001', 'docs/readme.md', cwd);
    assert.equal(result, false);
  } finally {
    cleanup(cwd);
  }
});

// ─── ruleConditionHolds — GOAL-001 ───────────────────────────────────────────

test('ruleConditionHolds GOAL-001: returns true when goal has drifted >20% from checkpoint', () => {
  const cwd = makeTempDir();
  setupKeelDirs(cwd);
  try {
    writeCheckpointFile(cwd, {
      goal: 'Original goal text',
    });
    // Write a very different goal
    fs.mkdirSync(path.join(cwd, '.keel'), { recursive: true });
    fs.writeFileSync(
      path.join(cwd, '.keel', 'goal.yaml'),
      stringifyYaml({ goal: 'Completely different goal that has changed significantly from original' })
    );
    const result = ruleConditionHolds('GOAL-001', null, cwd);
    assert.equal(result, true);
  } finally {
    cleanup(cwd);
  }
});

test('ruleConditionHolds GOAL-001: returns false when goal is within 20% of checkpoint', () => {
  const cwd = makeTempDir();
  setupKeelDirs(cwd);
  try {
    const goal = 'Implement keel companion binary';
    writeCheckpointFile(cwd, { goal });
    fs.mkdirSync(path.join(cwd, '.keel'), { recursive: true });
    fs.writeFileSync(
      path.join(cwd, '.keel', 'goal.yaml'),
      stringifyYaml({ goal })
    );
    const result = ruleConditionHolds('GOAL-001', null, cwd);
    assert.equal(result, false);
  } finally {
    cleanup(cwd);
  }
});

test('ruleConditionHolds GOAL-001: returns false when no checkpoint exists', () => {
  const cwd = makeTempDir();
  setupKeelDirs(cwd);
  try {
    fs.mkdirSync(path.join(cwd, '.keel'), { recursive: true });
    fs.writeFileSync(
      path.join(cwd, '.keel', 'goal.yaml'),
      stringifyYaml({ goal: 'Some goal' })
    );
    const result = ruleConditionHolds('GOAL-001', null, cwd);
    assert.equal(result, false);
  } finally {
    cleanup(cwd);
  }
});

test('ruleConditionHolds GOAL-001: returns false when no goal.yaml exists', () => {
  const cwd = makeTempDir();
  setupKeelDirs(cwd);
  try {
    writeCheckpointFile(cwd, { goal: 'Original goal' });
    // No goal.yaml written
    const result = ruleConditionHolds('GOAL-001', null, cwd);
    assert.equal(result, false);
  } finally {
    cleanup(cwd);
  }
});

// ─── ruleConditionHolds — VAL-004 ────────────────────────────────────────────

test('ruleConditionHolds VAL-004: returns true when unresolved-questions.yaml exists and is non-empty', () => {
  const cwd = makeTempDir();
  try {
    fs.writeFileSync(
      path.join(cwd, 'unresolved-questions.yaml'),
      stringifyYaml([{ question: 'What is the scope?' }])
    );
    const result = ruleConditionHolds('VAL-004', 'unresolved-questions.yaml', cwd);
    assert.equal(result, true);
  } finally {
    cleanup(cwd);
  }
});

test('ruleConditionHolds VAL-004: returns false when unresolved-questions.yaml is absent', () => {
  const cwd = makeTempDir();
  try {
    const result = ruleConditionHolds('VAL-004', 'unresolved-questions.yaml', cwd);
    assert.equal(result, false);
  } finally {
    cleanup(cwd);
  }
});

test('ruleConditionHolds VAL-004: returns false when unresolved-questions.yaml is empty array', () => {
  const cwd = makeTempDir();
  try {
    fs.writeFileSync(path.join(cwd, 'unresolved-questions.yaml'), '[]\n');
    const result = ruleConditionHolds('VAL-004', 'unresolved-questions.yaml', cwd);
    assert.equal(result, false);
  } finally {
    cleanup(cwd);
  }
});

test('ruleConditionHolds VAL-004: returns false when unresolved-questions.yaml is empty file', () => {
  const cwd = makeTempDir();
  try {
    fs.writeFileSync(path.join(cwd, 'unresolved-questions.yaml'), '');
    const result = ruleConditionHolds('VAL-004', 'unresolved-questions.yaml', cwd);
    assert.equal(result, false);
  } finally {
    cleanup(cwd);
  }
});

// ─── ruleConditionHolds — STEP-001 ───────────────────────────────────────────

test('ruleConditionHolds STEP-001: returns true when step is complete but source_file not modified since checkpoint', () => {
  const cwd = makeTempDir();
  setupKeelDirs(cwd);
  try {
    // Create the source file first
    fs.mkdirSync(path.join(cwd, 'src'), { recursive: true });
    fs.writeFileSync(path.join(cwd, 'src', 'feature.js'), 'console.log("old")');

    // Checkpoint created AFTER the file was written (future timestamp)
    const futureTime = new Date(Date.now() + 60_000).toISOString();
    const ts = '2025-01-15T10-00-00';
    const filePath = path.join(cwd, '.keel', 'checkpoints', `${ts}.yaml`);
    fs.writeFileSync(filePath, stringifyYaml({
      created_at: futureTime,
      goal: 'test',
      in_scope_files: [],
      in_scope_dirs: [],
      plan_steps: [
        { id: 'step-1', description: 'Implement feature', completed: true, source_file: 'src/feature.js' },
      ],
    }));

    // File mtime is in the past relative to checkpoint → condition holds
    const result = ruleConditionHolds('STEP-001', 'src/feature.js', cwd);
    assert.equal(result, true);
  } finally {
    cleanup(cwd);
  }
});

test('ruleConditionHolds STEP-001: returns false when step source_file was modified after checkpoint', () => {
  const cwd = makeTempDir();
  setupKeelDirs(cwd);
  try {
    // Checkpoint created in the past
    const pastTime = new Date(Date.now() - 60_000).toISOString();
    const ts = '2025-01-15T10-00-00';
    const filePath = path.join(cwd, '.keel', 'checkpoints', `${ts}.yaml`);
    fs.writeFileSync(filePath, stringifyYaml({
      created_at: pastTime,
      goal: 'test',
      in_scope_files: [],
      in_scope_dirs: [],
      plan_steps: [
        { id: 'step-1', description: 'Implement feature', completed: true, source_file: 'src/feature.js' },
      ],
    }));

    // Create the source file AFTER the checkpoint (mtime > checkpoint)
    fs.mkdirSync(path.join(cwd, 'src'), { recursive: true });
    fs.writeFileSync(path.join(cwd, 'src', 'feature.js'), 'console.log("new")');

    // File mtime is after checkpoint → condition does NOT hold
    const result = ruleConditionHolds('STEP-001', 'src/feature.js', cwd);
    assert.equal(result, false);
  } finally {
    cleanup(cwd);
  }
});

test('ruleConditionHolds STEP-001: returns false when no checkpoint exists', () => {
  const cwd = makeTempDir();
  setupKeelDirs(cwd);
  try {
    const result = ruleConditionHolds('STEP-001', 'src/feature.js', cwd);
    assert.equal(result, false);
  } finally {
    cleanup(cwd);
  }
});
