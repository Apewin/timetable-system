import assert from 'node:assert/strict';
import test from 'node:test';

import { changeSchedulingRooms } from '../scheduling-room-view.mjs';

test('adds a timetable room with a stable generated id', () => {
  assert.deepEqual(changeSchedulingRooms([], {
    type: 'add',
    name: '一号教室',
    roomType: 'general',
    capacity: 32,
  }), [{ id: 'ROOM_1', name: '一号教室', type: 'general', capacity: 32 }]);
});

test('adds a timetable room using a supplied door number as its id', () => {
  assert.deepEqual(changeSchedulingRooms([], {
    type: 'add',
    id: 'A201',
    name: '高二一班教室',
    roomType: 'general',
    capacity: 30,
  }), [{ id: 'A201', name: '高二一班教室', type: 'general', capacity: 30 }]);
});

test('updates a timetable room without changing its id', () => {
  assert.deepEqual(changeSchedulingRooms([
    { id: 'R1', name: '旧教室', type: 'general', capacity: 30 },
  ], {
    type: 'update',
    id: 'R1',
    name: '物理实验室',
    roomType: 'physics',
    capacity: 24,
  }), [{ id: 'R1', name: '物理实验室', type: 'physics', capacity: 24 }]);
});

test('changes a timetable room id to its door number', () => {
  assert.deepEqual(changeSchedulingRooms([
    { id: 'ROOM_1', name: '高一一班教室', type: 'general', capacity: 30 },
  ], {
    type: 'update',
    id: 'ROOM_1',
    newId: '101',
    name: '高一一班教室',
    roomType: 'general',
    capacity: 30,
  }), [{ id: '101', name: '高一一班教室', type: 'general', capacity: 30 }]);
});

test('rejects a duplicate door number when changing a room id', () => {
  assert.throws(() => changeSchedulingRooms([
    { id: '101', name: '一号教室', type: 'general', capacity: 30 },
    { id: 'A201', name: '二号教室', type: 'general', capacity: 30 },
  ], {
    type: 'update',
    id: '101',
    newId: ' a201 ',
    name: '一号教室',
    roomType: 'general',
    capacity: 30,
  }), /门牌号.*不能重复/);
});

test('allows deleting the final timetable room because rooms are optional', () => {
  assert.deepEqual(changeSchedulingRooms([
    { id: 'R1', name: '一号教室', type: 'general', capacity: 30 },
  ], { type: 'delete', id: 'R1' }), []);
});
