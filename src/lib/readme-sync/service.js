'use strict';

const path = require('node:path');
const { readReadmeSyncConfig, readGitHubToken } = require('./config');
const { buildReadmeBannerData } = require('./banner-data');
const { renderReadmeBannerSvg } = require('./render-svg');
const { pushBannerAndReadme } = require('./update-readme');
const { writeFileAtomic } = require('../fs');

function asResult(error) {
  return error ? error.message || String(error) : null;
}

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
  await writeBanner(path.resolve('readme-banner.svg'), `${svg}\n`);
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

async function maybeRunPostSyncReadmeUpdate({
  config = null,
  token = null,
  updateImpl = runReadmeSyncUpdate,
} = {}) {
  const resolvedConfig = config || (await readReadmeSyncConfig());
  if (!resolvedConfig?.enabled) return { attempted: false, ok: true, skipped: 'disabled', warning: null };

  const resolvedToken = token || (await readGitHubToken());
  if (!resolvedToken) return { attempted: false, ok: true, skipped: 'missing_token', warning: null };

  try {
    await updateImpl({ config: resolvedConfig, token: resolvedToken });
    return { attempted: true, ok: true, skipped: null, warning: null };
  } catch (error) {
    return { attempted: true, ok: false, skipped: null, warning: asResult(error) };
  }
}

module.exports = {
  runReadmeSyncUpdate,
  maybeRunPostSyncReadmeUpdate,
};
