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

test('a confirmed archive-card deletion removes only the selected snapshot and refreshes the list', async () => {
  assert.match(appSource, /data-delete-archive="\$\{safeDataAttribute\(archive\.id\)\}"/);
  assert.match(appSource, />删除存档</);

  const requests = [];
  const confirmations = [];
  const toasts = [];
  let reloadCount = 0;
  const button = { disabled: false, isConnected: true };
  const browserWindow = { _selectedScheduleArchiveId: 'ARCHIVE_1' };
  const deleteSource = sourceBetween(
    'async function deleteScheduleArchive',
    '\nasync function loadPastTimetables',
  );
  const deleteArchive = new Function(
    'window', 'api', 'confirm', 'showToast', 'loadPastTimetables', 'formatArchiveDateTime', 'scheduleArchiveDisplayName',
    `${deleteSource}; return deleteScheduleArchive;`,
  )(
    browserWindow,
    async (path, options = {}) => {
      requests.push({ path, options });
      if (path.endsWith('/delete-preview')) {
        return {
          archive: {
            id: 'ARCHIVE_1',
            name: '八月正式课表',
            saved_at: '2026-08-20T08:00:00.000Z',
          },
          revision: 88,
          remaining_count: 2,
        };
      }
      if (path === '/schedule-archives/ARCHIVE_1' && options.method === 'DELETE') {
        return { message: '已删除过往课表“八月正式课表”；当前课表没有变化' };
      }
      throw new Error(`unexpected API request ${path}`);
    },
    message => { confirmations.push(message); return true; },
    (message, type) => toasts.push({ message, type }),
    async () => { reloadCount += 1; },
    value => value,
    archive => archive.name || archive.id,
  );

  await deleteArchive('ARCHIVE_1', button);

  assert.deepEqual(requests.map(request => request.path), [
    '/schedule-archives/ARCHIVE_1/delete-preview',
    '/schedule-archives/ARCHIVE_1',
  ]);
  assert.match(confirmations[0], /八月正式课表/);
  assert.match(confirmations[0], /无法恢复/);
  assert.match(confirmations[0], /当前正在使用的课表不会变化/);
  assert.deepEqual(JSON.parse(requests[1].options.body), {
    expected_revision: 88,
    confirmation: 'ARCHIVE_1',
  });
  assert.equal(browserWindow._selectedScheduleArchiveId, null);
  assert.equal(reloadCount, 1);
  assert.equal(button.disabled, false);
  assert.match(toasts.at(-1).message, /当前课表没有变化/);
  assert.equal(toasts.at(-1).type, 'success');
});
