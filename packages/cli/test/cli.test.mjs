import assert from 'node:assert/strict';
import test from 'node:test';

import { runCli } from '../src/cli.mjs';

test('status returns the current backend response as JSON', async () => {
  const calls = [];
  const output = [];
  const exitCode = await runCli(['status'], {
    request: async request => {
      calls.push(request);
      return { ok: true, data: { service: 'rules-first', solve_status: 'valid' } };
    },
    writeOut: value => output.push(value),
    writeError: () => assert.fail('status must not write an error'),
    env: {},
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(calls, [{
    baseUrl: 'http://127.0.0.1:3001/api',
    path: '/status',
    method: 'GET',
    body: undefined,
  }]);
  assert.deepEqual(JSON.parse(output.join('')), {
    ok: true,
    data: { service: 'rules-first', solve_status: 'valid' },
  });
});

test('status tolerates the argument separator forwarded by pnpm scripts', async () => {
  const calls = [];
  const exitCode = await runCli(['--', 'status'], {
    request: async request => { calls.push(request); return { ok: true, data: {} }; },
    writeOut: () => {},
    writeError: () => assert.fail('pnpm argument separator must be ignored'),
    env: {},
  });

  assert.equal(exitCode, 0);
  assert.equal(calls[0].path, '/status');
});

test('validate reads the current schedule validation endpoint', async () => {
  const calls = [];
  const exitCode = await runCli(['validate'], {
    request: async request => { calls.push(request); return { ok: true, data: { hard_violations: [] } }; },
    writeOut: () => {},
    writeError: () => assert.fail('validate must not write an error'),
    env: { TIMETABLE_API_URL: 'http://school.internal/api/' },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(calls, [{
    baseUrl: 'http://school.internal/api',
    path: '/validate',
    method: 'GET',
    body: undefined,
  }]);
});

test('list reads one backend entity collection', async () => {
  const calls = [];
  const exitCode = await runCli(['list', 'students'], {
    request: async request => { calls.push(request); return { ok: true, data: [] }; },
    writeOut: () => {},
    writeError: () => assert.fail('list must not write an error'),
    env: {},
  });

  assert.equal(exitCode, 0);
  assert.equal(calls[0].path, '/students');
  assert.equal(calls[0].method, 'GET');
});

test('timetable reads one scoped timetable with an encoded identifier', async () => {
  const calls = [];
  const exitCode = await runCli(['timetable', 'teacher', 'T Rachel/01'], {
    request: async request => { calls.push(request); return { ok: true, data: [] }; },
    writeOut: () => {},
    writeError: () => assert.fail('timetable must not write an error'),
    env: {},
  });

  assert.equal(exitCode, 0);
  assert.equal(calls[0].path, '/timetable/teacher/T%20Rachel%2F01');
  assert.equal(calls[0].method, 'GET');
});

test('capabilities describes the stable machine interface without contacting the backend', async () => {
  const output = [];
  const exitCode = await runCli(['capabilities'], {
    request: async () => assert.fail('capabilities must be available offline'),
    writeOut: value => output.push(value),
    writeError: () => assert.fail('capabilities must not write an error'),
    env: { TIMETABLE_API_URL: 'http://school.internal/api' },
  });

  assert.equal(exitCode, 0);
  const payload = JSON.parse(output.join(''));
  assert.equal(payload.ok, true);
  assert.equal(payload.data.api_url, 'http://school.internal/api');
  assert.equal(payload.data.write_policy, '具有状态或本地文件副作用的操作必须显式使用 --apply');
  assert.ok(payload.data.commands.some(item => item.command === 'request METHOD PATH'));
});

test('request refuses a write unless --apply is explicit', async () => {
  const errors = [];
  const exitCode = await runCli([
    'request', 'POST', '/manual-plan/confirm', '--data', '{"confirmed_by":"AI"}',
  ], {
    request: async () => assert.fail('an unconfirmed write must never reach the backend'),
    writeOut: () => assert.fail('an unconfirmed write must not emit success output'),
    writeError: value => errors.push(value),
    env: {},
  });

  assert.equal(exitCode, 4);
  assert.equal(JSON.parse(errors.join('')).error.code, 'CLI_WRITE_CONFIRMATION_REQUIRED');
});

test('request can read any current backend API path without --apply', async () => {
  const calls = [];
  const exitCode = await runCli(['request', 'GET', '/api/state'], {
    request: async request => { calls.push(request); return { ok: true, data: {} }; },
    writeOut: () => {},
    writeError: () => assert.fail('a valid GET request must not write an error'),
    env: {},
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(calls, [{
    baseUrl: 'http://127.0.0.1:3001/api',
    path: '/state',
    method: 'GET',
    body: undefined,
  }]);
});

test('request sends a confirmed JSON write through the current backend API', async () => {
  const calls = [];
  const exitCode = await runCli([
    'request', 'POST', '/solve', '--data', '{"max_time_seconds":30,"candidate_count":2}', '--apply',
  ], {
    request: async request => { calls.push(request); return { ok: true, data: { status: 'FEASIBLE' } }; },
    writeOut: () => {},
    writeError: () => assert.fail('a confirmed valid write must not write an error'),
    env: {},
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(calls, [{
    baseUrl: 'http://127.0.0.1:3001/api',
    path: '/solve',
    method: 'POST',
    body: { max_time_seconds: 30, candidate_count: 2 },
  }]);
});

test('request rejects malformed JSON before contacting the backend', async () => {
  const errors = [];
  const exitCode = await runCli(['request', 'PUT', '/rules', '--data', '{bad', '--apply'], {
    request: async () => assert.fail('invalid JSON must never reach the backend'),
    writeOut: () => {},
    writeError: value => errors.push(value),
    env: {},
  });

  assert.equal(exitCode, 2);
  assert.equal(JSON.parse(errors.join('')).error.code, 'CLI_INVALID_JSON');
});

test('request accepts JSON from a file for larger model-generated payloads', async () => {
  const calls = [];
  const files = [];
  const exitCode = await runCli([
    'request', 'PUT', '/manual-plan/draft', '--data-file', 'draft.json', '--apply',
  ], {
    request: async request => { calls.push(request); return { ok: true, data: {} }; },
    readFile: (path, encoding) => {
      files.push({ path, encoding });
      return '{"entries":[{"section_id":"SEC_1"}]}';
    },
    writeOut: () => {},
    writeError: () => assert.fail('valid --data-file input must not write an error'),
    env: {},
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(files, [{ path: 'draft.json', encoding: 'utf8' }]);
  assert.deepEqual(calls[0].body, { entries: [{ section_id: 'SEC_1' }] });
});

test('solve exposes the common solver controls as a confirmed backend write', async () => {
  const calls = [];
  const exitCode = await runCli([
    'solve', '--max-time', '30', '--candidates', '2', '--random-seed', '77', '--apply',
  ], {
    request: async request => { calls.push(request); return { ok: true, data: { status: 'FEASIBLE' } }; },
    writeOut: () => {},
    writeError: () => assert.fail('a valid confirmed solve must not write an error'),
    env: {},
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(calls, [{
    baseUrl: 'http://127.0.0.1:3001/api',
    path: '/solve',
    method: 'POST',
    body: { max_time_seconds: 30, candidate_count: 2, random_seed: 77 },
  }]);
});

test('request rejects a missing --data value before contacting the backend', async () => {
  const errors = [];
  const exitCode = await runCli(['request', 'POST', '/solve', '--apply', '--data'], {
    request: async () => assert.fail('missing JSON must never reach the backend'),
    writeOut: () => {},
    writeError: value => errors.push(value),
    env: {},
  });

  assert.equal(exitCode, 2);
  assert.equal(JSON.parse(errors.join('')).error.code, 'CLI_INVALID_JSON');
});

test('import ap previews an Excel workbook through multipart without mutating state', async () => {
  const calls = [];
  const output = [];
  const exitCode = await runCli(['import', 'ap', 'ap-roster.xlsx'], {
    upload: async request => {
      calls.push(request);
      return { ok: true, data: { recognition_method: 'rules', changes: [] } };
    },
    request: async () => assert.fail('file preview must use multipart transport'),
    writeOut: value => output.push(value),
    writeError: () => assert.fail('a valid import preview must not write an error'),
    env: {},
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(calls, [{
    baseUrl: 'http://127.0.0.1:3001/api',
    path: '/ap-selections/import/preview',
    fields: { ai_organize: 'false' },
    files: [{ field: 'file', path: 'ap-roster.xlsx' }],
  }]);
  assert.equal(JSON.parse(output.join('')).data.recognition_method, 'rules');
});

test('import students can explicitly request AI workbook organization', async () => {
  const calls = [];
  const exitCode = await runCli(['import', 'students', 'students.xlsx', '--ai'], {
    upload: async request => { calls.push(request); return { ok: true, data: { recognition_method: 'ai' } }; },
    writeOut: () => {},
    writeError: () => assert.fail('a valid student import preview must not write an error'),
    env: {},
  });

  assert.equal(exitCode, 0);
  assert.equal(calls[0].path, '/import/excel');
  assert.deepEqual(calls[0].fields, { expected_type: 'students', ai_organize: 'true' });
});

test('import confirm writes a reviewed preview payload only with --apply', async () => {
  const calls = [];
  const exitCode = await runCli(['import', 'confirm', 'ap', 'reviewed.json', '--apply'], {
    request: async request => { calls.push(request); return { ok: true, data: { updated_students: 12 } }; },
    readFile: () => '{"changes":[{"student_id":"S1"}],"mode":"replace"}',
    writeOut: () => {},
    writeError: () => assert.fail('a reviewed confirmed import must not write an error'),
    env: {},
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(calls[0], {
    baseUrl: 'http://127.0.0.1:3001/api',
    path: '/ap-selections/import/confirm',
    method: 'POST',
    body: { changes: [{ student_id: 'S1' }], mode: 'replace' },
  });
});

test('export generate writes both generated workbooks into the confirmed output directory', async () => {
  const directories = [];
  const writes = [];
  const output = [];
  const exitCode = await runCli(['export', 'generate', '--output-dir', 'exports', '--apply'], {
    upload: async request => {
      assert.equal(request.path, '/export/templates/generate');
      return {
        ok: true,
        data: {
          summary: { class_filled_cells: 10, teacher_filled_cells: 20 },
          files: [
            { kind: 'class', filename: '班级课表.xlsx', mime_type: 'application/test', data_base64: Buffer.from('class').toString('base64') },
            { kind: 'teacher', filename: '../教师课表.xlsx', mime_type: 'application/test', data_base64: Buffer.from('teacher').toString('base64') },
          ],
        },
      };
    },
    mkdir: (path, options) => directories.push({ path, options }),
    writeFile: (path, data) => writes.push({ path, data: data.toString() }),
    cwd: '/work',
    writeOut: value => output.push(value),
    writeError: () => assert.fail('a valid export must not write an error'),
    env: {},
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(directories, [{ path: '/work/exports', options: { recursive: true } }]);
  assert.deepEqual(writes, [
    { path: '/work/exports/班级课表.xlsx', data: 'class' },
    { path: '/work/exports/教师课表.xlsx', data: 'teacher' },
  ]);
  assert.deepEqual(JSON.parse(output.join('')).data.files.map(file => file.path), writes.map(file => file.path));
});

test('export preview accepts either custom timetable template without writing files', async () => {
  const calls = [];
  const exitCode = await runCli([
    'export', 'preview', '--class-template', 'classes.xls', '--teacher-template', 'teachers.xlsx',
  ], {
    upload: async request => { calls.push(request); return { ok: true, data: { template_sources: {} } }; },
    writeOut: () => {},
    writeError: () => assert.fail('template preview must not write an error'),
    env: {},
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(calls, [{
    baseUrl: 'http://127.0.0.1:3001/api',
    path: '/export/templates/preview',
    fields: {},
    files: [
      { field: 'class_template', path: 'classes.xls' },
      { field: 'teacher_template', path: 'teachers.xlsx' },
    ],
  }]);
});

test('export generate sends reviewed teacher-sheet mappings with the templates', async () => {
  const calls = [];
  const exitCode = await runCli([
    'export', 'generate', '--mappings', 'mappings.json', '--apply',
  ], {
    upload: async request => {
      calls.push(request);
      return {
        ok: true,
        data: {
          summary: {},
          files: [{
            kind: 'class',
            filename: 'classes.xlsx',
            data_base64: Buffer.from('xlsx').toString('base64'),
          }],
        },
      };
    },
    readFile: () => '{"高一-历史":"T_HISTORY","机房使用":"__skip__"}',
    mkdir: () => {},
    writeFile: () => {},
    writeOut: () => {},
    writeError: () => assert.fail('valid export mappings must not write an error'),
    env: {},
  });

  assert.equal(exitCode, 0);
  assert.equal(calls[0].fields.teacher_mappings, '{"高一-历史":"T_HISTORY","机房使用":"__skip__"}');
});

test('describe exposes offline operation names, safety and payload guidance for models', async () => {
  const output = [];
  const exitCode = await runCli(['describe'], {
    request: async () => assert.fail('describe must work without a backend'),
    upload: async () => assert.fail('describe must not upload'),
    writeOut: value => output.push(value),
    writeError: () => assert.fail('describe must not write an error'),
    env: {},
  });

  assert.equal(exitCode, 0);
  const operations = JSON.parse(output.join('')).data.operations;
  for (const name of ['import.ap.preview', 'export.generate', 'manual-plan.confirm', 'graduation.confirm']) {
    assert.ok(operations.some(operation => operation.name === name), `missing ${name}`);
  }
  const graduation = operations.find(operation => operation.name === 'graduation.confirm');
  assert.equal(graduation.mutates, true);
  assert.deepEqual(graduation.body.required, ['confirmation', 'expected_revision']);
  const overlay = operations.find(operation => operation.name === 'schedule.overlay.add');
  assert.deepEqual(overlay.body.required, ['kind', 'title', 'class_id', 'start_slot_id']);
  assert.deepEqual(overlay.body.optional, ['duration', 'color']);
  const assistant = operations.find(operation => operation.name === 'assistant.chat');
  assert.deepEqual(assistant.body.optional, ['context', 'history']);
});

test('describe data includes the complete AP selection lifecycle exposed by the frontend', async () => {
  const output = [];
  const exitCode = await runCli(['describe', 'data'], {
    request: async () => assert.fail('describe must be available offline'),
    writeOut: value => output.push(value),
    writeError: () => assert.fail('known categories must not write an error'),
    env: {},
  });

  assert.equal(exitCode, 0);
  const names = JSON.parse(output.join('')).data.operations.map(operation => operation.name);
  assert.ok(names.includes('data.ap-selections.create'));
  assert.ok(names.includes('data.ap-selections.update'));
  assert.ok(names.includes('data.ap-selections.delete'));
});

test('action executes a named business operation with its documented safety policy', async () => {
  const calls = [];
  const exitCode = await runCli([
    'action', 'manual-plan.confirm', '--data-file', 'confirm.json', '--apply',
  ], {
    request: async request => { calls.push(request); return { ok: true, data: { status: 'confirmed' } }; },
    readFile: () => '{"confirmed_by":"CLI 模型"}',
    writeOut: () => {},
    writeError: () => assert.fail('a valid named action must not write an error'),
    env: {},
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(calls, [{
    baseUrl: 'http://127.0.0.1:3001/api',
    path: '/manual-plan/confirm',
    method: 'POST',
    body: { confirmed_by: 'CLI 模型' },
  }]);
});

test('action fills and encodes documented path parameters', async () => {
  const calls = [];
  const exitCode = await runCli(['action', 'archive.get', '--param', 'archiveId=ARCHIVE 2026/01'], {
    request: async request => { calls.push(request); return { ok: true, data: {} }; },
    writeOut: () => {},
    writeError: () => assert.fail('a complete named path must not write an error'),
    env: {},
  });

  assert.equal(exitCode, 0);
  assert.equal(calls[0].path, '/schedule-archives/ARCHIVE%202026%2F01');
});

test('manual-plan offers a high-level read command instead of requiring an API path', async () => {
  const calls = [];
  const exitCode = await runCli(['manual-plan', 'show'], {
    request: async request => { calls.push(request); return { ok: true, data: { status: 'draft' } }; },
    writeOut: () => {},
    writeError: () => assert.fail('manual-plan show must not write an error'),
    env: {},
  });

  assert.equal(exitCode, 0);
  assert.equal(calls[0].path, '/manual-plan');
  assert.equal(calls[0].method, 'GET');
});

test('archive show expands its identifier into the archived schedule operation', async () => {
  const calls = [];
  const exitCode = await runCli(['archive', 'show', 'ARCHIVE/2026'], {
    request: async request => { calls.push(request); return { ok: true, data: {} }; },
    writeOut: () => {},
    writeError: () => assert.fail('archive show must not write an error'),
    env: {},
  });

  assert.equal(exitCode, 0);
  assert.equal(calls[0].path, '/schedule-archives/ARCHIVE%2F2026');
});
