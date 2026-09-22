# QA 质检成果入库规范

本规范把 `inference-delivery-qa` 产出的内部质检包，转换为 AI Infra 部门知识库中的可审查记录。质检 Skill 负责“核查和产出证据”，本知识库负责“长期沉淀和检索”；两者不是互相替代。

## 1. 质检包与知识记录的对应关系

| 质检包内容 | 入库记录 | 入库要求 |
| --- | --- | --- |
| `QA-REPORT.md` 的项目结论 | Case | 记录项目、版本、范围、状态和结论，不复制未经脱敏的客户原文 |
| `mechanical/result.json`、`report.md`、`findings.csv` | Evidence | 记录哈希、生成命令、工具版本、机械状态和原始路径；大文件只保留获准地址与摘要 |
| `claims-review.md` | Case / Decision | 每条对客 claim 有独立 ID、证据 ID、处置状态和未验证边界 |
| `provenance.md` | Evidence | 记录来源系统、获取方式、时间与时区、run/request ID、权限和独立性 |
| `reproduction.md` | Evidence | 记录实际命令、工作目录、返回码、语义成功判据、环境和未测项 |
| `remediation.md` | Decision / Case | 每个问题有严重性、影响、责任人、补证动作和复验条件 |
| `delivery-manifest.md`、`package-sha256.json` | Evidence | 绑定交付文件清单、字节数和 SHA-256；包重打即新版本 |
| G0-G8 门禁 | Case 的 validation | 九道门禁逐项保留 PASS/FAIL/BLOCKED/UNVERIFIED/NA，不把机械通过写成客户放行 |
| 真实性五维 | Evidence 的 provenance | 文件完整性、数据自洽、来源核对、独立复测、人员/权限独立性分别记录 |

## 2. 状态映射

不要把质检包的局部结果直接映射为 `verified`：

- `HOLD`：Case=`rejected` 或 `observed`，必须带问题和整改关系。
- `BLOCKED`：Case=`observed`，明确缺少的权限/证据/资源；不得写成技术失败。
- `PENDING_INDEPENDENT_REVIEW`：Case=`proposed` 或 `observed`，等待组织独立人员审阅冻结包。
- 技术审核完成且独立批准已绑定到确切包摘要：才允许 Case=`verified`。
- `authenticity=NOT_ESTABLISHED` 永远不能单独升级为“数据真实”或“客户可交付”。

## 3. 客户交付标准

客户版材料与知识入库使用同一事实底座，但公开边界不同：

1. 交付物、模型/权重身份、镜像/驱动/框架、输入输出、启动命令和资源要求可追溯。
2. 验收标准先于结果冻结；不得看到结果后修改阈值、样本数、容差、成功状态或 TPOT 分母。
3. 失败、超时、取消和异常请求保留并进入分母；不能只汇报成功样本。
4. 明确区分静态校验、NPU smoke/full、独立环境复验和客户验收。
5. 客户版隐藏内部机号、IP、路径、凭据、排障过程和未授权原始材料；内部包与客户包有不同 manifest 和哈希。
6. 不把本机复用权重池、本地镜像或一次性重试写成客户现场自动复现。
7. 没有独立批准时，只能写“可进入放行评审”，不能写“客户已批准”。

## 4. Agent 执行接口

AI Agent 优先读取结构化质检产物，再写入知识记录：

```bash
python3 skills/inference-delivery-qa/scripts/qa.py init --out <run>/input
# 填写 <run>/input/audit-input.json，冻结 claims/evidence/G0-G8/datasets
python3 skills/inference-delivery-qa/scripts/qa.py audit \
  --root <run>/evidence \
  --input <run>/input/audit-input.json \
  --out <run>/mechanical
node .department-tools/scripts/team-wiki.js validate <knowledge-repo> --strict
node .department-tools/scripts/team-wiki.js build <knowledge-repo>
node .department-tools/scripts/team-wiki.js query <knowledge-repo> <model> <accelerator> <topic> --json
```

Agent 不依赖看板 DOM；看板读取同一 `generated/catalog.json`，供人检查标题、摘要、来源、引用关系和状态。`qa.py` 只做离线机械检查，不执行项目命令、不联网、不发报告，也不自动批准客户交付。

## 5. 最小入库清单

- [ ] Case 有项目/模型/版本/环境/目标/结果/适用边界。
- [ ] 至少一条 Evidence 能定位质检包文件、SHA-256 和生成命令。
- [ ] claims 数量与原报告一致，所有 claim 都有处置状态。
- [ ] G0-G8 每道门禁均有状态、理由和证据 ID。
- [ ] 失败、缺证、阻塞、未测项没有被隐藏在“总体通过”里。
- [ ] 交付物 manifest 与冻结包摘要一致。
- [ ] 内部字段和客户版字段已分离，敏感内容已脱敏。
- [ ] 独立人员批准绑定到确切包摘要，否则保持 `proposed`/`observed`。
