# FOLLOW-UP.md — 排课系统复审遗留问题清单

> **给接管程序员**：提交 `63933b0`（fix: Code Review 22 issues）已完成首轮修复，本文档是二次复审后的**剩余问题清单**，按优先级排列。
> 复审基线：`63933b0`。回归测试现状：`node packages/core/src/__tests__/regression.test.cjs` → 11/11 通过。

---

## 0. 当前状态一句话

首轮修复质量良好（22 项中 19 项完整落地，验证闭环已建立），但**跨年级教师冲突防护只修了 G12，G10/G11 仍是裸奔状态**——这是当前唯一可能导致生产流程卡死的问题，建议最先处理。

### 首轮修复已验证通过（无需再动）

- P0-3/P0-4：validate 教师冲突计入失败 + 全量学生检查 ✅
- P0-2：G12/G11 fallback 补教师占用检查（G12 两轮循环均含 `teacherBusy`）✅
- P0-5：原子写入（solve-cpsat / server.js / llm-bridge 三处）✅
- P1-1：三引擎 evaluate() 教师冲突硬惩罚（+100000/处）✅
- P1-6：`SEED=xxx node solve-cpsat.cjs` 可复现 + 失败退出码（exit 1/2）✅
- P0-1：API key 配置移出静态目录 + `dotfiles:'deny'` ✅
- 其余 P1-2~P2-9：日分布检查、task_id 唯一化、CLASS_TYPES 集中、归档 archive/ 等 ✅

---

## 1. 🔴【高】G10/G11 引擎缺跨年级教师占用防护

**位置**：
- `packages/core/src/cpsat-g11-engine.cjs` — 全文无 `globalTeacher`（grep 零结果）
- `packages/core/src/cpsat-g10-engine.cjs` L56 — `teacherBusy` 已定义但**全文件 0 个调用点**（死代码）

**问题**：排课按 G10 → G11 → G12 顺序执行，后跑的年级需要看到先跑年级已占用的教师时段。G12 完整实现了这个机制（`globalTeacher` 快照 + 5 个调用点），G10/G11 没有。

**为什么重要**：至少 8 位教师跨年级授课——

| 教师 | 跨年级授课 |
|---|---|
| T_RACHEL | G10 ENG_LIT + G11 PRE_AP_LIT |
| T_GUIDANCE | G10 + G11 升学课堂 |
| T_BIFEI | G10 ENG_LS + G12 FRENCH |
| T_NIUYONGMEI | G10 ENG_RW + G12 JAPANESE |
| T_WEIWEI | G11 TOEFL + G12 AP_LIT |
| T_HANPENG | G11 AP_LC + G12 AP_LANG |
| T_LUKE | G11 HONOR_LC + G12 ENG_CW |
| T_BAIRUSHUANG | G11 PHYS_CN + G12 AP_PHYSC |

G11 排课时对 G10 的占用完全不可见（例如 T_RACHEL 在 G10 的课）。**不会产出带冲突的课表**——PostChecker 已接入主流程会在出口拦截——但会表现为 `node solve-cpsat.cjs` 频繁 exit 1、流程卡死，且报错信息不指向根因。

**修法**（照搬 G12 模式，参照 `cpsat-g12-engine.cjs` L34-41, L62, L123, L230, L264, L276, L303）：

```js
// 1) G11 构造函数末尾追加（G10 已有，跳过）：
this.globalTeacher = {};
(this.data.assignments || []).forEach(a => {
  if (a.teacher_id && this.students.every(s => s.id !== a.student_id)) {
    if (!this.globalTeacher[a.teacher_id]) this.globalTeacher[a.teacher_id] = new Set();
    this.globalTeacher[a.teacher_id].add(a.slot_id);
  }
});
teacherBusy(tid, sid) { return this.globalTeacher[tid]?.has(sid) || false; }

// 2) G10/G11 的 CP-SAT 建模候选过滤处（生成 sv 变量的循环内）追加：
if (tid && this.teacherBusy(tid, sid)) continue;

// 3) G10/G11 的 SAT 路径与 fallback 路径的教师检查，统一补上：
//    ... || this.teacherBusy(tid, sid)
```

**注意**：`this.students.every(s => s.id !== a.student_id)` 这行过滤的含义是「只追踪其他年级的占用，忽略本年级旧数据」——改动时不要破坏这个语义（这是历史坑 3 的修复，详见 HANDOFF.md §5）。

**验收**：手工在 timetable.json 中给 G10 预置一条 `T_RACHEL@D1P3`，跑 `node solve-cpsat.cjs`，G11 的 PRE_AP_LIT 不得落在 D1P3。

---

## 2. 🟠【中】server.js 鉴权中间件顺序错误——启用 Token 后前端打不开

**位置**：`packages/web/server.js` L27（鉴权中间件）vs L41（`express.static`）

**问题**：中间件注册顺序为 `鉴权 → static`。浏览器加载页面时，`<script src="/app.js">`、CSS、favicon 等请求**不携带 Authorization 头**，设置 `API_TOKEN` 环境变量后全部返回 401 → 前端空白。当前未设 Token 时一切正常，所以问题是潜伏的。

