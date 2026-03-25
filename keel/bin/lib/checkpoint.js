// checkpoint.js — Checkpoint Store (read/write/diff)
// Requirements: 6.1, 6.5, 7.3
'use strict';

const fs = require('fs');
const path = require('path');
const { parseYaml, stringifyYaml } = require('./yaml.js');
const { writeAtomic } = require('./atomic.js');

// ─── Levenshtein Distance (inline, no external deps) ─────────────────────────

function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
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

function levenshteinRatio(a, b) {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 0;
  return levenshtein(a, b) / maxLen;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Format a Date as YYYY-MM-DDTHH-MM-SS (colons replaced with dashes).
 * @param {Date} date
 * @returns {string}
 */
function formatTimestamp(date) {
  return date.toISOString()
    .replace(/\.\d{3}Z$/, '')   // strip milliseconds and Z
    .replace(/:/g, '-');         // replace colons with dashes
}

/**
 * Recursively collect all file paths under dir, skipping ignored dirs.
 * Returns paths relative to rootDir.
 * @param {string} dir - absolute path to walk
 * @param {string} rootDir - absolute repo root (for relative path computation)
 * @param {string[]} results - accumulator
 * @returns {string[]}
 */
function walkFiles(dir, rootDir, results) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    const name = entry.name;
    // Skip ignored directories
    if (entry.isDirectory()) {
      if (name === '.git' || name === 'node_modules' || name === '.keel') continue;
      walkFiles(path.join(dir, name), rootDir, results);
    } else if (entry.isFile()) {
      results.push(path.relative(rootDir, path.join(dir, name)));
    }
  }
  return results;
}

// ─── writeCheckpoint ─────────────────────────────────────────────────────────

/**
 * Write a new checkpoint snapshot to .keel/checkpoints/<YYYY-MM-DDTHH-MM-SS>.yaml.
 * @param {string} cwd
 * @param {{ goal: string, phase: string, in_scope_files: string[], in_scope_dirs: string[], plan_steps: object[] }} data
 */
function writeCheckpoint(cwd, data) {
  const now = new Date();
  const filename = formatTimestamp(now) + '.yaml';
  const filePath = path.join(cwd, '.keel', 'checkpoints', filename);

  const record = {
    created_at: now.toISOString(),
    goal: data.goal || null,
    phase: data.phase || null,
    in_scope_files: Array.isArray(data.in_scope_files) ? data.in_scope_files : [],
    in_scope_dirs: Array.isArray(data.in_scope_dirs) ? data.in_scope_dirs : [],
    plan_steps: Array.isArray(data.plan_steps) ? data.plan_steps : [],
  };

  // Optional git context fields
  if (data.branch) record.branch = data.branch;
  if (data.git_commit) record.git_commit = data.git_commit;

  writeAtomic(filePath, stringifyYaml(record));
}

// ─── loadLatestCheckpoint ─────────────────────────────────────────────────────

/**
 * Load the most recent checkpoint from .keel/checkpoints/.
 * Returns null if the directory is absent or empty.
 * @param {string} cwd
 * @returns {object|null}
 */
function loadLatestCheckpoint(cwd) {
  const dir = path.join(cwd, '.keel', 'checkpoints');

  let files;
  try {
    files = fs.readdirSync(dir);
  } catch {
    return null;
  }

  // Keep only .yaml files and sort lexicographically (timestamp names sort correctly)
  const yamlFiles = files
    .filter(f => f.endsWith('.yaml'))
    .sort();

  if (yamlFiles.length === 0) return null;

  const latest = yamlFiles[yamlFiles.length - 1];
  const filePath = path.join(dir, latest);

  try {
    const text = fs.readFileSync(filePath, 'utf8').trim();
    if (!text) return null;
    return parseYaml(text);
  } catch {
    return null;
  }
}

// ─── computeDrift ─────────────────────────────────────────────────────────────

/**
 * Compute drift between current repo state and a checkpoint.
 * @param {string} cwd
 * @param {object} checkpoint
 * @returns {{ drifted: boolean, alerts: object[], blockers: object[] }}
 */
function computeDrift(cwd, checkpoint) {
  const alerts = [];
  const now = new Date().toISOString();
  const checkpointTime = new Date(checkpoint.created_at).getTime();

  const inScopeFiles = Array.isArray(checkpoint.in_scope_files) ? checkpoint.in_scope_files : [];
  const inScopeDirs = Array.isArray(checkpoint.in_scope_dirs) ? checkpoint.in_scope_dirs : [];

  // ── Find files modified since checkpoint ──────────────────────────────────
  const allFiles = walkFiles(cwd, cwd, []);

  for (const relFile of allFiles) {
    let stat;
    try {
      stat = fs.statSync(path.join(cwd, relFile));
    } catch {
      continue;
    }

    if (stat.mtimeMs <= checkpointTime) continue;

    // File was modified after checkpoint — check if it's in scope
    const normalizedFile = relFile.replace(/\\/g, '/');
    const inScope =
      inScopeFiles.some(f => f.replace(/\\/g, '/') === normalizedFile) ||
      inScopeDirs.some(d => {
        const dir = d.replace(/\\/g, '/').replace(/\/?$/, '/');
        return normalizedFile.startsWith(dir);
      });

    if (!inScope) {
      alerts.push({
        rule: 'SCOPE-001',
        message: `File ${relFile} is outside active plan scope`,
        severity: 'high',
        deterministic: true,
        created_at: now,
        source_file: relFile,
        cluster_id: `pivot-${Date.now()}`,
        consolidated: false,
      });
    }
  }

  // ── Check goal drift ──────────────────────────────────────────────────────
  if (typeof checkpoint.goal === 'string') {
    const goalPath = path.join(cwd, '.keel', 'goal.yaml');
    try {
      const text = fs.readFileSync(goalPath, 'utf8').trim();
      if (text) {
        const goalData = parseYaml(text);
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
    } catch {
      // goal.yaml absent — skip
    }
  }

  // ── Check VAL-004 ─────────────────────────────────────────────────────────
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

  const blockers = alerts.filter(a => a.deterministic === true);

  return {
    drifted: alerts.length > 0,
    alerts,
    blockers,
  };
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  writeCheckpoint,
  loadLatestCheckpoint,
  computeDrift,
  // Exported for testing
  levenshtein,
  levenshteinRatio,
  formatTimestamp,
};
