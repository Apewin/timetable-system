import assert from 'node:assert/strict';
import test from 'node:test';

import config from '../vite.config.js';

function proxyMatches(path) {
  return Object.keys(config.server?.proxy || {}).some(pattern => (
    pattern.startsWith('^')
      ? new RegExp(pattern).test(path)
      : path.startsWith(pattern)
  ));
}

test('the development proxy handles API routes without intercepting frontend modules', () => {
  assert.equal(proxyMatches('/api'), true);
  assert.equal(proxyMatches('/api/status'), true);
  assert.equal(proxyMatches('/timetable/api/status'), true);
  assert.equal(proxyMatches('/api-state-revision.mjs'), false);
});
