// checkpoint.test.js — Unit tests for checkpoint.js
// Requirements: 6.1, 6.2, 6.4
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  writeCheckpoint,
  loadLatestCheckpoint,
  computeDrift,
  levenshteinRatio,
  formatTimestamp,
} = require('./checkpoint.js');
const { parseYaml } = require('./yaml.js');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'keel-checkpoint-test-'));
}

function setupKeelDirs(cwd) {
  fs.mkdirSync(path.join(cwd, '.keel', 'checkpoints'), { recursive: true });
  fs.mkdirSync(path.join(cwd, '.keel', 'session'), { recursive: true });
}

function cleanup(cwd) {
  fs.rmSync(cwd, { recursive: true, force: true });
}

// ─── formatTimestamp ──────────────────────────────────────────────────────────

test('formatTimestamp replaces colons with dashes', () => {
  const d = new Date('2025-01-15T10:30:45.000Z');
  const result = formatTimestamp(d);
  assert.equal(result, '2025-01-15T10-30-45');
  assert.ok(!result.includes(':'), 'should not contain colons');
});

// ─── writeCheckpoint ─────────────────────────────────────────────────────────

test('writeCheckpoint creates a timestamped yaml file', () => {
  const cwd = makeTempDir();
  setupKeelDirs(cwd);
  try {
    const data = {
      goal: 'Test goal',
      phase: '1.0',
      in_scope_files: ['src/index.js'],
      in_scope_dirs: ['src/'],
      plan_steps: [{ id: '1', description: 'step one', completed: false }],
    };
    writeCheckpoint(cwd, data);

    const files = fs.readdirSync(path.join(cwd, '.keel', 'checkpoints'));
    assert.equal(files.length, 1);
    assert.ok(files[0].endsWith('.yaml'));
    // Filename should match YYYY-MM-DDTHH-MM-SS.yaml pattern
    assert.match(files[0], /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.yaml$/);

    const content = fs.readFileSync(path.join(cwd, '.keel', 'checkpoints', files[0]), 'utf8');
    const parsed = parseYaml(content);
    assert.equal(parsed.goal, 'Test goal');
    assert.equal(parsed.phase, '1.0');
    assert.deepEqual(parsed.in_scope_files, ['src/index.js']);
    assert.deepEqual(parsed.in_scope_dirs, ['src/']);
    assert.ok(typeof parsed.created_at === 'string', 'created_at should be present');
    // created_at should be valid ISO 8601
    assert.ok(!isNaN(new Date(parsed.created_at).getTime()), 'created_at should be valid date');
  } finally {
    cleanup(cwd);
  }
});

test('writeCheckpoint handles missing optional fields gracefully', () => {
  const cwd = makeTempDir();
  setupKeelDirs(cwd);
  try {
    writeCheckpoint(cwd, {});
    const files = fs.readdirSync(path.join(cwd, '.keel', 'checkpoints'));
    assert.equal(files.length, 1);
    const content = fs.readFileSync(path.join(cwd, '.keel', 'checkpoints', files[0]), 'utf8');
    const parsed = parseYaml(content);
    assert.deepEqual(parsed.in_scope_files, []);
    assert.deepEqual(parsed.in_scope_dirs, []);
    assert.deepEqual(parsed.plan_steps, []);
  } finally {
    cleanup(cwd);
  }
});

// ─── loadLatestCheckpoint ─────────────────────────────────────────────────────

test('loadLatestCheckpoint returns null when directory is absent', () => {
  const cwd = makeTempDir();
  try {
    const result = loadLatestCheckpoint(cwd);
    assert.equal(result, null);
  } finally {
    cleanup(cwd);
  }
});

test('loadLatestCheckpoint returns null when directory is empty', () => {
  const cwd = makeTempDir();
  setupKeelDirs(cwd);
  try {
    const result = loadLatestCheckpoint(cwd);
    assert.equal(result, null);
  } finally {
    cleanup(cwd);
  }
});

