import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';

async function jsonResponse(response) {
  const content = await response.text();
  let payload;
  try {
    payload = content ? JSON.parse(content) : null;
  } catch {
    throw new Error(`后端返回了非 JSON 响应（HTTP ${response.status}）`);
  }
  if (!response.ok || payload?.ok === false) {
    const message = payload?.errors?.map(item => item.msg || item.message).filter(Boolean).join('；')
      || `请求失败（HTTP ${response.status}）`;
    throw new Error(message);
  }
  return payload;
}

export async function requestJson({ baseUrl, path, method, body }) {
  const response = await fetch(`${baseUrl.replace(/\/+$/, '')}${path}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return jsonResponse(response);
}

export async function requestMultipart({ baseUrl, path, fields = {}, files = [] }) {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) form.append(name, String(value));
  for (const file of files) {
    const buffer = await readFile(file.path);
    form.append(file.field, new Blob([buffer]), basename(file.path));
  }
  const response = await fetch(`${baseUrl.replace(/\/+$/, '')}${path}`, {
    method: 'POST',
    body: form,
  });
  return jsonResponse(response);
}
