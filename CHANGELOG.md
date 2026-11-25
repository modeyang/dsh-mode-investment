# 更新日志

## 未发布

- **需求**：为 Matt Pocock 工程技能配置本仓库的任务跟踪、分诊和领域文档约定。
- **实现**：配置 GitHub origin 为 Issue 目标，使用默认分诊标签和单上下文领域文档布局；增加技能入口。交付文件：`AGENTS.md`、`docs/agents/issue-tracker.md`、`docs/agents/triage-labels.md`、`docs/agents/domain.md`、`CHANGELOG.md`。
- **验证**：确认目标仓库可访问、五个分诊标签存在，运行 `git diff --check`。
- **限制**：`gh` 在本仓库默认解析到上游；操作 Issue 时须显式指定 origin。此次为文档配置改动，未运行代码测试。
- **Issue/PR**：无。
