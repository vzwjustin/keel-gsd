#!/usr/bin/env node
// keel.js — Entry Point and Command Router
// Requirements: 1.1–1.5, 2.5, 2.6, 3.4, 4.4, 6.1–6.7, 7.1–7.6
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

// ─── Resolve lib modules lazily to avoid circular issues ─────────────────────

function daemon()     { return require('./lib/daemon.js'); }
function alerts()     { return require('./lib/alerts.js'); }
function checkpoint() { return require('./lib/checkpoint.js'); }
function scan()       { return require('./lib/scan.js'); }
function status()     { return require('./lib/status.js'); }
function yaml()       { return require('./lib/yaml.js'); }

// ─── Helpers ──────────────────────────────────────────────────────────────────

const cwd = process.cwd();

function die(msg, code = 1) {
  process.stderr.write(msg + '\n');
  process.exit(code);
}

function keelDir() {
  return path.join(cwd, '.keel');
}

function requireKeelDir() {
  if (!fs.existsSync(keelDir())) {
    die('keel not initialized — run: keel install');
  }
}

// ─── keel companion ───────────────────────────────────────────────────────────

function cmdCompanionStart() {
  try {
    requireKeelDir();
    daemon().startDaemon(cwd);
    process.exit(0);
  } catch (err) {
    die(err.message || String(err));
  }
}

async function cmdCompanionStop() {
  try {
    await daemon().stopDaemon(cwd);
    process.exit(0);
  } catch (err) {
    die(err.message || String(err));
  }
}

function cmdCompanionStatus() {
  try {
    const s = daemon().getStatus(cwd);
    const running = s.running === true;
    const staleNote = s.stale ? ' (stale)' : '';
    process.stdout.write(`running: ${running}\n`);
    if (s.last_beat_at) {
      process.stdout.write(`last_beat_at: ${s.last_beat_at}${staleNote}\n`);
    }
    process.exit(0);
  } catch (err) {
    die(err.message || String(err));
  }
}

// ─── keel checkpoint ──────────────────────────────────────────────────────────

function cmdCheckpoint() {
  try {
    requireKeelDir();

    // Load goal and scope for the snapshot
    const goalPath = path.join(cwd, '.keel', 'goal.yaml');
    let goalData = null;
    try {
      const text = fs.readFileSync(goalPath, 'utf8').trim();
      if (text) goalData = yaml().parseYaml(text);
    } catch { /* absent */ }

    const scopePath = path.join(cwd, '.keel', 'scope.yaml');
    let scopeData = null;
    try {
      const text = fs.readFileSync(scopePath, 'utf8').trim();
      if (text) scopeData = yaml().parseYaml(text);
    } catch { /* absent */ }

    // Build in_scope_files and in_scope_dirs from scope.yaml
    const inScopeFiles = [];
    const inScopeDirs = [];
    if (scopeData && Array.isArray(scopeData.in_scope)) {
      for (const entry of scopeData.in_scope) {
        const pattern = entry.pattern || '';
        if (pattern.endsWith('/**')) {
          inScopeDirs.push(pattern.slice(0, -3));
        } else {
          inScopeFiles.push(pattern);
        }
      }
    }

    // Load existing checkpoint for plan_steps continuity
    const existing = checkpoint().loadLatestCheckpoint(cwd);
    const planSteps = existing && Array.isArray(existing.plan_steps) ? existing.plan_steps : [];

    checkpoint().writeCheckpoint(cwd, {
      goal: (goalData && goalData.goal) || null,
      phase: (goalData && goalData.phase) || (existing && existing.phase) || null,
      in_scope_files: inScopeFiles,
      in_scope_dirs: inScopeDirs,
      plan_steps: planSteps,
    });

    // Clear cluster alerts (checkpoint clears all current alerts)
    const currentAlerts = alerts().readAlerts(cwd);
    if (currentAlerts.length > 0) {
      alerts().appendAlertHistory(cwd, currentAlerts, 'checkpoint');
      alerts().writeAlerts(cwd, []);
    }

    // Refresh KEEL-STATUS.md
    try { status().writeKeelStatus(cwd); } catch { /* .planning/ may not exist */ }

    process.stdout.write('✓ checkpoint written\n');
    process.exit(0);
  } catch (err) {
    die(`checkpoint error: ${err.message || err}`, 1);
  }
}

