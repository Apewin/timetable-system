import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const DEFAULT_WORKER_URL = new URL('./solver-worker.mjs', import.meta.url);

function solverJobError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, details);
  return error;
}

/**
 * Runs native OR-Tools work behind a process seam.  A native assertion may
 * terminate the Adapter process, but the HTTP backend receives a normal
 * rejected promise and can keep serving the last validated timetable.
 */
export function runSolverJob(job, {
  workerUrl = DEFAULT_WORKER_URL,
  timeoutMs = Math.max(5_000, Number(job?.options?.maxTimeSeconds || 120) * 1_000 + 5_000),
  onProgress,
} = {}) {
  return new Promise((resolve, reject) => {
    const child = fork(fileURLToPath(workerUrl), [], {
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      serialization: 'advanced',
    });
    let settled = false;
    let stderr = '';
    const finish = (action, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      child.removeAllListeners();
      child.stderr?.removeAllListeners();
      action(value);
    };
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      finish(reject, solverJobError(
        'SOLVER_WORKER_TIMEOUT',
        `求解进程超过 ${Math.round(timeoutMs / 1000)} 秒，已安全终止；原课表未受影响`,
      ));
    }, timeoutMs);

    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', chunk => {
      stderr = `${stderr}${chunk}`.slice(-4_000);
    });
    child.on('message', message => {
      if (message?.type === 'progress') {
        onProgress?.(message.data);
        return;
      }
      if (message?.type === 'result') finish(resolve, message.data);
      if (message?.type === 'error') finish(reject, solverJobError(
        message.error?.code || 'SOLVER_WORKER_ERROR',
        message.error?.message || '独立求解进程执行失败',
        { remoteStack: message.error?.stack },
      ));
    });
    child.on('error', error => finish(reject, solverJobError(
      'SOLVER_WORKER_START_FAILED',
      `无法启动独立求解进程：${error.message}`,
    )));
    child.on('exit', (code, signal) => {
      if (settled) return;
      const suffix = stderr.trim() ? `；${stderr.trim().split('\n').at(-1)}` : '';
      finish(reject, solverJobError(
        'SOLVER_WORKER_EXIT',
        `独立求解进程异常退出（退出码 ${code ?? '无'}${signal ? `，信号 ${signal}` : ''}）${suffix}`,
        { exitCode: code, signal },
      ));
    });
    child.send({ type: 'solve', job });
  });
}
