import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const appSource = await readFile(new URL('../app.js', import.meta.url), 'utf8');

test('legacy inline event handlers resolve to explicit window adapters', () => {
  const handlerNames = new Set(
    [...appSource.matchAll(/\bon[a-z]+="\s*([A-Za-z_$][\w$]*)\s*\(/g)]
      .map((match) => match[1]),
  );

  assert.ok(handlerNames.size > 0, 'expected the legacy templates to contain inline handlers');
  for (const handlerName of handlerNames) {
    assert.match(
      appSource,
      new RegExp(`window\\.${handlerName}\\s*=`),
      `inline handler ${handlerName} must be exposed through an explicit window adapter`,
    );
  }
});
