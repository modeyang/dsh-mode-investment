# ADR-0005：Serenity 专家与「研究计划入库」两阶段研判

- 状态：已接受并实现
- 日期：2026-08-28

## 背景

专家中心已有五位专家（段永平、混江龙、查理·芒格、沃伦·巴菲特、孙宇晨），其中四位支持个股研判、五位支持开放对谈。用户要求把公开方法论项目 `serenity-skill`（MIT，muxuuu/serenity-skill）作为第六位专家加入专家中心，并在专家对谈和大师研判中应用。

Serenity 方法的核心是先排产业链层级、找供应链卡点（scarce layer）、再排公司，并以证据强度分级。这与既有「一次生成 REPORT.md」的单阶段研判不同：它天然需要先有研究计划（产业链位置、稀缺环节判断、证据清单、失效条件），再据此执行研究。若直接放宽单阶段报告 prompt，Agent 会在同一轮内边定计划边出结论，丢失「先计划、再研究」的方法论约束，也无法把计划作为可审计产物留存。

## 决策

### 1. Serenity 是第六位专家，同时支持研判与开放对谈

- `packages/masters/assets/serenity-perspective/` 从上游 `serenity-skill`（commit `c2fe93de`）拷贝运行时文件：`SKILL.md`（frontmatter `name` 改为 `serenity-perspective`，正文保持纯方法论）、`agents/openai.yaml`、`references/*.md`、`assets/*`、`scripts/*.py`、`examples/*.md`，并新增 `references/provenance.md` 记录来源、MIT 许可与改编边界。
- `MASTER_THEMES` 新增 `serenity-perspective`：`name: Serenity`、`shortName: 链`、`color: #0ea5e9`、`roleTag: 产业链瓶颈研究`、`tags: [供应链卡点, 证据分层, 逆向核验]`、`planFirst: true`。
- Serenity 不设 `personaDisclaimer`（它是方法论文本，不是真人模拟）；`chatOnly` 为 false，因此进入研判创建器与开放对谈创建器。

### 2. 专家研判引入 `planning` 阶段：先计划、后研究、同一 Session

对 `planFirst` 专家（当前只有 Serenity）的个股研判与开放对谈：

1. 个股研判 `judgement.create`、开放对谈 `expert-chat.create` 初始进入 `planning`，首轮 prompt 读取工作区与 Skill 后，把研究计划完整写入根目录 `PLAN.md`（至少含一级标题、系统/产业链层级、供应链卡点、证据路径、市场可能没看清的地方、反方与失效条件、下一步验证），一句话确认；Serenity 对谈必须提供非空主题。
2. DSH turn/end 后校验 `PLAN.md`（存在、≥120 字符、含一级标题），通过则按 owner 类型原子封存到 `judgements/<id>/plans/0001` 或 `expert-chats/<id>/plans/0001`，写入 `research_plans` 索引；随后在**同一 Session** 发送研究阶段 prompt。研判进入 `reportStatus: 'generating'`，对谈回到普通聊天 Turn。
3. `PLAN.md` 校验失败走一次自动修复（独立 `planRepairAttempts`），与报告修复同构；失败则标记计划失败并保留可删除记录。
4. 研判报告阶段沿用既有 `REPORT.md` 校验、封存、版本与续聊逻辑；计划和报告都是独立不可变快照，开放对谈只入库计划，不生成报告。

### 3. 研究计划入库：与报告同构的不可变快照

- 新增 `research_plans` 表（migration v3，owner 复合主键，研判外键级联删除），保存 owner 类型/ID、可选 `judgement_id`、专家快照、DSH Session、版本、`relative_path/sha256/size_bytes/sealed_at`；`relative_path` 指向封存文件。
- `ResearchPlanStore` 与 `ReportStore` 同构：`validateWorkingPlan` → `seal`（staging→rename 原子写 + SHA-256 + manifest）→ `read`，并拒绝越界路径。
- `JudgementDetail` 与 `ExpertChatDetail` 均返回 `plan: ResearchPlan | null`，客户端在研判归档侧栏和专家对谈详情提供「查看研究计划」入口，用 Markdown 渲染封存的 PLAN.md。
- 消息、工具与 Turn 历史仍只由 DSH 保存；Hanai 不新增消息表。普通追问不改写 `PLAN.md`/`REPORT.md`，只有新建研判或显式修订才更新。

### 4. 版本号与打包

- `MASTER_VERSION` 升至 `2026.08.28-v4`。
- `THIRD_PARTY_NOTICES.md` 新增 `serenity-skill — MIT License` 段落（含 muxu 版权声明与完整许可文本）。
- `migration-manifest.json` 的 51 文件清单保持不变，serenity 文件作为「额外新增」专家资源参与发布包 allowlist 校验。

## 后果

### 正面

- 专家中心展示第六位专家；Serenity 方法论在研判（先计划后研究）与开放对谈（主题扫描）两种入口都能被调用。
- 研究计划作为不可变、带 SHA-256 的审计产物入库，与报告同级可追溯。
- 非 `planFirst` 的四位大师保持单阶段流程，无回归。
- 数据边界延续：DSH 是聊天事实源，Hanai SQLite 只增加业务索引。

### 代价

- `planning` 阶段多一轮模型往返，Serenity 研判成本与耗时高于单阶段大师。
- 状态机新增 `planning` 分支，Host 恢复逻辑（`recover`）需处理「计划封存前中断」与「研究阶段中断」两种场景。
- 上游 Skill 的 frontmatter `name` 与 Hanai 专家 id 不一致，需在 `provenance.md` 与测试中固定改编说明。

## 被否决的方案

### 复用单阶段研判、把计划写进首轮 prompt

无法把计划作为独立封存产物，Agent 首轮输出结构不可控，且与既有报告状态机混叠。

### 为计划新建独立业务表（plan 独立于 judgement）

计划生命周期完全隶属于一次研判（同一 Session、同一工作区、同生命周期），独立表会引入无意义的多态外键与删除协调，收益为零。
