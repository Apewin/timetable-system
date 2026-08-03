# 排课系统

面向国际课程学校的选科、分班、手动锁定和全校联合排课系统。

## 技术栈

- **packages/backend**：当前唯一生产后端，包含 rules-first 规则编译、CP-SAT 求解、独立校验与数据导入
- **packages/web**：当前网页前端，开发端口 `3000`，将 `/api` 转发到后端 `3001`
- **packages/core / packages/cli / packages/web/server.js**：早期原型，仅供历史对照，不参与当前网页排课

## 快速开始

```bash
# 安装依赖
pnpm install

# 同时启动当前后端和网页
pnpm --filter @timetable/web start
```

浏览器打开 `http://localhost:3000/`。也可以使用 `pnpm dev` 启动整个工作区的开发监听。

不要运行 `packages/web/server.js`；它是弃用的旧后端。只有显式执行
`pnpm --filter @timetable/web server:legacy` 才会启动它。

## 旧版 CLI（弃用）

以下命令属于 `packages/core` / `packages/cli` 原型，不是当前网页后端的数据或算法入口。

### 基础命令
- `tt init`: 初始化项目
- `tt status`: 查看项目状态
- `tt config set-walk-blocks`: 设置走班时段

### 数据管理
- `tt <entity> add`: 添加实体
- `tt <entity> list`: 列出实体
- `tt <entity> edit`: 编辑实体
- `tt <entity> rm`: 删除实体

实体类型: teacher, room, course, student, admin-class, teaching-class, teaching-assignment, ap-selection, constraint

### 校验
- `tt validate-input`: 校验输入数据完整性
- `tt validate`: 验证排课结果

### 求解
- `tt build-tasks`: 生成必修教学任务
- `tt solve sections`: 执行AP分班
- `tt solve timetable`: 执行排课
- `tt solve`: 两阶段求解（分班+排课）

### 查看与调整
- `tt show --by <student|teacher|class|room> --id <ID>`: 查看课表
- `tt lock --task <ID> --slot <SLOT>`: 锁定任务时段
- `tt unlock --task <ID>`: 解锁任务
- `tt swap --task <ID> --to <SLOT>`: 手动交换时段

### 导出
- `tt export --format <csv|html> --output <FILE>`: 导出课表

## 约束系统

### 硬约束（违反=课表非法）
- H1: 老师不重叠
- H2: 学生不重叠（走班核心）
- H3: 教室不重叠
- H4: 教室容量
- H5: 课时排满
- H6: 禁排
- H7: 教室类型匹配
- H8: 教师日上限

### 软约束（打分优化）
- S1: 优先排上午（权重5）
- S2: 连堂（权重8）
- S3: AP落走班时段（权重10）
- S5: 课表分散均衡（权重3）

## 验收标准

1. ✅ 能建全实体并 `validate-input` 通过
2. ✅ `tt solve sections` 出 AP sections，色数 ≤ 走班时段数
3. ✅ `tt solve timetable` 输出课表：所有硬约束 H1-H8 零违反
4. ✅ `tt show` 能按学生/老师/班级/教室看课表
5. ✅ `tt lock` 一节课后重排，锁定不被改
6. ✅ 同输入同 `--seed` → 同输出
7. ✅ 约束单测全绿

## 当前排课策略

网页后端默认使用 `bounded-feasible-first`：在固定时间预算内生成少量完整候选并择优，不做全局最优证明，也不穷举全部分班组合。

- 课时数完整、教师/学生不重叠、固定时段、手动金框和同步课组始终是不可放宽条件。
- “学生每天课程从第一节连续向后排列”在自动补全阶段作为高权重人工复核指标；它不会再让一张已经排满且无冲突的课表被整体丢弃。
- 系统优先返回完整候选，再按人工复核项数量和普通软规则分数择优。课表会记录 `review_items`、`quality_score` 和实际求解时间。
- 如需运行旧的严格精确模式，可在 API 请求中显式传入 `feasible_first: false`。
