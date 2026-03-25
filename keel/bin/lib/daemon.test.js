// daemon.test.js — Unit tests for daemon.js
// Requirements: 1.5, 1.7, 1.8
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { getStatus, startDaemon, stopDaemon } = require('./daemon.js');
const { stringifyYaml } = require('./yaml.js');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'keel-daemon-test-'));
}

function setupKeelDirs(cwd) {
  fs.mkdirSync(path.join(cwd, '.keel', 'session'), { recursive: true });
  fs.mkdirSync(path.join(cwd, '.keel', 'checkpoints'), { recursive: true });
}

function writeHeartbeat(cwd, data) {
  const sessionDir = path.join(cwd, '.keel', 'session');
  fs.mkdirSync(sessionDir, { recursive: true });
  fs.writeFileSync(
    path.join(sessionDir, 'companion-heartbeat.yaml'),
    stringifyYaml(data)
  );
}

function cleanup(cwd) {
  fs.rmSync(cwd, { recursive: true, force: true });
}

// ─── getStatus: absent heartbeat file ────────────────────────────────────────

test('getStatus returns running:false with nulls when heartbeat file is absent', () => {
  const cwd = makeTempDir();
  setupKeelDirs(cwd);
  try {
    const status = getStatus(cwd);
    assert.deepEqual(status, {
      running: false,
      pid: null,
      last_beat_at: null,
      stale: false,
    });
  } finally {
    cleanup(cwd);
  }
});

test('getStatus returns running:false with nulls when .keel/ directory does not exist', () => {
  const cwd = makeTempDir();
  // No .keel/ directory at all
  try {
    const status = getStatus(cwd);
    assert.deepEqual(status, {
      running: false,
      pid: null,
      last_beat_at: null,
      stale: false,
    });
  } finally {
    cleanup(cwd);
  }
});

// ─── getStatus: running:true, fresh heartbeat ─────────────────────────────────

test('getStatus returns running:true stale:false for fresh last_beat_at (< 30s ago)', () => {
  const cwd = makeTempDir();
  try {
    const freshBeat = new Date(Date.now() - 5000).toISOString(); // 5 seconds ago
    writeHeartbeat(cwd, {
      running: true,
      pid: 99999,
      last_beat_at: freshBeat,
      started_at: freshBeat,
      version: '1.0.0',
    });

    const status = getStatus(cwd);
    assert.equal(status.running, true);
    assert.equal(status.pid, 99999);
    assert.equal(status.last_beat_at, freshBeat);
    assert.equal(status.stale, false, 'heartbeat < 30s old should not be stale');
  } finally {
    cleanup(cwd);
  }
});

// ─── getStatus: running:true, stale heartbeat ────────────────────────────────

test('getStatus returns running:true stale:true for stale last_beat_at (> 30s ago)', () => {
  const cwd = makeTempDir();
  try {
    const staleBeat = new Date(Date.now() - 60000).toISOString(); // 60 seconds ago
    writeHeartbeat(cwd, {
      running: true,
      pid: 99998,
      last_beat_at: staleBeat,
      started_at: staleBeat,
      version: '1.0.0',
    });

    const status = getStatus(cwd);
    assert.equal(status.running, true);
    assert.equal(status.pid, 99998);
    assert.equal(status.last_beat_at, staleBeat);
    assert.equal(status.stale, true, 'heartbeat > 30s old should be stale');
  } finally {
    cleanup(cwd);
  }
});

test('getStatus stale boundary: exactly 30s old is stale (age > 30_000ms)', () => {
  const cwd = makeTempDir();
  try {
    // 31 seconds ago — just over the threshold
    const justStale = new Date(Date.now() - 31000).toISOString();
    writeHeartbeat(cwd, {
      running: true,
      pid: 99997,
      last_beat_at: justStale,
    });

    const status = getStatus(cwd);
    assert.equal(status.stale, true, 'heartbeat 31s old should be stale');
  } finally {
    cleanup(cwd);
  }
});

test('getStatus stale boundary: 29s old is not stale', () => {
  const cwd = makeTempDir();
  try {
    const notYetStale = new Date(Date.now() - 29000).toISOString();
    writeHeartbeat(cwd, {
      running: true,
      pid: 99996,
      last_beat_at: notYetStale,
    });

    const status = getStatus(cwd);
    assert.equal(status.stale, false, 'heartbeat 29s old should not be stale');
  } finally {
    cleanup(cwd);
  }
});

// ─── getStatus: running:false ─────────────────────────────────────────────────

test('getStatus returns running:false stale:false when heartbeat has running:false and fresh timestamp', () => {
  const cwd = makeTempDir();
  try {
    const beatAt = new Date(Date.now() - 5000).toISOString();
    writeHeartbeat(cwd, {
      running: false,
      pid: 99995,
      last_beat_at: beatAt,
    });

    const status = getStatus(cwd);
    assert.equal(status.running, false);
    assert.equal(status.pid, 99995);
    assert.equal(status.last_beat_at, beatAt);
    assert.equal(status.stale, false);
  } finally {
    cleanup(cwd);
  }
});

test('getStatus returns running:false stale:true when heartbeat has running:false and stale timestamp', () => {
  const cwd = makeTempDir();
  try {
    const staleBeat = new Date(Date.now() - 60000).toISOString();
    writeHeartbeat(cwd, {
      running: false,
      pid: 99994,
      last_beat_at: staleBeat,
    });

    const status = getStatus(cwd);
    assert.equal(status.running, false);
    assert.equal(status.pid, 99994);
    assert.equal(status.stale, true);
  } finally {
    cleanup(cwd);
  }
});

// ─── startDaemon: throws when .keel/ absent ───────────────────────────────────

test('startDaemon throws when .keel/ directory does not exist', () => {
  const cwd = makeTempDir();
  // No .keel/ directory
  try {
    assert.throws(
      () => startDaemon(cwd),
      (err) => {
        assert.ok(err instanceof Error, 'should throw an Error');
        assert.ok(
          err.message.includes('keel not initialized') || err.message.includes('keel'),
          `error message should mention keel, got: "${err.message}"`
        );
        return true;
      }
    );
  } finally {
    cleanup(cwd);
  }
});

test('startDaemon writes to stderr before throwing when .keel/ absent', () => {
  const cwd = makeTempDir();
  const stderrChunks = [];
  const originalWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = (chunk, ...args) => {
    stderrChunks.push(typeof chunk === 'string' ? chunk : chunk.toString());
    return originalWrite(chunk, ...args);
  };

  try {
    assert.throws(() => startDaemon(cwd));
    const stderrOutput = stderrChunks.join('');
    assert.ok(
      stderrOutput.includes('keel not initialized') || stderrOutput.includes('keel'),
      `stderr should contain error message, got: "${stderrOutput}"`
    );
  } finally {
    process.stderr.write = originalWrite;
    cleanup(cwd);
  }
});

// ─── startDaemon: does NOT throw when .keel/ exists ──────────────────────────

test('startDaemon does not throw when .keel/ directory exists', async () => {
  const cwd = makeTempDir();
  setupKeelDirs(cwd);
  try {
    // Should not throw — daemon may or may not fully start in test context
    assert.doesNotThrow(() => startDaemon(cwd));

    // Give daemon a moment to write heartbeat, then stop it
    await new Promise(resolve => setTimeout(resolve, 500));
  } finally {
    try {
      await stopDaemon(cwd);
    } catch {
      // best effort
    }
    cleanup(cwd);
  }
});
