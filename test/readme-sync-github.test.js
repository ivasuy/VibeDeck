const assert = require('node:assert/strict');
const test = require('node:test');

const { getRepoFile, putRepoFile } = require('../src/lib/readme-sync/github');
const {
  buildManagedImageUrl,
  pushBannerAndReadme,
  upsertManagedReadmeBlock,
} = require('../src/lib/readme-sync/update-readme');

test('buildManagedImageUrl returns a cache-busted raw GitHub URL', () => {
  const url = buildManagedImageUrl({
    owner: 'ivasuy',
    repo: 'ivasuy',
    branch: 'main',
    svgPath: 'github-readme-banner.svg',
    cacheKey: 'abc123sha',
  });

  assert.equal(
    url,
    'https://raw.githubusercontent.com/ivasuy/ivasuy/main/github-readme-banner.svg?v=abc123sha',
  );
});

test('appends managed block when markers are missing', () => {
  const next = upsertManagedReadmeBlock({
    readme: '# Hello\n',
    markerStart: '<!-- vibedeck:stats:start -->',
    markerEnd: '<!-- vibedeck:stats:end -->',
    imagePath: 'https://raw.githubusercontent.com/ivasuy/ivasuy/main/github-readme-banner.svg?v=abc123sha',
  });

  assert.match(next, /# Hello/);
  assert.match(next, /<!-- vibedeck:stats:start -->/);
  assert.match(next, /!\[VibeDeck Usage\]\(https:\/\/raw\.githubusercontent\.com\/ivasuy\/ivasuy\/main\/github-readme-banner\.svg\?v=abc123sha\)/);
});

test('replaces only the managed block when markers already exist', () => {
  const existing = [
    '# Hello',
    '',
    '<!-- vibedeck:stats:start -->',
    'old block',
    '<!-- vibedeck:stats:end -->',
    '',
    'tail',
  ].join('\n');

  const next = upsertManagedReadmeBlock({
    readme: existing,
    markerStart: '<!-- vibedeck:stats:start -->',
    markerEnd: '<!-- vibedeck:stats:end -->',
    imagePath: 'https://raw.githubusercontent.com/ivasuy/ivasuy/main/github-readme-banner.svg?v=abc123sha',
  });

  assert.doesNotMatch(next, /old block/);
  assert.match(next, /tail/);
  assert.equal((next.match(/vibedeck:stats:start/g) || []).length, 1);
  assert.equal((next.match(/vibedeck:stats:end/g) || []).length, 1);
});

test('github GET unwraps base64 and returns null on 404', async () => {
  let requestedUrl;
  const notFound = await getRepoFile({
    owner: 'ivasuy',
    repo: 'vibedeck',
    path: 'README.md',
    branch: 'main',
    token: 'ghp_token',
    fetchImpl: async (url) => {
      requestedUrl = String(url);
      return { ok: false, status: 404 };
    },
  });

  assert.equal(notFound, null);
  assert.equal(requestedUrl.includes('/vibedeck/contents/README.md?ref=main'), true);
});

test('github GET decodes base64 content payloads', async () => {
  const response = await getRepoFile({
    owner: 'ivasuy',
    repo: 'vibedeck',
    path: 'README.md',
    branch: 'main',
    token: 'ghp_token',
    fetchImpl: () => ({
      ok: true,
      status: 200,
      json: async () => ({
        sha: 'abc123',
        content: Buffer.from('hello', 'utf8').toString('base64'),
      }),
    }),
  });
  assert.deepEqual(response, {
    sha: 'abc123',
    content: 'hello',
  });
});

test('github PUT posts base64 payload and optional sha', async () => {
  let request;
  await putRepoFile({
    owner: 'ivasuy',
    repo: 'vibedeck',
    path: 'github-readme-banner.svg',
    branch: 'main',
    token: 'ghp_token',
    content: 'content',
    sha: 'abc123',
    message: 'chore: test',
    fetchImpl: async (url, init) => {
      request = {
        url: String(url),
        init,
        body: init ? JSON.parse(init.body) : null,
      };
      return {
        ok: true,
        status: 200,
        json: async () => ({}),
      };
    },
  });

  assert.equal(request.url.includes('/vibedeck/contents/github-readme-banner.svg'), true);
  assert.equal(request.init.method, 'PUT');
  assert.equal(request.body.content, Buffer.from('content', 'utf8').toString('base64'));
  assert.equal(request.body.sha, 'abc123');
});

test('pushBannerAndReadme writes managed README block using chore commit message', async () => {
  const messages = [];
  const requested = [];

  const parseBody = (body) => {
    if (typeof body !== 'string' || !body) return null;
    try {
      return JSON.parse(body);
    } catch {
      return null;
    }
  };

  await pushBannerAndReadme({
    config: {
      repo_owner: 'ivasuy',
      repo_name: 'vibedeck',
      branch: 'main',
      svg_path: 'github-readme-banner.svg',
      readme_path: 'README.md',
      marker_start: '<!-- vibedeck:stats:start -->',
      marker_end: '<!-- vibedeck:stats:end -->',
    },
    token: 'ghp_token',
    svg: '<svg></svg>',
    fetchImpl: async (url, init) => {
      const target = String(url);
      requested.push({
        url: target,
        method: init?.method || 'GET',
        body: parseBody(init?.body),
      });

      if (target.includes('/contents/github-readme-banner.svg')) {
        if (init) {
          messages.push(parseBody(init.body)?.message || null);
          return {
            ok: true,
            status: 200,
            json: async () => ({ content: { sha: 'newsvgsha' } }),
          };
        }
        return { ok: true, status: 200, json: async () => ({ sha: 'svgsha' }) };
      }
      if (target.includes('/contents/README.md')) {
        if (init) {
          messages.push(parseBody(init.body)?.message || null);
          return { ok: true, status: 200, json: async () => ({}) };
        }
        return { ok: false, status: 404 };
      }

      return { ok: true, status: 200, json: async () => ({}) };
    },
  });

  assert.equal(messages.includes('chore: update VibeDeck README banner'), true);
  const putMessages = requested
    .filter((entry) => entry.method === 'PUT')
    .map((entry) => entry.body?.message)
    .filter((message) => message);
  assert.ok(putMessages.includes('chore: update VibeDeck README banner'));
  const readmePut = requested.find(
    (entry) => entry.method === 'PUT' && entry.url.includes('/contents/README.md'),
  );
  const readmeContent = Buffer.from(readmePut.body.content, 'base64').toString('utf8');
  assert.match(
    readmeContent,
    /https:\/\/raw\.githubusercontent\.com\/ivasuy\/vibedeck\/main\/github-readme-banner\.svg\?v=newsvgsha/,
  );
});
