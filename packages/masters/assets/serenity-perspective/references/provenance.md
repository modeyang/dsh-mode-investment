# 来源、许可与改编说明

本能力包参考并重新编排了以下开源项目：

- 项目：`muxuuu/serenity-skill`
- 链接：https://github.com/muxuuu/serenity-skill
- 上游声明许可：MIT（Copyright (c) 2026 muxu）
- 读取 commit：`c2fe93deedfd0d1bd9fe7ef0601ea1b9c20ea24a`
- 读取日期：2026-08-28

上游 Skill 提供 Serenity 式产业链研究路径：市场故事 → 系统变化 → 必要零部件 → 产业链层级 → 供应链卡点 → 上市公司 → 证据 → 市场可能没看清的地方 → 什么情况说明这个判断错了。它要求优先排产业链层级、按证据强弱排序公司、对时效事实先联网核验，并明确研究支持边界（不执行交易）。

Hanai 版本不是逐字镜像。它为“个股研判 + 专家开放对谈”场景重新编排并补充了以下约束：

1. frontmatter `name` 由上游 `serenity-skill` 改为 `serenity-perspective`，以匹配 Hanai 专家注册标识；方法论正文保持上游纯方法论内容。
2. 个股研判采用两阶段流程：先写并封存 `PLAN.md`（研究计划入库），再据计划执行研究写 `REPORT.md`；两文件都在工作区根目录，普通追问不修改已封存版本。
3. “Serenity”在此是公开方法论的研究视角，不是真人参与、认可或背书；具体时效事实必须回到公告、财报、交易所文件、监管/项目文件等一手来源核验。
4. 明确的产业链卡点判断必须以证据分层（strong/medium/weak）支撑；社交内容只作线索，不作高置信结论依据。
5. 研究支持边界保持上游口径：提供研究优先级、证据链、风险核验与下一步检查清单；买卖决策始终由用户自己决定。

上游 README、CHANGELOG、SECURITY、CONTRIBUTING 与构建期文件不属于运行时能力包，未随 SKILL.md 一并迁移；MIT 许可声明与版权信息记录在仓库根 `THIRD_PARTY_NOTICES.md`。
