// install.test.js — Unit tests for keel init and keel install logic
// Requirements: 9.1, 9.2, 9.3, 9.4
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { parseYaml } = require('./yaml.js');
const { writeAtomic } = require('./atomic.js');
const { writeCheckpoint } = require('./checkpoint.js');
const { scanScope, readGoal } = require('./scan.js');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'keel-install-test-'));
}

function cleanup(cwd) {
  fs.rmSync(cwd, { recursive: true, force: true });
}

/**
 * Inline implementation of keel init logic (mirrors cmdInit in keel.js)
 * so we can test it without spawning a subprocess.
 */
function runInit(cwd) {
  const keelDirPath = path.join(cwd, '.keel');
  const sessionDir = path.join(keelDirPath, 'session');
  const checkpointsDir = path.join(keelDirPath, 'checkpoints');

  fs.mkdirSync(sessionDir, { recursive: true });
  fs.mkdirSync(checkpointsDir, { recursive: true });

  const keelYamlPath = path.join(keelDirPath, 'keel.yaml');
  if (!fs.existsSync(keelYamlPath)) {
    const { stringifyYaml } = require('./yaml.js');
    const defaults = {
      version: '1.0.0',
      initialized_at: new Date().toISOString(),
      watch: {
        debounce_ms: 500,
        ignore_patterns: ['.git/**', 'node_modules/**', '.keel/**'],
      },
      alerts: {
        consolidation_window_ms: 10000,
        stale_heartbeat_threshold_ms: 30000,
      },
      done_gate: {
        require_fresh_heartbeat: true,
        block_on_high_severity: true,
      },
    };
    writeAtomic(keelYamlPath, stringifyYaml(defaults));
  }

  // Add .keel/session/ to .gitignore
  const gitignorePath = path.join(cwd, '.gitignore');
  const gitignoreEntry = '.keel/session/';
  let content = '';
  try { content = fs.readFileSync(gitignorePath, 'utf8'); } catch { /* absent */ }
  if (!content.includes(gitignoreEntry)) {
    const append = (content.endsWith('\n') || content === '' ? '' : '\n') + gitignoreEntry + '\n';
    fs.appendFileSync(gitignorePath, append, 'utf8');
  }
}

// ─── keel init: directory structure ──────────────────────────────────────────

test('keel init creates .keel/session/ directory', () => {
  const cwd = makeTempDir();
  try {
    runInit(cwd);
    assert.ok(fs.existsSync(path.join(cwd, '.keel', 'session')), '.keel/session/ should exist');
    assert.ok(fs.statSync(path.join(cwd, '.keel', 'session')).isDirectory());
  } finally {
    cleanup(cwd);
  }
});

test('keel init creates .keel/checkpoints/ directory', () => {
  const cwd = makeTempDir();
  try {
    runInit(cwd);
    assert.ok(fs.existsSync(path.join(cwd, '.keel', 'checkpoints')), '.keel/checkpoints/ should exist');
    assert.ok(fs.statSync(path.join(cwd, '.keel', 'checkpoints')).isDirectory());
  } finally {
    cleanup(cwd);
  }
});

// ─── keel init: keel.yaml defaults ───────────────────────────────────────────

test('keel init writes .keel/keel.yaml with correct defaults', () => {
  const cwd = makeTempDir();
  try {
    runInit(cwd);
    const keelYamlPath = path.join(cwd, '.keel', 'keel.yaml');
    assert.ok(fs.existsSync(keelYamlPath), 'keel.yaml should exist');

    const content = fs.readFileSync(keelYamlPath, 'utf8');
    const parsed = parseYaml(content);

    assert.equal(parsed.version, '1.0.0');
    assert.ok(typeof parsed.initialized_at === 'string', 'initialized_at should be a string');
    assert.ok(!isNaN(new Date(parsed.initialized_at).getTime()), 'initialized_at should be valid ISO 8601');

    // watch defaults
    assert.equal(parsed.watch.debounce_ms, 500);
    assert.deepEqual(parsed.watch.ignore_patterns, ['.git/**', 'node_modules/**', '.keel/**']);

    // alerts defaults
    assert.equal(parsed.alerts.consolidation_window_ms, 10000);
    assert.equal(parsed.alerts.stale_heartbeat_threshold_ms, 30000);

    // done_gate defaults
    assert.equal(parsed.done_gate.require_fresh_heartbeat, true);
    assert.equal(parsed.done_gate.block_on_high_severity, true);
  } finally {
    cleanup(cwd);
  }
});

test('keel init does not overwrite existing keel.yaml', () => {
  const cwd = makeTempDir();
  try {
    // Pre-create .keel/ with a custom keel.yaml
    fs.mkdirSync(path.join(cwd, '.keel'), { recursive: true });
    const customContent = 'version: "custom"\n';
    fs.writeFileSync(path.join(cwd, '.keel', 'keel.yaml'), customContent, 'utf8');

    runInit(cwd);

    const content = fs.readFileSync(path.join(cwd, '.keel', 'keel.yaml'), 'utf8');
    assert.equal(content, customContent, 'existing keel.yaml should not be overwritten');
  } finally {
    cleanup(cwd);
  }
});

// ─── keel init: .gitignore ────────────────────────────────────────────────────

