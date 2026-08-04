# `@timetable/web`

当前排课系统的网页前端，使用 Vite 提供开发服务器；数据和排课 API 由同一工作区的 `@timetable/backend` 提供。

## 启动

在仓库根目录执行：

```bash
pnpm install
pnpm --filter @timetable/web start
```

该命令会同时启动：

- 前端：<http://localhost:3000/>
- 当前后端：<http://localhost:3001/>

如果只需要前端开发服务器：

```bash
pnpm --filter @timetable/web dev
```

此时需要另开终端启动后端：

```bash
pnpm --filter @timetable/backend start
```

`packages/web/server.js` 是弃用的旧服务端，不属于当前网页系统；当前系统不使用 `3101` 端口。

## 页面范围

- 排课表、必要条件确认、AI 补全和过往课表。
- 总课表、班级、教师、学生、AP 分流组和教室视图。
- 学生、教师、班级、课程、教室、教师分工和约束管理。
- 学生名单、AP 选课、高三 A/B/C 选课和通用 Excel 导入。
- 系统设置中的管理员确认式“学生毕业”，以及工具中的毕业学生选课信息归档。
- 右侧 AI 页面助手和需确认的调课/教师调换操作。

完整的系统架构、数据格式、算法约束、AI 配置和 API 说明见仓库根目录的 [README.md](../../README.md)。

## 前端检查

```bash
pnpm --filter @timetable/web test
pnpm --filter @timetable/web build
```
