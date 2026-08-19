# AP 课程排课系统

面向国际课程学校的选课、分班、手动排课和全校课表生成系统。系统同时处理行政班、教学班、AP 选修班、其他选修班，以及跨年级授课教师和混合年级课程。

当前网页和 CLI 均以 `packages/backend` 的 rules-first 后端为唯一数据和算法入口。

## 当前版本能做什么

- 管理学生、英文名、教师、课程、行政班、教学班和教师分工。
- 从 Excel 导入学生名单，并根据文件名识别年级；导入前可预览、滚动核对和确认。
- 导入多工作表 AP 选课表，并将表格姓名匹配到学生数据库。
- 导入高三 A/B/C 必修选修课组，以及格式不完全统一的其他选课表。
- 在上传预览区手动点击“大模型整理”，由 DeepSeek 兼容接口整理工作簿；整理完成后仍需人工核对和确认。
- 为课程配置适用年级、适用班级，以及按年级选择行政班或教学班授课。
- 生成 AP/其他选修 section，并在课表中显示 `Section N` 和该组人数。
- 在“排课表”中先拖拽课程建立手动草稿，再确认必要条件；确认后的课程以金色锁框保护，AI 补全后完整课表会回显在同一张表中。
- 基于已确认的手动条件先构造一份可行保底课表，再把保底表作为提示、用剩余预算做一次全局词典序优化；并记录保底与全局结果、质量分项、求解时长和待人工复核项。
- 查看总课表、班级课表、教师课表、学生课表、AP 分流组课表和教室视图。
- 从“排课表”或“总课表概览”保存通过硬约束校验的完整课表到“过往课表”，记录保存时间并支持回看；也可一键清除未锁定课程，同时保留全部金框和其他课表锁。
- 在“系统设置”执行每年一次的学生毕业：归档原 Senior 3 学生和选课、顺延在校学生及班级槽位，并清空全体在校学生的旧学年选修信息。
- 在“工具 → 毕业学生选课信息”只读查看每批毕业学生的 AP 与高三选修快照。
- 在每个页面使用 AI 助手进行解释、排查和提出待确认操作；教师调换、课程调时等写操作需要明确点击确认。

## 重要模型约定

### 班级与课程

- 行政班和教学班是不同的班级类型，不能在建模时混为一类。
- 行政班课程根据行政班学生展示；教学班课程根据教学班学生展示。
- AP 和其他选修课程通过 section 表示，学生在个人课表中看到自己唯一对应的 section。
- 同一时间存在多个选修课程时，班级课表会显示“几门并行”；个人课表会显示具体课程和 `Section N`。
- 课程的“授课方式”可以按年级配置为行政班或教学班，修改后会影响任务生成、section 和排课模型。

### 教室

现行 rules-first 排课版本不把教室和容量作为求解变量：排课只处理时间、教师、学生、班级、section 和规则。教室数据仍可维护并在界面展示，但当前自动排课不会因为教室容量或教室冲突阻止课表生成。

### 硬约束与软约束

硬约束不会自动放宽，典型包括：

- 教师同一时段不能重复授课。
- 同一学生同一时段不能上两门课。
- section 的周课时必须满足。
- 手动确认的金框课程、固定时段和同步活动不能被移动。
- 行政班课程和选修/混编课程的分离规则。
- 配置为硬规则的每日次数、连续节数、最少上课天数等限制。

当严格求解失败时，只有明确列入可审批范围的策略硬规则（目前仅学生每日连续性）才会在页面中逐条展示，并要求教务人员二次确认。批准仅对本次求解和确切规则 ID 生效；固定时段、禁排、锁定、教师与学生冲突不能通过此机制降级。使用审批降级生成的课表会保存审批记录并标记为“待复核”，不能存为正式课表。

软约束用于择优，不保证全部满足，例如课程分散、连堂偏好、时段优先级等。当前默认算法给构造阶段一个很小的限时以取得完整保底表，然后把它作为提示而非锁定条件，将全部剩余预算投入一次全局 CP-SAT 词典序优化。全局阶段失败、超时或结果变差时会回退到已经独立校验过的保底表；需要更充分择优时，可在已有可行课表上点击“继续优化”。