// ─── keel drift ───────────────────────────────────────────────────────────────

function cmdDrift(flags) {
  try {
    requireKeelDir();

    const cp = checkpoint().loadLatestCheckpoint(cwd);
    if (!cp) {
      if (flags.json) {
        process.stdout.write(JSON.stringify({ drifted: false, alerts: [], blockers: [] }) + '\n');
        process.exit(0);
      }
      process.stdout.write('No checkpoint found — run: keel checkpoint\n');
      process.exit(0);
    }

    const result = checkpoint().computeDrift(cwd, cp);

    if (flags.json) {
      process.stdout.write(JSON.stringify({
        drifted: result.drifted,
        alerts: result.alerts,
        blockers: result.blockers,
      }) + '\n');
      process.exit(result.drifted ? 1 : 0);
    }

    // Human report
    if (!result.drifted) {
      process.stdout.write('✓ clean — no drift detected\n');
      process.exit(0);
    }

    process.stdout.write(`drift detected — ${result.alerts.length} finding(s)\n\n`);

    for (const alert of result.alerts) {
      const consolidated = alert.consolidated ? ` [${alert.child_count} consolidated]` : '';
      process.stdout.write(`  [${alert.severity}] ${alert.rule}: ${alert.message}${consolidated}\n`);

      // --verbose: expand consolidated alerts to show children
      if (flags.verbose && alert.consolidated && Array.isArray(alert.child_rules)) {
        for (const childRule of alert.child_rules) {
          process.stdout.write(`    - ${childRule}\n`);
        }
      }
    }

    if (result.blockers.length > 0) {
      process.stdout.write('\nblockers:\n');
      for (const b of result.blockers) {
        process.stdout.write(`  • ${b.rule}: ${b.message}\n`);
      }
    }

    process.exit(1);
  } catch (err) {
    die(`drift error: ${err.message || err}`, 2);
  }
}

// ─── keel done ────────────────────────────────────────────────────────────────

function cmdDone(flags) {
  try {
    requireKeelDir();

    const { doneGate } = require('./lib/done.js');
    const result = doneGate(cwd);

    if (flags.json) {
      process.stdout.write(JSON.stringify({ passed: result.passed, reason: result.reason, blockers: result.blockers }) + '\n');
      process.exit(result.passed ? 0 : 1);
    }

    if (result.passed) {
      process.stdout.write('✓ done-gate passed\n');
      process.exit(0);
    } else {
      process.stdout.write(`✗ done-gate blocked\n\n`);
      for (const b of result.blockers) {
        process.stdout.write(`  [${b.check}] ${b.message}\n`);
      }
      process.exit(1);
    }
  } catch (err) {
    die(`done-gate error: ${err.message || err}`, 2);
  }
}

// ─── keel goal ────────────────────────────────────────────────────────────────

function cmdGoal() {
  try {
    requireKeelDir();
    const result = scan().readGoal(cwd);
    if (result.goal) {
      process.stdout.write(`goal: ${result.goal}\n`);
      process.stdout.write(`source: ${result.source}\n`);
    } else {
      process.stdout.write('No goal found in ROADMAP.md or .planning/ state\n');
    }
    try { status().writeKeelStatus(cwd); } catch { /* .planning/ may not exist */ }
    process.exit(result.goal ? 0 : 1);
  } catch (err) {
    die(`goal error: ${err.message || err}`, 1);
  }
}

// ─── keel scan ────────────────────────────────────────────────────────────────

function cmdScan() {
  try {
    requireKeelDir();
    const result = scan().scanScope(cwd);
    process.stdout.write(`✓ scope.yaml written — ${result.in_scope.length} in-scope pattern(s)\n`);
    try { status().writeKeelStatus(cwd); } catch { /* .planning/ may not exist */ }
    process.exit(0);
  } catch (err) {
    die(`scan error: ${err.message || err}`, 1);
  }
}

// ─── keel advance ─────────────────────────────────────────────────────────────

