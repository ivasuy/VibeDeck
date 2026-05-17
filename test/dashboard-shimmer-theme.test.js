const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const styles = fs.readFileSync('dashboard/src/styles.css', 'utf8');

test('shared shimmer uses dedicated loading colors instead of bright gray scale tokens', () => {
  const shimmerBlock = styles.match(/\.shimmer\s*\{(?<body>[\s\S]*?)\n\s*\}/)?.groups?.body || '';
  assert.match(shimmerBlock, /--shimmer-base/);
  assert.match(shimmerBlock, /--shimmer-highlight/);
  assert.doesNotMatch(shimmerBlock, /--oai-gray-(?:50|100|700|800)/);
});

test('dark shimmer stays muted on glass surfaces', () => {
  const darkBlock = styles.match(/:root\.dark \.shimmer\s*\{(?<body>[\s\S]*?)\n\s*\}/)?.groups?.body || '';
  assert.match(darkBlock, /--shimmer-base:\s*rgba\(129,\s*140,\s*248,\s*0\.10\)/);
  assert.match(darkBlock, /--shimmer-highlight:\s*rgba\(165,\s*180,\s*252,\s*0\.22\)/);
});