课表生成成功与正式发布是两个状态：硬约束可行表示求解完成；只有质量门槛通过且没有硬规则降级时，`publication_status` 才是 `ready`。默认质量门槛要求 AP 学生不存在日内空堂；未达到时课表仍可查看和人工调整，并显示受影响学生日、集中发生的星期/节次和可行的结构调整方向。

“系统设置 → 排课策略”可运行“质量极限分析”，分别最小化 AP 学生空堂日与 AP 上午空节学生节次。分析冻结当前 Section 分班、保留金框和全部硬约束，并以当前有效课表作为基准；页面显示“当前课表值、搜索值、两者中的最好已知值和改善幅度”，因此限时搜索不会返回比现有课表更差的最好已知值。只有求解状态为 `OPTIMAL` 的结果才标为已证明的数学下界；其他结果明确标为“未证明”。可选择 120、300 或 600 秒预算，但更长预算也不保证证明最优。该结果与允许重新分班、使用完整词典序目标的一键排课不能直接等同比较。如果学校暂时无法调整 Block 或必修课结构，管理员可以在保存课表时输入原因、审批人和精确确认语句，生成 `ready_with_quality_exception` 存档。该例外只允许越过质量门槛，绝不能批准硬冲突或已降级的硬规则，审批快照会永久保存在课表存档中。API 调用方仍可通过 `quality_limits.max_ap_student_gap_days` 显式设置本次发布上限。

## 系统结构

```text
Excel / 页面操作 ─> packages/web ─┐
                                  ├─ HTTP /api ─> packages/backend
大模型 / 管理员 ─> packages/cli ──┘                 │
                                                     ├─ 状态仓库：timetable.json
                                                     ├─ 规则校验与编译
                                                     ├─ section / 选课建模
                                                     ├─ 构造保底解 + 全局词典序 CP-SAT
                                                     ├─ 独立单目标质量极限分析
                                                     ├─ 独立求解子进程（超时/崩溃隔离）
                                                     ├─ 独立课表校验
                                                     └─ DeepSeek：表格整理、策略建议、页面助手
```

### 目录说明

| 路径 | 用途 |
| --- | --- |
| `packages/backend` | 当前唯一网页后端、数据导入、规则编译、排课求解、校验、AI 接口 |
| `packages/cli` | 面向管理员和大模型的机器可读 API 适配器，不包含独立求解逻辑 |
| `packages/web` | 当前网页界面、前端测试和 Vite 构建配置 |
| `packages/backend/assets` | 商用导出所需的默认班级、教师 Excel 模板 |
| `timetable.json` | 本地运行时状态文件，包含学校数据，不纳入 Git |
| `backups/`、`outputs/` | 本地备份和导出结果，均不纳入 Git |

## 快速开始

### 环境要求

- Node.js `>=18`
- pnpm `9`（仓库已声明 `packageManager: pnpm@9.0.0`）

### 安装

```bash
pnpm install
```

### 开发模式

在根目录启动前后端开发环境：

```bash
pnpm dev
```

启动后访问：

- 网页：<http://localhost:3000/>
- 当前 API：<http://localhost:3001/api/status>

开发模式会同时启动：

- `packages/backend/src/server.mjs`：端口 `3001`
- Vite：端口 `3000`，并把 `/api` 代理到后端

也可以分别启动：

```bash
# 终端一：当前后端
pnpm --filter @timetable/backend start

# 终端二：前端开发服务器
pnpm --filter @timetable/web dev
```

### CLI：给管理员和大模型的操作抓手

CLI 输出稳定 JSON，并直接调用当前后端 `/api`；它不读取或改写求解器内部文件，也不保留另一套业务规则。先启动后端，再在仓库根目录执行：

