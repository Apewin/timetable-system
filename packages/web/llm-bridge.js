/**
 * LLM桥接层 - 将自然语言规则翻译为JSON并写入rules.json
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RULES_PATH = process.env.RULES_PATH || path.resolve(__dirname, '../../rules.json');

// 规则翻译提示词
const RULE_TRANSLATION_PROMPT = `你是排课系统的规则解析器。用户用自然语言描述排课规则，你将其翻译为JSON规则。

## 当前规则
{RULES_CONTENT}

## 规则格式
每条规则包含：
- id: 唯一标识(string)
- type: "hard" | "soft"
- description: 中文描述
- scope: "teacher" | "course" | "global"
- For teacher restrictions: {"teachers":["T_XXX"], "forbidden_periods":[1,10], "penalty": 20}
- For clustering: {"condition":"no_cluster", "penalty":3}
- For fixed slots: {"course":"COURSE_ID", "fixed_slot":"D1P9"}
- For general: {"condition":"course=='SELF_STUDY'&&period==1", "penalty":25}

## 教师ID映射
- T_RACHEL: Rachel (外教英语)
- T_VINCENT: Vincent (外教英美概况/体育)
- T_LUKE: Luke
- T_JAIME: Jaime
- T_GLENN: Glenn
- T_CUIXIAOPENG: 崔晓鹏 (数学)
- T_XIEHAOYANG: 谢昊洋 (物理)
- T_ZHANGRAN: 张冉 (化学)
- T_LIYIXUAN: 李熠萱 (生物)
- T_BIFEI: 毕飞 (英语听力口语)
- T_NIUYONGMEI: 牛永梅 (英语读写)
- T_JIZHUREN: 季主任 (语法)
- T_EXP_A~L: 实验教师A~L

## 输出格式
返回JSON数组，每条是想添加/修改的规则：
[
  {"id":"my_new_rule","type":"soft","description":"...","scope":"teacher","teachers":["T_RACHEL"],"forbidden_periods":[1],"penalty":20}
]
如果是要修改现有规则（相同id），直接覆盖。
如果没有匹配的规则变化，返回空数组[]。
只返回JSON数组，不要其他文字。`;

export async function translateRule(naturalLanguage, apiKey) {
  const rulesContent = fs.existsSync(RULES_PATH)
    ? JSON.stringify(JSON.parse(fs.readFileSync(RULES_PATH, 'utf-8')), null, 2)
    : '{}';

  const prompt = RULE_TRANSLATION_PROMPT.replace('{RULES_CONTENT}', rulesContent);

  const res = await fetch((process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com') + '/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
    body: JSON.stringify({
      model: 'deepseek-v4-flash',
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content: naturalLanguage }
      ],
      temperature: 0.3, max_tokens: 2000
    })
  });
  const data = await res.json();
  const content = data.choices?.[0]?.message?.content || '';
  try {
    const match = content.match(/\[[\s\S]*\]/);
    return match ? JSON.parse(match[0]) : [];
  } catch { return []; }
}

export function applyRules(newRules) {
  if (!fs.existsSync(RULES_PATH)) return { ok: false, error: 'rules.json not found' };

  // P1-7 fix: LLM 生成规则做 schema 校验（只允许已知字段）
  const ALLOWED_FIELDS = ['id', 'type', 'description', 'scope', 'teachers', 'forbidden_periods', 'penalty',
    'condition', 'course', 'fixed_slot', 'fixed_slots', 'grades', 'forbidden_slots'];
  const ALLOWED_TYPES = ['hard', 'soft'];
  const ALLOWED_SCOPES = ['teacher', 'course', 'global'];

  const validated = [];
  const rejected = [];
  for (const rule of newRules) {
    if (!rule.id || typeof rule.id !== 'string') { rejected.push({ rule, reason: '缺少 id' }); continue; }
    if (rule.type && !ALLOWED_TYPES.includes(rule.type)) { rejected.push({ rule, reason: '无效 type: ' + rule.type }); continue; }
    if (rule.scope && !ALLOWED_SCOPES.includes(rule.scope)) { rejected.push({ rule, reason: '无效 scope: ' + rule.scope }); continue; }
    // 剥离不允许的字段
    const clean = {};
    for (const k of ALLOWED_FIELDS) { if (rule[k] !== undefined) clean[k] = rule[k]; }
    validated.push(clean);
  }

  if (rejected.length > 0) {
    console.warn('LLM 规则校验拒绝 ' + rejected.length + ' 条:');
    rejected.forEach(r => console.warn('  - ' + r.rule.id + ': ' + r.reason));
  }

  if (validated.length === 0) {
    return { ok: false, error: '所有规则未通过校验', rejected: rejected.length };
  }

  // P1-7 fix: 写入前备份
  const bakPath = RULES_PATH + '.bak';
  fs.copyFileSync(RULES_PATH, bakPath);

  const rules = JSON.parse(fs.readFileSync(RULES_PATH, 'utf-8'));

  validated.forEach(newRule => {
    const idx = rules.rules.findIndex(r => r.id === newRule.id);
    if (idx >= 0) {
      rules.rules[idx] = { ...rules.rules[idx], ...newRule };
    } else {
      rules.rules.push(newRule);
    }
  });

  rules.version = String(parseFloat(rules.version || '1.0') + 0.1);
  // P0-5 fix: 原子写入
  const tmpPath = RULES_PATH + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(rules, null, 2));
  fs.renameSync(tmpPath, RULES_PATH);

  return { ok: true, added: validated.length, rejected: rejected.length, total: rules.rules.length };
}

export function getRules() {
  if (!fs.existsSync(RULES_PATH)) return [];
  return JSON.parse(fs.readFileSync(RULES_PATH, 'utf-8'));
}

