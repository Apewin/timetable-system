import { resolve } from 'node:path';

import { describeOperations } from './api-manifest.mjs';

const READ_COMMANDS = new Map([
  ['status', '/status'],
  ['validate-input', '/validate-input'],
  ['validate', '/validate'],
]);
const TIMETABLE_SCOPES = new Set(['student', 'teacher', 'section', 'class', 'room', 'all']);
const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
const ACTION_ALIASES = new Map([
  ['manual-plan:show', 'manual-plan.get'],
  ['manual-plan:draft', 'manual-plan.draft'],
  ['manual-plan:confirm', 'manual-plan.confirm'],
  ['manual-plan:unlock', 'manual-plan.unlock'],
  ['manual-plan:solve', 'manual-plan.solve'],
  ['archive:list', 'archive.list'],
  ['archive:save', 'archive.create'],
  ['graduation:preview', 'graduation.preview'],
  ['graduation:confirm', 'graduation.confirm'],
  ['graduation:archives', 'graduation.archives.list'],
  ['ap-block:show', 'ap-block.get'],
  ['ap-block:update', 'ap-block.update'],
  ['ap-block:sections', 'ap-block.sections.list'],
  ['ap-block:build', 'ap-block.sections.build'],
]);

export const COMMANDS = [
  { command: 'capabilities', method: 'LOCAL', write: false },
  { command: 'describe [CATEGORY|OPERATION]', method: 'LOCAL', write: false },
  { command: 'action OPERATION [OPTIONS]', method: 'MANIFEST', write: 'operation-policy' },
  { command: 'manual-plan|archive|graduation|ap-block SUBCOMMAND', method: 'ALIAS', write: 'operation-policy' },
  { command: 'status|validate-input|validate', method: 'GET', write: false },
  { command: 'list ENTITY', method: 'GET', write: false },
  { command: 'timetable SCOPE ID', method: 'GET', write: false },
  { command: 'solve [OPTIONS] --apply', method: 'POST', write: true },
  { command: 'import TYPE FILE [--ai]', method: 'POST', write: false },
  { command: 'import confirm TYPE JSON_FILE --apply', method: 'POST', write: true },
  { command: 'export preview|ai-match [TEMPLATES]', method: 'POST', write: false },
  { command: 'export generate [OPTIONS] --apply', method: 'POST', write: 'local-files' },
  { command: 'request METHOD PATH', method: 'ANY', write: 'non-GET' },
];

export class CliError extends Error {
  constructor(code, message, exitCode = 2) {
    super(message);
    this.code = code;
    this.exitCode = exitCode;
  }
}

function expandArgs(argv) {
  const raw = argv[0] === '--' ? argv.slice(1) : argv;
  const alias = ACTION_ALIASES.get(`${raw[0]}:${raw[1]}`);
  if (raw[0] === 'archive' && raw[1] === 'show' && raw[2]) {
    return ['action', 'archive.get', '--param', `archiveId=${raw[2]}`, ...raw.slice(3)];
  }
  return alias ? ['action', alias, ...raw.slice(2)] : raw;
}

function requireApply(args, message) {
  if (!args.includes('--apply')) throw new CliError('CLI_WRITE_CONFIRMATION_REQUIRED', message, 4);
}

function optionValue(args, flag, { required = false } = {}) {
  const index = args.indexOf(flag);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith('-')) throw new CliError('CLI_USAGE', `${flag} 缺少值`);
  if (required && !value) throw new CliError('CLI_USAGE', `${flag} 缺少值`);
  return value;
}

function readJsonOptions(args, readFile, errorCode) {
  let inline;
  let filePath;
  try {
    inline = optionValue(args, '--data');
    filePath = optionValue(args, '--data-file');
  } catch (error) {
    throw new CliError(errorCode, error.message);
  }
  if (inline !== undefined && filePath !== undefined) {
    throw new CliError(errorCode, '--data 与 --data-file 只能使用一个');
  }
  if (inline === undefined && filePath === undefined) return undefined;
  try {
    return JSON.parse(filePath === undefined ? inline : readFile(filePath, 'utf8'));
  } catch (error) {
    throw new CliError(errorCode, error.message);
  }
}

function normalizeApiPath(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.includes('://')) return null;
  const path = value === '/api' ? '/' : value.replace(/^\/api(?=\/)/, '');
  return path.includes('..') ? null : path;
}

function fillPathParameters(template, args) {
  let path = template;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== '--param') continue;
    const pair = args[index + 1] || '';
    const separator = pair.indexOf('=');
    const name = separator > 0 ? pair.slice(0, separator) : '';
    const value = separator > 0 ? pair.slice(separator + 1) : '';
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name) || !value) {
      throw new CliError('CLI_ACTION_PATH_ERROR', `无效路径参数: ${pair}`);
    }
    path = path.replaceAll(`:${name}`, encodeURIComponent(value));
  }
  const missing = path.match(/:([A-Za-z][A-Za-z0-9_]*)/g);
  if (missing) {
    throw new CliError('CLI_ACTION_PATH_ERROR', `缺少路径参数: ${missing.map(item => item.slice(1)).join('、')}`);
  }
  return path;
}

function actionPlan(subject, args, readFile) {
  const operation = describeOperations(subject).find(item => item.name === subject);
  if (!operation || operation.transport === 'multipart') {
    throw new CliError(
      'CLI_UNKNOWN_OPERATION',
      operation ? '该文件操作请使用 import/export 命令' : `未知操作: ${subject || ''}`,
    );
  }
  if (operation.mutates) requireApply(args, `${operation.name} 必须显式使用 --apply`);
  return {
    transport: 'json',
    path: fillPathParameters(operation.path, args),
    method: operation.method,
    body: readJsonOptions(args, readFile, 'CLI_ACTION_INPUT_ERROR'),
  };
}

