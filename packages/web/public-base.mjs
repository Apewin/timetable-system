export function publicBaseFromVite(baseUrl) {
  const value = String(baseUrl || '/').trim() || '/';
  if (value === '/') return '';
  return value.replace(/\/+$/, '');
}

export const PUBLIC_BASE = publicBaseFromVite(import.meta.env?.BASE_URL);
export const API_BASE = `${PUBLIC_BASE}/api`;
