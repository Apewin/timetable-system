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

test('a historical timetable can be restored only after an impact preview and creates a safety copy', async () => {
  assert.match(appSource, /data-restore-archive="\$\{safeDataAttribute\(archive\.id\)\}"/);
  assert.match(appSource, />恢复为当前课表</);
  const requests = [];
  const confirmations = [];
  const toasts = [];
  const switchedViews = [];
  const button = { disabled: false, isConnected: true };
  const restoreSource = sourceBetween(
    'async function restoreScheduleArchive',
    '\nasync function deleteScheduleArchive',
  );
  const restore = new Function(
    'window', 'api', 'confirm', 'showToast', 'switchView', 'formatArchiveDateTime', 'scheduleArchiveDisplayName',
    `${restoreSource}; return restoreScheduleArchive;`,
  )(
    {},
    async (path, options = {}) => {
      requests.push({ path, options });
      if (path.endsWith('/restore-preview')) {
        return {
          archive: { id: 'ARCHIVE_1', name: '2025–2026 学年正式课表', saved_at: '2026-07-01T08:00:00.000Z' },
          revision: 91,
          creates_safety_snapshot: true,
          impact: {
            students: { current: 219, restored: 216 },
            teachers: { current: 43, restored: 42 },
            courses: { current: 51, restored: 50 },
          },
        };
      }
      if (path.endsWith('/restore') && options.method === 'POST') {
        return { message: '已恢复；恢复前版本已自动保存' };
      }
      throw new Error(`unexpected API request ${path}`);
    },
    message => { confirmations.push(message); return true; },
    (message, type) => toasts.push({ message, type }),
    async view => { switchedViews.push(view); },
    value => value,
    archive => archive.name || archive.id,
  );

  await restore('ARCHIVE_1', button);

  assert.deepEqual(requests.map(request => request.path), [
    '/schedule-archives/ARCHIVE_1/restore-preview',
    '/schedule-archives/ARCHIVE_1/restore',
  ]);
  assert.match(confirmations[0], /219 → 216/);
  assert.match(confirmations[0], /自动保存/);
  assert.deepEqual(JSON.parse(requests[1].options.body), {
    expected_revision: 91,
    confirmation: 'ARCHIVE_1',
  });
  assert.deepEqual(switchedViews, ['overview-timetable']);
  assert.equal(toasts.at(-1).type, 'success');
  assert.equal(button.disabled, false);
});
