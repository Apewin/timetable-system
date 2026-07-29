# HANDOFF.md — 排课系统修复任务交接

> **给接手 coding agent**：本文档描述系统当前发生了什么、需要修什么、按什么顺序修、怎么算修好。
> 基线提交：`8ec971a`（2026-07-29）。请先完整读完本文档再动手。
> 详细审查证据见同目录审查报告（若存在）；本文档已包含动手所需的全部定位信息。

---

## 0. 一句话现状

排课算法本身基本可用（G10/G11 已达 0 冲突），但**系统的"自我验收"全线失灵**：求解器、评分器、验证脚本各自用窄口径自评成功，所有失败信号（INFEASIBLE / SAT null / 教师冲突 / 课时缺失 / 异常）在流向出口途中被逐层静默——所以系统每次都宣称成功，人工检查每次都发现问题。

**你的任务不是重写求解器，而是先恢复系统"说我不行"的能力，再堵住制造冲突的源头。**

---

## 1. 核心诊断（为什么必须按本文档的顺序修）

失败信号被静默的四层机制（全部有代码实证）：

| 层 | 位置 | 静默行为 |
|---|---|---|
| 求解层 | `packages/core/src/cpsat-g12-engine.cjs` L185-190 | `OPTIMAL` 只代表 TC 子模型，AP/选修不在模型内 |
| 兜底层 | `cpsat-g12-engine.cjs` L244-263 | SAT 失败后 greedy fallback **不检查教师占用**，冲突直接落盘 |
| 评分层 | `cpsat-g12-engine.cjs` L326-345 | `evaluate()` 不含教师冲突惩罚，带冲突解与干净解同分 |
| 验证层 | `validate-against-excel.cjs` L107, L226-274 | 只抽查 5/80 学生；教师冲突**只打印不进 errors**；exit code 恒为 0 |

**因果推论**：在验证闭环修好之前，修任何求解器 bug 都无法被证明修好了——所以 Batch 1 必须先做。

---

## 2. 必读文件（动手前）

| 文件 | 作用 | 当前角色 |
|---|---|---|
| `solve-cpsat.cjs` | **当前生产主入口**（G10→G11→G12 三阶段） | 无任何验证、无退出码 |
| `packages/core/src/cpsat-g12-engine.cjs` | G12 引擎（冲突源头） | fallback 裸奔 |
| `packages/core/src/cpsat-g10-engine.cjs` / `cpsat-g11-engine.cjs` | G10/G11 引擎 | 结构同构 |
| `validate-against-excel.cjs` | Excel 规格验证 | 验收口径残缺 |
| `packages/core/src/solver/post-check.cjs` | **仓库内最全的检查器** | 未接入主流程，SPEC 缺 G11 teaching 课 |
| `packages/web/server.js` | Web 服务（~40 API） | 有 P0 安全漏洞 |
| `rules.json` / `timetable.json` | 规则与数据（被 .gitignore 排除，本地存在） | 输入输出混用同一文件 |

注意：仓库存在多套历史求解器（`solve-all.cjs`、`solve-quick.cjs`、`search*.cjs`、`engine.cjs`、`g11/g12-engine.cjs`、`cpsat-engine.cjs`）。**除 `solve-cpsat.cjs` 及其引用的三个 cpsat 引擎外，其余都不是当前生产路径，不要修它们，也不要删**（需要时移入 `archive/`）。

---

## 3. 修复任务（严格按批次顺序执行，每批完成后跑验收）

### Batch 1 — 验证闭环（最高优先，约半天）

> 目标：**任何带硬冲突的课表都无法再"静默通过"。**

**T1.1 `validate-against-excel.cjs`：教师冲突计入失败**
- L234-239：检测到冲突后，追加 `errors.push({ grade, count: conflicts.length, type: 'teacher_conflict' })`
- L263-267：`totalErrors` 计算必须包含教师冲突数（当前只累加 `s.errors`）

**T1.2 `validate-against-excel.cjs`：抽样改全量**
- L107：`const sample = gStudents.slice(0, 5)` → `const sample = gStudents`
- 输出保持聚合摘要（现状的 byType 打印即可），不要逐学生刷屏

**T1.3 `solve-cpsat.cjs`：接入 PostChecker + 正确退出码**
- 文件末尾写入最终 `state` 后：
```js
const { PostChecker } = require('./packages/core/src/solver/post-check.cjs');
const check = PostChecker.check(state);
PostChecker.report(check);
if (!check.pass) {
  console.error('验证未通过：' + check.violations.length + ' 个违规');
  process.exit(1);
}
```
- L84-87 的 catch 分支：末尾加 `process.exit(1)`

