import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizePublicPath,
  stripPublicPathFromUrl,
} from '../src/public-path.mjs';

test('defaults to /timetable and rejects nested public paths', () => {
  assert.equal(normalizePublicPath(undefined), '/timetable');
  assert.equal(normalizePublicPath(''), '');
  assert.equal(normalizePublicPath('/paike/'), '/paike');
  assert.throws(() => normalizePublicPath('/a/b'), /单段路径/);
});

test('strips the public prefix while leaving root API routes alone', () => {
  assert.equal(stripPublicPathFromUrl('/api/status', '/timetable'), '/api/status');
  assert.equal(stripPublicPathFromUrl('/timetable', '/timetable'), '/');
  assert.equal(stripPublicPathFromUrl('/timetable/', '/timetable'), '/');
  assert.equal(stripPublicPathFromUrl('/timetable/api/status?x=1', '/timetable'), '/api/status?x=1');
  assert.equal(stripPublicPathFromUrl('/timetable-other/api', '/timetable'), '/timetable-other/api');
});
