'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

test('local static server returns no-op JS for Vercel script URLs instead of SPA HTML', async () => {
  const { serveStaticFile } = require('../src/lib/static-server');
  const writes = [];
  const res = {
    statusCode: null,
    headers: null,
    writeHead(statusCode, headers) {
      this.statusCode = statusCode;
      this.headers = headers;
    },
    end(body = '') {
      writes.push(String(body));
    },
  };

  const served = await serveStaticFile('/tmp/does-not-matter', '/_vercel/insights/script.js', res);

  assert.equal(served, true);
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['Content-Type'], /application\/javascript/);
  assert.equal(writes.join(''), '');
});
