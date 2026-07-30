import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as XLSX from 'xlsx';

const envFile = fileURLToPath(new URL('../../../.env.local', import.meta.url));
const DEFAULT_API_URL = 'https://api.deepseek.com';
const DEFAULT_MODEL = 'deepseek-v4-flash';
const supportedTypes = new Set(['students', 'generic', 'ap_selections', 'elective_selections']);

function text(value) {
  return String(value ?? '').trim();
}

function parseEnv(content) {
  const values = {};
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator < 1) continue;
    values[trimmed.slice(0, separator).trim()] = trimmed.slice(separator + 1).trim();
  }
  return values;
}

function localEnv() {
  return existsSync(envFile) ? parseEnv(readFileSync(envFile, 'utf8')) : {};
}

export function getAiConfig({ includeSecret = false } = {}) {
  const file = localEnv();
  const apiKey = process.env.DEEPSEEK_API_KEY || file.DEEPSEEK_API_KEY || '';
  const config = {
    apiUrl: process.env.DEEPSEEK_API_URL || file.DEEPSEEK_API_URL || DEFAULT_API_URL,
    model: process.env.DEEPSEEK_MODEL || file.DEEPSEEK_MODEL || DEFAULT_MODEL,
    configured: Boolean(apiKey),
  };
  if (includeSecret) config.apiKey = apiKey;
  return config;
}

function validateApiUrl(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('模型 API 地址必须使用 http 或 https');
  return url.toString().replace(/\/+$/, '');
}

function envValue(value, label) {
  const normalized = text(value);
  if (/[\r\n]/.test(String(value ?? ''))) throw new Error(`${label} 不能包含换行`);
  return normalized;
}

export function saveAiConfig({ apiKey, apiUrl, model }) {
  const current = localEnv();
  if (apiKey && apiKey !== '***已配置***') current.DEEPSEEK_API_KEY = envValue(apiKey, 'API Key');
  if (apiUrl) current.DEEPSEEK_API_URL = validateApiUrl(text(apiUrl));
  if (model) current.DEEPSEEK_MODEL = envValue(model, '模型名称');
  if (!current.DEEPSEEK_API_KEY) throw new Error('请输入模型 API Key');
  const ordered = ['DEEPSEEK_API_KEY', 'DEEPSEEK_API_URL', 'DEEPSEEK_MODEL'];
  const lines = [
    ...ordered.filter(name => current[name]).map(name => `${name}=${current[name]}`),
    ...Object.entries(current)
      .filter(([name]) => !ordered.includes(name))
      .map(([name, value]) => `${name}=${value}`),
  ];
  writeFileSync(envFile, `${lines.join('\n')}\n`, { encoding: 'utf8', mode: 0o600 });
  process.env.DEEPSEEK_API_KEY = current.DEEPSEEK_API_KEY;
  process.env.DEEPSEEK_API_URL = current.DEEPSEEK_API_URL || DEFAULT_API_URL;
  process.env.DEEPSEEK_MODEL = current.DEEPSEEK_MODEL || DEFAULT_MODEL;
  return getAiConfig();
}

export function workbookSnapshot(workbook, {
  maxSheets = 30,
  maxRowsPerSheet = 160,
  maxColumns = 24,
  maxCells = 20_000,
} = {}) {
  let remaining = maxCells;
  const sheets = [];
  for (const sheetName of workbook.SheetNames.slice(0, maxSheets)) {
    if (remaining <= 0) break;
    const matrix = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: '' });
    const rows = [];
    for (const sourceRow of matrix.slice(0, maxRowsPerSheet)) {
      if (remaining <= 0) break;
      const row = sourceRow.slice(0, Math.min(maxColumns, remaining)).map(value => {
        const normalized = text(value);
        return normalized.length > 300 ? `${normalized.slice(0, 300)}…` : normalized;
      });
      remaining -= row.length;
      rows.push(row);
    }
    sheets.push({ name: sheetName, rows });
  }
  return {
    sheets,
    truncated: workbook.SheetNames.length > sheets.length || remaining <= 0,
  };
}

function schemaFor(expectedType) {
  if (expectedType === 'students') {
    return '每个名单页输出 headers=["Student ID","Name (Chinese)","Name (Pinyin)","English Name","Teaching Class","Class"]；rows 按该顺序。不要推测缺失值。';
  }
  if (expectedType === 'ap_selections') {
    return '每门 AP 课程一个 sheet；title 必须是课程标题；headers=["Name (Chinese)","Name (Pinyin)","English Name"]；rows 只包含该课程学生。';
  }
  if (expectedType === 'elective_selections') {
    return '输出一个 sheet；headers=["Student ID","中文姓名","姓名拼音","英文名","A组","B组","C组"]；每名学生一行。只把实际出现的选课放入 A/B/C，缺失组留空，禁止自行补课。';
  }
  return '识别为 students、teachers、courses 或 rooms，并使用明确的中文标准表头输出。';
}