function cmdAdvance() {
  try {
    requireKeelDir();

    // 1. Load latest checkpoint
    const cp = checkpoint().loadLatestCheckpoint(cwd);
    if (!cp) {
      die('No checkpoint found — run: keel checkpoint first', 1);
    }

    // 2. Find first incomplete plan step
    const planSteps = Array.isArray(cp.plan_steps) ? cp.plan_steps : [];
    const stepIndex = planSteps.findIndex(s => !s.completed);
    if (stepIndex === -1) {
      process.stdout.write('All plan steps are already complete\n');
      process.exit(0);
    }

    const step = planSteps[stepIndex];

    // 3. Mark it completed: true
    planSteps[stepIndex] = Object.assign({}, step, { completed: true });

    // 4. Write updated checkpoint (new timestamp)
    checkpoint().writeCheckpoint(cwd, {
      goal: cp.goal,
      phase: cp.phase,
      in_scope_files: cp.in_scope_files || [],
      in_scope_dirs: cp.in_scope_dirs || [],
      plan_steps: planSteps,
    });

    // 5 & 6. Clear all alerts with cluster_id matching that step; append to history
    const stepId = step.id || step.description || String(stepIndex);
    const currentAlerts = alerts().readAlerts(cwd);
    const stepAlerts = currentAlerts.filter(a => a.cluster_id && a.cluster_id.includes(stepId));
    const remainingAlerts = currentAlerts.filter(a => !a.cluster_id || !a.cluster_id.includes(stepId));

    if (stepAlerts.length > 0) {
      alerts().appendAlertHistory(cwd, stepAlerts, 'advance');
    }
    alerts().writeAlerts(cwd, remainingAlerts);

    // 7. Refresh KEEL-STATUS.md
    try { status().writeKeelStatus(cwd); } catch { /* .planning/ may not exist */ }

    // 8. Print confirmation
    process.stdout.write(`✓ Step ${stepId} marked complete\n`);
    process.exit(0);
  } catch (err) {
    die(`advance error: ${err.message || err}`, 1);
  }
}

// ─── keel watch ───────────────────────────────────────────────────────────────

function cmdWatch() {
  try {
    requireKeelDir();

    process.stdout.write('keel watch — watching for drift events (Ctrl+C to stop)\n');

    const IGNORE_PREFIXES = ['.keel/', '.git/', 'node_modules/'];
    const debounceTimers = new Map();

    function handleEvent(_eventType, filename) {
      if (!filename) return;
      const relPath = filename.replace(/\\/g, '/');
      if (IGNORE_PREFIXES.some(p => relPath.startsWith(p))) return;

      // Debounce 500ms
      if (debounceTimers.has(relPath)) return;
      const timer = setTimeout(() => debounceTimers.delete(relPath), 500);
      if (timer.unref) timer.unref();
      debounceTimers.set(relPath, timer);

      // Evaluate drift for this file
      try {
        const newAlerts = alerts().evaluateDriftRules(cwd, relPath);
        if (newAlerts.length > 0) {
          const ts = new Date().toISOString();
          for (const alert of newAlerts) {
            process.stdout.write(`[${ts}] ${alert.rule}: ${alert.message}\n`);
          }
        } else {
          const ts = new Date().toISOString();
          process.stdout.write(`[${ts}] change: ${relPath} (in scope)\n`);
        }
      } catch (err) {
        process.stderr.write(`watch error: ${err.message}\n`);
      }
    }

    try {
      fs.watch(cwd, { recursive: true }, handleEvent);
    } catch {
      // Fallback: watch top-level dirs individually
      const entries = fs.readdirSync(cwd, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const name = entry.name;
        if (name === '.git' || name === 'node_modules' || name === '.keel') continue;
        try {
          fs.watch(path.join(cwd, name), { recursive: false }, (evt, fn) => {
            if (fn) handleEvent(evt, name + '/' + fn);
          });
        } catch { /* skip */ }
      }
      fs.watch(cwd, { recursive: false }, handleEvent);
    }

    // Handle SIGINT for clean exit (exit 0)
    process.on('SIGINT', () => {
      process.stdout.write('\nkeel watch stopped\n');
      process.exit(0);
    });

  } catch (err) {
    die(`watch error: ${err.message || err}`, 1);
  }
}

