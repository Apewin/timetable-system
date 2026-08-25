import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

const SESSION_COOKIE = 'timetable_session';
const DEFAULT_SESSION_TTL_MS = 12 * 60 * 60 * 1_000;
const DEFAULT_LOGIN_WINDOW_MS = 5 * 60 * 1_000;

function secureEqual(left, right) {
  const leftHash = createHash('sha256').update(String(left)).digest();
  const rightHash = createHash('sha256').update(String(right)).digest();
  return timingSafeEqual(leftHash, rightHash);
}

function encoded(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function decoded(value) {
  return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
}

function signature(payload, secret) {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

function cookieValue(cookieHeader, name) {
  for (const part of String(cookieHeader || '').split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    return part.slice(separator + 1).trim();
  }
  return '';
}

export function createSecurityBoundary({
  mode = 'off',
  password = '',
  sessionSecret = '',
  sessionTtlMs = DEFAULT_SESSION_TTL_MS,
  now = () => Date.now(),
} = {}) {
  if (!['off', 'password'].includes(mode)) throw new Error(`不支持的认证模式: ${mode}`);
  if (mode === 'password' && !password) throw new Error('password 认证模式必须配置管理员密码');
  if (mode === 'password' && String(sessionSecret).length < 32) {
    throw new Error('password 认证模式的会话密钥至少需要 32 个字符');
  }
  const enabled = mode === 'password';

  return {
    enabled,
    mode,
    login(candidate) {
      if (!enabled || !secureEqual(candidate, password)) throw new Error('管理员密码错误');
      const issuedAt = now();
      const payload = encoded({
        sub: 'admin',
        iat: issuedAt,
        exp: issuedAt + sessionTtlMs,
        jti: randomUUID(),
      });
      const token = `${payload}.${signature(payload, sessionSecret)}`;
      return {
        actor: 'admin',
        expires_at: new Date(issuedAt + sessionTtlMs).toISOString(),
        cookie: `${SESSION_COOKIE}=${token}`,
      };
    },
    authenticate(cookieHeader) {
      if (!enabled) return { authenticated: true, actor: 'trusted-lan' };
      const token = cookieValue(cookieHeader, SESSION_COOKIE);
      const [payload, suppliedSignature, ...rest] = token.split('.');
      if (!payload || !suppliedSignature || rest.length) return { authenticated: false, actor: null };
      const expectedSignature = signature(payload, sessionSecret);
      if (!secureEqual(suppliedSignature, expectedSignature)) return { authenticated: false, actor: null };
      try {
        const session = decoded(payload);
        if (session.sub !== 'admin' || !Number.isFinite(session.exp) || session.exp <= now()) {
          return { authenticated: false, actor: null };
        }
        return { authenticated: true, actor: session.sub, expires_at: new Date(session.exp).toISOString() };
      } catch {
        return { authenticated: false, actor: null };
      }
    },
    sessionCookie(session, { secure = false } = {}) {
      const attributes = [
        session.cookie,
        'Path=/',
        `Max-Age=${Math.floor(sessionTtlMs / 1_000)}`,
        'HttpOnly',
        'SameSite=Strict',
      ];
      if (secure) attributes.push('Secure');
      return attributes.join('; ');
    },
    clearSessionCookie({ secure = false } = {}) {
      const attributes = [
        `${SESSION_COOKIE}=`,
        'Path=/',
        'Max-Age=0',
        'HttpOnly',
        'SameSite=Strict',
      ];
      if (secure) attributes.push('Secure');
      return attributes.join('; ');
    },
  };
}

export function securityBoundaryFromEnv(env = process.env) {
  const mode = String(env.TIMETABLE_AUTH_MODE || 'off').trim().toLowerCase();
  const ttlHours = Number(env.TIMETABLE_SESSION_TTL_HOURS || 12);
  if (!Number.isFinite(ttlHours) || ttlHours <= 0 || ttlHours > 168) {
    throw new Error('TIMETABLE_SESSION_TTL_HOURS 必须在 0–168 小时之间');
  }
  return createSecurityBoundary({
    mode,
    password: env.TIMETABLE_ADMIN_PASSWORD || '',
    sessionSecret: env.TIMETABLE_SESSION_SECRET || '',
    sessionTtlMs: ttlHours * 60 * 60 * 1_000,
  });
}

export function createLoginAttemptLimiter({
  maxFailures = 5,
  windowMs = DEFAULT_LOGIN_WINDOW_MS,
  now = () => Date.now(),
} = {}) {
  if (!Number.isInteger(maxFailures) || maxFailures < 1 || maxFailures > 100) {
    throw new Error('登录失败次数上限必须是 1–100 的整数');
  }
  if (!Number.isFinite(windowMs) || windowMs < 1_000) {
    throw new Error('登录限流时间窗口至少为 1 秒');
  }
  const attempts = new Map();

  function current(key) {
    const entry = attempts.get(String(key));
    if (!entry || entry.resetAt <= now()) {
      attempts.delete(String(key));
      return null;
    }
    return entry;
  }

  return {
    check(key) {
      const entry = current(key);
      if (!entry || entry.failures < maxFailures) return { allowed: true, retry_after_seconds: 0 };
      return {
        allowed: false,
        retry_after_seconds: Math.max(1, Math.ceil((entry.resetAt - now()) / 1_000)),
      };
    },
    recordFailure(key) {
      const entry = current(key) || { failures: 0, resetAt: now() + windowMs };
      entry.failures += 1;
      attempts.set(String(key), entry);
      return this.check(key);
    },
    clear(key) {
      attempts.delete(String(key));
    },
  };
}
