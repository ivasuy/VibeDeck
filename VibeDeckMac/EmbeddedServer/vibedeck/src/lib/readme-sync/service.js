'use strict';

const path = require('node:path');
const { readReadmeSyncConfig, readGitHubToken } = require('./config');
const { buildReadmeBannerData } = require('./banner-data');
const { renderReadmeBannerSvg } = require('./render-svg');
const { pushBannerAndReadme } = require('./update-readme');
const { writeFileAtomic } = require('../fs');

async function runReadmeSyncUpdate({
  fetchImpl = fetch,
  config = null,
  token = null,
  now = new Date(),
  buildBannerData = buildReadmeBannerData,
  renderSvg = renderReadmeBannerSvg,
  writeBanner = writeFileAtomic,
  pushBannerAndReadmeImpl = pushBannerAndReadme,
} = {}) {
  const resolvedConfig = config || (await readReadmeSyncConfig());
  const resolvedToken = token || (await readGitHubToken());

  if (!resolvedConfig?.enabled) throw new Error('README sync is not configured');
  if (!resolvedToken) throw new Error('GitHub token is not configured');

  const data = await buildBannerData({ now });
  const svg = renderSvg(data);
  const svgPath = resolvedConfig.svg_path || 'github-readme-banner.svg';
  await writeBanner(path.resolve(svgPath), `${svg}\n`);
  await pushBannerAndReadmeImpl({
    config: resolvedConfig,
    token: resolvedToken,
    svg,
    fetchImpl,
  });

  return {
    ok: true,
    repo: `${resolvedConfig.repo_owner}/${resolvedConfig.repo_name}`,
    branch: resolvedConfig.branch,
    readme_path: resolvedConfig.readme_path,
  };
}

module.exports = {
  runReadmeSyncUpdate,
};
