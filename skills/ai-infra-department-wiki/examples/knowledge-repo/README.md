# AI Infra 部门知识库

这里是随 Skill 一同分发的组织知识快照，不是空模板。知识正文保存在 `records/` 的 Markdown 文件中，`generated/` 是可重建的目录、图谱和看板产物。每位同事从 GitHub 安装 Skill 后，都能直接检索这份快照；后续增量通过组织知识仓评审后同步回 Skill。

## 记录类型

| 类型 | 路径 | 用途 |
| --- | --- | --- |
| 案例（`case`） | `records/cases/<领域>/` | 一次工程实测：目标、基线、变更、受控变量、结果、结论和适用边界。 |
| 证据（`evidence`） | `records/evidence/` | 冻结摘录、来源哈希、精确定位与核验信息。 |
| 决策（`decision`） | `records/decisions/` | 技术取舍、理由、反证和重新评估条件。 |
| 实践模式（`pattern`） | `records/patterns/` | 可跨案例复用的机制、行动和不适用条件。 |
| 运行手册（`runbook`） | `records/runbooks/` | 可执行的步骤、成功标准和失败处理。 |
| 环境基线（`environment`） | `records/environments/` | 硬件、软件和拓扑约束。 |

`records/cases/` 下按推理、训练、通信、部署和故障领域组织。`records/**/*.md` 都会被解析为正式记录；不要把普通说明文档放进去。

## 状态与证据边界

状态依次为 `draft → proposed → observed → verified → replicated`。从既有项目导入的**案例**在部门内未复跑前保留 `observed`；逐字摘录且哈希、来源定位可核的**证据**可以单独标为 `verified`，但这不表示案例的工程结论已经复验。冻结摘录发生变化时新增证据记录，不覆盖旧证据。

## 本地 Agent 检索

在已安装 Skill 的目录下运行：

```bash
node scripts/team-wiki.js query examples/knowledge-repo Qwen TPOT
node scripts/team-wiki.js show examples/knowledge-repo CASE-2026-0021
node scripts/team-wiki.js related examples/knowledge-repo CASE-2026-0021
```

看板位于 `generated/dashboard.html`；经 HTTP 提供时会读取同目录的 `catalog.json` 和 `graph-data.json`。`file://` 模式下可手动导入 catalog。新记录先在协作知识仓提交审核，验证后重建并更新此随 Skill 分发的快照。
