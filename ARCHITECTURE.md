# 系统架构与模块边界

本项目使用单一 rules-first 后端。页面、CLI 和 AI 助手都通过 `/api` 进入同一业务内核，不复制求解规则。架构目标是让关键业务概念形成有深度的 Module：Interface 小而稳定，复杂 Implementation 留在 Module 内部，从而提高 Locality，减少修改一条规则时跨文件追踪的范围。

## 关键 Module

| Module | Public Interface | 负责的 Implementation |
| --- | --- | --- |
| `teacher-scheduling-policy.mjs` | 教师设置校验、求解限制、不可行诊断、独立违规列表 | 每日/每周上限、可用节次、错误消息与求解前诊断 |
| `computation-job-manager.mjs` | `start/get/recent/cancel` | 作业生命周期、真实阶段、结果、取消信号、重启中断恢复、元数据持久化 |
| `computation-job-policy.mjs` | HTTP 计算请求映射、求解阶段展示 | 允许异步化的白名单、结果位置、求解器阶段到用户文案的 Adapter |
| `solver-job-runner.mjs` | `runSolverJob(job, options)` | 独立子进程、超时、stderr 隔离、进度消息和 AbortSignal 终止 |
| `state-schema.mjs` | `migrateStateDocument/stateDocumentForWrite` | 有序 schema 迁移、未来版本拒绝策略 |
| `state-repository.mjs` | `read/write/revision/listBackups/restoreBackup` | 冻结读取、派生状态 hydration、乐观并发、压缩持久化、原子写入、写前备份与安全恢复 |
| `security-boundary.mjs` | 登录、认证、Cookie、失败限流 | 密码比较、HMAC 会话、TTL 与环境配置 |
| `operation-audit.mjs` | `record/recent` | 私有追加式 JSONL 审计，不接触请求正文 |
| `exam-planner-view.mjs` | 编辑器序列化、考场名单 CRUD、导入转换、四阶段状态、结果审查、教师公平性摘要 | 前端考试业务状态与展示 Adapter，不依赖 DOM |
| `overview-timetable-view.mjs` | `overviewCardSummary` | 总课表卡片的课时上限、已排课时与展示标签转换 |
| `import-readiness-view.mjs` | `importReadinessModel/importTemplateCsv` | 导入就绪度、缺失项和标准 CSV 模板生成 |
| `teacher-assignment-view.mjs` | `summarizeTeachingTasks/teachingTaskStaffing` | 教学任务覆盖率和“无需教师”状态判定 |
| `responsive-shell.mjs` | 助手折叠策略 | 中等宽度三栏降级规则 |

`server.mjs` 仍是 Express composition root：它连接上述 Module 与路由，但不应成为新规则的唯一实现位置。新增业务规则时，优先建立或扩展一个领域 Module，再让 HTTP 路由做薄 Adapter。

## 关键执行流

### 排课与排考试计算

1. 前端识别白名单计算请求，发送 `X-Computation-Job: async`。
2. 后端立即返回 `202` 和 job id；`computation-job-manager` 在后台执行原业务用例。
3. 求解工作通过 `solver-job-runner` 进入独立进程，真实阶段回传到 job。
4. 前端轮询 job；刷新后从最近作业恢复，取消时 AbortSignal 终止子进程。
5. 只有未取消且通过独立校验的结果才能经 `StateRepository.write` 原子保存。

普通 CRUD 不进入这一 Seam，仍同步返回，避免把所有写操作误包装成后台任务。

### 状态写入

1. `read` 解析 JSON，通过 `state-schema` 顺序迁移，再 hydrate 派生课表并深冻结。
2. `write` 验证 `expectedRevision`，压缩派生字段，并设置当前 `schema_version`。
3. 覆盖前复制旧文件到私有备份目录。
4. 新文档先写临时文件，再原子 rename；最后按保留策略清理旧备份。

设置页通过 `GET /api/state-backups` 读取不含文件路径的版本摘要。恢复必须从该白名单 ID 中选择，提交精确确认词和当前 revision；恢复前当前状态仍会自动进入备份链，避免形成不可逆覆盖。

迁移必须是确定性、幂等的 `N → N+1` 函数。新增 schema 时提高 `CURRENT_STATE_SCHEMA_VERSION`，追加迁移和回归测试；不要修改已经发布迁移的含义。

## 不变量

- 教师周课时与每日课时是上限，不是必须排满的等式。
- 求解器约束和独立校验必须调用同一个教师策略 Interface。
- AI 只能建议搜索顺序和软权重，不能绕过硬约束、金框、审批或独立校验。
- 已取消、超时、崩溃、版本冲突或校验失败的计算不得覆盖现有有效结果。
- 排考试不读取日常课表冲突；考试周与教学周是不同时间域。
- 巡考来自具体课程的实际教师分工，不从课程名或 `can_teach` 猜测。
- 运行时学生数据、作业历史、审计和备份不得进入 Git。

## 验证层次

- 领域单元测试：策略、迁移、工作流状态和展示转换。
- API 集成测试：认证、审计、异步作业、revision 冲突、考试保存/求解/导出。
- 独立求解器与校验测试：同一结果分别验证硬约束。
- Playwright Chrome E2E：1280px 内容布局、四阶段排考试、真实 job、考场与教师任务、Excel 下载、刷新恢复。
- `pnpm check`：语法、lint、后端/前端/CLI 测试、全校集成和生产构建；`pnpm test:e2e`：真实 Chrome 回归。