```bash
# 离线查看命令能力和写操作策略
pnpm --silent tt -- capabilities
pnpm --silent tt -- describe
pnpm --silent tt -- describe manual-plan
pnpm --silent tt -- describe schedule.solve

# 只读诊断
pnpm --silent tt -- status
pnpm --silent tt -- validate-input
pnpm --silent tt -- validate
pnpm --silent tt -- list students
pnpm --silent tt -- timetable teacher T_TEACHER_ID

# 通用 API 入口；/api 前缀可省略
pnpm --silent tt -- request GET /state

# 命名业务操作；路径参数和请求体格式由 describe 返回
pnpm --silent tt -- action archive.timetable --param archiveId=ARCHIVE_ID --param by=class --param id=C101

# 手工必要条件、归档、毕业与 AP Block 均有高层命令
pnpm --silent tt -- manual-plan show
pnpm --silent tt -- manual-plan draft --data-file draft.json --apply
pnpm --silent tt -- archive list
pnpm --silent tt -- archive show ARCHIVE_ID
pnpm --silent tt -- graduation preview
pnpm --silent tt -- ap-block show

# 排课会写入当前状态，必须显式确认
pnpm --silent tt -- solve --max-time 120 --candidates 2 --random-seed 77 --apply

# Excel 导入先预览，再把人工核对后的请求体确认写入
pnpm --silent tt -- import ap /path/to/ap-roster.xlsx
pnpm --silent tt -- import ap /path/to/ap-roster.xlsx --ai
pnpm --silent tt -- import confirm ap reviewed-ap-changes.json --apply

# 班级和教师课表模板可预览、AI 匹配并生成两份 Excel；未上传时使用仓库默认模板
pnpm --silent tt -- export preview
pnpm --silent tt -- export ai-match --teacher-template /path/to/teachers.xlsx
pnpm --silent tt -- export generate --mappings reviewed-mappings.json --output-dir outputs --apply
```

`describe` 是供管理员和大模型离线发现业务能力的清单，包含接口方法、路径参数、请求体提示、是否写状态、是否调用外部模型。`action` 执行清单中的 JSON 操作；`import`/`export` 处理 multipart 和本地文件。仍可用 `request` 调用当前后端的其他相对路径，所有非 `GET` 的通用请求一律要求 `--apply`。

`--silent` 用于抑制 pnpm 自身的脚本标题，使标准输出只包含 CLI JSON；也可以直接执行 `node packages/cli/src/cli.mjs ...`。后端不在默认地址时，设置 `TIMETABLE_API_URL`，例如 `http://127.0.0.1:4000/api`。CLI 退出码固定为：`0` 成功、`2` 参数或 JSON 错误、`3` 后端连接/API 失败、`4` 操作缺少 `--apply`。

`--apply` 只表示调用者明确要求执行状态变更或本地文件写入，不会绕过后端权限或业务校验。导入预览、模板预览和 AI 模板匹配虽使用 `POST`，但不会写系统状态，因此命名命令不要求 `--apply`；确认导入、排课、编辑、归档、毕业和生成本地 Excel 必须使用。对于排课，已确认的金框课程仍是硬条件；需要降级的策略硬规则仍须携带后端认可的精确规则审批信息。大模型应先执行 `describe` 和只读命令分析，再把拟执行的写操作展示给用户，获得确认后才加入 `--apply`。

### 商用构建与启动

```bash
pnpm build
pnpm start
```

生产构建由后端同时提供网页和 `/api`，默认地址为 <http://127.0.0.1:3001/>。服务器默认只监听本机；确需在受信任的校园内网部署时，可显式设置 `HOST`。系统当前没有面向公网的账户、权限和租户隔离，不应直接暴露到互联网。

## DeepSeek / AI 配置

AI 不是确定性排课器的唯一依赖。即使没有 API Key，也可以使用数据管理、手动排课和确定性排课功能；以下功能需要配置模型接口：

- Excel “大模型整理”。
- AI 补全排课前的策略建议阶段。
- 页面右侧 AI 助手。
- 首页的 API 连接测试。

