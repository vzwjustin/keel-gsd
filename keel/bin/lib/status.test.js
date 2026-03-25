// status.test.js — Tests for buildStatusMarkdown drift warning section
// Requirements: 12.4
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { buildStatusMarkdown } = require('./status.js');

describe('buildStatusMarkdown — Drift Warning section', () => {
  it('includes ⚠ Drift Warning section when high-severity alerts are active', () => {
    const md = buildStatusMarkdown({
      goal: 'Test goal',
      phase: '1.0',
      nextStep: '1.1 — Do something',
      alerts: [
        { rule: 'SCOPE-001', message: 'File out of scope', severity: 'high', deterministic: true },
      ],
    });

    assert.ok(md.includes('## ⚠ Drift Warning'), 'should contain drift warning header');
    assert.ok(md.includes('The following blockers must be resolved before phase completion:'));
    assert.ok(md.includes('- SCOPE-001: File out of scope'));
    assert.ok(md.includes('Resolution: run `keel advance` to acknowledge or revert the file'));
  });

  it('omits ⚠ Drift Warning section when no high-severity alerts exist', () => {
    const md = buildStatusMarkdown({
      goal: 'Test goal',
      phase: '1.0',
      nextStep: null,
      alerts: [
        { rule: 'STEP-001', message: 'Step not modified', severity: 'medium', deterministic: false },
      ],
    });

    assert.ok(!md.includes('## ⚠ Drift Warning'), 'should not contain drift warning header');
  });

  it('omits ⚠ Drift Warning section when alerts list is empty', () => {
    const md = buildStatusMarkdown({
      goal: 'Test goal',
      phase: '1.0',
      nextStep: null,
      alerts: [],
    });

    assert.ok(!md.includes('## ⚠ Drift Warning'));
    assert.ok(md.includes('No active alerts.'));
  });

  it('lists multiple high-severity alerts with correct resolution commands', () => {
    const md = buildStatusMarkdown({
      goal: 'Test goal',
      phase: '2.0',
      nextStep: null,
      alerts: [
        { rule: 'SCOPE-001', message: 'File x.js out of scope', severity: 'high', deterministic: true },
        { rule: 'VAL-004', message: 'Unresolved questions detected', severity: 'high', deterministic: true },
        { rule: 'STEP-001', message: 'Step not modified', severity: 'medium', deterministic: false },
      ],
    });

    assert.ok(md.includes('## ⚠ Drift Warning'));
    // Should list both high-severity alerts
    assert.ok(md.includes('- SCOPE-001: File x.js out of scope'));
    assert.ok(md.includes('Resolution: run `keel advance` to acknowledge or revert the file'));
    assert.ok(md.includes('- VAL-004: Unresolved questions detected'));
    assert.ok(md.includes('Resolution: resolve questions in unresolved-questions.yaml'));
    // Medium-severity should NOT appear in drift warning section
    // (it does appear in Active Alerts, so check the drift warning section specifically)
    const driftSection = md.split('## ⚠ Drift Warning')[1].split('## Blockers')[0];
    assert.ok(!driftSection.includes('STEP-001'), 'medium-severity should not be in drift warning section');
  });

  it('includes GOAL-001 resolution command', () => {
    const md = buildStatusMarkdown({
      goal: 'Test goal',
      phase: '1.0',
      nextStep: null,
      alerts: [
        { rule: 'GOAL-001', message: 'Goal drifted', severity: 'high', deterministic: true },
      ],
    });

    assert.ok(md.includes('- GOAL-001: Goal drifted'));
    assert.ok(md.includes('Resolution: run `keel goal` to re-anchor'));
  });

  it('includes GIT-001 resolution command for high-severity git alerts', () => {
    // GIT-001 is normally medium, but test the resolution mapping anyway
    const md = buildStatusMarkdown({
      goal: 'Test goal',
      phase: '1.0',
      nextStep: null,
      alerts: [
        { rule: 'GIT-001', message: 'Branch mismatch', severity: 'high', deterministic: false },
      ],
    });

    assert.ok(md.includes('## ⚠ Drift Warning'));
    assert.ok(md.includes('Resolution: run `keel checkpoint` to re-anchor'));
  });

  it('still includes Blockers section alongside Drift Warning', () => {
    const md = buildStatusMarkdown({
      goal: 'Test goal',
      phase: '1.0',
      nextStep: null,
      alerts: [
        { rule: 'SCOPE-001', message: 'Out of scope', severity: 'high', deterministic: true },
      ],
    });

    assert.ok(md.includes('## ⚠ Drift Warning'));
    assert.ok(md.includes('## Blockers'));
    assert.ok(md.includes('Resolve SCOPE-001 drift before running keel done'));
  });
});
