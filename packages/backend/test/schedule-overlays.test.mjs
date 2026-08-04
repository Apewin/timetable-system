import assert from 'node:assert/strict';
import test from 'node:test';

import { createScheduleOverlay } from '../src/schedule-overlays.mjs';

test('creates a special event across consecutive periods in one day', () => {
  const overlay = createScheduleOverlay([], {
    id: 'OVERLAY_TEST',
    class_id: 'TC_G12_3',
    kind: 'special_event',
    title: '年级讲座',
    start_slot_id: 'D3P4',
    duration: 3,
    color: '#7e57c2',
  });

  assert.deepEqual(overlay, {
    id: 'OVERLAY_TEST',
    class_id: 'TC_G12_3',
    kind: 'special_event',
    title: '年级讲座',
    color: '#7e57c2',
    slot_ids: ['D3P4', 'D3P5', 'D3P6'],
  });
});

test('refuses an event that crosses the day boundary or overlaps another event', () => {
  assert.throws(
    () => createScheduleOverlay([], {
      id: 'OVERLAY_TOO_LONG', class_id: 'TC_G12_3', kind: 'special_event',
      title: '讲座', start_slot_id: 'D2P9', duration: 3,
    }),
    /不能跨越当天第 10 节课/,
  );
  assert.throws(
    () => createScheduleOverlay([{
      id: 'OVERLAY_EXISTING', class_id: 'TC_G12_3', kind: 'self_study',
      title: '自习', color: '#607d8b', slot_ids: ['D2P4'],
    }], {
      id: 'OVERLAY_COLLISION', class_id: 'TC_G12_3', kind: 'special_event',
      title: '讲座', start_slot_id: 'D2P3', duration: 2,
    }),
    /不能覆盖已有的自习或特殊事件/,
  );
});
