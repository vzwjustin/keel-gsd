// yaml.test.js — Round-trip tests for yaml.js
// Tests parse → stringify → parse identity for all YAML shapes used in keel state files
// Uses Node.js built-in node:test + assert (no external deps)
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseYaml, stringifyYaml } = require('./yaml.js');

/**
 * Assert that parse(stringify(value)) deep-equals value.
 */
function assertRoundTrip(value, label) {
  const yaml = stringifyYaml(value);
  const parsed = parseYaml(yaml);
  assert.deepEqual(parsed, value, `Round-trip failed for: ${label}\nYAML:\n${yaml}`);
}

// ─── Heartbeat file ───────────────────────────────────────────────────────────

test('heartbeat: round-trip', () => {
  const heartbeat = {
    running: true,
    pid: 12345,
    last_beat_at: '2025-01-15T10:30:00.000Z',
    started_at: '2025-01-15T10:00:00.000Z',
    version: '1.0.0',
  };
  assertRoundTrip(heartbeat, 'heartbeat');
});

test('heartbeat: running false', () => {
  const heartbeat = {
    running: false,
    pid: 12345,
    last_beat_at: '2025-01-15T10:30:00.000Z',
  };
  assertRoundTrip(heartbeat, 'heartbeat running:false');
});

// ─── Alerts file (array of objects) ──────────────────────────────────────────

test('alerts: empty array round-trip', () => {
  assertRoundTrip([], 'empty alerts');
});

test('alerts: single alert round-trip', () => {
  const alerts = [
    {
      rule: 'SCOPE-001',
      message: 'File modified outside active scope',
      severity: 'high',
      deterministic: true,
      created_at: '2025-01-15T10:30:00.000Z',
      source_file: 'src/foo.js',
      cluster_id: 'scope-drift-001',
      consolidated: false,
    },
  ];
  assertRoundTrip(alerts, 'single alert');
});

test('alerts: multiple alerts round-trip', () => {
  const alerts = [
    {
      rule: 'SCOPE-001',
      message: 'File modified outside active scope',
      severity: 'high',
      deterministic: true,
      created_at: '2025-01-15T10:30:00.000Z',
      source_file: 'src/foo.js',
      cluster_id: 'scope-drift-001',
      consolidated: false,
    },
    {
      rule: 'GOAL-001',
      message: 'Goal statement drifted more than 20%',
      severity: 'medium',
      deterministic: true,
      created_at: '2025-01-15T10:31:00.000Z',
      source_file: null,
      cluster_id: 'goal-drift-001',
      consolidated: false,
    },
  ];
  assertRoundTrip(alerts, 'multiple alerts');
});

test('alerts: consolidated parent alert round-trip', () => {
  const alerts = [
    {
      rule: 'SCOPE-001',
      message: '3 related drift findings — session pivot detected',
      severity: 'high',
      deterministic: true,
      created_at: '2025-01-15T10:30:00.000Z',
      source_file: 'src/foo.js',
      cluster_id: 'scope-drift-001',
      consolidated: true,
      child_count: 3,
    },
  ];
  assertRoundTrip(alerts, 'consolidated alert');
});

// ─── Checkpoint file (nested objects with arrays) ─────────────────────────────

test('checkpoint: round-trip', () => {
  const checkpoint = {
    captured_at: '2025-01-15T10:00:00.000Z',
    phase: '3.1',
    goal: 'Implement the keel companion binary',
    in_scope_files: [
      'keel/bin/keel.js',
      'keel/bin/lib/yaml.js',
      'keel/bin/lib/atomic.js',
    ],
    in_scope_dirs: ['keel/bin/lib'],
    plan_steps: [
      { id: 'step-1', description: 'Scaffold project structure', completed: true },
      { id: 'step-2', description: 'Implement yaml.js', completed: false },
    ],
  };
  assertRoundTrip(checkpoint, 'checkpoint');
});

