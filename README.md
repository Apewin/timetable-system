# 排课系统

AP课程选科走班排课系统，为国际课程学校设计。

## 技术栈

- **TypeScript** monorepo (pnpm workspaces)
- **packages/core**: 领域库（model + solver + validate + state，纯逻辑无IO）
- **packages/cli**: Node CLI (citty)
- **packages/web**: 前端（后置）

## 快速开始

```bash
# 安装依赖
pnpm install

# 构建
pnpm build

# 初始化项目
cd /path/to/project
tt init --name "学校名称"

# 添加数据
tt teacher add --id T1 --name 张伟 --canTeach MATH,PHYS
tt room add --id R1 --name 物理实验室 --type physics --capacity 30
tt course add --id MATH --name 数学 --type required --weeklyHours 4
tt student add --id S1 --name 李明 --grade 1 --adminClass AC1 --teachingClass TC1

# 校验数据
tt validate-input

# 生成教学任务
tt build-tasks

# 求解
tt solve

# 查看课表
tt show --by student --id S1
tt show --by teacher --id T1

# 导出
tt export --format html --output timetable.html
```

## CLI 命令

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
