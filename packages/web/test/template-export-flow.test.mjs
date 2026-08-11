import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const appSource = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const indexSource = await readFile(new URL('../index.html', import.meta.url), 'utf8');

function sourceBetween(startMarker, endMarker) {
  const start = appSource.indexOf(startMarker);
  const end = appSource.indexOf(endMarker, start);
  assert.notEqual(start, -1, `missing ${startMarker}`);
  assert.notEqual(end, -1, `missing ${endMarker}`);
  return appSource.slice(start, end);
}

test('template export initialization binds preview, AI, and generate controls', () => {
  const listeners = new Map();
  const control = id => ({
    id,
    dataset: {},
    addEventListener(event, handler) {
      listeners.set(`${id}:${event}`, handler);
    },
  });
  const controls = Object.fromEntries([
    'class-template-input',
    'teacher-template-input',
    'btn-template-preview',
    'btn-template-ai-match',
    'btn-template-generate',
  ].map(id => [id, control(id)]));
  let syncCount = 0;
  const previewHandler = () => {};
  const aiHandler = () => {};
  const generateHandler = () => {};
  const initSource = sourceBetween('function initTemplateExport()', '\n// 加载导出页面');
  const init = new Function(
    'document',
    'syncTemplateExportFiles',
    'previewScheduleTemplates',
    'aiMatchScheduleTemplates',
    'generateScheduleTemplateFiles',
    `${initSource}; return initTemplateExport;`,
  )(
    { getElementById: id => controls[id] || null },
    () => { syncCount += 1; },
    previewHandler,
    aiHandler,
    generateHandler,
  );

  init();

  assert.equal(listeners.get('btn-template-preview:click'), previewHandler);
  assert.equal(listeners.get('btn-template-ai-match:click'), aiHandler);
  assert.equal(listeners.get('btn-template-generate:click'), generateHandler);
  assert.equal(syncCount, 1);
});

test('direct generate previews first and produces both workbooks', async () => {
  const buttons = Object.fromEntries([
    'btn-template-preview',
    'btn-template-ai-match',
    'btn-template-generate',
  ].map(id => [id, { disabled: false }]));
  const state = { classFile: null, teacherFile: null, preview: null };
  const preview = {
    teacher_template: {
      ai_review: { configured: false, candidate_count: 0 },
    },
  };
  const files = [{ filename: 'classes.xlsx' }, { filename: 'teachers.xlsx' }];
  const requests = [];
  const downloaded = [];
  const statuses = [];
  const generateSource = sourceBetween(
    'async function generateScheduleTemplateFiles()',
    '\nfunction initTemplateExport()',
  );
  const generate = new Function(
    'document',
    'templateExportState',
    'setTemplateExportStatus',
    'templateExportRequest',
    'templateExportFormData',
    'renderTemplateExportPreview',
    'downloadTemplateFile',
    'showToast',
    `${generateSource}; return generateScheduleTemplateFiles;`,
  )(
    { getElementById: id => buttons[id] || null },
    state,
    message => statuses.push(message),
    async path => {
      requests.push(path);
      if (path === '/export/templates/preview') return preview;
      return {
        files,
        summary: { class_filled_cells: 429, teacher_filled_cells: 343, warnings: [] },
      };
    },
    options => options,
    () => {},
    file => downloaded.push(file.filename),
    () => {},
  );

  await generate();

  assert.deepEqual(requests, ['/export/templates/preview', '/export/templates/generate']);
  assert.deepEqual(downloaded, ['classes.xlsx', 'teachers.xlsx']);
  assert.equal(state.preview, preview);
  assert.match(statuses.at(-1), /已生成 2 个文件/);
  assert.equal(buttons['btn-template-generate'].disabled, false);
});

test('default template generate button is initially enabled', () => {
  const tag = indexSource.match(/<button id="btn-template-generate"[^>]*>/)?.[0] || '';
  assert.ok(tag, 'generate button is missing');
  assert.doesNotMatch(tag, /\sdisabled(?:\s|>|=)/);
});
