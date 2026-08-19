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

正式运行时先在根目录执行 `pnpm build`，再执行 `pnpm start`；构建后的页面由当前后端统一提供。

## 页面范围

- 排课表、必要条件确认、AI 完整课表回显、保留锁定的一键清除、完整课表保存和过往课表。
- 总课表、班级、教师、学生、AP 分流组和教室视图。
- 学生、教师、班级、课程、教室、教师分工和约束管理。
- 学生名单、AP 选课、高三 A/B/C 选课和通用 Excel 导入。
- 导出页内置学校的班级、教师空白课表模板，无需上传即可预检映射并生成两份保留原格式的正式版 Excel；教师表先按姓名，再按年级、课程和系统教师分工匹配。剩余受限候选可由用户明确点击 AI 复核，调用时不发送学生信息或完整课表，最终映射仍可人工修改。
- 系统设置中的管理员确认式“学生毕业”，以及工具中的毕业学生选课信息归档。
- 右侧 AI 页面助手和需确认的调课/教师调换操作。

## 管理后台界面

界面壳层参考 [satnaing/shadcn-admin](https://github.com/satnaing/shadcn-admin) 的后台信息架构，保留当前原生 Vite 页面及全部后端 API，没有把示例项目整仓复制进来。

- 左侧导航可折叠；窄屏时变为抽屉式导航。
- `⌘ K` / `Ctrl K` 可搜索并打开任意页面。
- 支持浅色、深色主题并记住本机选择。
- 首页工作台显示学生、教师、课程、规则和课表发布状态。
- 顶部“进入排课”只打开排课工作区，实际求解仍需在排课页明确发起。

完整的系统架构、数据格式、算法约束、AI 配置和 API 说明见仓库根目录的 [README.md](../../README.md)。

## 前端检查

```bash
pnpm --filter @timetable/web test
pnpm --filter @timetable/web build
```
