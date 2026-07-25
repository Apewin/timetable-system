# 排课系统 Web 前端

基于 Express + Vite 的 Web 前端，提供可视化的排课管理界面。

## 功能

- 📊 项目状态查看
- 👨‍🏫 数据管理（教师、教室、课程、学生、班级等）
- 📅 课表查看（按学生、教师、班级、教室）
- ✅ 数据校验
- 📤 课表导出

## 快速开始

```bash
# 安装依赖
pnpm install

# 启动开发服务器（需要同时启动 API 服务器和前端）
pnpm start

# 或者分别启动
pnpm server  # 启动 API 服务器 (端口 3001)
pnpm dev     # 启动前端开发服务器 (端口 3000)
```

## 访问

- 前端: http://localhost:3000
- API: http://localhost:3001/api

## API 接口

### 状态
- `GET /api/status` - 获取项目状态

### 实体管理
- `GET /api/:entity` - 获取实体列表
- `POST /api/:entity` - 添加实体
- `PUT /api/:entity/:id` - 更新实体
- `DELETE /api/:entity/:id` - 删除实体

实体类型: teachers, rooms, courses, students, admin_classes, teaching_classes, teaching_assignments, ap_selections, constraints

### 校验
- `GET /api/validate-input` - 校验输入数据

### 课表
- `GET /api/timetable/:by/:id` - 获取课表

### 任务
- `POST /api/build-tasks` - 生成教学任务

## 环境变量

- `STATE_FILE` - 状态文件路径（默认: 当前目录下的 timetable.json）
- `PORT` - API 服务器端口（默认: 3001）
