const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function safeUnlink(filePath) {
  try {
    fs.unlinkSync(filePath);
  } catch {
    // ignore
  }
}

function safeRename(from, to) {
  fs.renameSync(from, to);
}

async function runBatch(payloads) {
  const list = Array.isArray(payloads) ? payloads : [];
  if (list.length === 0) return;

  const staged = [];
  const backups = [];
  const renamed = [];

  try {
    // Phase 1: stage + validate.
    for (const payload of list) {
      if (!payload || typeof payload !== 'object') throw new Error('Invalid batch payload');
      const finalPath = payload.path;
      if (typeof finalPath !== 'string' || !path.isAbsolute(finalPath)) {
        throw new Error('Payload path must be absolute');
      }
      const content = payload.content;
      if (typeof content !== 'string') throw new Error('Payload content must be a string');
      const validate = payload.validate;
      if (typeof validate !== 'function') throw new Error('Payload validate must be a function');

      const dir = path.dirname(finalPath);
      fs.mkdirSync(dir, { recursive: true });

      const stagingPath = path.join(dir, `.vibedeck-staging-${crypto.randomUUID()}`);
      fs.writeFileSync(stagingPath, content);
      staged.push({ stagingPath, finalPath, dir, content, validate });

      validate(content);
    }
  } catch (err) {
    for (const s of staged) safeUnlink(s.stagingPath);
    throw err;
  }

  try {
    // Phase 2: backup originals.
    for (const s of staged) {
      if (!fs.existsSync(s.finalPath)) continue;
      const backupPath = path.join(s.dir, `.vibedeck-backup-${crypto.randomUUID()}`);
      fs.copyFileSync(s.finalPath, backupPath);
      backups.push({ finalPath: s.finalPath, backupPath });
    }

    // Phase 2: commit renames.
    for (const s of staged) {
      safeRename(s.stagingPath, s.finalPath);
      renamed.push(s);
    }
  } catch (err) {
    // Rollback: restore backups for renamed targets; remove new files without backups.
    for (let i = renamed.length - 1; i >= 0; i--) {
      const s = renamed[i];
      const b = backups.find((x) => x.finalPath === s.finalPath);
      if (b) {
        try {
          safeRename(b.backupPath, b.finalPath);
        } catch {
          // ignore restore errors; we still want to clean up what we can.
        }
      } else {
        safeUnlink(s.finalPath);
      }
    }

    // Remove any leftover staging files (not yet renamed, or failed after rename).
    for (const s of staged) safeUnlink(s.stagingPath);

    // Remove any backups that weren't consumed by restore.
    for (const b of backups) safeUnlink(b.backupPath);

    throw err;
  }

  // Success: remove backups.
  for (const b of backups) safeUnlink(b.backupPath);
}

module.exports = {
  runBatch,
};

