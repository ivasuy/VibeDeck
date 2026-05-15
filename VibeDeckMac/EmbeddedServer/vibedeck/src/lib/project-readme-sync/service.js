'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { buildProjectReadmeBannerData } = require('./banner-data');
const { renderProjectReadmeBannerSvg } = require('./render-svg');
const { writeManagedProjectReadme } = require('./update-readme');
const { writeFileAtomic } = require('../fs');

async function runProjectReadmeSync({
  cwd = process.cwd(),
  home,
  now = new Date(),
  buildBannerData = buildProjectReadmeBannerData,
  renderSvg = renderProjectReadmeBannerSvg,
  writeBanner = writeFileAtomic,
  writeManagedReadme = writeManagedProjectReadme,
} = {}) {
  const resolvedCwd = typeof cwd === 'string' && cwd.trim() ? path.resolve(cwd) : process.cwd();
  const readmePath = path.resolve(resolvedCwd, 'README.md');
  const bannerPath = path.resolve(resolvedCwd, 'project-readme-banner.svg');

  try {
    const readmeStat = await fs.stat(readmePath);
    if (!readmeStat.isFile()) throw new Error('README.md not found in current directory');
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      throw new Error('README.md not found in current directory');
    }
    throw error;
  }

  const data = await buildBannerData({ home, cwd: resolvedCwd, now });
  const svg = renderSvg(data);

  await writeBanner(bannerPath, `${svg}\n`);
  await writeManagedReadme({ readmePath });

  return {
    readmePath,
    bannerPath,
    projectLabel: data?.projectLabel,
  };
}

module.exports = {
  runProjectReadmeSync,
};
