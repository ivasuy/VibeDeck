const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { decodeClaudeProjectPathFromSessionFile } = require('../src/lib/sessions/claude-project-path');

function encodeProjectRoot(projectRoot) {
  return `-${projectRoot.split(path.sep).filter(Boolean).join('-')}`;
}

test('decodeClaudeProjectPathFromSessionFile recovers repo cwd from ~/.claude/projects path', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-claude-path-basic-'));
  try {
    const projectRoot = path.join(tmp, 'switchyard');
    fs.mkdirSync(projectRoot, { recursive: true });
    const filePath = path.join(
      tmp,
      '.claude',
      'projects',
      encodeProjectRoot(projectRoot),
      'cbd58a4f.jsonl',
    );

    assert.equal(decodeClaudeProjectPathFromSessionFile(filePath), projectRoot);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('decodeClaudeProjectPathFromSessionFile preserves hyphenated path segments when the repo exists', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-claude-path-'));
  try {
    const projectRoot = path.join(tmp, 'vasu-portfolio-v2');
    fs.mkdirSync(projectRoot, { recursive: true });
    const filePath = path.join(
      tmp,
      '.claude',
      'projects',
      encodeProjectRoot(projectRoot),
      'session.jsonl',
    );

    assert.equal(decodeClaudeProjectPathFromSessionFile(filePath), projectRoot);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
