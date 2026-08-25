import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';

const JOB_STORE_SCHEMA_VERSION = 1;
const TERMINAL_STATUSES = new Set(['succeeded', 'failed', 'cancelled', 'interrupted']);

function iso(timestamp) {
  return new Date(timestamp).toISOString();
}

function boundedPercent(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(100, Math.max(0, Math.round(parsed))) : fallback;
}

function publicJob(job, result) {
  return {
    id: job.id,
    type: job.type,
    label: job.label,
    status: job.status,
    stage: job.stage,
    percent: job.percent,
    message: job.message,
    result_location: job.result_location,
    actor: job.actor,
    created_at: job.created_at,
    started_at: job.started_at,
    finished_at: job.finished_at,
    error: job.error,
    cancelable: ['queued', 'running'].includes(job.status),
    ...(result === undefined ? {} : { result }),
  };
}

function persistedDocument(jobs) {
  return {
    schema_version: JOB_STORE_SCHEMA_VERSION,
    jobs: [...jobs.values()].map(job => publicJob(job)),
  };
}

export function createComputationJobManager({
  file,
  maxJobs = 50,
  now = () => Date.now(),
} = {}) {
  if (!Number.isInteger(maxJobs) || maxJobs < 1 || maxJobs > 500) {
    throw new Error('计算作业保留数量必须是 1–500 的整数');
  }
  const jobs = new Map();
  const results = new Map();
  const controllers = new Map();

  if (file && existsSync(file)) {
    try {
      const stored = JSON.parse(readFileSync(file, 'utf8'));
      for (const item of Array.isArray(stored.jobs) ? stored.jobs : []) {
        const interrupted = ['queued', 'running'].includes(item.status);
        jobs.set(item.id, {
          ...item,
          status: interrupted ? 'interrupted' : item.status,
          stage: interrupted ? 'interrupted' : item.stage,
          message: interrupted ? '后端重启中断了该作业，请重新发起计算。' : item.message,
          error: interrupted ? { code: 'JOB_INTERRUPTED', message: '后端重启中断了该作业' } : item.error,
          finished_at: interrupted ? iso(now()) : item.finished_at,
        });
      }
    } catch {
      // A damaged auxiliary job history must never prevent the core system
      // from starting. New jobs will replace it with a valid document.
    }
  }

  function persist() {
    if (!file) return;
    const temporary = `${file}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(persistedDocument(jobs), null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
    renameSync(temporary, file);
  }

  function prune() {
    const ordered = [...jobs.values()].sort((left, right) =>
      String(right.created_at).localeCompare(String(left.created_at)));
    for (const job of ordered.slice(maxJobs)) {
      jobs.delete(job.id);
      results.delete(job.id);
      controllers.delete(job.id);
    }
  }

  function update(job, values) {
    Object.assign(job, values);
    persist();
    return publicJob(job, results.get(job.id));
  }

  return {
    start({ type, label, resultLocation, actor, run }) {
      if (typeof run !== 'function') throw new Error('计算作业必须提供执行函数');
      const createdAt = now();
      const job = {
        id: randomUUID(),
        type: String(type || 'calculation'),
        label: String(label || '后台计算'),
        status: 'queued',
        stage: 'queued',
        percent: 0,
        message: '作业已进入队列',
        result_location: resultLocation || null,
        actor: String(actor || 'unknown'),
        created_at: iso(createdAt),
        started_at: null,
        finished_at: null,
        error: null,
      };
      const controller = new AbortController();
      jobs.set(job.id, job);
      controllers.set(job.id, controller);
      prune();
      persist();

      queueMicrotask(async () => {
        if (controller.signal.aborted || job.status === 'cancelled') return;
        update(job, {
          status: 'running',
          stage: 'starting',
          percent: 2,
          message: '正在准备数据与约束',
          started_at: iso(now()),
        });
        const progress = ({ stage, percent, message } = {}) => {
          if (job.status !== 'running') return publicJob(job);
          return update(job, {
            stage: String(stage || job.stage || 'running'),
            percent: boundedPercent(percent, job.percent),
            message: String(message || job.message || '正在计算'),
          });
        };
        try {
          const result = await run({ signal: controller.signal, progress, jobId: job.id });
          if (controller.signal.aborted || job.status === 'cancelled') return;
          results.set(job.id, result);
          update(job, {
            status: 'succeeded',
            stage: 'completed',
            percent: 100,
            message: '计算完成，结果已保存',
            finished_at: iso(now()),
          });
        } catch (error) {
          if (controller.signal.aborted || error?.code === 'SOLVER_JOB_CANCELLED') {
            if (job.status !== 'cancelled') update(job, {
              status: 'cancelled',
              stage: 'cancelled',
              message: '作业已取消，未覆盖已有有效结果',
              finished_at: iso(now()),
              error: null,
            });
            return;
          }
          update(job, {
            status: 'failed',
            stage: 'failed',
            percent: 100,
            message: error?.message || '计算失败',
            finished_at: iso(now()),
            error: { code: error?.code || 'COMPUTATION_FAILED', message: error?.message || '计算失败' },
          });
        } finally {
          controllers.delete(job.id);
        }
      });
      return publicJob(job);
    },
    get(id, { includeResult = true } = {}) {
      const job = jobs.get(String(id));
      return job ? publicJob(job, includeResult ? results.get(job.id) : undefined) : null;
    },
    recent(limit = 20) {
      const count = Math.min(maxJobs, Math.max(1, Number(limit) || 20));
      return [...jobs.values()]
        .sort((left, right) => String(right.created_at).localeCompare(String(left.created_at)))
        .slice(0, count)
        .map(job => publicJob(job));
    },
    cancel(id) {
      const job = jobs.get(String(id));
      if (!job) return null;
      if (TERMINAL_STATUSES.has(job.status)) return publicJob(job, results.get(job.id));
      controllers.get(job.id)?.abort();
      return update(job, {
        status: 'cancelled',
        stage: 'cancelled',
        message: '作业已取消，未覆盖已有有效结果',
        finished_at: iso(now()),
        error: null,
      });
    },
  };
}
