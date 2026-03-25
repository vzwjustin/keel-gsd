// atomic.test.js — Unit tests for writeAtomic (Requirements 2.4, 3.3)
'use strict';

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { writeAtomic } = require('./atomic.js');

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'atomic-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('writeAtomic', () => {
  test('writes correct content to the target file', () => {
    const filePath = path.join(tmpDir, 'output.yaml');
    const content = 'key: value\nfoo: bar\n';

    writeAtomic(filePath, content);

    const result = fs.readFileSync(filePath, 'utf8');
    assert.equal(result, content);
  });

  test('no temp file remains after a successful write', () => {
    const filePath = path.join(tmpDir, 'output.yaml');
    const tmpPath = filePath + '.tmp';

    writeAtomic(filePath, 'hello: world\n');

    assert.equal(fs.existsSync(tmpPath), false, 'temp file should be cleaned up after successful write');
  });

  test('overwrites existing file content correctly', () => {
    const filePath = path.join(tmpDir, 'output.yaml');

    writeAtomic(filePath, 'first: write\n');
    writeAtomic(filePath, 'second: write\n');

    const result = fs.readFileSync(filePath, 'utf8');
    assert.equal(result, 'second: write\n');
  });

  test('creates parent directories if they do not exist', () => {
    const filePath = path.join(tmpDir, 'nested', 'deep', 'output.yaml');
    const content = 'nested: true\n';

    writeAtomic(filePath, content);

    const result = fs.readFileSync(filePath, 'utf8');
    assert.equal(result, content);
  });

  test('target file is never in a partially-written state (atomic rename)', () => {
    const filePath = path.join(tmpDir, 'output.yaml');
    const initialContent = 'initial: content\n';
    const newContent = 'x'.repeat(100_000); // large enough to matter

    // Write initial content
    writeAtomic(filePath, initialContent);

    // Intercept renameSync to capture what was in the temp file just before rename
    const origRename = fs.renameSync.bind(fs);
    let tempContentBeforeRename = null;
    const patchedRename = (src, dest) => {
      tempContentBeforeRename = fs.readFileSync(src, 'utf8');
      origRename(src, dest);
    };
    fs.renameSync = patchedRename;

    try {
      writeAtomic(filePath, newContent);
    } finally {
      fs.renameSync = origRename;
    }

    // The temp file had the full new content before rename
    assert.equal(tempContentBeforeRename, newContent, 'temp file must contain full content before rename');

    // After rename, target has the new content
    const result = fs.readFileSync(filePath, 'utf8');
    assert.equal(result, newContent, 'target file must have new content after atomic rename');

    // No temp file left
    assert.equal(fs.existsSync(filePath + '.tmp'), false, 'no temp file should remain');
  });

  test('writes empty string content', () => {
    const filePath = path.join(tmpDir, 'empty.yaml');

    writeAtomic(filePath, '');

    const result = fs.readFileSync(filePath, 'utf8');
    assert.equal(result, '');
  });
});
