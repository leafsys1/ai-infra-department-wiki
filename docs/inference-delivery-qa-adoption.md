# inference-delivery-qa 采纳记录

来源：`leafsys1/inference-delivery-qa-skill`

采纳版本：`7b376bb Add inference delivery QA agent skill`

## 已采纳能力

- `inference-delivery-qa` 通用 Agent Skill
- G0-G8 九道技术门禁
- 证据白名单、路径逃逸/敏感路径/哈希/CSV/时序/TPOT 机械检查
- 文件完整性、数据自洽、来源核对、独立复测、人员/权限独立性五维真实性边界
- QA-REPORT、provenance、reproduction、remediation、delivery-manifest、package-sha256 质检包结构
- `HOLD`、`BLOCKED`、`PENDING_INDEPENDENT_REVIEW` 保守状态机
- Python 3.9+ 标准库实现，不联网、不执行被审项目命令、不自动客户放行

## 迁移验证

在本仓 `tests/inference-delivery-qa/` 中运行：

```bash
python3 -m unittest discover -s tests/inference-delivery-qa -v
```

结果：18 项通过。测试是原项目测试的目录适配版本，保留其合成夹具边界，不把夹具当成业务 benchmark。

原项目提交中的 `VALIDATION.md` 已保留为验证范围参考；客户或部门实际验收仍需在授权环境执行真实复测，并将结果按 `skills/ai-infra-department-wiki/references/inference-delivery-qa-bridge.md` 入库。
