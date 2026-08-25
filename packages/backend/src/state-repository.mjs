import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, join } from 'node:path';
import { compactPersistedState, hydrateDerivedScheduleState } from './schedule-projection.mjs';
import { migrateStateDocument, stateDocumentForWrite } from './state-schema.mjs';

function freezeDeep(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) freezeDeep(child, seen);
  return Object.freeze(value);
}

export class StateRepository {
  constructor(file, {
    backupDirectory = `${file}.backups`,
    maxBackups = 30,
    now = () => Date.now(),
  } = {}) {
    if (!Number.isInteger(maxBackups) || maxBackups < 0 || maxBackups > 1_000) {
      throw new Error('状态备份保留数量必须是 0–1000 的整数');
    }
    this.file = file;
    this.backupDirectory = backupDirectory;
    this.maxBackups = maxBackups;
    this.now = now;
    this.backupSequence = 0;
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
    const migrated = migrateStateDocument(parsed).state;
    this.cached = freezeDeep(hydrateDerivedScheduleState(migrated));
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
    const next = stateDocumentForWrite(compactPersistedState(state));
    next.meta = {
      ...next.meta,
      revision: currentRevision + 1,
      updated_at: new Date().toISOString(),
    };
    const temporary = `${this.file}.${process.pid}.${Date.now()}.next`;
    try {
      writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o600,
      });
      this.backupCurrent(currentRevision);
      renameSync(temporary, this.file);
      chmodSync(this.file, 0o600);
      this.pruneBackups();
    } catch (error) {
      if (existsSync(temporary)) unlinkSync(temporary);
      throw error;
    }
    this.cached = null;
    this.cachedFingerprint = null;
    return this.read();
  }

  backupCurrent(revision) {
    if (!this.maxBackups || !existsSync(this.file)) return null;
    mkdirSync(this.backupDirectory, { recursive: true, mode: 0o700 });
    const timestamp = new Date(this.now()).toISOString().replace(/[:.]/g, '-');
    const sequence = ++this.backupSequence;
    const backup = join(
      this.backupDirectory,
      `${basename(this.file)}.r${revision}.${timestamp}.${process.pid}-${sequence}.json`,
    );
    copyFileSync(this.file, backup);
    chmodSync(backup, 0o600);
    return backup;
  }

  pruneBackups() {
    if (!this.maxBackups || !existsSync(this.backupDirectory)) return;
    const prefix = `${basename(this.file)}.r`;
    const files = readdirSync(this.backupDirectory)
      .filter(name => name.startsWith(prefix))
      .map(name => ({
        name,
        revision: Number(name.slice(prefix.length).split('.', 1)[0]),
      }))
      .sort((left, right) => {
        const leftRevision = Number.isSafeInteger(left.revision) ? left.revision : -1;
        const rightRevision = Number.isSafeInteger(right.revision) ? right.revision : -1;
        return rightRevision - leftRevision || right.name.localeCompare(left.name);
      });
    for (const { name } of files.slice(this.maxBackups)) {
      unlinkSync(join(this.backupDirectory, name));
    }
  }

  listBackups() {
    if (!existsSync(this.backupDirectory)) return [];
    const prefix = `${basename(this.file)}.r`;
    return readdirSync(this.backupDirectory)
      .filter(name => name.startsWith(prefix) && basename(name) === name)
      .flatMap(name => {
        try {
          const file = join(this.backupDirectory, name);
          const stat = statSync(file);
          const state = JSON.parse(readFileSync(file, 'utf8'));
          const revision = this.revision(state);
          return [{
            id: name,
            revision,
            updated_at: state.meta?.updated_at || null,
            created_at: stat.mtime.toISOString(),
            size_bytes: stat.size,
            solve_status: state.solve_status || 'not_run',
            counts: Object.fromEntries(['students', 'teachers', 'courses', 'rooms']
              .map(key => [key, Array.isArray(state[key]) ? state[key].length : 0])),
          }];
        } catch {
          return [];
        }
      })
      .sort((left, right) => right.revision - left.revision
        || String(right.created_at).localeCompare(String(left.created_at))
        || right.id.localeCompare(left.id));
  }

  restoreBackup(id, { expectedRevision } = {}) {
    const requested = String(id || '');
    const descriptor = basename(requested) === requested
      ? this.listBackups().find(item => item.id === requested)
      : null;
    if (!descriptor) {
      const error = new Error('备份版本不存在或已超出保留期限');
      error.code = 'BACKUP_NOT_FOUND';
      throw error;
    }
    const state = JSON.parse(readFileSync(join(this.backupDirectory, descriptor.id), 'utf8'));
    return this.write(migrateStateDocument(state).state, { expectedRevision });
  }
}
