// done.js — Done-Gate logic
// Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6
'use strict';

const fs = require('fs');
const path = require('path');
const { parseYaml } = require('./yaml.js');
const { getStatus } = require('./daemon.js');
const { readAlerts } = require('./alerts.js');
const { loadLatestCheckpoint, levenshteinRatio } = require('./checkpoint.js');

/**
 * Run the 4-check done-gate against the given working directory.
 * Does NOT call process.exit() — returns a result object.
 *
 * @param {string} cwd
 * @returns {{ passed: boolean, reason: string, blockers: Array<{check: string, message: string, rule?: string}> }}
 */
function doneGate(cwd) {
  const blockers = [];

  // ── Check 1: Companion heartbeat freshness ────────────────────────────────
  try {
    const s = getStatus(cwd);
    if (!s.running) {
      blockers.push({
        check: 'heartbeat',
        message: 'Companion is not running — start with: keel companion start',
      });
    } else if (s.stale) {
      blockers.push({
        check: 'heartbeat',
        message: 'Companion heartbeat is stale — restart with: keel companion stop && keel companion start',
      });
    }
  } catch (err) {
    blockers.push({ check: 'heartbeat', message: `Cannot read heartbeat: ${err.message}` });
  }

  // ── Check 2: No high-severity deterministic alerts ────────────────────────
  try {
    const activeAlerts = readAlerts(cwd);
    const highAlerts = activeAlerts.filter(a => a.severity === 'high' && a.deterministic === true);
    for (const alert of highAlerts) {
      blockers.push({ check: 'alerts', message: alert.message, rule: alert.rule });
    }
  } catch (err) {
    blockers.push({ check: 'alerts', message: `Cannot read alerts: ${err.message}` });
  }

  // ── Check 3: Goal not drifted from checkpoint ─────────────────────────────
  const cp = loadLatestCheckpoint(cwd);
  if (cp) {
    try {
      const goalPath = path.join(cwd, '.keel', 'goal.yaml');
      const text = fs.readFileSync(goalPath, 'utf8').trim();
      if (text) {
        const goalData = parseYaml(text);
        if (goalData && typeof goalData.goal === 'string' && typeof cp.goal === 'string') {
          const ratio = levenshteinRatio(goalData.goal, cp.goal);
          if (ratio > 0.20) {
            blockers.push({
              check: 'goal',
              message: 'Goal has drifted from checkpoint — run: keel goal to re-anchor',
            });
          }
        }
      }
    } catch {
      // goal.yaml absent — skip check
    }

    // ── Check 4: All plan steps completed or have recorded delta ─────────────
    if (Array.isArray(cp.plan_steps)) {
      const incomplete = cp.plan_steps.filter(s => !s.completed && !s.delta);
      if (incomplete.length > 0) {
        blockers.push({
          check: 'steps',
          message: `${incomplete.length} plan step(s) incomplete — run: keel advance`,
        });
      }
    }
  }

  const passed = blockers.length === 0;
  const reason = passed ? '✓ done-gate passed' : blockers[0].message;

  return { passed, reason, blockers };
}

module.exports = { doneGate };
