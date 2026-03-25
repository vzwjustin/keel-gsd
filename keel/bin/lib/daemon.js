// daemon.js — Process Lifecycle (Companion Daemon)
// Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 2.1, 2.2, 2.3, 2.4, 8.4
'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { parseYaml, stringifyYaml } = require('./yaml.js');
const { writeAtomic } = require('./atomic.js');
const { evaluateDriftRules, ruleConditionHolds, consolidateAlerts, writeAlerts, readAlerts, appendAlertHistory } = require('./alerts.js');
const { writeKeelStatus } = require('./status.js');

// Path to keel.js entry point (resolved relative to this file's location)
const keelJsPath = path.resolve(__dirname, '..', 'keel.js');

// Heartbeat file path helper
function heartbeatPath(cwd) {
  return path.join(cwd, '.keel', 'session', 'companion-heartbeat.yaml');
}

// ─── readHeartbeat ────────────────────────────────────────────────────────────

/**
 * Read the heartbeat YAML file. Returns null if absent or unparseable.
 * @param {string} cwd
 * @returns {object|null}
 */
function readHeartbeat(cwd) {
  try {
    const text = fs.readFileSync(heartbeatPath(cwd), 'utf8').trim();
    if (!text) return null;
    return parseYaml(text);
  } catch {
    return null;
  }
}

// ─── writeHeartbeat ───────────────────────────────────────────────────────────

/**
 * Write heartbeat atomically.
 * @param {string} cwd
 * @param {object} data
 */
function writeHeartbeat(cwd, data) {
  writeAtomic(heartbeatPath(cwd), stringifyYaml(data));
}

// ─── isProcessAlive ───────────────────────────────────────────────────────────

/**
 * Check if a process with the given PID is alive.
 * Uses process.kill(pid, 0) — throws if process doesn't exist.
 * @param {number} pid
 * @returns {boolean}
 */
function isProcessAlive(pid) {
  if (!pid || typeof pid !== 'number') return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// ─── startDaemon ─────────────────────────────────────────────────────────────

/**
 * Start the companion daemon. Returns immediately after fork.
 * Throws (and prints to stderr) if .keel/ does not exist.
 * Idempotent: exits 0 if daemon is already running.
 * @param {string} cwd
 */
function startDaemon(cwd) {
  const keelDir = path.join(cwd, '.keel');

  // Requirement 1.8: check .keel/ exists
  if (!fs.existsSync(keelDir)) {
    const msg = 'keel not initialized — run: keel install';
    process.stderr.write(msg + '\n');
    throw new Error(msg);
  }

  // Requirement 1.2: idempotent — check if already running
  const heartbeat = readHeartbeat(cwd);
  if (heartbeat && heartbeat.pid && isProcessAlive(heartbeat.pid)) {
    // Already running — exit 0 silently
    return;
  }

  // Spawn detached child process
  const child = spawn(process.execPath, [keelJsPath, '--daemon'], {
    detached: true,
    stdio: 'ignore',
    cwd,
  });

  // Write a preliminary heartbeat with the child PID so subsequent
  // startDaemon calls see it and skip spawning (prevents race condition
  // when startDaemon is called rapidly before the daemon writes its own heartbeat).
  try {
    writeHeartbeat(cwd, {
      running: true,
      pid: child.pid,
      last_beat_at: new Date().toISOString(),
      started_at: new Date().toISOString(),
      version: '1.0.0',
    });
  } catch {
    // Non-fatal: daemon will write its own heartbeat shortly
  }

  // Unref so parent exits immediately
  child.unref();
}

// ─── stopDaemon ───────────────────────────────────────────────────────────────

/**
 * Stop the companion daemon via SIGTERM.
 * Waits up to 2 seconds for the process to exit.
 * Writes running: false to heartbeat file.
 * Idempotent if not running.
 * @param {string} cwd
 * @returns {Promise<void>}
 */
async function stopDaemon(cwd) {
  const heartbeat = readHeartbeat(cwd);

  if (!heartbeat || !heartbeat.pid) {
    // No PID — nothing to stop
    return;
  }

  const pid = heartbeat.pid;

  if (!isProcessAlive(pid)) {
    // Process already gone — update heartbeat and return
    writeHeartbeat(cwd, Object.assign({}, heartbeat, { running: false }));
    return;
  }

  // Send SIGTERM
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    // Process may have already exited between the check and the kill
  }

  // Wait up to 2 seconds for process to exit
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }

  // Write running: false to heartbeat (Requirement 2.3: preserve last_beat_at)
  const updated = Object.assign({}, heartbeat, { running: false });
  writeHeartbeat(cwd, updated);
}

