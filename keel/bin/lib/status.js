// status.js — KEEL-STATUS.md writer
// Requirements: 8.1, 8.2, 8.3, 8.5
'use strict';

const fs = require('fs');
const path = require('path');
const { parseYaml } = require('./yaml.js');
const { readAlerts } = require('./alerts.js');
const { loadLatestCheckpoint } = require('./checkpoint.js');

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Read a YAML file; return null on any error.
 * @param {string} filePath
 * @returns {object|null}
 */
function readYamlFile(filePath) {
  try {
    const text = fs.readFileSync(filePath, 'utf8').trim();
    if (!text) return null;
    return parseYaml(text);
  } catch {
    return null;
  }
}

// ─── buildStatusMarkdown ──────────────────────────────────────────────────────

/**
 * Build the KEEL-STATUS.md markdown string from current state.
 * @param {{ goal: string|null, phase: string|null, nextStep: string|null, alerts: object[] }} state
 * @returns {string}
 */
function buildStatusMarkdown(state) {
  const { goal, phase, nextStep, alerts } = state;
  const timestamp = new Date().toISOString();

  const lines = [];

  lines.push('# KEEL Status');
  lines.push('');
  lines.push(`Last updated: ${timestamp}`);
  lines.push('');

  // Goal
  lines.push('## Goal');
  lines.push('');
  lines.push(goal || '(no goal set)');
  lines.push('');

  // Phase
  lines.push('## Phase');
  lines.push('');
  lines.push(phase || '(no phase)');
  lines.push('');

  // Next Step
  lines.push('## Next Step');
  lines.push('');
  lines.push(nextStep || '(no next step)');
  lines.push('');

  // Active Alerts
  lines.push('## Active Alerts');
  lines.push('');
  if (!Array.isArray(alerts) || alerts.length === 0) {
    lines.push('No active alerts.');
  } else {
    for (const alert of alerts) {
      const severity = alert.severity || 'unknown';
      const rule = alert.rule || 'UNKNOWN';
      const message = alert.message || '';
      lines.push(`- [${severity}] ${rule}: ${message}`);
    }
  }
  lines.push('');

  // Blockers — high-severity deterministic alerts
  const blockers = Array.isArray(alerts)
    ? alerts.filter(a => a.deterministic === true && a.severity === 'high')
    : [];

  lines.push('## Blockers');
  lines.push('');
  if (blockers.length === 0) {
    lines.push('None.');
  } else {
    for (const blocker of blockers) {
      lines.push(`- Resolve ${blocker.rule} drift before running keel done`);
    }
  }
  lines.push('');

  return lines.join('\n');
}

// ─── writeKeelStatus ─────────────────────────────────────────────────────────

/**
 * Write `.planning/KEEL-STATUS.md` with current goal, phase, next step,
 * active alerts, blockers, and a Last updated timestamp.
 *
 * Skips silently if `.planning/` does not exist.
 *
 * @param {string} cwd
 */
function writeKeelStatus(cwd) {
  const planningDir = path.join(cwd, '.planning');

  // Requirement 8.5: skip silently if .planning/ does not exist
  try {
    const stat = fs.statSync(planningDir);
    if (!stat.isDirectory()) return;
  } catch {
    return;
  }

  // Read goal from .keel/goal.yaml
  const goalData = readYamlFile(path.join(cwd, '.keel', 'goal.yaml'));
  const goal = (goalData && typeof goalData.goal === 'string') ? goalData.goal : null;

  // Read phase and next step from latest checkpoint
  const checkpoint = loadLatestCheckpoint(cwd);

  let phase = null;
  let nextStep = null;

  if (checkpoint) {
    // Phase: e.g. "3.1 — keel-companion" or just "3.1"
    if (checkpoint.phase) {
      phase = String(checkpoint.phase);
    }

    // Next step: first incomplete plan step
    if (Array.isArray(checkpoint.plan_steps)) {
      const incomplete = checkpoint.plan_steps.find(s => !s.completed);
      if (incomplete) {
        const id = incomplete.id || '';
        const desc = incomplete.description || '';
        nextStep = id && desc ? `${id} — ${desc}` : (id || desc || null);
      }
    }
  }

  // Read active alerts
  const alerts = readAlerts(cwd);

  const content = buildStatusMarkdown({ goal, phase, nextStep, alerts });

  // Write directly (human-readable file, not machine-parsed state)
  const outputPath = path.join(planningDir, 'KEEL-STATUS.md');
  fs.writeFileSync(outputPath, content, 'utf8');
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  writeKeelStatus,
  // Exported for testing
  buildStatusMarkdown,
};
