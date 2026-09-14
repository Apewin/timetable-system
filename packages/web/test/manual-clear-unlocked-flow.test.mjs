import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const appSource = await readFile(new URL('../app.js', import.meta.url), 'utf8');

function sourceBetween(startMarker, endMarker) {
  const start = appSource.indexOf(startMarker);
  const end = appSource.indexOf(endMarker, start);
  assert.notEqual(start, -1, `missing ${startMarker}`);
  assert.notEqual(end, -1, `missing ${endMarker}`);
  return appSource.slice(start, end);
}

test('manual timetable exposes a lock-preserving clear action', () => {
  const manualView = html.slice(
    html.indexOf('id="view-manual-timetable"'),
    html.indexOf('id="view-past-timetables"'),
  );
  assert.match(manualView, /id="manual-clear-unlocked-schedule"/);
  assert.match(manualView, /清除未锁定课程/);
  assert.match(manualView, /保留金框/);
  assert.match(manualView, /id="manual-clear-all-schedule"[^>]*>课表全部清空<\/button>/);
});

test('manual timetable actions are connected when the page starts', () => {
  assert.match(
    appSource,
    /getElementById\('manual-clear-unlocked-schedule'\)\.addEventListener\('click', clearManualUnlockedSchedule\)/,
  );
  assert.match(
    appSource,
    /getElementById\('manual-clear-all-schedule'\)\.addEventListener\('click', clearManualAllSchedule\)/,
  );
  assert.match(
    appSource,
    /getElementById\('manual-save-schedule'\)\.addEventListener\('click', saveCurrentScheduleArchive\)/,
  );
  assert.match(
    appSource,
    /getElementById\('manual-open-archives'\)\.addEventListener\('click', \(\) => switchView\('past-timetables'\)\)/,
  );
});

test('clear action previews exact impact and submits the preview revision', async () => {
  const requests = [];
  const confirmations = [];
  const statuses = [];
  const toasts = [];
  const button = { disabled: false };
  const clearSource = sourceBetween(
    'async function clearManualUnlockedSchedule',
    '\nfunction formatArchiveDateTime',
  );
  const clear = new Function(
    'window', 'document', 'api', 'confirm', 'showToast',
    'loadManualTimetable', 'renderManualPlanControls',
    `${clearSource}; return clearManualUnlockedSchedule;`,
  )(
    {},
    { getElementById: id => id === 'manual-clear-unlocked-schedule' ? button : null },
    async (path, options = {}) => {
      requests.push({ path, options });
      if (path === '/schedule/clear-unlocked/preview') {
        return { retained_locked_meetings: 78, cleared_unlocked_meetings: 327, revision: 461 };
      }
      if (path === '/schedule/clear-unlocked') {
        return { message: '已保留 78 个锁定课时，并清除 327 个未锁定课时。' };
      }
      throw new Error(`unexpected API path ${path}`);
    },
    message => { confirmations.push(message); return true; },
    (message, type) => toasts.push({ message, type }),
    async () => {},
    message => statuses.push(message),
  );

  await clear();

  assert.deepEqual(requests.map(request => request.path), [
    '/schedule/clear-unlocked/preview',
    '/schedule/clear-unlocked',
  ]);
  assert.match(confirmations[0], /保留 78 个.*锁定/);
  assert.match(confirmations[0], /清除 327 个.*未锁定/);
  assert.deepEqual(JSON.parse(requests[1].options.body), {
    expected_revision: 461,
    confirmed_by: '教务用户',
  });
  assert.match(statuses.at(-1), /已保留 78 个锁定课时/);
  assert.match(toasts.at(-1).message, /清除 327 个未锁定课时/);
  assert.equal(button.disabled, false);
});