function requestPlan(subject, identifier, args, readFile) {
  const method = String(subject || '').toUpperCase();
  const path = HTTP_METHODS.has(method) ? normalizeApiPath(identifier) : null;
  if (!path) throw new CliError('CLI_USAGE', '用法: request METHOD /api/path [--data JSON|--data-file FILE] [--apply]');
  if (method !== 'GET') requireApply(args, '写操作必须显式使用 --apply');
  return {
    transport: 'json',
    path,
    method,
    body: readJsonOptions(args, readFile, 'CLI_INVALID_JSON'),
  };
}

function solvePlan(args) {
  requireApply(args, '排课会写入当前课表，必须显式使用 --apply');
  const body = {};
  for (const [flag, field] of [
    ['--max-time', 'max_time_seconds'],
    ['--candidates', 'candidate_count'],
    ['--random-seed', 'random_seed'],
  ]) {
    const raw = optionValue(args, flag);
    if (raw === undefined) continue;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 1) throw new CliError('CLI_USAGE', `${flag} 必须是正整数`);
    body[field] = value;
  }
  return { transport: 'json', path: '/solve', method: 'POST', body };
}

function importPlan(subject, identifier, args, readFile) {
  const previewPaths = {
    ap: '/ap-selections/import/preview',
    elective: '/elective-selections/import/preview',
    students: '/import/excel',
    generic: '/import/excel',
  };
  const confirmPaths = {
    ap: '/ap-selections/import/confirm',
    elective: '/elective-selections/import/confirm',
    students: '/import/confirm',
    generic: '/import/confirm',
  };
  if (subject === 'confirm') {
    const path = confirmPaths[identifier];
    const payloadPath = args[3];
    if (!path || !payloadPath) throw new CliError('CLI_USAGE', '用法: import confirm TYPE JSON_FILE --apply');
    requireApply(args, '确认导入必须显式使用 --apply');
    try {
      return { transport: 'json', path, method: 'POST', body: JSON.parse(readFile(payloadPath, 'utf8')) };
    } catch (error) {
      throw new CliError('CLI_IMPORT_CONFIRM_ERROR', error.message);
    }
  }
  const path = previewPaths[subject];
  if (!path || !identifier) throw new CliError('CLI_USAGE', '用法: import <students|ap|elective|generic> FILE [--ai]');
  return {
    transport: 'multipart',
    path,
    fields: {
      ...(subject === 'students' ? { expected_type: 'students' } : {}),
      ai_organize: String(args.includes('--ai')),
    },
    files: [{ field: 'file', path: identifier }],
  };
}

function exportPlan(subject, args, readFile, cwd) {
  const paths = {
    preview: '/export/templates/preview',
    'ai-match': '/export/templates/ai-match',
    generate: '/export/templates/generate',
  };
  const path = paths[subject];
  if (!path) throw new CliError('CLI_USAGE', '用法: export <preview|ai-match|generate> [OPTIONS]');
  if (subject === 'generate') requireApply(args, '导出会写入本地文件，必须显式使用 --apply');
  const files = [];
  for (const [flag, field] of [
    ['--class-template', 'class_template'],
    ['--teacher-template', 'teacher_template'],
  ]) {
    const filePath = optionValue(args, flag);
    if (filePath !== undefined) files.push({ field, path: filePath });
  }
  const fields = {};
  const mappingsPath = optionValue(args, '--mappings');
  if (mappingsPath !== undefined) {
    try {
      fields.teacher_mappings = JSON.stringify(JSON.parse(readFile(mappingsPath, 'utf8')));
    } catch (error) {
      throw new CliError('CLI_EXPORT_MAPPINGS_ERROR', error.message);
    }
  }
  const outputDir = subject === 'generate'
    ? resolve(cwd, optionValue(args, '--output-dir') || 'outputs')
    : undefined;
  return { transport: 'multipart', path, fields, files, outputDir };
}

export function buildCommandPlan(argv, { baseUrl, readFile, cwd }) {
  const args = expandArgs(argv);
  const [command, subject, identifier] = args;
  if (command === 'capabilities') {
    return {
      local: {
        ok: true,
        data: {
          name: 'tt', api_url: baseUrl, commands: COMMANDS,
          write_policy: '具有状态或本地文件副作用的操作必须显式使用 --apply',
        },
      },
    };
  }
  if (command === 'describe') {
    const operations = describeOperations(subject);
    if (subject && !operations.length) throw new CliError('CLI_UNKNOWN_OPERATION', `没有匹配的操作或分类: ${subject}`);
    return {
      local: {
        ok: true,
        data: {
          filter: subject || null,
          operations,
          execution: 'JSON 操作用 action/request；文件流程用 import/export；mutates=true 必须使用 --apply。',
        },
      },
    };
  }
  if (command === 'action') return actionPlan(subject, args, readFile);
  if (command === 'request') return requestPlan(subject, identifier, args, readFile);
  if (command === 'solve') return solvePlan(args);
  if (command === 'import') return importPlan(subject, identifier, args, readFile);
  if (command === 'export') return exportPlan(subject, args, readFile, cwd);
  if (READ_COMMANDS.has(command)) return { transport: 'json', path: READ_COMMANDS.get(command), method: 'GET' };
  if (command === 'list' && /^[a-z][a-z0-9_]*$/.test(subject || '')) {
    return { transport: 'json', path: `/${subject}`, method: 'GET' };
  }
  if (command === 'timetable' && TIMETABLE_SCOPES.has(subject) && identifier) {
    return { transport: 'json', path: `/timetable/${subject}/${encodeURIComponent(identifier)}`, method: 'GET' };
  }
  throw new CliError('CLI_USAGE', '运行 capabilities 查看命令，或 describe 查看业务操作。');
}