// ─── getStatus ────────────────────────────────────────────────────────────────

/**
 * Read heartbeat and return status object.
 * @param {string} cwd
 * @returns {{ running: boolean, pid: number|null, last_beat_at: string|null, stale: boolean }}
 */
function getStatus(cwd) {
  const heartbeat = readHeartbeat(cwd);

  if (!heartbeat) {
    return { running: false, pid: null, last_beat_at: null, stale: false };
  }

  const running = heartbeat.running === true;
  const pid = typeof heartbeat.pid === 'number' ? heartbeat.pid : null;
  const last_beat_at = heartbeat.last_beat_at || null;

  // Staleness: age > 30s
  let stale = false;
  if (last_beat_at) {
    const age = Date.now() - new Date(last_beat_at).getTime();
    stale = age > 30_000;
  }

  return { running, pid, last_beat_at, stale };
}

// ─── Debounce state ───────────────────────────────────────────────────────────

const debounceTimers = new Map();

/**
 * Returns true if the filePath is currently debounced (should be skipped).
 * Marks the path as debounced for debouncMs.
 * @param {string} filePath
 * @param {number} debounceMs
 * @returns {boolean}
 */
function isDebounced(filePath, debounceMs) {
  if (debounceTimers.has(filePath)) return true;
  const timer = setTimeout(() => debounceTimers.delete(filePath), debounceMs);
  // Allow the timer to be garbage collected without blocking the event loop
  if (timer.unref) timer.unref();
  debounceTimers.set(filePath, timer);
  return false;
}

// ─── watchCycle ───────────────────────────────────────────────────────────────

/**
 * Process a file change event: evaluate drift rules, auto-clear stale alerts,
 * consolidate, write alerts.yaml atomically, refresh KEEL-STATUS.md if changed.
 * Exported for testing.
 * @param {string} cwd
 * @param {string} filePath - relative path from cwd
 */
function watchCycle(cwd, filePath) {
  // Only evaluate drift if the file was actually modified (mtime newer than checkpoint).
  // fs.watch on macOS fires for reads/access too — skip those to avoid false alerts
  // during exploration/mapping workflows.
  let checkpoint = null;
  try {
    checkpoint = require('./checkpoint.js').loadLatestCheckpoint(cwd);
  } catch { /* not available */ }

  if (checkpoint) {
    const checkpointTime = new Date(checkpoint.created_at).getTime();
    try {
      const stat = fs.statSync(path.join(cwd, filePath));
      if (stat.mtimeMs <= checkpointTime) {
        // File not actually modified since checkpoint — skip drift evaluation
        return;
      }
    } catch {
      // File may have been deleted — still evaluate
    }
  }

  // Evaluate drift rules for the changed file
  const newAlerts = evaluateDriftRules(cwd, filePath);

  // Read current alerts
  const currentAlerts = readAlerts(cwd);

  // Auto-clear stale alerts: re-evaluate each existing alert's condition
  const clearedAlerts = [];
  const stillActiveAlerts = [];
  for (const alert of currentAlerts) {
    if (ruleConditionHolds(alert.rule, alert.source_file, cwd)) {
      stillActiveAlerts.push(alert);
    } else {
      clearedAlerts.push(alert);
    }
  }

  // Append cleared alerts to history
  if (clearedAlerts.length > 0) {
    appendAlertHistory(cwd, clearedAlerts, 'auto');
  }

  // Merge still-active + new alerts, deduplicating by (rule, source_file)
  // to prevent the same file from generating duplicate SCOPE-001 alerts
  // on every watch cycle
  const seen = new Set();
  for (const alert of stillActiveAlerts) {
    const key = `${alert.rule}:${alert.source_file || ''}`;
    seen.add(key);
  }
  const dedupedNew = newAlerts.filter(alert => {
    const key = `${alert.rule}:${alert.source_file || ''}`;
    return !seen.has(key);
  });

  const merged = stillActiveAlerts.concat(dedupedNew);
  const finalAlerts = consolidateAlerts(merged, 10_000);

  // Write updated alerts.yaml atomically
  writeAlerts(cwd, finalAlerts);

  // Refresh KEEL-STATUS.md if alert state changed
  const alertStateChanged =
    clearedAlerts.length > 0 ||
    dedupedNew.length > 0 ||
    finalAlerts.length !== currentAlerts.length;

  if (alertStateChanged) {
    try {
      writeKeelStatus(cwd);
    } catch {
      // Non-fatal: .planning/ may not exist
    }
  }
}