**Batch 1 验收**（必须全过才算完成）：
```bash
node solve-cpsat.cjs && echo "EXIT=$?"   # 若课表有冲突，必须 exit 1 且打印违规清单
node validate-against-excel.cjs; echo "EXIT=$?"  # 有冲突时必须 exit 1
```

---

### Batch 2 — 堵住冲突源头（约 1-2 天）

**T2.1 `cpsat-g12-engine.cjs` fallback 补教师占用检查**（L245-262 的 greedy 循环内，两个 for 循环都要加）：
```js
if (tid && (A.some(x => x.teacher_id === tid && x.slot_id === sid && x.student_id !== stu.id)
            || this.teacherBusy(tid, sid))) continue;
```
- 若某门课因此排不满：收集到 `unscheduled[]`，在返回值中携带，并在 console 明确打印 `[PARTIAL] 学生 X 课程 Y 排 Z/W 节`。**禁止静默排满**。

**T2.2 三个 cpsat 引擎的 `evaluate()` 加教师冲突硬惩罚**（权重必须大于一切软目标）：
```js
// evaluate(A) 开头插入：
const tMap = {};
A.forEach(a => {
  if (!a.teacher_id) return;
  const k = a.teacher_id + '@' + a.slot_id;
  (tMap[k] = tMap[k] || new Set()).add(a.course_id);
});
Object.values(tMap).forEach(courses => { if (courses.size > 1) sc += 100000; });
```

**T2.2b `cpsat-g10-engine.cjs` / `cpsat-g11-engine.cjs` 的 `_smartFill` 补日分布检查**（移动课程到早上空位前）：
```js
const hrs = A.filter(a => a.student_id === stu.id && a.course_id === moveA.course_id).length;
if (hrs <= 5) {
  const sameDay = A.some(a => a.student_id === stu.id && a.course_id === moveA.course_id
    && a.slot_id.startsWith('D' + d) && a !== moveA);
  if (sameDay) continue;  // ≤5hr 课程同一天最多 1 节
}
```
G12 引擎 `_smartFill`（L305-322）同样处理。

**T2.3 输入/输出分离 + 原子写入**（`solve-cpsat.cjs`）：
- 新增写文件工具函数，替换全部 `fs.writeFileSync(DATA_PATH, ...)`：
```js
function atomicWrite(path, data) {
  const tmp = path + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmp, path);
}
```
- 起步时（L41-43）不再就地清空原文件：先 `fs.copyFileSync(DATA_PATH, DATA_PATH + '.bak')` 备份再操作

**Batch 2 验收**：
```bash
node solve-cpsat.cjs; echo "EXIT=$?"   # G12 教师冲突必须为 0，或明确输出 PARTIAL 清单后 exit 1
node validate-against-excel.cjs        # 教师冲突=0
```

---

### Batch 3 — 规格收口（约 1 天）

**T3.1 SPEC 单一来源**：`validate-against-excel.cjs` 的 `SPEC`（L8-87）与 `post-check.cjs` 的 `_getSpecs()`（L196-215）已漂移（post-check 的 G11 缺全部 teaching 课）。
- 新建 `packages/core/src/spec/course-spec.cjs` 导出唯一规格（以 validate 版为准，补全 G11 teaching：`ENG_COMP:4, AP_CALC_BC:5, PRE_AP_LIT:2, PHYS_CN:2`，TC1/2 另有 `TOEFL:3, HONOR_LC:2`，TC3 另有 `AP_LC:5`）
- 两处改为 require 该文件

**T3.2 task_id 唯一化**：三个引擎 `_add()` 中 `task_id: cls + '_' + cid + '_' + s.id` → 尾部拼 `+ '_' + sid`

**T3.3 CLASS_TYPES 集中**：新建 `packages/core/src/spec/class-types.cjs`：
```js
module.exports = { CLASS_TYPES: Object.freeze({
  ADMIN: 'admin', TEACHING: 'teaching', AP: 'ap', BATCH: 'batch', FILLER: 'filler'
})};
```
替换三个 cpsat 引擎内的字面量（grep `'admin'\|'teaching'\|'filler'\|'batch'\|'ap'` 定位，注意 `ap` 的替换要看上下文，勿误伤）