test('loadLatestCheckpoint returns the most recent checkpoint', async () => {
  const cwd = makeTempDir();
  setupKeelDirs(cwd);
  try {
    const dir = path.join(cwd, '.keel', 'checkpoints');

    // Write two checkpoints with different timestamps (older first)
    const older = '2025-01-15T10-00-00.yaml';
    const newer = '2025-01-15T11-00-00.yaml';

    const { stringifyYaml } = require('./yaml.js');
    fs.writeFileSync(path.join(dir, older), stringifyYaml({ created_at: '2025-01-15T10:00:00.000Z', goal: 'old goal' }));
    fs.writeFileSync(path.join(dir, newer), stringifyYaml({ created_at: '2025-01-15T11:00:00.000Z', goal: 'new goal' }));

    const result = loadLatestCheckpoint(cwd);
    assert.ok(result !== null);
    assert.equal(result.goal, 'new goal');
  } finally {
    cleanup(cwd);
  }
});

test('loadLatestCheckpoint returns single checkpoint when only one exists', () => {
  const cwd = makeTempDir();
  setupKeelDirs(cwd);
  try {
    const data = {
      goal: 'Only checkpoint',
      phase: '2.0',
      in_scope_files: [],
      in_scope_dirs: [],
      plan_steps: [],
    };
    writeCheckpoint(cwd, data);
    const result = loadLatestCheckpoint(cwd);
    assert.ok(result !== null);
    assert.equal(result.goal, 'Only checkpoint');
  } finally {
    cleanup(cwd);
  }
});

// ─── computeDrift ─────────────────────────────────────────────────────────────

test('computeDrift returns no drift for clean state', () => {
  const cwd = makeTempDir();
  setupKeelDirs(cwd);
  try {
    // Create a file that is in scope
    fs.mkdirSync(path.join(cwd, 'src'), { recursive: true });
    fs.writeFileSync(path.join(cwd, 'src', 'index.js'), 'console.log("hello")');

    // Checkpoint created AFTER the file was written
    const checkpoint = {
      created_at: new Date(Date.now() + 5000).toISOString(), // future timestamp
      goal: 'Test goal',
      in_scope_files: ['src/index.js'],
      in_scope_dirs: ['src/'],
      plan_steps: [],
    };

    const result = computeDrift(cwd, checkpoint);
    assert.equal(result.drifted, false);
    assert.equal(result.alerts.length, 0);
    assert.equal(result.blockers.length, 0);
  } finally {
    cleanup(cwd);
  }
});

