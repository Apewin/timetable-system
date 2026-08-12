import {
  existsSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { compactPersistedState, hydrateDerivedScheduleState } from './schedule-projection.mjs';

function freezeDeep(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) freezeDeep(child, seen);
  return Object.freeze(value);
}

export class StateRepository {
  constructor(file) {
    this.file = file;
    this.cached = null;
    this.cachedFingerprint = null;
  }

  revision(state) {
    const value = Number(state?.meta?.revision);
    return Number.isSafeInteger(value) && value >= 0 ? value : 0;
  }

  read() {
    if (!existsSync(this.file)) throw new Error(`状态文件不存在: ${this.file}`);
    const stat = statSync(this.file, { bigint: true });
    const fingerprint = `${stat.size}:${stat.mtimeNs}`;
    if (this.cached && fingerprint === this.cachedFingerprint) return this.cached;
    const parsed = JSON.parse(readFileSync(this.file, 'utf8'));
    this.cached = freezeDeep(hydrateDerivedScheduleState(parsed));
    this.cachedFingerprint = fingerprint;
    return this.cached;
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
    const next = compactPersistedState(state);
    next.meta = {
      ...next.meta,
      revision: currentRevision + 1,
      updated_at: new Date().toISOString(),
    };
    const temporary = `${this.file}.${process.pid}.${Date.now()}.next`;
    try {
      writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
      renameSync(temporary, this.file);
    } catch (error) {
      if (existsSync(temporary)) unlinkSync(temporary);
      throw error;
    }
    this.cached = null;
    this.cachedFingerprint = null;
    return this.read();
  }
}
