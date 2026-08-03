# 排课系统代码审查报告

> 审查工具：Alibaba OpenCodeReview 1.8.3
> 审查模型：DeepSeek `deepseek-v4-flash`
> 报告日期：2026-07-31
> 审查方式：对关键文件进行全文件扫描；本报告记录的是审查发现，尚未自动修改源码。

## 一、结论摘要

本次审查已经确认 DeepSeek API 接入正常。最初出现的 `404 /v1/messages` 并不是 DeepSeek 地址或模型名称错误，而是 OpenCodeReview 当时使用了 Anthropic 协议。切换到内置 `deepseek` 提供商后，连接测试成功。

代码层面目前确认了 8 个问题：

| 优先级 | 数量 | 主要影响 |
| --- | ---: | --- |
| 中 | 4 | 可能导致规则不生效、任务 ID 冲突或性能明显下降 |
| 低 | 4 | 维护性问题，以及配置错误时缺少明确提示 |

建议先处理“任务 ID 冲突”和“年级规则匹配”两类问题，再处理性能和常量整理问题。

## 二、DeepSeek 接入排查

DeepSeek 官方文档明确支持：

- OpenAI 兼容 Base URL：`https://api.deepseek.com`
- 模型：`deepseek-v4-flash`
- OpenAI 兼容调用路径：`/chat/completions`

