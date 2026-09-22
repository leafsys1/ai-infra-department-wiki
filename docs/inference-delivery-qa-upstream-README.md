# 推理部署与算子调优质检 Skill

让同事的智能体完成一轮有证据的项目质检，交回 **结论逐条审查、原始证据索引、数据检查结果、真实性边界、整改清单和待放行报告**。

适用：模型推理部署、算子优化、PD/KV Cache、推理性能对比与客户交付材料。通用 Agent Skills 格式；不依赖某个模型、Hermes 工具或厂商 MCP。Python 3.9+ 标准库，无需 pip install。

## 安装

本仓库默认私有，安装者需已有读取权限。仓库所有者应通过 GitHub 正规协作权限或批准的脱敏离线包分发，**不要共享所有者令牌/SSH 私钥**。

```bash
git clone --branch feat/initial-qa-skill git@github.com:leafsys1/inference-delivery-qa-skill.git
cd inference-delivery-qa-skill
python3 -m unittest discover -s tests -v
```

### Codex

官方文档支持用户级 `~/.agents/skills` 和项目级 `.agents/skills`。安装到选定范围：

```bash
python3 install.py --dest "$HOME/.agents/skills"
```

进入项目后显式调用 `$inference-delivery-qa`。若未发现，重启/新开会话并检查安装目录；完整 skill 文件夹须一起安装，不只拷贝 SKILL.md。

### zcode、DeepSeek harness 和其他智能体

本仓库不猜测各版本的私有配置格式和插件接口。先查对应产品当前的技能目录/加载器配置，把目录填给：

```text
python install.py --dest <已确认的技能根目录>
```

如果该版本没有原生技能发现功能，仍可克隆仓库，在同事智能体里显式要求：

> 读取仓库中的 skills/inference-delivery-qa/SKILL.md 并按步骤执行，引用文件从该 skill 目录解析。你已获得本项目文件的只读权限。项目根目录为……，交付结论/报告为……，本轮输出目录为……。无源系统访问或复测授权的部分记 BLOCKED，继续完成其它检查并交付报告。禁止修改被审数据和自动对客放行。

这条路径要求智能体支持读文件、运行 Python 和写产物；只会聊天、不能执行工具的产品不满足要求。**已验证的是通用文件格式与脚本执行；未在 zcode/DeepSeek harness 产品内运行集成测试。** 同事首次安装应确认 agent 确实读取了 SKILL.md，并用下述空输入冒烟验证未误放行。

Windows 使用 `python` 或 `py -3`，`--dest` 传实际绝对目录；安装器不修改 agent 配置、不覆盖旧技能。更新前审阅 diff，将旧安装改名保留，再安装新版本。复核报告时记录所用 Git commit。

## 同事如何发起一轮质检

把下面这段交给已安装 skill 的智能体，填写路径和已有授权：

> 使用 inference-delivery-qa 对这个项目做一次交付质检。项目目录：[路径]；待交付报告/结论：[路径]；客户验收依据：[路径，没有则注明]；本轮输出目录：[新的路径]。先枚举所有结论，再核对源代码/生效配置/原始日志/逐请求数据与交付文档。授权范围：[本地只读 / 指定源系统只读 / 指定复测]。输出完整质检包，逐项写明 PASS、FAIL、UNVERIFIED、BLOCKED 或 NA，给出数据自洽、来源核验、独立复测的分别结论。缺证据也必须产出本轮报告，不得编数据、改阈值或自签客户放行。

实际 workflow：发现材料→逐条 claim→门禁检查→源头交叉核验→机械脚本→授权复测→报告与冻结包。skill 驱动 agent 完成流程；CLI 单独执行只是其中的确定性数据检查。

## 交回的内容

```text
run-directory/
  QA-REPORT.md              # 总结、九道门禁、边界与状态
  claims-review.md          # 全部对客结论逐条核对
  provenance.md             # 来源与真实性分层记录
  reproduction.md           # 实际命令、回显、判据、独立性
  remediation.md            # 问题、影响、补证与复验动作
  delivery-manifest.md      # 交付文件版本及用途
  package-sha256.json       # 冻结包内全部文件摘要，排除自身
  input/audit-input.json    # 本轮机械检查配置
  evidence/                # 授权的原始证据副本
  mechanical/
    report.md
    result.json
    evidence-index.json
    findings.csv
    checksums.sha256
```

完整内部包默认本地保存，不上传仓库。原始文件不能给客户时另建经批准的脱敏客户包。脚本生成 mechanical 内的文件；其余为 agent 依据实际证据生成，不能把脚本报告冒充已完成技术评审。

## 数据真实性能判断到哪里

- 哈希：字节完整性，不证明历史实验发生。
- CSV 校验：数据内部一致性，不证明无删样、无伪造。
- 源系统交叉读取：加强来源证据，仍有权限和受控日志边界。
- 独立复测：支持相应条件下结论可重现，不追认全部历史数据。

因此脚本始终输出 `authenticity=NOT_ESTABLISHED`；agent 在 provenance.md 陈述真正核验到哪一步。不同模型互审不自动满足人员独立性。所有检查通过仍为 `PENDING_INDEPENDENT_REVIEW`，最终放行由授权的独立人员对冻结包批准。发现问题不直接认定同事造假。

## 机械脚本与冒烟测试

以下为使用方式，示例目录要由调用者选定且互不覆盖：

```bash
python3 skills/inference-delivery-qa/scripts/qa.py init --out /tmp/qa-input
python3 skills/inference-delivery-qa/scripts/qa.py audit --root /path/to/evidence --input /tmp/qa-input/audit-input.json --out /tmp/qa-check
```

先将空白输入按真实材料填写后才做正式检查。空白模板**应报缺少材料或阻塞，不能通过**。字段定义和 CSV 映射见 [输入协议](skills/inference-delivery-qa/references/input-contract.md)。`0`=机械检查通过（不等于项目通过）；`2`=有发现；`1`=工具错误。文件缺失/无权限/坏格式均不得当 PASS。

脚本不运行任意命令、不联网、不自动发报告、不读取未列入清单的文件。它不能自动理解所有原生 AISBench 导出格式；需 agent 按工具版本建立明确列映射，JSON/XLSX 等先用可审阅转换器转换并保留原始数据。脚本不做自动因果判断、统计显著性认证或数字签名。

## 开发与验证

```bash
python3 -m unittest discover -s tests -v
```

测试使用临时合成夹具，**不是业务 benchmark**。发布前还要执行技能格式/链接检查、独立评审和脱敏检查。复测输出不能提交到本仓库。

依据：[Agent Skills 规范](https://agentskills.io/specification)、[Codex 技能文档](https://developers.openai.com/codex/skills/)。仓库内容为本次质检需求新写的实现，不复制第三方私有 performance skills 源文件。
