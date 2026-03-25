// atomic.js — Atomic file write helper (write-to-temp + rename)
// Prevents partial reads by concurrent hook processes (Requirements 2.4, 3.3)
'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Write content to filePath atomically.
 * Writes to a temp file in the same directory, then uses fs.renameSync
 * to atomically replace the target. This ensures concurrent readers
 * always see either the previous complete content or the new complete
 * content — never a partial write.
 *
 * @param {string} filePath - Absolute or relative path to the target file
 * @param {string} content  - String content to write
 */
function writeAtomic(filePath, content) {
  const dir = path.dirname(filePath);
  const tmpPath = filePath + '.tmp';

  // Ensure the directory exists
  fs.mkdirSync(dir, { recursive: true });

  // Write to temp file
  fs.writeFileSync(tmpPath, content, 'utf8');

  // Atomically replace target (rename is atomic on POSIX; best-effort on Windows)
  fs.renameSync(tmpPath, filePath);
}

module.exports = { writeAtomic };