// ─── keel init ────────────────────────────────────────────────────────────────

function cmdInit() {
  try {
    const keelDirPath = keelDir();
    const sessionDir = path.join(keelDirPath, 'session');
    const checkpointsDir = path.join(keelDirPath, 'checkpoints');

    fs.mkdirSync(sessionDir, { recursive: true });
    fs.mkdirSync(checkpointsDir, { recursive: true });

    // Write keel.yaml with defaults
    const keelYamlPath = path.join(keelDirPath, 'keel.yaml');
    if (!fs.existsSync(keelYamlPath)) {
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
      const { writeAtomic } = require('./lib/atomic.js');
      writeAtomic(keelYamlPath, yaml().stringifyYaml(defaults));
    }

    // Add .keel/session/ to .gitignore if not already present
    const gitignorePath = path.join(cwd, '.gitignore');
    const gitignoreEntry = '.keel/session/';
    try {
      let content = '';
      try { content = fs.readFileSync(gitignorePath, 'utf8'); } catch { /* absent */ }
      if (!content.includes(gitignoreEntry)) {
        const append = (content.endsWith('\n') || content === '' ? '' : '\n') + gitignoreEntry + '\n';
        fs.appendFileSync(gitignorePath, append, 'utf8');
      }
    } catch { /* non-fatal */ }

    process.stdout.write('✓ keel initialized\n');
    process.stdout.write(`  .keel/session/       created\n`);
    process.stdout.write(`  .keel/checkpoints/   created\n`);
    process.stdout.write(`  .keel/keel.yaml      written\n`);
    process.exit(0);
  } catch (err) {
    die(`init error: ${err.message || err}`, 1);
  }
}

// ─── keel install ─────────────────────────────────────────────────────────────

async function runInstall(flags) {
  try {
    const keelDirPath = keelDir();

    if (flags.link) {
      const binSrc = path.resolve(__filename);
      const home = process.env.HOME || os.homedir();
      const targets = [
        '/usr/local/bin/keel',
        path.join(home, '.local', 'bin', 'keel'),
        path.join(home, 'bin', 'keel'),
      ];
      let linked = false;
      for (const target of targets) {
        try {
          fs.mkdirSync(path.dirname(target), { recursive: true });
          try { fs.unlinkSync(target); } catch { /* not present */ }
          fs.symlinkSync(binSrc, target);
          process.stdout.write(`✓ keel linked at ${target}\n`);
          linked = true;
          break;
        } catch { /* try next */ }
      }
      if (!linked) {
        die('Could not create symlink in /usr/local/bin, ~/.local/bin, or ~/bin — check permissions', 1);
      }
      process.exit(0);
    }

    // Idempotency check
    if (fs.existsSync(keelDirPath)) {
      process.stdout.write('keel is already installed — .keel/ exists\n');
      process.stdout.write('  Next: keel companion start\n');
      process.exit(0);
    }

    // 1. Create .keel/ structure
    const sessionDir = path.join(keelDirPath, 'session');
    const checkpointsDir = path.join(keelDirPath, 'checkpoints');
    try {
      fs.mkdirSync(sessionDir, { recursive: true });
      fs.mkdirSync(checkpointsDir, { recursive: true });
    } catch (err) {
      die(`install error: cannot create .keel/ — ${err.message}`, 1);
    }

    // 2. Write keel.yaml
    const keelYamlPath = path.join(keelDirPath, 'keel.yaml');
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
    const { writeAtomic } = require('./lib/atomic.js');
    writeAtomic(keelYamlPath, yaml().stringifyYaml(defaults));

    // Add .keel/session/ to .gitignore
    const gitignorePath = path.join(cwd, '.gitignore');
    const gitignoreEntry = '.keel/session/';
    try {
      let content = '';
      try { content = fs.readFileSync(gitignorePath, 'utf8'); } catch { /* absent */ }
      if (!content.includes(gitignoreEntry)) {
        const append = (content.endsWith('\n') || content === '' ? '' : '\n') + gitignoreEntry + '\n';
        fs.appendFileSync(gitignorePath, append, 'utf8');
      }
    } catch { /* non-fatal */ }

    // 3. Run scan
    try {
      scan().scanScope(cwd);
    } catch { /* non-fatal if no checkpoint yet */ }

    // 4. Run goal
    try {
      scan().readGoal(cwd);
    } catch { /* non-fatal if no ROADMAP.md */ }

    // 5. Run checkpoint
    try {
      const goalPath = path.join(cwd, '.keel', 'goal.yaml');
      let goalData = null;
      try {
        const text = fs.readFileSync(goalPath, 'utf8').trim();
        if (text) goalData = yaml().parseYaml(text);
      } catch { /* absent */ }

      checkpoint().writeCheckpoint(cwd, {
        goal: (goalData && goalData.goal) || null,
        phase: (goalData && goalData.phase) || null,
        in_scope_files: [],
        in_scope_dirs: [],
        plan_steps: [],
      });
    } catch { /* non-fatal */ }

    // 6. Start companion
    try {
      daemon().startDaemon(cwd);
    } catch { /* non-fatal */ }

    process.stdout.write('✓ keel installed — companion running\n');
    process.stdout.write('  Next: keel drift\n');
    process.exit(0);
  } catch (err) {
    die(`install error: ${err.message || err}`, 1);
  }
}

