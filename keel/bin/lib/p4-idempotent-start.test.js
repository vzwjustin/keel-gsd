// p4-idempotent-start.test.js — Property test for P4: Idempotent Start
// Validates: Requirements 1.2
//
// Property P4: Calling startDaemon(cwd) N times (1–5) results in exactly one
// running daemon process. The same PID is returned by getStatus after all calls.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fc = require('fast-check');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { startDaemon, stopDaemon, getStatus } = require('./daemon.js');

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Create a temp directory with the required .keel/session/ structure.
 */
function makeTempKeelDir() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'keel-p4-'));
  fs.mkdirSync(path.join(tmpDir, '.keel', 'session'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, '.keel', 'checkpoints'), { recursive: true });
  return tmpDir;
}

/**
 * Wait until getStatus(cwd).running === true or timeout expires.
 * Returns the status object when running, or the last status on timeout.
 */
async function waitForRunning(cwd, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = getStatus(cwd);
    if (status.running && status.pid && isProcessAlive(status.pid)) {
      return status;
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  return getStatus(cwd);
}

/**
 * Check if a process is alive via signal 0.
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

/**
 * Remove a directory tree, ignoring errors.
 */
function rmrf(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // best effort
  }
}

// ─── P4: Idempotent Start ─────────────────────────────────────────────────────

test('P4: startDaemon called N times results in exactly one running daemon', async () => {
  /**
   * **Validates: Requirements 1.2**
   *
   * For any N in 1..5, calling startDaemon(cwd) N times must result in
   * exactly one running daemon process (same PID across all calls after the first).
   */
  await fc.assert(
    fc.asyncProperty(
      fc.integer({ min: 1, max: 5 }),
      async (n) => {
        const cwd = makeTempKeelDir();
        try {
          // Call startDaemon N times
          for (let i = 0; i < n; i++) {
            startDaemon(cwd);
          }

          // Wait for the daemon to write its heartbeat
          const status = await waitForRunning(cwd, 4000);

          // Assert exactly one daemon is running
          assert.equal(status.running, true, `Daemon must be running after ${n} startDaemon calls`);
          assert.ok(status.pid, 'Daemon must have a valid PID');
          assert.ok(isProcessAlive(status.pid), `Process ${status.pid} must be alive`);

          // Record the PID from the first start
          const firstPid = status.pid;

          // Call startDaemon again — must NOT spawn a new process
          startDaemon(cwd);
          // Small delay to allow any (erroneous) new process to write its heartbeat
          await new Promise(resolve => setTimeout(resolve, 200));

          const statusAfterExtra = getStatus(cwd);
          assert.equal(statusAfterExtra.running, true, 'Daemon must still be running after extra startDaemon call');
          assert.equal(
            statusAfterExtra.pid,
            firstPid,
            `PID must be unchanged after extra startDaemon call (was ${firstPid}, got ${statusAfterExtra.pid})`
          );

          // Verify the process is still alive (same one)
          assert.ok(isProcessAlive(firstPid), `Original process ${firstPid} must still be alive`);

          return true;
        } finally {
          // Clean up: stop daemon and remove temp dir
          try {
            await stopDaemon(cwd);
          } catch {
            // best effort
          }
          rmrf(cwd);
        }
      }
    ),
    { numRuns: 5, verbose: false }
  );
});

// ─── Deterministic: second call returns same PID ─────────────────────────────

test('P4 deterministic: second startDaemon call returns same PID as first', async () => {
  const cwd = makeTempKeelDir();
  try {
    // First call — starts the daemon
    startDaemon(cwd);
    const status1 = await waitForRunning(cwd, 4000);

    assert.equal(status1.running, true, 'Daemon must be running after first call');
    assert.ok(status1.pid, 'Must have a valid PID after first call');

    const pid1 = status1.pid;

    // Second call — must be a no-op
    startDaemon(cwd);
    await new Promise(resolve => setTimeout(resolve, 200));

    const status2 = getStatus(cwd);
    assert.equal(status2.running, true, 'Daemon must still be running after second call');
    assert.equal(status2.pid, pid1, `PID must be unchanged: expected ${pid1}, got ${status2.pid}`);
    assert.ok(isProcessAlive(pid1), `Process ${pid1} must still be alive`);
  } finally {
    try {
      await stopDaemon(cwd);
    } catch {
      // best effort
    }
    rmrf(cwd);
  }
});
