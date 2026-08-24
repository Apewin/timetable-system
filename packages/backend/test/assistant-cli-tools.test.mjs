import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assistantCliMutationProposal,
  assistantCliTools,
  executeAssistantCliRead,
  executeAssistantCliWrite,
  executeConfirmedAssistantCliAction,
} from '../src/assistant-cli-tools.mjs';

test('assistant CLI bridge executes a whitelisted query through the real CLI planner', async () => {
  const requests = [];
  const result = await executeAssistantCliRead({
    operation: 'system.status',
    params: {},
    body: null,
  }, {
    baseUrl: 'http://127.0.0.1:4321/api',
    request: async request => {
      requests.push(request);
      return { ok: true, data: { solve_status: 'valid', publication_status: 'ready' } };
    },
  });

  assert.deepEqual(requests, [{
    baseUrl: 'http://127.0.0.1:4321/api',
    path: '/status',
    method: 'GET',
    body: undefined,
  }]);
  assert.deepEqual(result, { solve_status: 'valid', publication_status: 'ready' });
});

test('assistant CLI bridge rejects operations that could expose raw state', async () => {
  await assert.rejects(() => executeAssistantCliRead({
    operation: 'system.state', params: {}, body: null,
  }, {
    baseUrl: 'http://127.0.0.1:4321/api',
    request: async () => assert.fail('unsafe operations must not reach the API'),
  }), /未获准/);
});

test('assistant CLI bridge executes a confirmed mutation through the CLI apply gate', async () => {
  const requests = [];
  const result = await executeAssistantCliWrite({
    operation: 'schedule.solve',
    params: {},
    body: { max_time_seconds: 60, candidate_count: 2 },
  }, {
    baseUrl: 'http://127.0.0.1:4321/api',
    request: async request => {
      requests.push(request);
      return { ok: true, data: { status: 'FEASIBLE', publication_status: 'ready' } };
    },
  });

  assert.deepEqual(requests, [{
    baseUrl: 'http://127.0.0.1:4321/api',
    path: '/solve',
    method: 'POST',
    body: { max_time_seconds: 60, candidate_count: 2 },
  }]);
  assert.equal(result.status, 'FEASIBLE');
});

test('confirmed assistant CLI action rejects a stale data revision before execution', async () => {
  await assert.rejects(() => executeConfirmedAssistantCliAction({
    operation: 'schedule.tasks.build',
    params: {},
    body: null,
    expected_revision: 11,
  }, {
    state: { meta: { revision: 12 } },
    baseUrl: 'http://127.0.0.1:4321/api',
    executeCliWrite: async () => assert.fail('stale confirmation must not execute'),
  }), /数据已变化/);
});

test('confirmed assistant CLI action executes the exact reviewed operation', async () => {
  const calls = [];
  const result = await executeConfirmedAssistantCliAction({
    operation: 'manual-plan.unlock',
    params: {},
    body: null,
    expected_revision: 12,
  }, {
    state: { meta: { revision: 12 } },
    baseUrl: 'http://127.0.0.1:4321/api',
    executeCliWrite: async (call, options) => {
      calls.push({ call, options });
      return { status: 'draft' };
    },
  });

  assert.deepEqual(calls, [{
    call: { operation: 'manual-plan.unlock', params: {}, body: null },
    options: { baseUrl: 'http://127.0.0.1:4321/api' },
  }]);
  assert.deepEqual(result, { status: 'draft' });
});

test('assistant CLI bridge never exposes graduation or generic deletion as model tools', async () => {
  await assert.rejects(() => executeAssistantCliWrite({
    operation: 'graduation.confirm',
    params: {},
    body: { confirmation: '确认毕业', expected_revision: 12 },
  }, {
    baseUrl: 'http://127.0.0.1:4321/api',
    request: async () => assert.fail('forbidden destructive operations must not reach the API'),
  }), /未获准/);
});

test('assistant offers a revision-bound clear-unlocked operation with an exact impact preview', () => {
  assert.ok(assistantCliTools().some(tool =>
    tool.operation === 'schedule.clear-unlocked' && tool.mode === 'confirm'));

  const proposal = assistantCliMutationProposal({
    operation: 'schedule.clear-unlocked', params: {}, body: null,
  }, {
    meta: { revision: 23 },
    manual_plan: {
      status: 'confirmed',
      locks: [{ section_id: 'SEC_LOCKED', slot_id: 'D1P1', origin: 'manual' }],
    },
    schedule: {
      sections: [],
      locks: [{ section_id: 'SEC_LOCKED', slot_id: 'D1P1', origin: 'manual' }],
      meetings: [
        { section_id: 'SEC_LOCKED', slot_id: 'D1P1' },
        { section_id: 'SEC_OPEN', slot_id: 'D1P2' },
      ],
    },
  });

  assert.equal(proposal.operation, 'schedule.clear-unlocked');
  assert.equal(proposal.expected_revision, 23);
  assert.deepEqual(proposal.body, { expected_revision: 23 });
  assert.match(proposal.impacts.join('\n'), /保留 1 个已锁定课时/);
  assert.match(proposal.impacts.join('\n'), /清除 1 个未锁定课时/);
});