// ─── --daemon internal flag ───────────────────────────────────────────────────

function handleDaemonFlag() {
  // Called when spawned as the daemon child process
  daemon().runDaemonLoop(cwd);
}

// ─── Argument parsing and dispatch ───────────────────────────────────────────

const args = process.argv.slice(2);

// Internal daemon entry point
if (args.includes('--daemon')) {
  handleDaemonFlag();
  // runDaemonLoop keeps the event loop alive — no process.exit() here
} else {
  const cmd = args[0];
  const sub = args[1];

  // Parse flags
  const flags = {
    json: args.includes('--json'),
    verbose: args.includes('--verbose'),
    link: args.includes('--link'),
  };

  try {
    if (cmd === 'companion') {
      if (sub === 'start') {
        cmdCompanionStart();
      } else if (sub === 'stop') {
        cmdCompanionStop();
      } else if (sub === 'status') {
        cmdCompanionStatus();
      } else {
        die(`Unknown companion subcommand: ${sub || '(none)'}\nUsage: keel companion start|stop|status`);
      }
    } else if (cmd === 'checkpoint') {
      cmdCheckpoint();
    } else if (cmd === 'drift') {
      cmdDrift(flags);
    } else if (cmd === 'done') {
      cmdDone(flags);
    } else if (cmd === 'goal') {
      cmdGoal();
    } else if (cmd === 'scan') {
      cmdScan();
    } else if (cmd === 'advance') {
      cmdAdvance();
    } else if (cmd === 'watch') {
      cmdWatch();
    } else if (cmd === 'init') {
      cmdInit();
    } else if (cmd === 'install') {
      runInstall(flags);
    } else if (!cmd) {
      process.stdout.write([
        'keel — drift detection companion',
        '',
        'Usage: keel <command> [options]',
        '',
        'Commands:',
        '  companion start     Start the background companion daemon',
        '  companion stop      Stop the companion daemon',
        '  companion status    Show companion running state',
        '  checkpoint          Snapshot current state',
        '  drift               Compare state vs latest checkpoint',
        '  drift --json        JSON output: {drifted, alerts, blockers}',
        '  drift --verbose     Expand consolidated alerts',
        '  done                Run done-gate (4 checks)',
        '  done --json         JSON output: {passed, reason, blockers}',
        '  goal                Read goal from ROADMAP.md / .planning/',
        '  scan                Walk repo, write scope.yaml',
        '  advance             Mark current step complete',
        '  watch               Foreground file watcher',
        '  install             Bootstrap .keel/ and start companion',
        '  install --link      Symlink keel onto PATH',
        '  init                Create .keel/ structure and keel.yaml',
        '',
      ].join('\n'));
      process.exit(0);
    } else {
      die(`Unknown command: ${cmd}\nRun keel with no arguments for usage.`);
    }
  } catch (err) {
    die(`Unexpected error: ${err.message || err}`, 2);
  }
}
