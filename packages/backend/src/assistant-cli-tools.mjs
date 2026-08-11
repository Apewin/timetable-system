import { OPERATIONS } from '../../cli/src/api-manifest.mjs';
import { runCli } from '../../cli/src/cli.mjs';

const SAFE_READ_OPERATIONS = new Set([
  'system.status',
  'rules.list',
  'rules.compile',
  'schedule.input.validate',
  'schedule.validate',
  'schedule.preview',
  'schedule.editor.get',
  'manual-plan.get',
  'ap-block.get',
  'ap-block.sections.suggestions',
  'archive.list',
]);

const CONFIRM_WRITE_OPERATIONS = new Set([
  'schedule.tasks.build',
  'schedule.solve',
  'schedule.lock',
  'schedule.unlock',
  'schedule.swap',
  'schedule.teacher.adjust',
  'schedule.overlay.add',
  'schedule.overlay.delete',
  'manual-plan.draft',
  'manual-plan.confirm',
  'manual-plan.unlock',
  'manual-plan.solve',
  'ap-block.update',
  'ap-block.sections.build',
  'ap-block.section.update',
  'archive.create',
]);

const OPERATION_TITLES = {
  'schedule.tasks.build': '重新生成排课任务',
  'schedule.solve': '运行自动排课',
  'schedule.lock': '锁定课表课程',
  'schedule.unlock': '解除课表锁定',
  'schedule.swap': '调整课程时段',
  'schedule.teacher.adjust': '调整教师课表',
  'schedule.overlay.add': '添加自习或特殊活动',
  'schedule.overlay.delete': '删除自习或特殊活动',
  'manual-plan.draft': '更新手工排课草稿',
  'manual-plan.confirm': '确认金框必要条件',
  'manual-plan.unlock': '解除金框必要条件',
  'manual-plan.solve': '按金框补全排课',
  'ap-block.update': '更新 AP Block 配置',
  'ap-block.sections.build': '重新生成 AP 分班',
  'ap-block.section.update': '调整 AP Section',
  'archive.create': '保存正式课表归档',
};

const operationsByName = new Map(OPERATIONS.map(operation => [operation.name, operation]));

function pathParameters(path) {
  return [...path.matchAll(/:([A-Za-z][A-Za-z0-9_]*)/g)].map(match => match[1]);
}

function boundedValue(value, depth = 0) {
  if (depth > 6) return '[内容层级过深，已省略]';
  if (typeof value === 'string') return value.length > 500 ? `${value.slice(0, 500)}…` : value;
  if (Array.isArray(value)) return value.slice(0, 50).map(item => boundedValue(item, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).slice(0, 80)
      .map(([key, item]) => [key, boundedValue(item, depth + 1)]));
  }
  return value;
}

export function assistantCliTools() {
  return OPERATIONS
    .filter(operation => SAFE_READ_OPERATIONS.has(operation.name)
      || CONFIRM_WRITE_OPERATIONS.has(operation.name))
    .map(operation => ({
      operation: operation.name,
      method: operation.method,
      path_parameters: pathParameters(operation.path),
      body: operation.body,
      mode: SAFE_READ_OPERATIONS.has(operation.name) ? 'read' : 'confirm',
    }));
}

