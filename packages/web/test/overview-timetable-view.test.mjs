import assert from 'node:assert/strict';
import test from 'node:test';

import { overviewCardSummary } from '../overview-timetable-view.mjs';

test('summarizes scheduled periods without exposing an internal id', () => {
  assert.deepEqual(overviewCardSummary({
    item: { id: 'T_INTERNAL_17', name: '张老师', max_per_week: 25 },
    viewType: 'teacher',
    data: { rows: [{ 1: { course: '数学' }, 2: null }, { 1: { course: '物理' } }] },
  }), {
    title: '张老师',
    scheduled_periods: 2,
    capacity_text: '已排 2 节 · 周上限 25 节',
  });
});
