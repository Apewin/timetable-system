# 商用提交检查清单

## 自动检查

```bash
pnpm install --frozen-lockfile
pnpm check
```

`pnpm check` 必须依次通过后端与 CLI 语法检查、全仓 lint、后端/前端/CLI 测试，以及 Vite 生产构建。

后端启动后再执行只读 CLI 冒烟：

```bash
pnpm --silent tt -- capabilities
pnpm --silent tt -- describe schedule
pnpm --silent tt -- status
pnpm --silent tt -- validate
pnpm --silent tt -- export preview
```

使用脱敏测试工作簿执行一次 `import TYPE FILE`，确认预览不会写状态；在临时目录执行一次带 `--apply` 的 `export generate`，确认班级和教师两份 Excel 都能打开。不要在发布检查中确认导入、毕业或重新排课真实数据。

## 提交范围

- 应包含 `packages/backend`、`packages/cli`、`packages/web`、默认 Excel 模板、根目录配置和当前文档。
- 不应包含 `timetable.json`、`.env.local`、`backups/`、`outputs/`、`dist/`、日志或任何填有真实信息的 Excel。
- 使用 `git status --short` 检查没有意外的个人路径、临时脚本或生成文件。

## 业务验收

- 通过 `/api/validate` 确认硬违规为 0。
- 确认金框必要条件全部保留，且没有未经批准的硬规则降级。
- 只有 `publication_status = ready` 的课表才能保存为正式课表。
- 抽查 AP Block 名单、上午时段分布、教师冲突和导出的两份 Excel。

## 部署

```bash
pnpm build
pnpm start
```

默认访问地址为 <http://127.0.0.1:3001/>。非本机部署必须先落实 `SECURITY.md` 中的反向代理、HTTPS 和身份认证要求。