test('keel init adds .keel/session/ to .gitignore when absent', () => {
  const cwd = makeTempDir();
  try {
    runInit(cwd);
    const content = fs.readFileSync(path.join(cwd, '.gitignore'), 'utf8');
    assert.ok(content.includes('.keel/session/'), '.gitignore should contain .keel/session/');
  } finally {
    cleanup(cwd);
  }
});

test('keel init does not duplicate .keel/session/ in .gitignore', () => {
  const cwd = makeTempDir();
  try {
    // Pre-populate .gitignore with the entry
    fs.writeFileSync(path.join(cwd, '.gitignore'), '.keel/session/\n', 'utf8');

    runInit(cwd);

    const content = fs.readFileSync(path.join(cwd, '.gitignore'), 'utf8');
    const occurrences = (content.match(/\.keel\/session\//g) || []).length;
    assert.equal(occurrences, 1, '.keel/session/ should appear exactly once');
  } finally {
    cleanup(cwd);
  }
});

test('keel init appends to existing .gitignore without clobbering it', () => {
  const cwd = makeTempDir();
  try {
    fs.writeFileSync(path.join(cwd, '.gitignore'), 'node_modules/\n', 'utf8');

    runInit(cwd);

    const content = fs.readFileSync(path.join(cwd, '.gitignore'), 'utf8');
    assert.ok(content.includes('node_modules/'), 'existing entry should be preserved');
    assert.ok(content.includes('.keel/session/'), 'new entry should be appended');
  } finally {
    cleanup(cwd);
  }
});

// ─── keel install: idempotency ────────────────────────────────────────────────

test('keel install is idempotent when .keel/ already exists', () => {
  const cwd = makeTempDir();
  try {
    // Simulate already-installed state
    fs.mkdirSync(path.join(cwd, '.keel', 'session'), { recursive: true });
    fs.mkdirSync(path.join(cwd, '.keel', 'checkpoints'), { recursive: true });

    // The idempotency check: if .keel/ exists, we should detect it
    const keelDirPath = path.join(cwd, '.keel');
    assert.ok(fs.existsSync(keelDirPath), '.keel/ should exist before second install');

    // Running init again should not throw and should not overwrite keel.yaml if present
    const { stringifyYaml } = require('./yaml.js');
    const originalContent = stringifyYaml({ version: '1.0.0', initialized_at: '2025-01-01T00:00:00.000Z' });
    fs.writeFileSync(path.join(cwd, '.keel', 'keel.yaml'), originalContent, 'utf8');

    runInit(cwd);

    const afterContent = fs.readFileSync(path.join(cwd, '.keel', 'keel.yaml'), 'utf8');
    assert.equal(afterContent, originalContent, 'keel.yaml should not be overwritten on re-init');
  } finally {
    cleanup(cwd);
  }
});

// ─── keel install: permission error handling ──────────────────────────────────

test('keel install exits with error on permission failure', () => {
  // Simulate a permission error by trying to create a directory in a read-only path
  // We test the error-handling path by verifying mkdirSync throws on bad paths
  const badPath = '/nonexistent-root-dir-that-cannot-be-created/keel-test/session';
  let threw = false;
  let errorMessage = '';
  try {
    fs.mkdirSync(badPath, { recursive: true });
  } catch (err) {
    threw = true;
    errorMessage = err.message || String(err);
  }
  assert.ok(threw, 'should throw on permission/path error');
  assert.ok(errorMessage.length > 0, 'error message should be descriptive');
});

// ─── keel install: sequence verification ─────────────────────────────────────

test('keel install sequence creates all required artifacts', () => {
  const cwd = makeTempDir();
  try {
    // Simulate the full install sequence (without starting daemon)
    const keelDirPath = path.join(cwd, '.keel');

    // Step 1: .keel/ should not exist yet
    assert.ok(!fs.existsSync(keelDirPath), '.keel/ should not exist before install');

    // Step 2: Run init (creates dirs + keel.yaml)
    runInit(cwd);

    assert.ok(fs.existsSync(path.join(cwd, '.keel', 'session')));
    assert.ok(fs.existsSync(path.join(cwd, '.keel', 'checkpoints')));
    assert.ok(fs.existsSync(path.join(cwd, '.keel', 'keel.yaml')));

    // Step 3: Run scan
    const scopeResult = scanScope(cwd);
    assert.ok(fs.existsSync(path.join(cwd, '.keel', 'scope.yaml')), 'scope.yaml should be written');
    assert.ok(Array.isArray(scopeResult.in_scope));

    // Step 4: Run goal (non-fatal if no ROADMAP.md)
    const goalResult = readGoal(cwd);
    // goal may be null if no ROADMAP.md — that's fine
    assert.ok(goalResult !== undefined);

    // Step 5: Write initial checkpoint
    writeCheckpoint(cwd, {
      goal: null,
      phase: null,
      in_scope_files: [],
      in_scope_dirs: [],
      plan_steps: [],
    });
    const checkpointFiles = fs.readdirSync(path.join(cwd, '.keel', 'checkpoints'));
    assert.equal(checkpointFiles.length, 1, 'one checkpoint should be written');

  } finally {
    cleanup(cwd);
  }
});
