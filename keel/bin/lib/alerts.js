// alerts.js — Alert Engine (evaluate, consolidate, auto-clear)
// Requirements: 3.1, 3.2, 3.3, 3.5, 4.1, 4.2, 4.3, 5.1, 5.2, 5.3
'use strict';

const fs = require('fs');
const path = require('path');
const { parseYaml, stringifyYaml } = require('./yaml.js');
const { writeAtomic } = require('./atomic.js');

// ─── Levenshtein Distance (inline, no external deps) ─────────────────────────

/**
 * Compute Levenshtein distance between two strings.
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  // Use two rows to save memory
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let curr = new Array(n + 1);
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        curr[j] = prev[j - 1];
      } else {
        curr[j] = 1 + Math.min(prev[j - 1], prev[j], curr[j - 1]);
      }
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

/**
 * Levenshtein ratio: distance / max(len(a), len(b)).
 * Returns 0 if both strings are empty.
 */
function levenshteinRatio(a, b) {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 0;
  return levenshtein(a, b) / maxLen;
}

// ─── Severity helpers ────────────────────────────────────────────────────────

const SEVERITY_ORDER = { high: 3, medium: 2, low: 1 };

function maxSeverity(severities) {
  let best = 'low';
  for (const s of severities) {
    if ((SEVERITY_ORDER[s] || 0) > (SEVERITY_ORDER[best] || 0)) best = s;
  }
  return best;
}

// ─── File helpers ─────────────────────────────────────────────────────────────

function readYamlFile(filePath) {
  try {
    const text = fs.readFileSync(filePath, 'utf8').trim();
    if (!text) return null;
    return parseYaml(text);
  } catch {
    return null;
  }
}

// ─── readAlerts ───────────────────────────────────────────────────────────────

/**
 * Read .keel/session/alerts.yaml; return [] if absent or empty.
 * @param {string} cwd
 * @returns {object[]}
 */
function readAlerts(cwd) {
  const filePath = path.join(cwd, '.keel', 'session', 'alerts.yaml');
  const value = readYamlFile(filePath);
  if (!value) return [];
  if (Array.isArray(value)) return value;
  return [];
}

// ─── writeAlerts ──────────────────────────────────────────────────────────────

/**
 * Write alerts atomically to .keel/session/alerts.yaml.
 * @param {string} cwd
 * @param {object[]} alerts
 */
function writeAlerts(cwd, alerts) {
  const filePath = path.join(cwd, '.keel', 'session', 'alerts.yaml');
  const content = Array.isArray(alerts) && alerts.length > 0
    ? stringifyYaml(alerts)
    : '[]\n';
  writeAtomic(filePath, content);
}

// ─── evaluateDriftRules ───────────────────────────────────────────────────────

/**
 * Evaluate SCOPE-001, GOAL-001, VAL-004, STEP-001 in order.
 * Returns an array of new Alert objects (not yet written to disk).
 * @param {string} cwd
 * @param {string} changedFile - relative path from repo root
 * @returns {object[]}
 */
