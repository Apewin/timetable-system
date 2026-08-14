import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const appSource = await readFile(new URL('../app.js', import.meta.url), 'utf8');

function sourceBetween(startMarker, endMarker) {
  const start = appSource.indexOf(startMarker);
  const end = appSource.indexOf(endMarker, start);
  assert.notEqual(start, -1, `missing ${startMarker}`);
  assert.notEqual(end, -1, `missing ${endMarker}`);
  return appSource.slice(start, end);
}

test('confirmed assistant CLI card executes the exact reviewed operation endpoint', async () => {
  const requests = [];
  const statuses = [];
  const messages = [];
  const executeSource = sourceBetween(
    'async function executeAiAssistantAction',
    '\nfunction renderAiAssistantActionProposal',
  );
  const execute = new Function(
    'confirm',
    'api',
    'setAiAssistantStatus',
    'loadViewData',
    'getCurrentView',
    'updateAiAssistantContext',
    'renderAiAssistantMessage',
    'appendAiAssistantActionLine',
    'document',
    `${executeSource}; return executeAiAssistantAction;`,
  )(
    () => true,
    async (path, options) => {
      requests.push({ path, body: JSON.parse(options.body) });
      return { message: 'CLI 操作 schedule.solve 已执行' };
    },
    message => statuses.push(message),
    async () => {},
    () => 'status',
    () => {},
    (role, content) => messages.push({ role, content }),
    () => {},
    { createElement: () => ({ textContent: '' }) },
  );
  const card = {
    classList: { add() {} },
    replaceChildren() {},
    appendChild() {},
  };
  const confirmButton = { disabled: false };
  const action = {
    type: 'cli_operation',
    operation: 'schedule.solve',
    params: {},
    body: { max_time_seconds: 60 },
    expected_revision: 23,
  };

  await execute(action, card, confirmButton);

  assert.deepEqual(requests, [{
    path: '/assistant/actions/execute-cli-operation',
    body: {
      operation: 'schedule.solve',
      params: {},
      body: { max_time_seconds: 60 },
      expected_revision: 23,
    },
  }]);
  assert.match(statuses.at(-1), /完成/);
  assert.match(messages.at(-1).content, /CLI/);
});

test('clear-unlocked confirmation uses scheduling language and reports the exact result', async () => {
  const confirmations = [];
  const messages = [];
  const executeSource = sourceBetween(
    'async function executeAiAssistantAction',
    '\nfunction renderAiAssistantActionProposal',
  );
  const execute = new Function(
    'confirm', 'api', 'setAiAssistantStatus', 'loadViewData', 'getCurrentView',
    'updateAiAssistantContext', 'renderAiAssistantMessage', 'appendAiAssistantActionLine',
    'document', `${executeSource}; return executeAiAssistantAction;`,
  )(
    message => { confirmations.push(message); return true; },
    async () => ({ message: '已保留 78 个锁定课时，并清除 327 个未锁定课时。' }),
    () => {}, async () => {}, () => 'timetable-all', () => {},
    (role, content) => messages.push({ role, content }),
    () => {}, { createElement: () => ({ textContent: '' }) },
  );
  const card = { classList: { add() {} }, replaceChildren() {}, appendChild() {} };

  await execute({
    type: 'cli_operation',
    operation: 'schedule.clear-unlocked',
    params: {},
    body: { expected_revision: 461 },
    expected_revision: 461,
  }, card, { disabled: false });

  assert.match(confirmations[0], /清除.*未锁定/);
  assert.match(confirmations[0], /保留.*金框/);
  assert.equal(messages.at(-1).content, '已保留 78 个锁定课时，并清除 327 个未锁定课时。');
});
