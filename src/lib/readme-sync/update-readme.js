'use strict';

const { getRepoFile, putRepoFile } = require('./github');

function buildManagedReadmeBlock({ imagePath }) {
  return [
    '<!-- vibedeck:stats:start -->',
    `![VibeDeck Usage](${imagePath})`,
    '<!-- vibedeck:stats:end -->',
  ].join('\n');
}

function upsertManagedReadmeBlock({ readme, markerStart, markerEnd, imagePath }) {
  const source = String(readme || '');
  const block = buildManagedReadmeBlock({ imagePath });
  const start = source.indexOf(markerStart);
  const end = source.indexOf(markerEnd);
  if (start !== -1 && end !== -1 && end >= start) {
    const tailIndex = end + String(markerEnd).length;
    return `${source.slice(0, start).replace(/\s*$/, '')}\n\n${block}\n${source.slice(tailIndex).replace(/^\s*/, '\n')}`;
  }
  return `${source.replace(/\s*$/, '')}\n\n${block}\n`;
}

async function pushBannerAndReadme({ config, token, svg, fetchImpl = fetch }) {
  const owner = config?.repo_owner;
  const repo = config?.repo_name;
  const branch = config?.branch;
  const svgPath = config?.svg_path;
  const readmePath = config?.readme_path;
  const markerStart = config?.marker_start || '<!-- vibedeck:stats:start -->';
  const markerEnd = config?.marker_end || '<!-- vibedeck:stats:end -->';

  const existingSvg = await getRepoFile({
    owner,
    repo,
    path: svgPath,
    branch,
    token,
    fetchImpl,
  });
  await putRepoFile({
    owner,
    repo,
    path: svgPath,
    branch,
    token,
    content: svg,
    sha: existingSvg?.sha || null,
    fetchImpl,
  });

  const existingReadme = await getRepoFile({
    owner,
    repo,
    path: readmePath,
    branch,
    token,
    fetchImpl,
  });
  const nextReadme = upsertManagedReadmeBlock({
    readme: existingReadme?.content || '',
    markerStart,
    markerEnd,
    imagePath: `./${svgPath}`,
  });
  await putRepoFile({
    owner,
    repo,
    path: readmePath,
    branch,
    token,
    content: nextReadme,
    sha: existingReadme?.sha || null,
    message: 'chore: update VibeDeck README banner',
    fetchImpl,
  });
}

module.exports = {
  buildManagedReadmeBlock,
  upsertManagedReadmeBlock,
  pushBannerAndReadme,
};
