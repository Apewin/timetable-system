import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createOperationAudit } from '../src/operation-audit.mjs';

test('records mutation metadata without persisting the request payload', t => {
  const directory = mkdtempSync(join(tmpdir(), 'timetable-audit-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const audit = createOperationAudit({
    file: join(directory, 'audit.jsonl'),
    now: () => Date.UTC(2026, 7, 25, 8, 0, 0),
  });

  audit.record({
    actor: 'admin', method: 'PUT', path: '/api/teachers/T1', status: 200,
    ip: '192.168.31.12', body: { name: '不应进入审计文件' },
  });

  const [entry] = audit.recent(10);
  assert.deepEqual(entry, {
    id: entry.id,
    occurred_at: '2026-08-25T08:00:00.000Z',
    actor: 'admin',
    method: 'PUT',
    path: '/api/teachers/T1',
    status: 200,
    ip: '192.168.31.12',
  });
});
