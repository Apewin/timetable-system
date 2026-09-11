export const DEFAULT_PUBLIC_PATH = '/timetable';

export function normalizePublicPath(raw, { defaultPath = DEFAULT_PUBLIC_PATH } = {}) {
  if (raw === '') return '';
  const value = String(raw ?? defaultPath).trim();
  if (!value || value === '/') return '';
  const normalized = `/${value.replace(/^\/+|\/+$/g, '')}`;
  if (!/^\/[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/.test(normalized)) {
    throw new Error('TIMETABLE_PUBLIC_PATH 只能是单段路径，例如 /timetable');
  }
  return normalized;
}

export function publicPathFromEnv(env = process.env) {
  return normalizePublicPath(env.TIMETABLE_PUBLIC_PATH);
}

export function stripPublicPathFromUrl(url, publicPath) {
  if (!publicPath) return url || '/';
  const raw = String(url || '/');
  const hashIndex = raw.indexOf('#');
  const withoutHash = hashIndex === -1 ? raw : raw.slice(0, hashIndex);
  const hash = hashIndex === -1 ? '' : raw.slice(hashIndex);
  const queryIndex = withoutHash.indexOf('?');
  const path = queryIndex === -1 ? withoutHash : withoutHash.slice(0, queryIndex);
  const query = queryIndex === -1 ? '' : withoutHash.slice(queryIndex);
  let nextPath = path;
  if (path === publicPath) nextPath = '/';
  else if (path.startsWith(`${publicPath}/`)) nextPath = path.slice(publicPath.length) || '/';
  return `${nextPath}${query}${hash}`;
}