export function safeAssistantCliCall(rawCall) {
  if (!rawCall || typeof rawCall !== 'object' || Array.isArray(rawCall)) return null;
  const operation = operationsByName.get(String(rawCall.operation || ''));
  const mode = SAFE_READ_OPERATIONS.has(operation?.name)
    ? 'read'
    : CONFIRM_WRITE_OPERATIONS.has(operation?.name) ? 'confirm' : null;
  if (!operation || !mode) {
    throw new Error('助手请求了未获准的 CLI 操作');
  }
  const params = rawCall.params && typeof rawCall.params === 'object' && !Array.isArray(rawCall.params)
    ? rawCall.params
    : {};
  const body = rawCall.body === undefined ? null : rawCall.body;
  const requiredParams = pathParameters(operation.path);
  const suppliedParams = Object.keys(params);
  const missing = requiredParams.filter(name => params[name] === undefined || params[name] === null || params[name] === '');
  const extra = suppliedParams.filter(name => !requiredParams.includes(name));
  if (missing.length) throw new Error(`CLI 操作缺少路径参数：${missing.join('、')}`);
  if (extra.length) throw new Error(`CLI 操作包含未知路径参数：${extra.join('、')}`);
  if (suppliedParams.some(name => !['string', 'number'].includes(typeof params[name]))) {
    throw new Error('CLI 路径参数只能是字符串或数字');
  }
  if (body !== null && (typeof body !== 'object' || Array.isArray(body))) {
    throw new Error('CLI 操作请求体必须是 JSON 对象');
  }
  if (body !== null && JSON.stringify(body).length > 20_000) {
    throw new Error('CLI 操作请求体超过助手允许的大小');
  }
  return { operation: operation.name, params, body, mode };
}

export function safeAssistantCliReadCall(rawCall) {
  const call = safeAssistantCliCall(rawCall);
  if (call?.mode !== 'read') throw new Error('该 CLI 操作必须等待用户确认');
  return { operation: call.operation, params: call.params, body: call.body };
}

export function assistantCliMutationProposal(rawCall, state = {}) {
  const call = safeAssistantCliCall(rawCall);
  if (call?.mode !== 'confirm') throw new Error('该 CLI 操作不是可确认的写操作');
  return {
    type: 'cli_operation',
    operation: call.operation,
    params: call.params,
    body: call.body,
    expected_revision: Number(state.meta?.revision) || 0,
    title: OPERATION_TITLES[call.operation] || `执行 ${call.operation}`,
    impacts: [
      '只有点击确认后才会通过 CLI 执行；取消不会修改任何数据。',
      '执行时仍会经过 CLI 的 --apply 门槛和后端业务校验。',
    ],
  };
}

export function boundedAssistantCliResult(value) {
  return boundedValue(value);
}

async function runAssistantCliCall(call, { baseUrl, request, apply = false } = {}) {
  const argv = ['action', call.operation];
  for (const [name, value] of Object.entries(call.params)) {
    argv.push('--param', `${name}=${String(value)}`);
  }
  if (call.body !== null) argv.push('--data', JSON.stringify(call.body));
  if (apply) argv.push('--apply');
  const output = [];
  const errors = [];
  const dependencies = {
    env: { TIMETABLE_API_URL: baseUrl },
    writeOut: value => output.push(value),
    writeError: value => errors.push(value),
  };
  if (request) dependencies.request = request;
  const exitCode = await runCli(argv, dependencies);
  const rawPayload = (exitCode === 0 ? output : errors).join('');
  let payload;
  try {
    payload = JSON.parse(rawPayload);
  } catch {
    throw new Error('CLI 返回了无法解析的结果');
  }
  if (exitCode !== 0 || payload?.ok === false) {
    throw new Error(payload?.error?.message || 'CLI 操作失败');
  }
  return payload?.data;
}

export async function executeAssistantCliRead(rawCall, { baseUrl, request } = {}) {
  const call = safeAssistantCliReadCall(rawCall);
  return runAssistantCliCall(call, { baseUrl, request });
}

export async function executeAssistantCliWrite(rawCall, { baseUrl, request } = {}) {
  const call = safeAssistantCliCall(rawCall);
  if (call?.mode !== 'confirm') throw new Error('该 CLI 操作不是获准的写操作');
  return runAssistantCliCall(call, { baseUrl, request, apply: true });
}

export async function executeConfirmedAssistantCliAction(payload, {
  state,
  baseUrl,
  executeCliWrite = executeAssistantCliWrite,
} = {}) {
  const expectedRevision = Number(payload?.expected_revision);
  const currentRevision = Number(state?.meta?.revision) || 0;
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision !== currentRevision) {
    throw new Error('系统数据已变化，请让助手基于最新数据重新生成操作');
  }
  return executeCliWrite({
    operation: payload?.operation,
    params: payload?.params,
    body: payload?.body,
  }, { baseUrl });
}