function evaluateDriftRules(cwd, changedFile) {
  const alerts = [];
  const now = new Date().toISOString();

  // Load latest checkpoint (may be null if checkpoint.js not yet implemented)
  let checkpoint = null;
  try {
    const { loadLatestCheckpoint } = require('./checkpoint.js');
    if (typeof loadLatestCheckpoint === 'function') {
      checkpoint = loadLatestCheckpoint(cwd);
    }
  } catch {
    // checkpoint.js not yet implemented — skip checkpoint-dependent rules
  }

  // ── SCOPE-001 ──────────────────────────────────────────────────────────────
  // File written outside in_scope_files + in_scope_dirs from active checkpoint
  if (changedFile && checkpoint) {
    const inScopeFiles = Array.isArray(checkpoint.in_scope_files) ? checkpoint.in_scope_files : [];
    const inScopeDirs = Array.isArray(checkpoint.in_scope_dirs) ? checkpoint.in_scope_dirs : [];

    const normalizedFile = changedFile.replace(/\\/g, '/');
    const inScope =
      inScopeFiles.some(f => f.replace(/\\/g, '/') === normalizedFile) ||
      inScopeDirs.some(d => {
        const dir = d.replace(/\\/g, '/').replace(/\/?$/, '/');
        return normalizedFile.startsWith(dir);
      });

    if (!inScope) {
      const clusterId = `pivot-${Date.now()}`;
      alerts.push({
        rule: 'SCOPE-001',
        message: `File ${changedFile} is outside active plan scope`,
        severity: 'high',
        deterministic: true,
        created_at: now,
        source_file: changedFile,
        cluster_id: clusterId,
        consolidated: false,
      });
    }
  }

  // ── GOAL-001 ───────────────────────────────────────────────────────────────
  // goal.yaml goal text differs from active checkpoint goal by >20% (Levenshtein)
  if (checkpoint && typeof checkpoint.goal === 'string') {
    const goalPath = path.join(cwd, '.keel', 'goal.yaml');
    const goalData = readYamlFile(goalPath);
    if (goalData && typeof goalData.goal === 'string') {
      const ratio = levenshteinRatio(goalData.goal, checkpoint.goal);
      if (ratio > 0.20) {
        alerts.push({
          rule: 'GOAL-001',
          message: `Goal text has drifted from checkpoint by ${Math.round(ratio * 100)}%`,
          severity: 'high',
          deterministic: true,
          created_at: now,
          source_file: '.keel/goal.yaml',
          cluster_id: `goal-${Date.now()}`,
          consolidated: false,
        });
      }
    }
  }

  // ── VAL-004 ────────────────────────────────────────────────────────────────
  // unresolved-questions.yaml exists and is non-empty
  const unresolvedPath = path.join(cwd, 'unresolved-questions.yaml');
  try {
    const stat = fs.statSync(unresolvedPath);
    if (stat.isFile() && stat.size > 0) {
      const content = fs.readFileSync(unresolvedPath, 'utf8').trim();
      if (content && content !== '[]' && content !== 'null') {
        const parsed = parseYaml(content);
        const hasItems = Array.isArray(parsed) ? parsed.length > 0 : parsed !== null;
        if (hasItems) {
          alerts.push({
            rule: 'VAL-004',
            message: 'Unresolved questions detected in unresolved-questions.yaml',
            severity: 'high',
            deterministic: true,
            created_at: now,
            source_file: 'unresolved-questions.yaml',
            cluster_id: `val-${Date.now()}`,
            consolidated: false,
          });
        }
      }
    }
  } catch {
    // file absent — no alert
  }

  // ── STEP-001 ───────────────────────────────────────────────────────────────
  // Plan step marked complete in checkpoint but corresponding file not modified
  if (checkpoint && Array.isArray(checkpoint.plan_steps)) {
    for (const step of checkpoint.plan_steps) {
      if (!step.completed) continue;
      // If the step has a source_file, check it was modified since checkpoint
      if (!step.source_file) continue;
      const stepFile = path.join(cwd, step.source_file);
      try {
        const stat = fs.statSync(stepFile);
        const checkpointTime = new Date(checkpoint.created_at).getTime();
        if (stat.mtimeMs < checkpointTime) {
          alerts.push({
            rule: 'STEP-001',
            message: `Plan step ${step.id || step.description} marked complete but ${step.source_file} not modified`,
            severity: 'medium',
            deterministic: false,
            created_at: now,
            source_file: step.source_file,
            cluster_id: `step-${Date.now()}`,
            consolidated: false,
          });
        }
      } catch {
        // file doesn't exist — also a signal
        alerts.push({
          rule: 'STEP-001',
          message: `Plan step ${step.id || step.description} marked complete but ${step.source_file} does not exist`,
          severity: 'medium',
          deterministic: false,
          created_at: now,
          source_file: step.source_file,
          cluster_id: `step-${Date.now()}`,
          consolidated: false,
        });
      }
    }
  }

  return alerts;
}

// ─── ruleConditionHolds ───────────────────────────────────────────────────────

/**
 * Re-evaluate a single rule's condition against current repo state.
 * Returns true if the alert condition still holds (alert should remain).
 * @param {string} rule
 * @param {string|null} sourceFile
 * @param {string} cwd
 * @returns {boolean}
 */
