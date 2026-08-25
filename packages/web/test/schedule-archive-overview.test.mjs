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

function archiveControls({
  review = { required: false },
  promptValues = ['2026–2027 学年秋季正式课表', '教务处已完成核对'],
} = {}) {
  const elements = {
    'overview-save-schedule': { disabled: true },
    'overview-archive-status': { textContent: '', className: '' },
    'manual-save-schedule': { disabled: true },
    'manual-archive-status': { textContent: '', className: '' },
  };
  const requests = [];
  const toasts = [];
  const archiveSource = sourceBetween(
    'function formatArchiveDateTime',
    '\nasync function loadPastTimetables',
  );
  const controls = new Function(
    'window',
    'document',
    'api',
    'confirm',
    'prompt',
    'qualityMetricSummary',
    'showToast',
    `${archiveSource}; return { applyScheduleArchiveStatus, saveCurrentScheduleArchive };`,
  )(
    {},
    { getElementById: id => elements[id] || null },
    async (path, options = {}) => {
      requests.push({ path, options });
      if (path === '/schedule-quality-review') return review;
      if (path === '/schedule-archives') {
        return {
          archive: {
            saved_at: '2026-08-19T12:00:00.000Z',
            publication_status: 'ready',
          },
        };
      }
      throw new Error(`unexpected API path ${path}`);
    },
    () => true,
    () => promptValues.shift() ?? null,
    () => '质量分析',
    (message, type) => toasts.push({ message, type }),
  );
  return { ...controls, elements, requests, toasts };
}

test('legacy timestamp archive names are translated into a readable history title', () => {
  const archiveSource = sourceBetween(
    'function formatArchiveDateTime',
    '\nfunction setScheduleArchiveStatus',
  );
  const { scheduleArchiveDisplayName } = new Function(
    `${archiveSource}; return { scheduleArchiveDisplayName };`,
  )();

  assert.match(scheduleArchiveDisplayName({
    name: '课表存档 · 2026-08-04T17:27:07.752Z',
    saved_at: '2026-08-04T17:27:07.752Z',
  }), /^历史课表 · /);
  assert.equal(scheduleArchiveDisplayName({
    name: '2026–2027 学年秋季正式课表',
    saved_at: '2026-08-04T17:27:07.752Z',
  }), '2026–2027 学年秋季正式课表');
});

test('legacy archives explain missing metadata and isolate deletion from restore', () => {
  assert.match(appSource, /旧版存档未记录学年、用途或保存人/);
  assert.match(appSource, /恢复前会自动备份当前课表/);
  assert.match(appSource, /<details class="schedule-archive-danger">/);
  assert.match(appSource, /<summary>更多操作<\/summary>/);
});

test('the complete-schedule archive action is available from both review surfaces', () => {
  const manualView = html.slice(
    html.indexOf('id="view-manual-timetable"'),
    html.indexOf('id="view-past-timetables"'),
  );
  const overviewView = html.slice(
    html.indexOf('id="view-overview-timetable"'),
    html.indexOf('id="view-status"'),
  );

  assert.match(manualView, /class="manual-archive-panel"/);
  assert.match(manualView, /id="manual-save-schedule"/);
  assert.match(manualView, /保存当前完整课表/);
  assert.match(overviewView, /id="overview-save-schedule"/);
  assert.match(overviewView, /保存为过往课表/);
});

test('archive controls enable only for a valid complete timetable', () => {
  const { applyScheduleArchiveStatus, elements } = archiveControls();

  applyScheduleArchiveStatus({ solve_status: 'valid', review_required: false });
  assert.equal(elements['overview-save-schedule'].disabled, false);
  assert.equal(elements['manual-save-schedule'].disabled, false);
  assert.match(elements['overview-archive-status'].textContent, /可以保存/);
  assert.match(elements['manual-archive-status'].textContent, /可以保存/);

  applyScheduleArchiveStatus({ solve_status: 'stale', review_required: false });
  assert.equal(elements['overview-save-schedule'].disabled, true);
  assert.equal(elements['manual-save-schedule'].disabled, true);
  assert.match(elements['overview-archive-status'].textContent, /完成排课后/);
});

test('saving from either surface archives the backend complete schedule', async () => {
  const {
    applyScheduleArchiveStatus,
    saveCurrentScheduleArchive,
    elements,
    requests,
    toasts,
  } = archiveControls();
  applyScheduleArchiveStatus({ solve_status: 'valid', review_required: false });

  await saveCurrentScheduleArchive();

  assert.deepEqual(requests.map(request => request.path), [
    '/schedule-quality-review',
    '/schedule-archives',
  ]);
  assert.equal(requests[1].options.method, 'POST');
  assert.deepEqual(JSON.parse(requests[1].options.body), {
    name: '2026–2027 学年秋季正式课表',
    notes: '教务处已完成核对',
  });
  assert.equal(elements['overview-save-schedule'].disabled, false);
  assert.equal(elements['manual-save-schedule'].disabled, false);
  assert.match(elements['overview-archive-status'].textContent, /保存为独立快照/);
  assert.match(elements['manual-archive-status'].textContent, /保存为独立快照/);
  assert.match(toasts.at(-1).message, /课表已储存/);
});