function parseJsonContent(content) {
  const stripped = text(content)
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  try {
    return JSON.parse(stripped);
  } catch {
    const start = stripped.indexOf('{');
    const end = stripped.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(stripped.slice(start, end + 1));
    throw new Error('模型没有返回可解析的 JSON');
  }
}

function validateInterpretation(value) {
  if (!value || !Array.isArray(value.sheets) || !value.sheets.length) throw new Error('模型返回结果缺少 sheets');
  if (value.sheets.length > 30) throw new Error('模型返回的工作表数量异常');
  const sheets = value.sheets.map((sheet, sheetIndex) => {
    if (!Array.isArray(sheet.headers) || !sheet.headers.length || sheet.headers.length > 24) {
      throw new Error(`模型返回的第 ${sheetIndex + 1} 个工作表缺少有效表头`);
    }
    if (!Array.isArray(sheet.rows) || sheet.rows.length > 5_000) {
      throw new Error(`模型返回的第 ${sheetIndex + 1} 个工作表数据行无效`);
    }
    const headers = sheet.headers.map(text);
    const rows = sheet.rows.map(row => {
      if (Array.isArray(row)) return headers.map((_, index) => text(row[index]));
      if (row && typeof row === 'object') return headers.map(header => text(row[header]));
      throw new Error(`模型返回的第 ${sheetIndex + 1} 个工作表含无效数据行`);
    });
    return {
      name: text(sheet.name) || `AI识别${sheetIndex + 1}`,
      title: text(sheet.title),
      headers,
      rows,
    };
  });
  return {
    document_type: text(value.document_type),
    confidence: Number.isFinite(Number(value.confidence)) ? Number(value.confidence) : undefined,
    notes: Array.isArray(value.notes) ? value.notes.map(text).filter(Boolean) : [],
    sheets,
  };
}

export function workbookFromInterpretation(interpretation) {
  const validated = validateInterpretation(interpretation);
  const workbook = XLSX.utils.book_new();
  const usedNames = new Set();
  for (const [index, sheet] of validated.sheets.entries()) {
    const rows = [];
    if (sheet.title) rows.push([sheet.title], []);
    rows.push(sheet.headers, ...sheet.rows);
    let name = sheet.name.slice(0, 31) || `AI识别${index + 1}`;
    while (usedNames.has(name)) name = `${name.slice(0, 27)}_${index + 1}`;
    usedNames.add(name);
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), name);
  }
  return workbook;
}

async function callChat(messages, config, fetchImpl) {
  const endpoint = `${validateApiUrl(config.apiUrl)}/chat/completions`;
  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      temperature: 0,
      max_tokens: 12_000,
    }),
    signal: AbortSignal.timeout(45_000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error?.message || `模型 API 请求失败（HTTP ${response.status}）`);
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new Error('模型 API 没有返回内容');
  return content;
}

export async function interpretWorkbook(workbook, {
  expectedType,
  filename = '',
  reason = '',
  fetchImpl = globalThis.fetch,
  config = getAiConfig({ includeSecret: true }),
} = {}) {
  if (!supportedTypes.has(expectedType)) throw new Error(`不支持的工作簿识别类型: ${expectedType}`);
  if (!config.apiKey) throw new Error('规则解析失败，且模型 API Key 尚未配置；请在系统设置中配置后重试');
  const snapshot = workbookSnapshot(workbook);
  const content = await callChat([
    {
      role: 'system',
      content: [
        '你是学校排课系统的 Excel 结构转换器。',
        '你的职责仅是把上传表格忠实转换成标准结构，不推测、不补全、不创建学生或课程。',
        '只返回 JSON：{"document_type":"","confidence":0到1,"notes":[],"sheets":[{"name":"","title":"","headers":[],"rows":[[]]}]}。',
        schemaFor(expectedType),
      ].join('\n'),
    },
    {
      role: 'user',
      content: JSON.stringify({
        expected_type: expectedType,
        filename,
        deterministic_parser_failure: reason,
        workbook: snapshot,
      }),
    },
  ], config, fetchImpl);
  const interpretation = validateInterpretation(parseJsonContent(content));
  return {
    interpretation,
    workbook: workbookFromInterpretation(interpretation),
    model: config.model,
  };
}

export async function testAiConnection(message = '请回复“连接成功”', options = {}) {
  const config = options.config || getAiConfig({ includeSecret: true });
  if (!config.apiKey) throw new Error('模型 API Key 未配置');
  const started = Date.now();
  const response = await callChat([
    { role: 'system', content: '你是连接测试助手，请用一句话回复。' },
    { role: 'user', content: text(message) || '请回复“连接成功”' },
  ], config, options.fetchImpl || globalThis.fetch);
  return { response: text(response), latency: Date.now() - started, model: config.model };
}