test('checkpoint: empty arrays round-trip', () => {
  const checkpoint = {
    captured_at: '2025-01-15T10:00:00.000Z',
    phase: '3.1',
    goal: 'Test goal',
    in_scope_files: [],
    in_scope_dirs: [],
    plan_steps: [],
  };
  assertRoundTrip(checkpoint, 'checkpoint with empty arrays');
});

// ─── Scope file ───────────────────────────────────────────────────────────────

test('scope: round-trip with in_scope and out_of_scope arrays', () => {
  const scope = {
    generated_at: '2025-01-15T10:00:00.000Z',
    in_scope: [
      { pattern: 'keel/bin/**', reason: 'Active phase files' },
      { pattern: '.kiro/specs/keel-companion/**', reason: 'Spec files' },
    ],
    out_of_scope: [
      { pattern: 'node_modules/**', reason: 'Dependencies' },
      { pattern: '.git/**', reason: 'Git internals' },
    ],
  };
  assertRoundTrip(scope, 'scope.yaml');
});

test('scope: empty scope arrays round-trip', () => {
  const scope = {
    generated_at: '2025-01-15T10:00:00.000Z',
    in_scope: [],
    out_of_scope: [],
  };
  assertRoundTrip(scope, 'scope.yaml empty arrays');
});

// ─── Goal file ────────────────────────────────────────────────────────────────

test('goal: round-trip', () => {
  const goal = {
    goal: 'Build the keel companion binary as a Node.js zero-runtime-dependency tool',
    source: 'ROADMAP.md',
    phase: '3.1',
    captured_at: '2025-01-15T10:00:00.000Z',
  };
  assertRoundTrip(goal, 'goal.yaml');
});

// ─── keel.yaml config ─────────────────────────────────────────────────────────

test('keel.yaml: nested config round-trip', () => {
  const config = {
    watch: {
      debounce_ms: 500,
      ignore_patterns: ['.keel/**', '.git/**', 'node_modules/**'],
    },
    alerts: {
      consolidation_window_ms: 10000,
    },
    done_gate: {
      require_heartbeat_fresh: true,
      heartbeat_max_age_ms: 30000,
      block_on_high_severity: true,
    },
  };
  assertRoundTrip(config, 'keel.yaml');
});

// ─── Scalar edge cases ────────────────────────────────────────────────────────

test('scalars: booleans round-trip', () => {
  assertRoundTrip({ a: true, b: false }, 'booleans');
});

test('scalars: numbers round-trip', () => {
  assertRoundTrip({ count: 0, pid: 99999, ms: 10000 }, 'numbers');
});

test('scalars: null values round-trip', () => {
  assertRoundTrip({ source_file: null }, 'null value');
});

test('scalars: string with colon round-trip', () => {
  // Strings containing ':' must be quoted
  assertRoundTrip({ message: 'Error: something went wrong' }, 'string with colon');
});

test('scalars: ISO 8601 timestamp strings round-trip', () => {
  assertRoundTrip({ ts: '2025-01-15T10:30:00.000Z' }, 'ISO timestamp');
});

test('scalars: empty string round-trip', () => {
  assertRoundTrip({ key: '' }, 'empty string');
});

test('scalars: numeric-looking string round-trip', () => {
  // e.g. phase "3.1" should stay a string
  assertRoundTrip({ phase: '3.1' }, 'numeric-looking string');
});

// ─── stringify produces parseable output ─────────────────────────────────────

test('stringify: produces valid YAML ending with newline', () => {
  const yaml = stringifyYaml({ running: true });
  assert.ok(yaml.endsWith('\n'), 'YAML output should end with newline');
});

test('stringify: empty array produces []', () => {
  const yaml = stringifyYaml([]);
  assert.equal(yaml.trim(), '[]');
});

test('stringify: empty object produces {}', () => {
  const yaml = stringifyYaml({});
  assert.equal(yaml.trim(), '{}');
});
