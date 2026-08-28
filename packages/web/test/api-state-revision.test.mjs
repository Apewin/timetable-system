import assert from 'node:assert/strict';
import test from 'node:test';
import {
  StateRevisionTracker,
  mutationNeedsStateRevision,
} from '../api-state-revision.mjs';

test('tracks the newest server revision and formats a strong If-Match header', () => {
  const tracker = new StateRevisionTracker();
  assert.equal(tracker.ifMatchHeader(), null);
  tracker.observe({ headers: new Headers({ 'x-state-revision': '7' }) }, { data: {} });
  assert.equal(tracker.revision, 7);
  assert.equal(tracker.ifMatchHeader(), '"7"');
  tracker.observe({ headers: new Headers() }, { data: { revision: 8 } });
  assert.equal(tracker.revision, 8);
});

test('never rolls the revision backwards when responses finish out of order', () => {
  const tracker = new StateRevisionTracker(12);
  tracker.observe({ headers: new Headers({ 'x-state-revision': '10' }) }, { data: { revision: 9 } });
  assert.equal(tracker.revision, 12);
});

test('learns the current revision from a rejected stale-write response', () => {
  const tracker = new StateRevisionTracker(7);
  tracker.observe(
    { status: 409, headers: new Headers({ 'x-state-revision': '9' }) },
    { ok: false, errors: [{ code: 'STATE_VERSION_CONFLICT' }] },
  );
  assert.equal(tracker.ifMatchHeader(), '"9"');
});

test('requires revisions for data mutations but not reads or session endpoints', () => {
  assert.equal(mutationNeedsStateRevision('/teachers/T1', 'PUT'), true);
  assert.equal(mutationNeedsStateRevision('/courses', 'POST'), true);
  assert.equal(mutationNeedsStateRevision('/teachers/T1', 'DELETE'), true);
  assert.equal(mutationNeedsStateRevision('/teachers', 'GET'), false);
  assert.equal(mutationNeedsStateRevision('/auth/login', 'POST'), false);
  assert.equal(mutationNeedsStateRevision('/auth/logout', 'POST'), false);
});
