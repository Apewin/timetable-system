import assert from 'node:assert/strict';
import test from 'node:test';
import {
  teacherAvailabilityEditor,
  teacherAvailabilitySummary,
  teacherAvailableSlotsFromForm,
} from '../teacher-availability-view.mjs';

test('renders the full weekly availability grid and preserves selected slots', () => {
  const html = teacherAvailabilityEditor({ availableSlots: ['D1P1', 'D5P10'] });

  assert.match(html, /name="availability_mode"/);
  assert.match(html, /value="selected" selected/);
  assert.match(html, /name="available_slots" value="D1P1" checked/);
  assert.match(html, /name="available_slots" value="D5P10" checked/);
  assert.equal((html.match(/name="available_slots"/g) || []).length, 50);
});

test('serializes only the selected slots when availability is restricted', () => {
  const formData = new FormData();
  formData.set('availability_mode', 'selected');
  formData.append('available_slots', 'D1P1');
  formData.append('available_slots', 'D3P4');

  assert.deepEqual(teacherAvailableSlotsFromForm(formData), ['D1P1', 'D3P4']);
});

test('requires at least one slot when availability is restricted', () => {
  const formData = new FormData();
  formData.set('availability_mode', 'selected');

  assert.throws(
    () => teacherAvailableSlotsFromForm(formData),
    /至少勾选一个可用时段/,
  );
});

test('summarizes whether a teacher has a restricted timetable', () => {
  assert.equal(teacherAvailabilitySummary([]), '所有时段');
  assert.equal(teacherAvailabilitySummary(['D1P1', 'D2P2']), '限定 2 个时段');
});
