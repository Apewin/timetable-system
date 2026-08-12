import test from 'node:test';
import assert from 'node:assert/strict';

import { escapeHtml, safeDataAttribute } from '../dom-safety.mjs';

test('escapeHtml encodes text that could break out of generated markup', () => {
  assert.equal(
    escapeHtml(`<img src=x onerror="alert('x')"> &`),
    '&lt;img src=x onerror=&quot;alert(&#39;x&#39;)&quot;&gt; &amp;',
  );
});

test('safeDataAttribute serializes an identifier without executable markup', () => {
  assert.equal(safeDataAttribute(`SEC_1" onclick="alert(1)`), 'SEC_1&quot; onclick=&quot;alert(1)');
});
