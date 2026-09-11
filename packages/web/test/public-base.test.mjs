import assert from 'node:assert/strict';
import test from 'node:test';
import { publicBaseFromVite } from '../public-base.mjs';

test('vite base /timetable/ becomes the browser API prefix', () => {
  assert.equal(publicBaseFromVite('/'), '');
  assert.equal(publicBaseFromVite('/timetable/'), '/timetable');
  assert.equal(`${publicBaseFromVite('/timetable/')}/api`, '/timetable/api');
});
