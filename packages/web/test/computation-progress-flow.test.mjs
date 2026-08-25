import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const appSource = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const indexSource = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const styleSource = await readFile(new URL('../styles.css', import.meta.url), 'utf8');

test('all scheduling calculations use one persistent, cancellable backend job center', () => {
  assert.match(indexSource, /id="computation-progress"[^>]*role="status"/);
  assert.match(indexSource, /id="computation-progress-bar"[^>]*max="100"/);
  assert.match(indexSource, /id="computation-progress-time"/);
  assert.match(indexSource, /id="computation-progress-cancel"/);
  assert.match(indexSource, /id="computation-progress-result"/);
  assert.match(appSource, /computationRequestDescriptor/);
  assert.match(appSource, /X-Computation-Job/);
  assert.match(appSource, /waitForComputationJob/);
  assert.match(appSource, /restoreComputationJobCenter/);
  assert.match(styleSource, /\.computation-progress\s*\{/);
  assert.match(styleSource, /\.computation-progress-bar\s*\{/);
});

test('legacy AI scheduling also uses the shared progress-aware API client', () => {
  assert.doesNotMatch(appSource, /fetch\(['"]\/api\/ai\/solve/);
  assert.match(appSource, /api\('\/ai\/solve'/);
});

test('finished jobs shrink to a non-blocking corner card', () => {
  assert.match(styleSource, /\.computation-progress\.is-success,[\s\S]*?bottom:\s*74px/);
  assert.match(styleSource, /\.computation-progress\.is-error,[\s\S]*?width:\s*min\(440px/);
  assert.match(
    styleSource,
    /\.computation-progress\.is-success,\s*\.computation-progress\.is-error,\s*\.computation-progress\.is-cancelled\s*\{[^}]*pointer-events:\s*none/,
  );
  assert.match(styleSource, /\.computation-progress-actions\s*\{[^}]*pointer-events:\s*auto/);
});

test('the multiple-solution screen reads the already-unwrapped API result', () => {
  const start = appSource.indexOf('window.generateMultipleSolutions = async function()');
  const end = appSource.indexOf('// 选择方案', start);
  const functionSource = appSource.slice(start, end);
  assert.doesNotMatch(functionSource, /result\.data|result\.ok|result\.errors/);
  assert.match(functionSource, /result\.solutions/);
});
