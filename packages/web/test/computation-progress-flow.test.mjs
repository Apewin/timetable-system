import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const appSource = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const indexSource = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const styleSource = await readFile(new URL('../styles.css', import.meta.url), 'utf8');

test('all scheduling calculations surface one persistent global progress bar', () => {
  assert.match(indexSource, /id="computation-progress"[^>]*role="status"/);
  assert.match(indexSource, /id="computation-progress-bar"[^>]*max="100"/);
  assert.match(indexSource, /id="computation-progress-time"/);
  assert.match(indexSource, /进度按时间预算估算/);
  assert.match(appSource, /computationRequestDescriptor/);
  assert.match(appSource, /computationProgressSnapshot/);
  assert.match(appSource, /beginComputationProgress/);
  assert.match(appSource, /finishComputationProgress/);
  assert.match(styleSource, /\.computation-progress\s*\{/);
  assert.match(styleSource, /\.computation-progress-bar\s*\{/);
});

test('legacy AI scheduling also uses the shared progress-aware API client', () => {
  assert.doesNotMatch(appSource, /fetch\(['"]\/api\/ai\/solve/);
  assert.match(appSource, /api\('\/ai\/solve'/);
});

test('the multiple-solution screen reads the already-unwrapped API result', () => {
  const start = appSource.indexOf('window.generateMultipleSolutions = async function()');
  const end = appSource.indexOf('// 选择方案', start);
  const functionSource = appSource.slice(start, end);
  assert.doesNotMatch(functionSource, /result\.data|result\.ok|result\.errors/);
  assert.match(functionSource, /result\.solutions/);
});
