import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';

export class StateRepository {
  constructor(file) { this.file = file; }

  revision(state) {
    const value = Number(state?.meta?.revision);
    return Number.isSafeInteger(value) && value >= 0 ? value : 0;
  }

  read() {
    if (!existsSync(this.file)) throw new Error(`状态文件不存在: ${this.file}`);
    return JSON.parse(readFileSync(this.file, 'utf8'));
  }

  write(state, { expectedRevision } = {}) {
    const current = existsSync(this.file) ? this.read() : null;
    const currentRevision = this.revision(current);
    if (expectedRevision !== undefined && expectedRevision !== currentRevision) {
      const error = new Error(`状态已在排课期间更新（预期版本 ${expectedRevision}，当前版本 ${currentRevision}）`);
      error.code = 'STATE_VERSION_CONFLICT';
      error.expected_revision = expectedRevision;
      error.current_revision = currentRevision;
      throw error;
    }
    const next = structuredClone(state);
    next.meta = {
      ...next.meta,
      revision: currentRevision + 1,
      updated_at: new Date().toISOString(),
    };
    const temporary = `${this.file}.next`;
    writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    renameSync(temporary, this.file);
    return next;
  }
}
