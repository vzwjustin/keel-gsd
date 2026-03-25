// scan.js — Scope manifest generation and goal reader
// Requirements: 6.3, 6.4
// Design: scan.js, Scope Manifest section, keel goal command
'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { parseYaml, stringifyYaml } = require('./yaml.js');
const { writeAtomic } = require('./atomic.js');
const { loadLatestCheckpoint } = require('./checkpoint.js');

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Normalize a path to use forward slashes.
 * @param {string} p
 * @returns {string}
 */
function normalizePath(p) {
  return p.replace(/\\/g, '/');
}

/**
 * Derive a glob pattern from a file path (e.g. "keel/bin/lib/scan.js" → "keel/**").
 * Returns the top-level directory glob, or the file itself if at root level.
 * @param {string} relPath - relative path from repo root
 * @returns {string}
 */
function toGlobPattern(relPath) {
  const normalized = normalizePath(relPath);
  const parts = normalized.split('/');
  if (parts.length === 1) return normalized;
  return parts[0] + '/**';
}

/**
 * Extract file references from a markdown file.
 * Looks for patterns like `path/to/file.ext` in code spans, links, and plain text.
 * @param {string} content
 * @returns {string[]}
 */
function extractFileRefsFromMarkdown(content) {
  const refs = new Set();

  // Code spans: `some/path/file.ext`
  const codeSpanRe = /`([^`\n]+\.[a-zA-Z][a-zA-Z0-9]*)`/g;
  let m;
  while ((m = codeSpanRe.exec(content)) !== null) {
    const candidate = m[1].trim();
    if (looksLikeFilePath(candidate)) refs.add(candidate);
  }

  // Markdown links: [text](path/to/file)
  const linkRe = /\[([^\]]*)\]\(([^)]+)\)/g;
  while ((m = linkRe.exec(content)) !== null) {
    const candidate = m[2].trim();
    if (looksLikeFilePath(candidate)) refs.add(candidate);
  }

  // Bare paths that look like file references (word/word/word.ext)
  const barePathRe = /\b([\w.-]+(?:\/[\w.-]+)+\.[a-zA-Z][a-zA-Z0-9]*)\b/g;
  while ((m = barePathRe.exec(content)) !== null) {
    const candidate = m[1].trim();
    if (looksLikeFilePath(candidate)) refs.add(candidate);
  }

  return Array.from(refs);
}

/**
 * Heuristic: does this string look like a relative file path?
 * @param {string} s
 * @returns {boolean}
 */
function looksLikeFilePath(s) {
  // Must contain a slash and a dot (extension), not start with http/https
  if (s.startsWith('http://') || s.startsWith('https://')) return false;
  if (!s.includes('/')) return false;
  if (!s.includes('.')) return false;
  // Avoid things like "e.g. foo/bar" — require at least one word char segment
  if (!/^[\w./-]+$/.test(s)) return false;
  return true;
}

/**
 * Collect glob patterns from .planning/*.md files by extracting file references.
 * @param {string} cwd
 * @returns {string[]} array of glob patterns
 */
function getPlanningFilePatterns(cwd) {
  const planningDir = path.join(cwd, '.planning');
  let files;
  try {
    files = fs.readdirSync(planningDir);
  } catch {
    return [];
  }

  const patterns = new Set();
  for (const file of files) {
    if (!file.endsWith('.md')) continue;
    const filePath = path.join(planningDir, file);
    let content;
    try {
      content = fs.readFileSync(filePath, 'utf8');
    } catch {
      continue;
    }
    const refs = extractFileRefsFromMarkdown(content);
    for (const ref of refs) {
      patterns.add(toGlobPattern(ref));
    }
  }

  return Array.from(patterns);
}

/**
 * Get recently git-modified files (HEAD~1..HEAD).
 * Returns [] if git is unavailable or the command fails.
 * @param {string} cwd
 * @returns {string[]}
 */
function getGitModifiedFiles(cwd) {
  try {
    const output = execSync('git diff --name-only HEAD~1 HEAD', {
      cwd,
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
    }).toString('utf8');
    return output
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 0);
  } catch {
    return [];
  }
}

/**
 * Known out-of-scope directories (documentation, assets, etc.)
 * These are added as out_of_scope entries when they exist in the repo.
 */
const KNOWN_OUT_OF_SCOPE_DIRS = [
  'docs',
  'assets',
  'node_modules',
  '.git',
];

// ─── scanScope ────────────────────────────────────────────────────────────────

/**
 * Walk the repo and infer scope from:
 *   1. Active checkpoint's in_scope_files and in_scope_dirs
 *   2. Directories containing those files
 *   3. Recent git-modified files (gracefully skipped if git unavailable)
 *   4. Files matching patterns in .planning/ phase task files
 *
 * Writes .keel/scope.yaml atomically.
 *
 * @param {string} cwd - repo root
 * @returns {{ in_scope: object[], out_of_scope: object[] }}
 */
function scanScope(cwd) {
  const inScopePatterns = new Map(); // pattern → reason

  // ── 1 & 2: Active checkpoint in_scope_files and their parent dirs ──────────
  const checkpoint = loadLatestCheckpoint(cwd);
  if (checkpoint) {
    const inScopeFiles = Array.isArray(checkpoint.in_scope_files) ? checkpoint.in_scope_files : [];
    const inScopeDirs = Array.isArray(checkpoint.in_scope_dirs) ? checkpoint.in_scope_dirs : [];

    for (const f of inScopeFiles) {
      const pattern = toGlobPattern(normalizePath(f));
      if (!inScopePatterns.has(pattern)) {
        inScopePatterns.set(pattern, 'active_plan');
      }
    }

    for (const d of inScopeDirs) {
      const normalized = normalizePath(d).replace(/\/?$/, '/**');
      if (!inScopePatterns.has(normalized)) {
        inScopePatterns.set(normalized, 'active_plan');
      }
    }
  }

  // Always include .keel/** as keel_state
  inScopePatterns.set('.keel/**', 'keel_state');

  // ── 3: Recent git-modified files ──────────────────────────────────────────
  const gitFiles = getGitModifiedFiles(cwd);
  for (const f of gitFiles) {
    const pattern = toGlobPattern(normalizePath(f));
    if (!inScopePatterns.has(pattern)) {
      inScopePatterns.set(pattern, 'related_component');
    }
  }

  // ── 4: .planning/ phase task file references ──────────────────────────────
  const planningPatterns = getPlanningFilePatterns(cwd);
  for (const pattern of planningPatterns) {
    if (!inScopePatterns.has(pattern)) {
      inScopePatterns.set(pattern, 'related_component');
    }
  }

  // ── Build in_scope array ──────────────────────────────────────────────────
  const inScope = [];
  for (const [pattern, reason] of inScopePatterns) {
    inScope.push({ pattern, reason });
  }

  // ── Build out_of_scope array ──────────────────────────────────────────────
  const outOfScope = [];
  for (const dir of KNOWN_OUT_OF_SCOPE_DIRS) {
    // Only add if the directory actually exists and is not already in scope
    const dirPath = path.join(cwd, dir);
    let exists = false;
    try {
      exists = fs.statSync(dirPath).isDirectory();
    } catch {
      // doesn't exist
    }
    if (exists) {
      const pattern = dir + '/**';
      const alreadyInScope = inScope.some(e => e.pattern === pattern);
      if (!alreadyInScope) {
        outOfScope.push({ pattern });
      }
    }
  }

  // ── Write scope.yaml atomically ───────────────────────────────────────────
  const scopeData = {
    scanned_at: new Date().toISOString(),
    root: '.',
    in_scope: inScope,
    out_of_scope: outOfScope,
  };

  const scopePath = path.join(cwd, '.keel', 'scope.yaml');
  writeAtomic(scopePath, stringifyYaml(scopeData));

  return { in_scope: inScope, out_of_scope: outOfScope };
}

// ─── readGoal ─────────────────────────────────────────────────────────────────

/**
 * Read the current goal from ROADMAP.md (looks for ## Goal or # Goal heading,
 * then extracts the next non-empty line). Falls back to .planning/ state files
 * if ROADMAP.md is absent.
 *
 * Writes .keel/goal.yaml atomically.
 *
 * @param {string} cwd - repo root
 * @returns {{ goal: string|null, source: string, phase: string|null }}
 */
function readGoal(cwd) {
  let goal = null;
  let source = null;
  let phase = null;

  // ── Try ROADMAP.md first ──────────────────────────────────────────────────
  const roadmapPath = path.join(cwd, 'ROADMAP.md');
  try {
    const content = fs.readFileSync(roadmapPath, 'utf8');
    const lines = content.split('\n');
    let foundGoalHeading = false;
    for (const line of lines) {
      if (foundGoalHeading) {
        const trimmed = line.trim();
        if (trimmed.length > 0) {
          // Strip leading markdown formatting (e.g. "**Goal:** text" or "> text")
          goal = trimmed
            .replace(/^\*\*[^*]+\*\*:?\s*/, '')
            .replace(/^>\s*/, '')
            .replace(/^\*+/, '')
            .trim();
          if (goal.length === 0) goal = trimmed;
          source = 'ROADMAP.md';
          break;
        }
      } else if (/^#{1,2}\s+Goal\b/i.test(line.trim())) {
        foundGoalHeading = true;
      }
    }
  } catch {
    // ROADMAP.md absent — fall through to .planning/
  }

  // ── Fallback: .planning/ state files ─────────────────────────────────────
  if (!goal) {
    const planningDir = path.join(cwd, '.planning');
    let planningFiles;
    try {
      planningFiles = fs.readdirSync(planningDir);
    } catch {
      planningFiles = [];
    }

    // Look for a file that might contain goal/phase info (e.g. state.yaml, config.yaml)
    const stateFiles = planningFiles.filter(f =>
      f.endsWith('.yaml') || f.endsWith('.yml') || f.endsWith('.json')
    );

    for (const file of stateFiles) {
      const filePath = path.join(planningDir, file);
      try {
        const content = fs.readFileSync(filePath, 'utf8').trim();
        if (!content) continue;
        const data = parseYaml(content);
        if (data && typeof data === 'object') {
          if (typeof data.goal === 'string' && data.goal.trim()) {
            goal = data.goal.trim();
            source = `.planning/${file}`;
            if (typeof data.phase === 'string') phase = data.phase;
            break;
          }
          // Also check for milestone/objective fields
          if (typeof data.milestone === 'string' && data.milestone.trim()) {
            goal = data.milestone.trim();
            source = `.planning/${file}`;
            break;
          }
        }
      } catch {
        continue;
      }
    }

    // Also scan .planning/*.md for a Goal heading
    if (!goal) {
      const mdFiles = planningFiles.filter(f => f.endsWith('.md'));
      for (const file of mdFiles) {
        if (file === 'KEEL-STATUS.md') continue;
        const filePath = path.join(planningDir, file);
        try {
          const content = fs.readFileSync(filePath, 'utf8');
          const lines = content.split('\n');
          let foundGoalHeading = false;
          for (const line of lines) {
            if (foundGoalHeading) {
              const trimmed = line.trim();
              if (trimmed.length > 0 && !trimmed.startsWith('#')) {
                goal = trimmed.replace(/^\*\*[^*]+\*\*:?\s*/, '').trim();
                if (goal.length === 0) goal = trimmed;
                source = `.planning/${file}`;
                break;
              }
            } else if (/^#{1,2}\s+Goal\b/i.test(line.trim())) {
              foundGoalHeading = true;
            }
          }
          if (goal) break;
        } catch {
          continue;
        }
      }
    }
  }

  // ── Try to extract phase from active checkpoint ───────────────────────────
  if (!phase) {
    const checkpoint = loadLatestCheckpoint(cwd);
    if (checkpoint && typeof checkpoint.phase === 'string') {
      phase = checkpoint.phase;
    }
  }

  // ── Write goal.yaml atomically ────────────────────────────────────────────
  const goalData = {
    goal: goal || null,
    source: source || null,
    phase: phase || null,
    captured_at: new Date().toISOString(),
  };

  const goalPath = path.join(cwd, '.keel', 'goal.yaml');
  writeAtomic(goalPath, stringifyYaml(goalData));

  return { goal: goal || null, source: source || null, phase: phase || null };
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = { scanScope, readGoal };