方式一：复制环境变量模板并填写：

```bash
cp .env.example .env.local
```

```dotenv
DEEPSEEK_API_KEY=你的密钥
# 可选：兼容 DeepSeek API 的地址
DEEPSEEK_API_URL=https://api.deepseek.com
# 可选：模型名称；也可在网页“系统设置”中修改
DEEPSEEK_MODEL=deepseek-v4-flash
```

方式二：打开网页“系统设置”，填写 API 地址、模型名称和 API Key。API Key 只保存在本地配置中，接口返回时会脱敏为“已配置”。

AI 的安全边界：模型可以解释数据、给出排班方案并生成待确认卡片，但不会因为一句自然语言直接写入学生、教师或课表数据。页面中的教师调换、课程调时等操作必须经过确认；通过 CLI 操作时，写请求必须显式添加 `--apply`。两种入口都会由后端再次检查数据版本、金框锁定和全部硬约束。

页面助手已接入受控 CLI 工具层。模型只会看到白名单操作：状态、规则、校验等无学生个人信息的查询可以在一次对话中经 CLI 执行；排课、金框、AP Block、课表标注和归档等写操作只能生成带操作名与 JSON 参数的确认卡。点击确认后，系统检查数据版本，再通过真实 CLI 的 `action … --apply` 执行。完整状态、学生实体列表、系统设置、毕业、任意实体删除、文件路径和任意 Shell 命令不向页面助手开放。

## 推荐使用流程

1. 在“学生管理”导入各年级学生名单，先检查预览中的姓名、英文名、学号、行政班和教学班，再确认导入。
2. 在“AP 选课”和“其他选课”上传选课表；表格不规范时，点击对应区域的“大模型整理”，核对识别结果后再确认更新。
3. 在“教师管理”“课程管理”“班级管理”“教师分工”中补全授课资格、适用年级、适用班级和授课方式。
4. 在“约束管理”检查硬约束和软约束。涉及规则放宽时，系统要求明确的批准信息，不会自动放宽受保护规则。
5. 进入“排课表”，选择教学班，把课程拖到目标时段。行政班课程可以从教学班视角放入对应的行政班分格；冲突会在格子上标记。
6. 点击“确认必要条件”。确认成功后课程出现金色锁框，并成为 AI 补全的硬条件。
7. 点击“快速生成”。大模型只整理搜索优先级，真正的课表由本地确定性求解器生成；求解器先保留可行初稿，再用剩余时间进行全局择优。已有完整课表后，可点击“继续优化”降低软约束代价。求解运行在独立子进程中，超时或原生求解器异常不会带崩后端，也不会覆盖原课表。
8. AI 完成后，“排课表”会在原网格中回显完整课表：金框仍表示不可移动的必要条件，其余课程标记为“AI 已排”。也可继续在“数据校验”和各类课表视图核对 AP 分流的 `Section N`、行政班去向、教师班级标签和待人工复核项。
9. 若质量门槛未通过，可先在“系统设置 → 排课策略”运行质量极限分析，并按诊断调整 Block/必修课结构；学校确认暂时接受时，保存流程会要求管理员完成质量例外审批。确认无误后，可在“排课表”或“总课表概览”点击保存，之后在“过往课表”按保存时间和审批记录查看。需要重新补排时，可在“排课表”先预览影响，再清除所有未锁定课时；金框必要条件和其他课表锁会保留。

### 每年一次：学生毕业

进入“系统设置 → 学生毕业”后，系统会先展示只读预览。管理员必须在弹窗中输入 `确认毕业` 才能执行。执行后：

- 当前 Senior 3 学生从活动学生库移除，但姓名、英文名、AP 选课和高三选修会保存为只读归档。
- 当前 Senior 1、Senior 2 学生和对应的行政班/教学班槽位顺延一级；空出的 Senior 1 槽位等待新名单导入。
- 所有继续在校学生的 AP、其他选修和 A/B/C 选课组信息会清空；新学年必须重新导入选课，不能沿用旧学年选课。
- 当前课表、section、手动金框必要条件会清空，必须按新学年数据重新排课。