function ruleConditionHolds(rule, sourceFile, cwd) {
  switch (rule) {
    case 'SCOPE-001': {
      if (!sourceFile) return false;
      let checkpoint = null;
      try {
        const { loadLatestCheckpoint } = require('./checkpoint.js');
        if (typeof loadLatestCheckpoint === 'function') {
          checkpoint = loadLatestCheckpoint(cwd);
        }
      } catch {
        return false;
      }
      if (!checkpoint) return false;
      const inScopeFiles = Array.isArray(checkpoint.in_scope_files) ? checkpoint.in_scope_files : [];
      const inScopeDirs = Array.isArray(checkpoint.in_scope_dirs) ? checkpoint.in_scope_dirs : [];
      const normalizedFile = sourceFile.replace(/\\/g, '/');
      const inScope =
        inScopeFiles.some(f => f.replace(/\\/g, '/') === normalizedFile) ||
        inScopeDirs.some(d => {
          const dir = d.replace(/\\/g, '/').replace(/\/?$/, '/');
          return normalizedFile.startsWith(dir);
        });
      return !inScope;
    }

    case 'GOAL-001': {
      let checkpoint = null;
      try {
        const { loadLatestCheckpoint } = require('./checkpoint.js');
        if (typeof loadLatestCheckpoint === 'function') {
          checkpoint = loadLatestCheckpoint(cwd);
        }
      } catch {
        return false;
      }
      if (!checkpoint || typeof checkpoint.goal !== 'string') return false;
      const goalPath = path.join(cwd, '.keel', 'goal.yaml');
      const goalData = readYamlFile(goalPath);
      if (!goalData || typeof goalData.goal !== 'string') return false;
      return levenshteinRatio(goalData.goal, checkpoint.goal) > 0.20;
    }

    case 'VAL-004': {
      const unresolvedPath = path.join(cwd, 'unresolved-questions.yaml');
      try {
        const stat = fs.statSync(unresolvedPath);
        if (!stat.isFile() || stat.size === 0) return false;
        const content = fs.readFileSync(unresolvedPath, 'utf8').trim();
        if (!content || content === '[]' || content === 'null') return false;
        const parsed = parseYaml(content);
        return Array.isArray(parsed) ? parsed.length > 0 : parsed !== null;
      } catch {
        return false;
      }
    }

    case 'STEP-001': {
      if (!sourceFile) return false;
      let checkpoint = null;
      try {
        const { loadLatestCheckpoint } = require('./checkpoint.js');
        if (typeof loadLatestCheckpoint === 'function') {
          checkpoint = loadLatestCheckpoint(cwd);
        }
      } catch {
        return false;
      }
      if (!checkpoint || !Array.isArray(checkpoint.plan_steps)) return false;
      const step = checkpoint.plan_steps.find(s => s.source_file === sourceFile);
      if (!step || !step.completed) return false;
      try {
        const stat = fs.statSync(path.join(cwd, sourceFile));
        const checkpointTime = new Date(checkpoint.created_at).getTime();
        return stat.mtimeMs < checkpointTime;
      } catch {
        return true; // file missing — condition still holds
      }
    }

    default:
      return false;
  }
}

// ─── consolidateAlerts ────────────────────────────────────────────────────────

/**
 * Group alerts by cluster_id; replace clusters of ≥2 alerts within windowMs
 * with a single parent alert.
 * @param {object[]} alerts
 * @param {number} windowMs
 * @returns {object[]}
 */
function consolidateAlerts(alerts, windowMs) {
  if (!Array.isArray(alerts) || alerts.length === 0) return [];

  const now = Date.now();

  // Group by cluster_id
  const clusters = new Map();
  for (const alert of alerts) {
    const cid = alert.cluster_id || '__none__';
    if (!clusters.has(cid)) clusters.set(cid, []);
    clusters.get(cid).push(alert);
  }

  const result = [];

  for (const [clusterId, clusterAlerts] of clusters) {
    if (clusterAlerts.length < 2) {
      // No consolidation needed
      result.push(...clusterAlerts);
      continue;
    }

    // Check if all were generated within the window
    const oldest = Math.min(...clusterAlerts.map(a => new Date(a.created_at).getTime()));
    if ((now - oldest) > windowMs) {
      // Outside window — keep as-is
      result.push(...clusterAlerts);
      continue;
    }

    // Consolidate into a single parent alert
    const severities = clusterAlerts.map(a => a.severity);
    const anyDeterministic = clusterAlerts.some(a => a.deterministic === true);
    const childRules = clusterAlerts.map(a => a.rule);

    const parent = {
      rule: clusterAlerts[0].rule,
      message: `${clusterAlerts.length} related drift findings — session pivot detected`,
      severity: maxSeverity(severities),
      deterministic: anyDeterministic,
      created_at: new Date(now).toISOString(),
      source_file: null,
      cluster_id: clusterId,
      consolidated: true,
      child_count: clusterAlerts.length,
      child_rules: childRules,
    };

    result.push(parent);
  }

  return result;
}

// ─── appendAlertHistory ───────────────────────────────────────────────────────

/**
 * Append cleared alerts to .keel/session/alert-history.yaml.
 * @param {string} cwd
 * @param {object[]} clearedAlerts
 * @param {string} clearedReason - 'auto' | 'advance' | 'checkpoint'
 */
function appendAlertHistory(cwd, clearedAlerts, clearedReason) {
  if (!Array.isArray(clearedAlerts) || clearedAlerts.length === 0) return;

  const filePath = path.join(cwd, '.keel', 'session', 'alert-history.yaml');
  const clearedAt = new Date().toISOString();

  // Read existing history
  let existing = [];
  const raw = readYamlFile(filePath);
  if (Array.isArray(raw)) existing = raw;

  // Build new entries
  const newEntries = clearedAlerts.map(alert => ({
    rule: alert.rule,
    message: alert.message,
    cluster_id: alert.cluster_id,
    cleared_at: clearedAt,
    cleared_reason: clearedReason,
  }));

  const combined = existing.concat(newEntries);
  writeAtomic(filePath, stringifyYaml(combined));
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  readAlerts,
  writeAlerts,
  evaluateDriftRules,
  ruleConditionHolds,
  consolidateAlerts,
  appendAlertHistory,
  // Exported for testing
  levenshtein,
  levenshteinRatio,
};