参考：[DeepSeek 官方首次调用文档](https://api-docs.deepseek.com/zh-cn/)。

实际故障过程如下：

1. 初始配置下，OpenCodeReview 把请求发送到了 `https://api.deepseek.com/v1/messages`。
2. `/v1/messages` 是 Anthropic 风格路径，而不是 DeepSeek 的默认 OpenAI 兼容路径，因此返回 `404 Not Found`。
3. 执行 `ocr config set provider deepseek` 后，CLI 改用 OpenAI 兼容协议。
4. 使用 `deepseek-v4-flash` 的 `ocr llm test` 已成功。
5. 小文件扫描也已经成功返回审查意见，说明模型、密钥、协议和代码审查工具链均能工作。

全量扫描曾被中止，主要原因是一次提交的文件数量和上下文规模较大；这与 API 基础连接失败不同。后续应按后端、核心算法、前端分批扫描。

## 三、详细问题

### P1：`CLASS_TYPES` 缺少 `ELECTIVE`

- 文件：`packages/core/src/constants.cjs:6-12`
- 类型：维护性 / 一致性
- 严重程度：中

当前集中常量只有 `ADMIN`、`TEACHING`、`AP`、`BATCH`、`FILLER`，没有 `ELECTIVE`。但系统多个位置直接使用字符串 `elective`，例如：

- `packages/backend/src/server.mjs`
- `packages/core/src/solver/section-local-search.cjs`
- `packages/core/src/solver/section-cpsat-engine.cjs`
- `packages/core/src/solver/integer-section-cpsat-engine.cjs`

影响是“集中定义 class type”的目标没有实现，后续代码仍会继续散落字符串。若某个模块拼写不一致，排课过滤逻辑可能漏掉普通选修课。

建议：

```js
const CLASS_TYPES = Object.freeze({
  ADMIN: 'admin',
  TEACHING: 'teaching',
  AP: 'ap',
  ELECTIVE: 'elective',
  BATCH: 'batch',
  FILLER: 'filler',
});
```

同时逐步将业务代码中的 `'elective'` 替换为 `CLASS_TYPES.ELECTIVE`，并增加常量覆盖测试。

### P2：`makeTaskId` 存在下划线碰撞风险

- 文件：`packages/core/src/constants.cjs:30-32`
- 类型：潜在业务错误
- 严重程度：中

当前实现是：

```js
return cls + '_' + cid + '_' + studentId + '_' + slotId;
```

但 `class_id`、`course_id`、`section_id` 等标识符本身可能含有下划线。于是不同的输入可能得到同一个结果，例如：

```text
makeTaskId('A_B', 'C', 'D', 'E') -> A_B_C_D_E
makeTaskId('A', 'B_C', 'D', 'E') -> A_B_C_D_E
```

`task_id` 被锁管理器、去重逻辑和排课校验使用。发生碰撞时，可能出现锁错对象、去重误判、错误覆盖或冲突检查遗漏。

建议使用不可出现在 ID 中的分隔符并进行编码，或者使用长度前缀/结构化 JSON 后再编码。例如：

```js
return [cls, cid, studentId, slotId]
  .map(value => encodeURIComponent(String(value)))
  .join('|');
```

必须补充包含下划线、竖线和空字符串的回归测试，并检查所有读取 `task_id` 的地方是否依赖旧格式。

### P3：`TOTAL_SLOTS` 是独立魔法数字

- 文件：`packages/core/src/constants.cjs:18-20`
- 类型：维护性 / 潜在配置错误
- 严重程度：中

当前定义：

```js
const DAYS_PER_WEEK = 5;
const PERIODS_PER_DAY = 10;
const TOTAL_SLOTS = 50;
```

如果日节数或周天数修改，`TOTAL_SLOTS` 可能忘记同步，进而影响容量判断、槽位索引和排课边界。

建议改为单一数据源：

```js
const TOTAL_SLOTS = DAYS_PER_WEEK * PERIODS_PER_DAY;
```

同时增加一个断言测试，保证 `TOTAL_SLOTS === DAYS_PER_WEEK * PERIODS_PER_DAY`。

### P4：规则编译器重复构建学生 Map

- 文件：`packages/backend/src/rule-compiler.mjs:12-17`
- 类型：性能
- 严重程度：中

`gradesForSection` 每被调用一次，就会重新遍历所有学生并创建一个 `Map`。它在每个 section、每条规则中反复执行。当学生数为 `N`、section 数为 `S`、规则数较多时，会产生大量重复的 `O(N)` 工作。

排课数据规模扩大后，这会增加规则编译耗时，尤其影响包含 `grades` 或 `teaches_grades` 条件的规则。

建议在 `compileRules` 开始时只创建一次：

```js
const studentsById = new Map(
  (state.students || []).map(student => [student.id, student]),
);
```

之后将 `studentsById` 传入 `matchesSelector` 和 `gradesForSection`，把重复工作从每次调用降为每次编译一次。

### P5：非 section 作用域的 `grades` 选择器可能静默失效

- 文件：`packages/backend/src/rule-compiler.mjs:30-33`
- 类型：规则逻辑错误
- 严重程度：中

当前逻辑是：

```js
const grades = scope === 'section'
  ? gradesForSection(entity, state)
  : new Set([entity.grade]);
```

教师、课程、教室等实体通常没有 `grade` 属性。此时 `grades` 实际上是 `{undefined}`，任何类似“适用于 Senior 2”的规则都可能匹配不到目标，但系统只会把它标记成 `unmatched`，不会明确报错。

这会直接影响按年级配置软约束或硬约束的行为：规则看起来保存成功，实际可能没有作用。

建议二选一：

1. 对教师、课程等实体根据其关联 section 推导年级；或
2. 在规则校验阶段禁止不支持的 `scope + grades` 组合，并给出明确错误。

### P6：`section_class_types` 只对 teacher 作用域生效

- 文件：`packages/backend/src/rule-compiler.mjs:34-40、60-67`
- 类型：规则语义不一致
- 严重程度：低至中

`section_class_types` 目前只在 teacher 作用域的 section 过滤中使用。对于 course、class、room 等作用域，section 只按课程、班级或教室匹配，`section_class_types` 会被静默忽略。

如果产品层允许教务为任意规则配置“只作用于行政班/教学班/AP 选修”，当前行为会造成配置与实际排课效果不一致。

建议明确产品语义：

- 如果该字段应该对所有作用域生效，就统一放到 section 过滤的公共逻辑中；
- 如果它只允许 teacher 规则使用，就在规则 schema 中限制，并在保存时提示。

### P7：带 selector 的 global 规则存在内部状态不一致

- 文件：`packages/backend/src/rule-compiler.mjs:45-59、81`
- 类型：规则配置错误
- 严重程度：低

`global` 作用域会构造一个虚拟实体 `{ id: 'GLOBAL' }`。如果 global 规则同时带有 `ids`、`grades` 等 selector，selector 匹配几乎必然失败，`target_ids` 为空；但后续又把 global 规则的 `unmatched` 固定为 `false`，并让 `section_target_ids` 返回全部 section。

这会产生“目标实体为空，但 section 目标全量生效”的矛盾状态，后续维护者很难判断规则到底是否生效。

建议：

- global 规则禁止带 selector；或
- global 规则跳过 selector 匹配，并明确 `target_ids` 的语义；或
- 对不合法配置直接返回校验错误，不进入求解器。

### P8：软规则缺少默认权重

- 文件：`packages/backend/src/rule-compiler.mjs:70-80`
- 类型：健壮性 / 维护性
- 严重程度：低

当前输出为：

```js
weight: rule.hard ? 0 : rule.weight,
```

当软规则未配置 `weight` 时，结果是 `undefined`。如果后续优化器用它参与数值计算，可能产生 `NaN`、比较异常，或导致该软约束被静默忽略。

建议在编译阶段归一化：

```js
weight: rule.hard ? 0 : (rule.weight ?? 1),
```

并在规则 schema 中限制权重为有限的非负数。

## 四、建议的修复顺序

### 第一批：先修复可能影响排课正确性的项目

1. P2：重构 `makeTaskId`，补充碰撞回归测试。
2. P5：明确并修复按年级规则在 teacher/course/class 作用域的匹配逻辑。
3. P7：禁止或正确处理带 selector 的 global 规则。
4. P8：为软规则补充默认权重和 schema 校验。

### 第二批：性能和一致性

1. P4：缓存 `studentsById`，减少规则编译耗时。
2. P1：补充 `CLASS_TYPES.ELECTIVE` 并消除散落字面量。
3. P3：由周数和每日节数推导 `TOTAL_SLOTS`。
4. P6：统一 `section_class_types` 的作用域语义。

## 五、验证计划

修复后建议至少执行：

```bash
pnpm test
pnpm build
```

并新增或补充以下测试：

- 含下划线 ID 的 `makeTaskId` 唯一性测试；
- Senior 1/Senior 2/Senior 3 的 section 年级匹配测试；
- teacher、course、class、section 四种作用域的 selector 测试；
- global 规则带 selector 时的配置校验测试；
- 未填写软规则权重时的默认值测试；
- 修改周天数或每日节次后 `TOTAL_SLOTS` 自动同步的测试。

本报告只记录审查结果，没有自动改动上述源码。