系统会校验三个年级的行政班和教学班槽位能否一一顺延；数量不一致时会拒绝操作，并提示先在班级管理中调整。

## 数据导入说明

### 学生名单

支持拖拽或文件选择上传 Excel/CSV。标准字段包括：

- `Student ID` / 学号
- 中文姓名
- 英文名（可选）
- 年级
- `Class` / 行政班
- `Teaching Class` / 教学班

文件名中的 `Senior 1/2/3`、`2025级`、`高一/高二/高三` 等信息可用于年级识别。导入流程会展示文件识别结果、可导入人数、异常行和完整名单；只有点击确认后才写入数据库。

### AP 选课

“AP 选课”支持多个工作表。系统会读取工作表标题、学生姓名/学号和课程列，并将姓名与学生数据库匹配。导入预览会显示当前 AP 选课和导入后的变化，确认后才更新学生的 `ap_courses`。

### 高三 A/B/C 与其他选课

“其他选课”用于高三 A/B/C 等选择组，也支持格式差异较大的单课名单。解析器优先使用确定性规则；无法识别时可手动点击“大模型整理”，模型只负责把工作簿转换为系统标准结构，最终仍由页面预览和后端校验决定是否写入。

## 主要 API

所有接口返回统一结构：成功为 `{ "ok": true, "data": ... }`，失败为 `{ "ok": false, "errors": [...] }`。

| 接口 | 作用 |
| --- | --- |
| `GET /api/status` | 查看服务、数据量和当前课表状态 |
| `GET /api/state` | 读取当前本地状态 |
| `GET /api/validate-input` | 校验输入模型并生成诊断 |
| `POST /api/solve` | 按当前规则求解并保存课表 |
| `POST /api/manual-plan/ai-solve` | 在已确认金框基础上 AI 补全 |
| `GET /api/validate` | 独立校验当前课表 |
| `GET /api/timetable/:by/:id` | 查看学生、教师、班级、section 或教室课表 |
| `POST /api/import/excel` | 通用 Excel/CSV 预览，可选择 AI 整理 |
| `POST /api/ap-selections/import/preview` | AP 多工作表选课预览 |
| `POST /api/elective-selections/import/preview` | 高三 A/B/C 选课预览 |
| `POST /api/assistant/chat` | 获取页面助手回答和待确认操作 |
| `POST /api/schedule-archives` | 保存当前有效课表快照 |
| `GET /api/graduation/preview` | 只读预览本次毕业会影响的学生、班级和选课 |
| `POST /api/graduation/confirm` | 以确认词和数据版本完成学生毕业 |
| `GET /api/graduation-archives` | 列出毕业学生选课归档 |

实体的增删改查接口仍使用 `/api/:entity`，常用实体包括 `students`、`teachers`、`courses`、`admin_classes`、`teaching_classes`、`teaching_assignments` 和 `constraints`。

## 状态文件与数据安全

默认状态文件是仓库根目录的 `timetable.json`。也可以通过 `STATE_FILE` 指定其他路径：

```bash
STATE_FILE=/path/to/timetable.json pnpm start
```

状态文件包含学生和选课等学校数据，已被 `.gitignore` 排除。不要把 `timetable.json`、`.env.local` 或真实 API Key 提交到 Git。需要保留版本时，应使用网页“过往课表”或单独备份状态文件。

## 测试与检查

```bash
# 一次完成后端与 CLI 语法、lint、全部测试和生产构建
pnpm check
```

真实学校数据相关的集成测试可能因本地尚未导入完整高三 A/B/C 选课而跳过；这不等同于测试失败。发布前应同时检查测试输出、`/api/validate` 和网页中的待人工复核项。

提交或部署前还应执行 [RELEASE_CHECKLIST.md](./RELEASE_CHECKLIST.md)；数据和网络安全边界见 [SECURITY.md](./SECURITY.md)。
