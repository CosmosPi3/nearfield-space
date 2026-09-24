const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { TEMP_DIR } = require('../config');

function ensureTempDir() {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

// Clears any files left behind by a prior crashed run. Safe because TEMP_DIR
// is an app-owned directory (never OS /tmp) that holds nothing else.
function sweepTempDir() {
  ensureTempDir();
  for (const entry of fs.readdirSync(TEMP_DIR)) {
    fs.rmSync(path.join(TEMP_DIR, entry), { force: true });
  }
}

function newTempPath(ext) {
  ensureTempDir();
  return path.join(TEMP_DIR, `${randomUUID()}.${ext}`);
}

module.exports = { ensureTempDir, sweepTempDir, newTempPath };