test('computeDrift detects out-of-scope file modified after checkpoint', () => {
  const cwd = makeTempDir();
  setupKeelDirs(cwd);
  try {
    // Create an out-of-scope file
    fs.mkdirSync(path.join(cwd, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(cwd, 'docs', 'readme.md'), '# Docs');

    // Checkpoint created BEFORE the file was written (in the past)
    const checkpoint = {
      created_at: new Date(Date.now() - 10000).toISOString(),
      goal: 'Test goal',
      in_scope_files: ['src/index.js'],
      in_scope_dirs: ['src/'],
      plan_steps: [],
    };

    const result = computeDrift(cwd, checkpoint);
    assert.equal(result.drifted, true);
    const scopeAlert = result.alerts.find(a => a.rule === 'SCOPE-001');
    assert.ok(scopeAlert, 'should have SCOPE-001 alert');
    assert.equal(scopeAlert.deterministic, true);
    assert.ok(result.blockers.length > 0);
  } finally {
    cleanup(cwd);
  }
});

test('computeDrift detects goal text drift > 20%', () => {
  const cwd = makeTempDir();
  setupKeelDirs(cwd);
  try {
    // Write a goal.yaml with very different text
    const { stringifyYaml } = require('./yaml.js');
    fs.writeFileSync(
      path.join(cwd, '.keel', 'goal.yaml'),
      stringifyYaml({ goal: 'Completely different goal that has changed significantly from original' })
    );

    const checkpoint = {
      created_at: new Date(Date.now() + 5000).toISOString(), // future so no file drift
      goal: 'Original goal text',
      in_scope_files: [],
      in_scope_dirs: [],
      plan_steps: [],
    };

    const result = computeDrift(cwd, checkpoint);
    const goalAlert = result.alerts.find(a => a.rule === 'GOAL-001');
    assert.ok(goalAlert, 'should have GOAL-001 alert');
    assert.equal(goalAlert.deterministic, true);
  } finally {
    cleanup(cwd);
  }
});

test('computeDrift does not flag goal drift when change is <= 20%', () => {
  const cwd = makeTempDir();
  setupKeelDirs(cwd);
  try {
    const { stringifyYaml } = require('./yaml.js');
    // Very similar goal — only one character different
    fs.writeFileSync(
      path.join(cwd, '.keel', 'goal.yaml'),
      stringifyYaml({ goal: 'Implement keel companion binary' })
    );

    const checkpoint = {
      created_at: new Date(Date.now() + 5000).toISOString(),
      goal: 'Implement keel companion binary',
      in_scope_files: [],
      in_scope_dirs: [],
      plan_steps: [],
    };

    const result = computeDrift(cwd, checkpoint);
    const goalAlert = result.alerts.find(a => a.rule === 'GOAL-001');
    assert.equal(goalAlert, undefined, 'should not have GOAL-001 alert for identical goal');
  } finally {
    cleanup(cwd);
  }
});

test('computeDrift detects VAL-004 when unresolved-questions.yaml is non-empty', () => {
  const cwd = makeTempDir();
  setupKeelDirs(cwd);
  try {
    const { stringifyYaml } = require('./yaml.js');
    fs.writeFileSync(
      path.join(cwd, 'unresolved-questions.yaml'),
      stringifyYaml([{ question: 'What is the scope?' }])
    );

    const checkpoint = {
      created_at: new Date(Date.now() + 5000).toISOString(),
      goal: 'Test goal',
      in_scope_files: [],
      in_scope_dirs: [],
      plan_steps: [],
    };

    const result = computeDrift(cwd, checkpoint);
    const val004 = result.alerts.find(a => a.rule === 'VAL-004');
    assert.ok(val004, 'should have VAL-004 alert');
    assert.equal(val004.deterministic, true);
    assert.equal(result.drifted, true);
  } finally {
    cleanup(cwd);
  }
});

test('computeDrift does not flag VAL-004 when unresolved-questions.yaml is absent', () => {
  const cwd = makeTempDir();
  setupKeelDirs(cwd);
  try {
    const checkpoint = {
      created_at: new Date(Date.now() + 5000).toISOString(),
      goal: 'Test goal',
      in_scope_files: [],
      in_scope_dirs: [],
      plan_steps: [],
    };

    const result = computeDrift(cwd, checkpoint);
    const val004 = result.alerts.find(a => a.rule === 'VAL-004');
    assert.equal(val004, undefined);
  } finally {
    cleanup(cwd);
  }
});

test('computeDrift blockers are subset of alerts with deterministic: true', () => {
  const cwd = makeTempDir();
  setupKeelDirs(cwd);
  try {
    const { stringifyYaml } = require('./yaml.js');
    fs.writeFileSync(
      path.join(cwd, 'unresolved-questions.yaml'),
      stringifyYaml([{ question: 'Open question' }])
    );

    const checkpoint = {
      created_at: new Date(Date.now() + 5000).toISOString(),
      goal: 'Test goal',
      in_scope_files: [],
      in_scope_dirs: [],
      plan_steps: [],
    };

    const result = computeDrift(cwd, checkpoint);
    // Every blocker must be in alerts
    for (const blocker of result.blockers) {
      assert.ok(result.alerts.includes(blocker), 'blocker should be in alerts');
      assert.equal(blocker.deterministic, true);
    }
  } finally {
    cleanup(cwd);
  }
});

// ─── levenshteinRatio ─────────────────────────────────────────────────────────

test('levenshteinRatio returns 0 for identical strings', () => {
  assert.equal(levenshteinRatio('hello', 'hello'), 0);
});

test('levenshteinRatio returns 0 for two empty strings', () => {
  assert.equal(levenshteinRatio('', ''), 0);
});

test('levenshteinRatio returns 1 for completely different strings of same length', () => {
  assert.equal(levenshteinRatio('abc', 'xyz'), 1);
});

test('levenshteinRatio is > 0.20 for significantly different strings', () => {
  const ratio = levenshteinRatio('short', 'completely different long string');
  assert.ok(ratio > 0.20, `expected ratio > 0.20, got ${ratio}`);
});
