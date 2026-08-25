import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createLoginAttemptLimiter,
  createSecurityBoundary,
  securityBoundaryFromEnv,
} from '../src/security-boundary.mjs';

test('password mode issues a signed session that authenticates later requests', () => {
  const security = createSecurityBoundary({
    mode: 'password',
    password: 'correct horse battery staple',
    sessionSecret: 'a-secure-session-secret-with-at-least-32-characters',
    now: () => Date.UTC(2026, 7, 25, 8, 0, 0),
  });

  const session = security.login('correct horse battery staple');
  const authenticated = security.authenticate(`other=value; ${session.cookie}`);

  assert.equal(authenticated.authenticated, true);
  assert.equal(authenticated.actor, 'admin');
});

test('login attempt limiter blocks repeated failures until its window expires', () => {
  let currentTime = 1_000;
  const limiter = createLoginAttemptLimiter({
    maxFailures: 2,
    windowMs: 10_000,
    now: () => currentTime,
  });

  assert.equal(limiter.check('client').allowed, true);
  limiter.recordFailure('client');
  assert.equal(limiter.check('client').allowed, true);
  limiter.recordFailure('client');
  assert.equal(limiter.check('client').allowed, false);
  currentTime += 10_001;
  assert.equal(limiter.check('client').allowed, true);
});

test('environment configuration keeps authentication off unless password mode is explicit', () => {
  assert.equal(securityBoundaryFromEnv({}).enabled, false);
  assert.equal(securityBoundaryFromEnv({
    TIMETABLE_AUTH_MODE: 'password',
    TIMETABLE_ADMIN_PASSWORD: 'school-secret',
    TIMETABLE_SESSION_SECRET: 'another-secure-session-secret-with-32-characters',
  }).enabled, true);
});

test('session cookies are http-only, same-site, and secure behind HTTPS', () => {
  const security = createSecurityBoundary({
    mode: 'password',
    password: 'school-secret',
    sessionSecret: 'a-secure-session-secret-with-at-least-32-characters',
  });
  const session = security.login('school-secret');

  assert.match(security.sessionCookie(session, { secure: true }), /HttpOnly; SameSite=Strict; Secure/);
  assert.match(security.clearSessionCookie({ secure: true }), /Max-Age=0.*Secure/);
});
