import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';

export class StateRepository {
  constructor(file) { this.file = file; }

  read() {
    if (!existsSync(this.file)) throw new Error(`状态文件不存在: ${this.file}`);
    return JSON.parse(readFileSync(this.file, 'utf8'));
  }

  write(state) {
    const next = structuredClone(state);
    next.meta = { ...next.meta, updated_at: new Date().toISOString() };
    const temporary = `${this.file}.next`;
    writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    renameSync(temporary, this.file);
    return next;
  }
}