// ─── runDaemonLoop ────────────────────────────────────────────────────────────

/**
 * Daemon entry point. Called when process.argv includes '--daemon'.
 * Writes initial heartbeat, starts fs.watch, runs heartbeat setInterval.
 * @param {string} cwd
 */
function runDaemonLoop(cwd) {
  const now = new Date().toISOString();

  // Write initial heartbeat (Requirement 1.1, 2.1)
  writeHeartbeat(cwd, {
    running: true,
    pid: process.pid,
    started_at: now,
    last_beat_at: now,
    version: '1.0.0',
  });

  // Write initial KEEL-STATUS.md before first watch cycle (Requirement 12.3)
  try {
    writeKeelStatus(cwd);
  } catch {
    // Non-fatal: .planning/ may not exist
  }

  // ── File watcher ──────────────────────────────────────────────────────────

  const IGNORE_PREFIXES = ['.keel/', '.git/', 'node_modules/'];

  function handleFileEvent(eventType, filename) {
    if (!filename) return;

    // Normalize path separators
    const relPath = filename.replace(/\\/g, '/');

    // Ignore keel state files, git, node_modules
    if (IGNORE_PREFIXES.some(prefix => relPath.startsWith(prefix))) return;

    // Debounce: 500ms per file path
    if (isDebounced(relPath, 500)) return;

    try {
      watchCycle(cwd, relPath);
    } catch {
      // Non-fatal: watch cycle errors should not crash the daemon
    }
  }

  // Try recursive watch; fall back to per-directory watch on unsupported platforms (Linux)
  try {
    fs.watch(cwd, { recursive: true }, handleFileEvent);
  } catch (err) {
    // Fallback: watch each top-level directory individually
    process.stderr.write(`[keel] fs.watch recursive not supported, falling back to per-directory watch: ${err.message}\n`);
    try {
      const entries = fs.readdirSync(cwd, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const name = entry.name;
        if (name === '.git' || name === 'node_modules' || name === '.keel') continue;
        try {
          fs.watch(path.join(cwd, name), { recursive: false }, (eventType, filename) => {
            if (!filename) return;
            handleFileEvent(eventType, name + '/' + filename);
          });
        } catch {
          // Skip directories that can't be watched
        }
      }
      // Also watch the root (non-recursive) for top-level file changes
      fs.watch(cwd, { recursive: false }, (eventType, filename) => {
        if (!filename) return;
        handleFileEvent(eventType, filename);
      });
    } catch {
      // If even the fallback fails, continue without file watching
      process.stderr.write('[keel] Warning: file watching unavailable\n');
    }
  }

  // ── Heartbeat interval (every 15s) ────────────────────────────────────────

  const heartbeatInterval = setInterval(() => {
    try {
      const existing = readHeartbeat(cwd) || {};
      const beatAt = new Date().toISOString();
      writeHeartbeat(cwd, Object.assign({}, existing, {
        running: true,
        pid: process.pid,
        last_beat_at: beatAt,
      }));

      // Requirement 8.4: refresh KEEL-STATUS.md if alert state has changed
      // (We refresh on every heartbeat to keep it current)
      try {
        writeKeelStatus(cwd);
      } catch {
        // Non-fatal
      }
    } catch {
      // Non-fatal: heartbeat write errors should not crash the daemon
    }
  }, 15_000);

  // Allow the process to exit naturally if nothing else keeps it alive
  // (the fs.watch watcher keeps the event loop alive)
  if (heartbeatInterval.unref) {
    // Don't unref — we want the interval to keep the daemon alive
    // heartbeatInterval.unref();
  }

  // Handle graceful shutdown
  process.on('SIGTERM', () => {
    clearInterval(heartbeatInterval);
    try {
      const existing = readHeartbeat(cwd) || {};
      writeHeartbeat(cwd, Object.assign({}, existing, { running: false }));
    } catch {
      // Best effort
    }
    process.exit(0);
  });
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  startDaemon,
  stopDaemon,
  getStatus,
  runDaemonLoop,
  // Exported for testing
  watchCycle,
};