**修法**：把 static 移到鉴权中间件**之前**：

```js
// 顺序调整为：
app.use(express.static(__dirname, { dotfiles: 'deny', index: 'index.html' })); // 先静态
app.use((req, res, next) => { /* 鉴权 */ });                                    // 后鉴权（只拦 API）
```

安全性不降：`.env.local` 已由 `dotfiles:'deny'` 拦截，且配置文件已移出该目录（P0-1 修复）。

**验收**：
```bash
API_TOKEN=test123 node packages/web/server.js &
curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/app.js   # 期望 200
curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/api/state # 期望 401
```

---

## 3. 🟡【低】G11 fallback 缺 unscheduled 记录

**位置**：`packages/core/src/cpsat-g11-engine.cjs` fallback 两轮循环结束后

**问题**：G12 在排不满时会 `console.warn` + 推入 `this.unscheduled`（参照 `cpsat-g12-engine.cjs` L218-221, L283-287），G11 没有——排不满的学生静默缺失，只能靠 PostChecker 的课时检查兜底，排查时看不到明确指向。

**修法**：照搬 G12 模式，构造函数加 `this.unscheduled = []`，fallback 结束后：
```js
if (a < hrs) {
  console.warn('  G11 fallback: 学生 ' + stu.id + ' 课程 ' + cid + ' 仅排 ' + a + '/' + hrs + ' 节');
  this.unscheduled.push({ student: stu.id, course: cid, scheduled: a, needed: hrs, reason: 'fallback_insufficient' });
}
```

---

## 4. 🟡【低】回归测试 Test 4 与实现脱钩

**位置**：`packages/core/src/__tests__/regression.test.cjs` Test 4（task_id 唯一性）

**问题**：测试用的是测试文件内**复制的命名函数** `makeTaskId`，不是引擎真实的 `_add`。如果引擎改回不拼 slot，这个测试照样绿——假保护。

**修法**：改为直接实例化引擎（或提取 `_add` 的 task_id 生成逻辑为可导出的纯函数后 require 它）：
```js
// 最小修法：在引擎文件导出 _add 依赖的 taskId 构造函数，测试直接 require
// packages/core/src/constants.cjs 追加：
function makeTaskId(cls, cid, studentId, slotId) { return cls + '_' + cid + '_' + studentId + '_' + slotId; }
// 引擎 _add 与测试都引用同一实现
```

---

## 5. 🟡【低·行为变更】bestOfN 全年级失败时不报告缺失明细

**位置**：`solve-cpsat.cjs` bestOfN（阈值已改为 `students.length * 50`）

**问题**：新语义是「全或无」——任一学生排不满 → 该迭代 skip → 50 轮全失败 → `exit 2`。方向正确（正确性优先），但失败时控制台只有引擎内零散的 warn，**没有最终汇总**，运维不知道缺的是哪些学生的哪些课。

**修法**：bestOfN 失败分支打印汇总：
```js
if (!best) {
  console.error('  ERROR: All ' + iters + ' iterations failed for ' + label);
  if (engine.unscheduled && engine.unscheduled.length) {
    console.error('  未排课程明细 (' + engine.unscheduled.length + ' 项):');
    engine.unscheduled.forEach(u => console.error('    - ' + JSON.stringify(u)));
  }
  return { assignments: [], score: Infinity, failed: true };
}
```

---

## 6. 降级接受项（暂不修，改代码时留意）

| 项 | 现状 | 留意点 |
|---|---|---|
| SPEC 双份定义 | `validate-against-excel.cjs` 与 `post-check.cjs` 各自硬编码课程规格（内容已对齐） | 修改任何一处规格时**必须同步另一处**，否则验证口径再次漂移 |
| LLM 规则写入 | `/api/rules/apply` 已加白名单校验 + 备份，但仍是"直接写入"而非"预览→确认"两步 | 若未来开放外部访问，需补确认流程 |

---

## 7. 建议处理顺序

```
① 问题 1（G10/G11 globalTeacher）   ← 唯一可能卡死生产流程的，最先修
② 问题 2（中间件顺序）              ← 启用鉴权前必须修，10 分钟
③ 问题 3 + 5（unscheduled 记录与汇总）← 一起改，提升可观测性
④ 问题 4（测试脱钩）                ← 顺手修
```

全部修完后执行：
```bash
node packages/core/src/__tests__/regression.test.cjs   # 期望全绿
SEED=20260729 node solve-cpsat.cjs                      # 期望 exit 0，或 exit 2 + 未排明细
node validate-against-excel.cjs                         # 期望教师无冲突
```

完成后更新下表：

| 问题 | 状态 | 完成日期 | 备注 |
|---|---|---|---|
| 1 G10/G11 globalTeacher | ⬜ | | |
| 2 中间件顺序 | ⬜ | | |
| 3 G11 unscheduled | ⬜ | | |
| 4 测试脱钩 | ⬜ | | |
| 5 失败汇总打印 | ⬜ | | |
