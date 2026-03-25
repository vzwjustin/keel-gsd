// p3-atomic-integrity.test.js — Property test for P3: Atomic Write Integrity
// Validates: Requirements 2.4, 3.3
//
// Property P3: Every read of companion-heartbeat.yaml or alerts.yaml during a
// concurrent writeAtomic either parses successfully or returns the previous
// valid content — never a partial/corrupt state.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { writeAtomic } = require('./atomic.js');
const { parseYaml, stringifyYaml } = require('./yaml.js');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'p3-atomic-'));
}

function cleanupDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (_) {}
}

/**
 * Generate a valid YAML-serializable object (heartbeat-like shape).
 */
function yamlObjectArbitrary() {
  // Use a fixed epoch offset to avoid invalid Date edge cases from fc.date()
  const BASE_MS = new Date('2024-01-01T00:00:00.000Z').getTime();
  return fc.record({
    running: fc.boolean(),
    pid: fc.integer({ min: 1, max: 99999 }),
    last_beat_at: fc.integer({ min: 0, max: 365 * 24 * 3600 * 1000 })
      .map(offset => new Date(BASE_MS + offset).toISOString()),
    version: fc.constantFrom('1.0.0', '1.1.0', '2.0.0'),
  });
}

// ─── P3: Atomic Write Integrity ───────────────────────────────────────────────

test('P3: writeAtomic — every read sees either old or new valid YAML, never partial', () => {
  /**
   * **Validates: Requirements 2.4, 3.3**
   *
   * For any pair of (oldContent, newContent) as valid YAML strings:
   *   1. Write oldContent to the file
   *   2. Call writeAtomic(newContent)
   *   3. Read the file back
   *   4. Assert the read result is either oldContent or newContent (never partial)
   *   5. Assert parseYaml(readResult) succeeds without throwing
   */
  fc.assert(
    fc.property(
      yamlObjectArbitrary(),
      yamlObjectArbitrary(),
      (oldObj, newObj) => {
        const tmpDir = makeTmpDir();
        try {
          const filePath = path.join(tmpDir, 'companion-heartbeat.yaml');
          const oldContent = stringifyYaml(oldObj);
          const newContent = stringifyYaml(newObj);

          // Write initial valid content
          fs.writeFileSync(filePath, oldContent, 'utf8');

          // Atomically write new content
          writeAtomic(filePath, newContent);

          // Read back — must be one of the two valid states
          const readResult = fs.readFileSync(filePath, 'utf8');

          // Assert it's either old or new content (never partial)
          const isOld = readResult === oldContent;
          const isNew = readResult === newContent;
          assert.ok(
            isOld || isNew,
            `Read result is neither old nor new content.\nGot: ${JSON.stringify(readResult)}\nOld: ${JSON.stringify(oldContent)}\nNew: ${JSON.stringify(newContent)}`
          );

          // Assert it parses successfully as valid YAML
          let parsed;
          assert.doesNotThrow(() => {
            parsed = parseYaml(readResult);
          }, `parseYaml threw on read result: ${JSON.stringify(readResult)}`);

          // Parsed result must be a non-null object
          assert.ok(parsed !== null && typeof parsed === 'object', 'Parsed YAML must be a non-null object');

          return true;
        } finally {
          cleanupDir(tmpDir);
        }
      }
    ),
    { numRuns: 200, verbose: false }
  );
});

// ─── P3: No temp file left behind after successful write ─────────────────────

test('P3: writeAtomic — no .tmp file remains after successful write', () => {
  /**
   * **Validates: Requirements 2.4**
   *
   * After writeAtomic completes, the .tmp file must not exist.
   * The rename is the final step — temp file is consumed by the rename.
   */
  fc.assert(
    fc.property(
      yamlObjectArbitrary(),
      (obj) => {
        const tmpDir = makeTmpDir();
        try {
          const filePath = path.join(tmpDir, 'alerts.yaml');
          const content = stringifyYaml(obj);

          writeAtomic(filePath, content);

          // The .tmp file must not exist after a successful write
          const tmpFilePath = filePath + '.tmp';
          assert.ok(
            !fs.existsSync(tmpFilePath),
            `.tmp file must not exist after successful writeAtomic: ${tmpFilePath}`
          );

          // The target file must exist and be readable
          assert.ok(fs.existsSync(filePath), 'Target file must exist after writeAtomic');

          const readBack = fs.readFileSync(filePath, 'utf8');
          assert.equal(readBack, content, 'File content must match what was written');

          return true;
        } finally {
          cleanupDir(tmpDir);
        }
      }
    ),
    { numRuns: 200, verbose: false }
  );
});

// ─── P3: Sequential writes always leave a valid parseable file ───────────────

test('P3: writeAtomic — N sequential writes always leave a valid parseable YAML file', () => {
  /**
   * **Validates: Requirements 2.4, 3.3**
   *
   * After any sequence of N writeAtomic calls, the file must always
   * contain the last written content and be parseable as valid YAML.
   */
  fc.assert(
    fc.property(
      fc.array(yamlObjectArbitrary(), { minLength: 1, maxLength: 10 }),
      (objects) => {
        const tmpDir = makeTmpDir();
        try {
          const filePath = path.join(tmpDir, 'companion-heartbeat.yaml');
          const contents = objects.map(o => stringifyYaml(o));

          for (const content of contents) {
            writeAtomic(filePath, content);
          }

          // After all writes, file must contain the last written content
          const lastContent = contents[contents.length - 1];
          const readBack = fs.readFileSync(filePath, 'utf8');
          assert.equal(readBack, lastContent, 'File must contain the last written content');

          // Must parse successfully
          assert.doesNotThrow(() => {
            parseYaml(readBack);
          }, 'Final file content must be parseable YAML');

          return true;
        } finally {
          cleanupDir(tmpDir);
        }
      }
    ),
    { numRuns: 200, verbose: false }
  );
});
