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

function archiveControls({ review = { required: false } } = {}) {
  const elements = {
    'overview-save-schedule': { disabled: true },
    'overview-archive-status': { textContent: '', className: '' },
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
    `${archiveSource}; return { applyOverviewScheduleStatus, saveCurrentScheduleArchive };`,
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
    () => null,
    () => '质量分析',
    (message, type) => toasts.push({ message, type }),
  );
  return { ...controls, elements, requests, toasts };
}

test('the archive action lives with the complete overview instead of the necessary-condition editor', () => {
  const manualView = html.slice(
    html.indexOf('id="view-manual-timetable"'),
    html.indexOf('id="view-past-timetables"'),
  );
  const overviewView = html.slice(
    html.indexOf('id="view-overview-timetable"'),
    html.indexOf('id="view-status"'),
  );

  assert.doesNotMatch(manualView, /id="manual-save-schedule"/);
  assert.match(manualView, /只用于编辑 AI 排课必须保留的必要条件/);
  assert.match(overviewView, /id="overview-save-schedule"/);
  assert.match(overviewView, /保存为过往课表/);
});

test('overview archive controls enable only for a valid complete timetable', () => {
  const { applyOverviewScheduleStatus, elements } = archiveControls();

  applyOverviewScheduleStatus({ solve_status: 'valid', review_required: false });
  assert.equal(elements['overview-save-schedule'].disabled, false);
  assert.match(elements['overview-archive-status'].textContent, /可以保存/);

  applyOverviewScheduleStatus({ solve_status: 'stale', review_required: false });
  assert.equal(elements['overview-save-schedule'].disabled, true);
  assert.match(elements['overview-archive-status'].textContent, /完成排课后/);
});

test('saving from the overview archives the backend complete schedule', async () => {
  const {
    applyOverviewScheduleStatus,
    saveCurrentScheduleArchive,
    elements,
    requests,
    toasts,
  } = archiveControls();
  applyOverviewScheduleStatus({ solve_status: 'valid', review_required: false });

  await saveCurrentScheduleArchive();

  assert.deepEqual(requests.map(request => request.path), [
    '/schedule-quality-review',
    '/schedule-archives',
  ]);
  assert.equal(requests[1].options.method, 'POST');
  assert.deepEqual(JSON.parse(requests[1].options.body), {});
  assert.equal(elements['overview-save-schedule'].disabled, false);
  assert.match(elements['overview-archive-status'].textContent, /保存为独立快照/);
  assert.match(toasts.at(-1).message, /课表已储存/);
});
