'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { runProjectReadmeSync } = require('../src/lib/project-readme-sync/service');
const {
  DEFAULT_IMAGE_PATH,
  PROJECT_MARKER_START,
  PROJECT_MARKER_END,
  PROJECT_USAGE_HEADING,
} = require('../src/lib/project-readme-sync/update-readme');

function createTempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'vibedeck-project-readme-sync-'));
}

test('runProjectReadmeSync fails when README.md is missing in the target directory', async () => {
  const cwd = await createTempDir();
  const expected = 'README.md not found in current directory';
  let bannerCalled = false;
  let readmeCalled = false;

  try {
    await assert.rejects(
      async () => {
        await runProjectReadmeSync({
          cwd,
          buildBannerData: async () => ({ projectLabel: 'ignored' }),
          renderSvg: () => '<svg />',
          writeBanner: async () => {
            bannerCalled = true;
          },
          writeManagedReadme: async () => {
            readmeCalled = true;
          },
        });
      },
      (error) => {
        assert.equal(error.message, expected);
        return true;
      },
  );
  } finally {
    assert.equal(bannerCalled, false);
    assert.equal(readmeCalled, false);
    await fs.rm(cwd, { recursive: true, force: true });
  }
});

test('runProjectReadmeSync writes local banner and README files with resolved paths', async () => {
  const cwd = await createTempDir();
  const readmePath = path.join(cwd, 'README.md');
  const bannerPath = path.join(cwd, 'project-readme-banner.svg');
  const projectLabel = 'repo-label';
  const now = new Date('2026-05-14T12:00:00Z');
  const home = '/home/vibedeck';
  let bannerArgs = null;
  let writeReadmeArgs = null;
  let builtArgs = null;

  await fs.writeFile(readmePath, '# Repo\n', 'utf8');

  try {
    const result = await runProjectReadmeSync({
      cwd,
      home,
      now,
      buildBannerData: async (args) => {
        builtArgs = args;
        return { projectLabel, activeDaysLabel: '3' };
      },
      renderSvg: (data) => `svg:${data.projectLabel}`,
      writeBanner: async (targetPath, content) => {
        bannerArgs = { targetPath, content };
      },
      writeManagedReadme: async (args) => {
        writeReadmeArgs = args;
        return 'ok';
      },
    });

    assert.equal(result.readmePath, readmePath);
    assert.equal(result.bannerPath, bannerPath);
    assert.equal(result.projectLabel, projectLabel);

    assert.deepEqual(builtArgs, { home, cwd, now });
    assert.deepEqual(bannerArgs, {
      targetPath: bannerPath,
      content: 'svg:repo-label\n',
    });
    assert.deepEqual(writeReadmeArgs, { readmePath });
  } finally {
    await fs.rm(cwd, { recursive: true, force: true });
  }
});

test('runProjectReadmeSync updates managed README block without duplicating markers across runs', async () => {
  const cwd = await createTempDir();
  const readmePath = path.join(cwd, 'README.md');
  const original = [
    '# Repo',
    '',
    PROJECT_MARKER_START,
    '![Old usage](./old.svg)',
    PROJECT_MARKER_END,
    '',
    'end',
  ].join('\n');

  await fs.writeFile(
    readmePath,
    original,
    'utf8',
  );

  try {
    const run = async () => {
      await runProjectReadmeSync({
        cwd,
        buildBannerData: async () => ({ projectLabel: 'repo', totalTokensLabel: '0' }),
        renderSvg: () => '<svg />',
        writeBanner: async () => {},
      });
    };

    await run();
    await run();

    const rewritten = await fs.readFile(readmePath, 'utf8');
    const startCount = (rewritten.match(new RegExp(PROJECT_MARKER_START, 'g')) || []).length;
    const endCount = (rewritten.match(new RegExp(PROJECT_MARKER_END, 'g')) || []).length;
    const expectedBlock = [
      PROJECT_USAGE_HEADING,
      '',
      PROJECT_MARKER_START,
      `![VibeDeck Project Usage](${DEFAULT_IMAGE_PATH})`,
      PROJECT_MARKER_END,
    ].join('\n');

    assert.equal(startCount, 1);
    assert.equal(endCount, 1);
    assert.match(rewritten, /## Project Usage/);
    assert.match(rewritten, /VibeDeck Project Usage/);
    assert.equal(rewritten.includes('![Old usage](./old.svg)'), false);
    assert.equal(rewritten.includes(expectedBlock), true);
  } finally {
    await fs.rm(cwd, { recursive: true, force: true });
  }
});