---

### Batch 4 — Web 安全（与算法无关，但严重度最高，可提前插入）

> 若只能修一件事，先修 T4.1。

**T4.1 API Key 泄露**（`packages/web/server.js`）：
- L2132：`resolve(__dirname, '.env.local')` → `resolve(__dirname, '../../.env.local')`（移出静态目录）
- L25：`app.use(express.static(__dirname))` → `app.use(express.static(__dirname, { dotfiles: 'deny', index: 'index.html' }))`
- `.gitignore` 追加：`packages/web/.env.local`
- **提醒 Boss：撤销并更换现有 DeepSeek API Key（视为已泄露）**

**T4.2 LLM 规则写入门禁**（`/api/rules/apply` 端点）：
- 写入 `rules.json` 前：zod 校验（参考 `packages/core/src/models/schemas.ts`）+ 备份原文件（`rules.json.bak`）+ 响应改为"预览模式"返回 diff，新增 `/api/rules/confirm` 才真正落盘

**T4.3 XSS**（`packages/web/app.js` L389）：LLM 响应注入 `innerHTML` → 改 `textContent`（如需富文本，先消毒）

**T4.4 `server.js` L2176**：`if (!DEEPSEEK_API_KEY)` → `if (!global.DEEPSEEK_API_KEY)`

---

## 4. 明确不要做的事（红线）

1. ❌ **不要重写求解器架构**（不引入 ScheduleState 统一状态层、不做教师关联组件 CP-SAT、不搞全局单模型）——那是下一阶段的事，本次只做上面列出的点状修复
2. ❌ 不要删除或"顺手重构"历史脚本（`solve-all/solve-quick/search*`、旧引擎）——不用就移 `archive/`，但先问
3. ❌ 不要碰 `packages/web/ai-tutoring-system.js`、`llm-bridge.js` 的 LLM 功能逻辑（除了 T4.1-T4.4 的安全修复）
4. ❌ 不要放宽任何硬约束来让模型"有解"——无解就报 INFEASIBLE/PARTIAL
5. ❌ 不要新增依赖（除明确需要的）；不要格式化全仓库；不要改与任务无关的代码风格
6. ❌ 不要把 `rules.json` / `timetable.json` 提交进 git（已在 .gitignore，保持）

## 5. 已知陷阱（前人踩过，别重蹈）

- `timetable.json` 是输入+输出合一：引擎构造时读取的 `assignments` 包含**上一轮结果**，`globalTeacher` 过滤逻辑（`cpsat-g12-engine.cjs` L37 `this.students.every(s => s.id !== a.student_id)`）依赖"同年级旧数据被视为非本年级"——改动数据结构时务必理解这段
- 课程 id 含 `_`（如 `AP_STAT`）：任何按 `_` split 解析变量名的代码都会出错，用对象字段传参
- anneal 的 swap 白名单只有 `teaching`/`filler`：admin/batch 课移动会破坏固定时段约束，不要扩大白名单
- G10 admin 时段全校对齐是隐式前提：anneal 的 TC 级 swap（`cpsat-g10-engine.cjs` L380-394）依赖它，改 admin 排布前必须先加显式保护
- 温度参数名存实亡（`temp*=0.9995`、5000 次后 temp≈16 ≫ 阈值 0.05）：别把温度条件当作有效收敛判据

## 6. 总验收标准（全部通过才算完成）

```bash
# 1. 注入测试：手工往 timetable.json 加一条教师冲突 → 验证必须失败
node validate-against-excel.cjs; echo $?   # 期望非 0

# 2. 主流程：求解后自带验证，有冲突即非零退出
node solve-cpsat.cjs; echo $?              # 期望 0（冲突已修复）或 1 + PARTIAL 清单

# 3. 安全：key 不可下载
curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/.env.local   # 期望 403/404

# 4. G12 终态：教师冲突 0（或显式 PARTIAL）
node validate-against-excel.cjs | grep "教师冲突"   # 期望 "教师无冲突" 或冲突计入失败
```

完成每个 Batch 后更新本文件末尾的进度表：

| Batch | 状态 | 完成日期 | 备注 |
|---|---|---|---|
| 1 验证闭环 | ⬜ | | |
| 2 冲突源头 | ⬜ | | |
| 3 规格收口 | ⬜ | | |
| 4 Web 安全 | ⬜ | | T4.1 可提前 |
