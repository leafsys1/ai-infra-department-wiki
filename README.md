# AI Infra Department Wiki

面向团队协作的 AI Infra 组织知识库工具。把实验、故障、评测、部署经验和经过审查的结论，沉淀成可检索、可追溯、可继续维护的知识记录。

> 本仓是工具分发仓，不存放部门真实知识。真实知识放在独立的私有知识仓，通过 Git 分支和 Pull Request 协作。

[English](README.en.md) · [安装 Skill](#安装) · [知识仓工作流](#工作流) · [可视化看板](#可视化看板)

![license](https://img.shields.io/badge/license-MIT-1f883d?style=flat-square)
![node](https://img.shields.io/badge/node-%3E%3D22-1f883d?style=flat-square)
![tests](https://img.shields.io/badge/tests-169%20passed-1f883d?style=flat-square)
![Hermes](https://img.shields.io/badge/Hermes-Skill-8250df?style=flat-square)

## 解决的问题

团队知识经常散落在聊天、日志、临时文档和个人记忆里。这个 Skill 提供一套小而完整的闭环：

- **记录**：Case、Evidence、Decision、Pattern、Runbook、Environment
- **校验**：frontmatter、JSON Schema、引用关系、敏感信息和脱敏策略
- **检索**：关键词、中文 bigram、类型/状态/模型/加速器/标签过滤
- **协作**：每次贡献走分支和 PR，记录与新增证据可以一起发布
- **同步**：同事先 sync，再 query；能看到自己上次同步后的新增内容
- **演进**：Pattern 通过 held-out Skill gate 后，才升级为可复用 Skill

## 安装

本仓是公开工具仓。使用 Hermes：

```bash
hermes skills install leafsys1/ai-infra-department-wiki/skills/ai-infra-department-wiki
```

也可以直接安装某个分支的 SKILL.md：

```bash
hermes skills install https://raw.githubusercontent.com/leafsys1/ai-infra-department-wiki/main/skills/ai-infra-department-wiki/SKILL.md
```

安装后，CLI 位于 Skill 目录的 `scripts/team-wiki.js`。

## 工作流

### 1. 建知识仓

```bash
node scripts/team-wiki.js init ../department-knowledge --name "AI Infra Department"
cd ../department-knowledge
node .department-tools/scripts/team-wiki.js validate . --strict
```

`init` 会生成记录目录、脱敏策略、CI、PR 模板、CODEOWNERS，并把固定版本工具链写入 `.department-tools/`。真实知识仓建议设为私有。

### 2. 贡献记录

```bash
node .department-tools/scripts/team-wiki.js sync .
node .department-tools/scripts/team-wiki.js query . prefill 吞吐 --accelerator 910b2c
node .department-tools/scripts/team-wiki.js capture . case CASE-2026-0007
# 编辑 drafts/CASE-2026-0007.md，完成后移动到 records/ 并补齐 evidence
node .department-tools/scripts/team-wiki.js validate . --strict
node .department-tools/scripts/team-wiki.js publish . records/cases/inference/CASE-2026-0007.md --push
```

一个 PR 应该能回答：发生了什么、证据在哪里、适用于什么环境、限制是什么、谁复核过。

### 3. 查找和浏览

```bash
node .department-tools/scripts/team-wiki.js build .
node .department-tools/scripts/team-wiki.js overview .
node .department-tools/scripts/team-wiki.js show . CASE-2026-0001
node .department-tools/scripts/team-wiki.js related . CASE-2026-0001
```

## 可视化看板

打开 [部门知识看板](docs/department-dashboard/index.html)。看板是一个无构建、无服务依赖的单文件页面，视觉参考 GitHub 的仓库首页：

- 左侧按知识类型浏览，中心显示知识活动、状态分布和最近更新
- 搜索、状态过滤、类型过滤、排序、记录详情和关系图都在本地完成
- 点击“导入 catalog.json”即可加载知识仓 `generated/catalog.json`
- 不上传数据；页面只读取你主动选择的本地 JSON 文件

也可以用浏览器直接打开文件：

```bash
xdg-open docs/department-dashboard/index.html
```

## 记录类型

| 类型 | 用途 |
| --- | --- |
| Case | 一个问题、实验或迁移任务的完整结论 |
| Evidence | 原始压测、日志摘要或可复核的证据 |
| Decision | 团队做出的选型与取舍 |
| Pattern | 可迁移到其他任务的做法 |
| Runbook | 可按步骤执行的操作流程 |
| Environment | 运行环境和依赖基线 |

## 质量门禁

```bash
npm run verify:skill-install
node --test tests/js/*.test.js
node workbench/scripts/check-repository-privacy.mjs
```

当前仓库不承载部门真实知识。请不要提交客户资料、内部地址、凭据、原始日志或未经脱敏的性能数据。

## 许可证

MIT
