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

function assistantMessagesElement() {
  return {
    children: [],
    scrollTop: 0,
    scrollHeight: 0,
    appendChild(child) {
      this.children.push(child);
      this.scrollHeight = this.children.length;
    },
    removeChild(child) {
      const index = this.children.indexOf(child);
      if (index >= 0) this.children.splice(index, 1);
      this.scrollHeight = this.children.length;
    },
    replaceChildren(...children) {
      this.children = [...children];
      this.scrollHeight = this.children.length;
    },
    get firstChild() {
      return this.children[0] || null;
    },
  };
}

test('switching pages starts a fresh assistant conversation for the new page', () => {
  const messages = assistantMessagesElement();
  const elements = {
    'ai-assistant-context-label': { textContent: '' },
    'ai-assistant-messages': messages,
    'ai-assistant-status': { textContent: '旧页面分析完成' },
  };
  const assistantSource = sourceBetween(
    'let aiAssistantConversation = [];',
    '\nfunction appendAiAssistantActionLine',
  );
  const assistant = new Function(
    'document',
    'getCurrentView',
    'AI_ASSISTANT_VIEW_LABELS',
    'manualCurrentClassId',
    `${assistantSource}; return {
      updateAiAssistantContext,
      renderAiAssistantMessage,
      seedConversation(value) { aiAssistantConversation = value; },
      conversation() { return aiAssistantConversation; },
    };`,
  )(
    {
      getElementById: id => elements[id] || null,
      createElement: () => ({ className: '', textContent: '' }),
    },
    () => 'manual-timetable',
    {
      'manual-timetable': '排课表',
      'overview-timetable': '总课表概览',
    },
    () => 'TC_G11_1',
  );

  assistant.updateAiAssistantContext('manual-timetable');
  assistant.seedConversation([
    { role: 'user', content: '分析高二教学1班' },
    { role: 'assistant', content: '当前页面为手动排课。' },
  ]);
  assistant.renderAiAssistantMessage('user', '分析高二教学1班');
  assistant.renderAiAssistantMessage('assistant', '当前页面为手动排课。');

  assistant.updateAiAssistantContext('overview-timetable');

  assert.deepEqual(assistant.conversation(), []);
  assert.equal(messages.children.length, 1);
  assert.match(messages.children[0].textContent, /总课表概览/);
  assert.equal(messages.children.some(message => /手动排课|高二教学1班/.test(message.textContent)), false);
  assert.equal(elements['ai-assistant-status'].textContent, '');
});

test('a response from the previous page cannot contaminate the new page', async () => {
  let currentView = 'manual-timetable';
  let resolveRequest;
  const pendingResponse = new Promise(resolve => { resolveRequest = resolve; });
  const messages = assistantMessagesElement();
  const elements = {
    'ai-assistant-context-label': { textContent: '' },
    'ai-assistant-messages': messages,
    'ai-assistant-status': { textContent: '' },
    'ai-assistant-input': { value: '分析旧页面' },
    'btn-ai-assistant-send': { disabled: false },
    'view-manual-timetable': { querySelectorAll: () => [] },
    'view-overview-timetable': { querySelectorAll: () => [] },
  };
  const assistantSource = sourceBetween(
    'let aiAssistantConversation = [];',
    '\nfunction initAiAssistant',
  );
  const assistant = new Function(
    'document',
    'getCurrentView',
    'AI_ASSISTANT_VIEW_LABELS',
    'manualCurrentClassId',
    'api',
    `${assistantSource}; return {
      updateAiAssistantContext,
      sendAiAssistantMessage,
      conversation() { return aiAssistantConversation; },
    };`,
  )(
    {
      getElementById: id => elements[id] || null,
      createElement: () => ({ className: '', textContent: '' }),
    },
    () => currentView,
    {
      'manual-timetable': '排课表',
      'overview-timetable': '总课表概览',
    },
    () => 'TC_G11_1',
    async () => pendingResponse,
  );

  assistant.updateAiAssistantContext('manual-timetable');
  const oldRequest = assistant.sendAiAssistantMessage('分析旧页面');
  currentView = 'overview-timetable';
  assistant.updateAiAssistantContext('overview-timetable');
  resolveRequest({ response: '这是旧页面的回答', model: 'test-model' });
  await oldRequest;

  assert.deepEqual(assistant.conversation(), []);
  assert.equal(messages.children.length, 1);
  assert.match(messages.children[0].textContent, /总课表概览/);
  assert.equal(messages.children.some(message => /旧页面/.test(message.textContent)), false);
  assert.equal(elements['btn-ai-assistant-send'].disabled, false);
});

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
    () => {}, async () => {}, () => 'overview-timetable', () => {},
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
