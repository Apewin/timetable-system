import { solveSchedule } from './cpsat-solver.mjs';
import { solveFeasibleFirstSchedule } from './feasible-first-solver.mjs';

function send(message) {
  if (process.connected) process.send(message);
}

function sendAndFlush(message) {
  return new Promise(resolve => {
    if (!process.connected) return resolve();
    process.send(message, () => resolve());
  });
}

async function solve(job) {
  const onProgress = data => send({ type: 'progress', data });
  const options = { ...(job.options || {}), onProgress };
  if (job.solver === 'exact') return solveSchedule(job.problem, options);
  if (job.solver === 'feasible-first') {
    return solveFeasibleFirstSchedule(job.problem, options);
  }
  if (job.solver === 'constructive-lns') {
    const { solveConstructiveLnsSchedule } = await import('./constructive-lns-solver.mjs');
    return solveConstructiveLnsSchedule(job.problem, options);
  }
  if (job.solver === 'resilient-optimize') {
    const { solveResilientOptimizedSchedule } = await import('./resilient-optimizer.mjs');
    return solveResilientOptimizedSchedule(job.problem, options);
  }
  if (job.solver === 'quality-lower-bounds') {
    const { solveScheduleQualityLowerBounds } = await import('./quality-lower-bound.mjs');
    return solveScheduleQualityLowerBounds(job.problem, options);
  }
  if (job.solver === 'exam') {
    const { solveExamSchedule } = await import('./exam-scheduling.mjs');
    return solveExamSchedule(job.state || {}, job.plan || {}, options);
  }
  throw Object.assign(new Error(`不支持的求解作业类型: ${job.solver}`), {
    code: 'SOLVER_JOB_TYPE_UNSUPPORTED',
  });
}

process.once('message', async message => {
  try {
    if (message?.type !== 'solve') throw new Error('独立求解进程没有收到有效作业');
    const result = await solve(message.job || {});
    await sendAndFlush({ type: 'result', data: result });
  } catch (error) {
    await sendAndFlush({
      type: 'error',
      error: { code: error.code, message: error.message, stack: error.stack },
    });
  } finally {
    process.disconnect?.();
  }
});
