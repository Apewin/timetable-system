import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

function boundedLimit(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? Math.min(500, Math.max(1, parsed)) : 100;
}

export function createOperationAudit({ file, now = () => Date.now() } = {}) {
  if (!file) throw new Error('操作审计必须配置文件路径');
  return {
    file,
    record({ actor, method, path, status, ip }) {
      const entry = {
        id: randomUUID(),
        occurred_at: new Date(now()).toISOString(),
        actor: String(actor || 'anonymous'),
        method: String(method || '').toUpperCase(),
        path: String(path || ''),
        status: Number(status || 0),
        ip: String(ip || ''),
      };
      appendFileSync(file, `${JSON.stringify(entry)}\n`, { encoding: 'utf8', mode: 0o600 });
      return entry;
    },
    recent(limit = 100) {
      if (!existsSync(file)) return [];
      const lines = readFileSync(file, 'utf8').trim().split(/\r?\n/).filter(Boolean);
      return lines.slice(-boundedLimit(limit)).reverse().flatMap(line => {
        try { return [JSON.parse(line)]; } catch { return []; }
      });
    },
  };
}
