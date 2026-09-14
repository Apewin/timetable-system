import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const appSource = await readFile(new URL('../app.js', import.meta.url), 'utf8');

function clearAllFactory() {
  const start = appSource.indexOf('async function clearManualAllSchedule');
  const end = appSource.indexOf('\nfunction formatArchiveDateTime');
  assert.notEqual(start, -1, 'missing clearManualAllSchedule');
  assert.notEqual(end, -1, 'missing formatArchiveDateTime');
  return appSource.slice(start, end);
}

function buildClearAll({ answers, preview }) {
  const requests = [];
  const confirmations = [];
  const statuses = [];
  const toasts = [];
  const button = { disabled: false };
  const windowStub = { _manualHasSchedule: true, _manualHasClearableSchedule: true };
  const clear = new Function(
    'window', 'document', 'api', 'confirm', 'showToast',
    'loadManualTimetable', 'renderManualPlanControls', 'resetManualDraftStorage',
    `${clearAllFactory()}; return clearManualAllSchedule;`,
  )(
    windowStub,
    { getElementById: id => id === 'manual-clear-all-schedule' ? button : null },
    async (path, options = {}) => {
      requests.push({ path, options });
      if (path === '/schedule/clear-all/preview') return preview;
      if (path === '/schedule/clear-all') {
        return { message: '已清空全部课表：删除 405 节课（含 78 节锁定课）。' };
      }
      throw new Error(`unexpected API path ${path}`);
    },
    message => {
      confirmations.push(message);
      return answers[confirmations.length - 1];
    },
    (message, type) => toasts.push({ message, type }),
    async () => {},
    message => statuses.push(message),
    () => {},
  );
  return { clear, requests, confirmations, statuses, toasts, button, windowStub };
}

const fullPreview = {
  total_meetings: 405,
  locked_meetings: 78,
  unlocked_meetings: 327,
  parked_meetings: 2,
  lock_count: 78,
  manual_placements: 12,
  revision: 474,
};

test('clearing the whole timetable requires two separate confirmations', async () => {
  const single = buildClearAll({ answers: [true, false], preview: fullPreview });
  await single.clear();

  assert.equal(single.confirmations.length, 2);
  assert.match(single.confirmations[0], /包括锁定课程/);
  assert.match(single.confirmations[0], /锁定课时：78 节/);
  assert.match(single.confirmations[0], /未锁定课时：327 节/);
  assert.match(single.confirmations[1], /第二次确认/);
  assert.deepEqual(single.requests.map(request => request.path), ['/schedule/clear-all/preview']);
  assert.match(single.statuses.at(-1), /已取消清空/);
});

test('the first refusal stops before the second confirmation and any write', async () => {
  const refused = buildClearAll({ answers: [false], preview: fullPreview });
  await refused.clear();

  assert.equal(refused.confirmations.length, 1);
  assert.deepEqual(refused.requests.map(request => request.path), ['/schedule/clear-all/preview']);
});

test('both confirmations submit the previewed revision with the confirmation phrase', async () => {
  const accepted = buildClearAll({ answers: [true, true], preview: fullPreview });
  await accepted.clear();

  assert.deepEqual(accepted.requests.map(request => request.path), [
    '/schedule/clear-all/preview',
    '/schedule/clear-all',
  ]);
  assert.deepEqual(JSON.parse(accepted.requests[1].options.body), {
    expected_revision: 474,
    confirmation: '清空全部课表',
    confirmed_by: '教务用户',
  });
  assert.equal(accepted.windowStub._manualHasSchedule, false);
  assert.equal(accepted.windowStub._manualHasClearableSchedule, false);
  assert.match(accepted.toasts.at(-1).message, /已清空全部课表/);
});

test('clearing stays available when only manual locks or drafts exist', () => {
  assert.match(
    appSource,
    /window\._manualHasClearableSchedule = window\._manualHasSchedule[\s\S]*?manualPlan\.placements \|\| \[\]\)\.length > 0/,
  );
  assert.match(
    appSource,
    /clearAllButton\.disabled = !window\._manualHasClearableSchedule/,
  );
});

test('an already empty timetable is reported without asking for confirmation', async () => {
  const empty = buildClearAll({
    answers: [],
    preview: {
      total_meetings: 0,
      locked_meetings: 0,
      unlocked_meetings: 0,
      parked_meetings: 0,
      lock_count: 0,
      manual_placements: 0,
      revision: 474,
    },
  });
  await empty.clear();

  assert.deepEqual(empty.confirmations, []);
  assert.deepEqual(empty.requests.map(request => request.path), ['/schedule/clear-all/preview']);
  assert.match(empty.toasts.at(-1).message, /已经是空的/);
});
