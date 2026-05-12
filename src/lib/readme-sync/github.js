'use strict';

function githubHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'VibeDeck',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

function escapePathSegment(pathSegment) {
  return encodeURIComponent(pathSegment);
}

function buildContentUrl({ owner, repo, path, branch }) {
  const encodedPath = String(path || '')
    .split('/')
    .map((segment) => escapePathSegment(segment))
    .join('/');
  const encodedBranch = encodePath(branch);
  return `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodedPath}?ref=${encodedBranch}`;
}

function buildWriteUrl({ owner, repo, path }) {
  const encodedPath = String(path || '')
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  return `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodedPath}`;
}

function encodePath(path) {
  return encodeURIComponent(String(path || '').trim() || 'main');
}

async function getRepoFile({
  owner,
  repo,
  path,
  branch,
  token,
  fetchImpl = fetch,
}) {
  const url = buildContentUrl({ owner, repo, path, branch });
  const res = await fetchImpl(url, { headers: githubHeaders(token) });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`GitHub GET failed (${res.status})`);
  }
  const body = await res.json();
  const content = String(body?.content || '').replace(/\n/g, '');
  return {
    sha: body?.sha || null,
    content: content ? Buffer.from(content, 'base64').toString('utf8') : '',
  };
}

async function putRepoFile({
  owner,
  repo,
  path,
  branch,
  token,
  content,
  sha = null,
  message = 'chore: update VibeDeck README banner',
  fetchImpl = fetch,
}) {
  const url = buildWriteUrl({ owner, repo, path });
  const body = {
    message,
    branch,
    content: Buffer.from(String(content || ''), 'utf8').toString('base64'),
    ...(sha ? { sha } : {}),
  };
  const res = await fetchImpl(url, {
    method: 'PUT',
    headers: { ...githubHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`GitHub PUT failed (${res.status})`);
  }
  return res.json();
}

module.exports = {
  githubHeaders,
  getRepoFile,
  putRepoFile,
};
