import assert from 'node:assert/strict';
import test from 'node:test';

test('the production server can be imported without opening a listening socket', async () => {
  const server = await import('../src/server.mjs');
  assert.equal(typeof server.startServer, 'function');
});

test('the production server rejects an invalid configured port before listening', async () => {
  const { startServer } = await import('../src/server.mjs');
  assert.throws(() => startServer({ port: -1 }), /PORT/);
});
