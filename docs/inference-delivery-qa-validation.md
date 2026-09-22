# 发布核验记录

本文仅记录 skill 软件与文档的验证范围，不是模型部署/算子性能的验证结论。

## 验证目标

- 标准 SKILL.md 可被支持 Agent Skills 的客户端读取；所有相对资源链接存在。
- 安装器复制完整目录，不修改配置，不覆盖旧安装。
- 空材料、缺门禁、缺证据、哈希错误、CSV 异常不能被自动放行。
- 脚本不执行项目命令、不联网；用户数据不自动发送到 GitHub。
- 所有正常/异常夹具均为测试内生成的合成数据，不作业务性能证据。

## 平台证据

- Codex 安装路径依据官方文档 https://developers.openai.com/codex/skills/ 的 `.agents/skills` 用户/项目级发现规则。
- 格式依据 https://agentskills.io/specification ，name/description 与 skill 文件夹匹配，metadata 为字符串映射。
- zcode 与 DeepSeek harness 未在本环境安装，不宣称产品内集成测试通过。提供显式读取 SKILL.md + Python 的通用执行方式。

## 安全边界

哈希和机械检查不是来源认证。即使提交者填写所有 PASS，也只能进入独立复核。最终批准应由受控系统记录对确切包摘要的批准；本工具无签名或身份验证服务。对抗性测试验证的是已覆盖的软件行为，不是任意恶意文件、恶意文件系统或篡改主机下的安全证明。

## 实际执行结果

- `python3 -m unittest discover -s tests -v`：18 项通过，覆盖安装不覆盖、symlink 拒绝、输出目录保护、坏 JSON/CSV、缺失证据、哈希不符、NaN/Inf/负值、失败请求保留、expected_rows、重复 request ID、哨兵值、TPOT 分母、报告转义、工具异常保守报告和“rc=0 不等于放行”。
- Python 3.9 AST 兼容性检查：全部 Python 文件通过；GitHub Actions 继续在 3.9/3.11/3.13 运行。
- Codex CLI 端到端合成缺证据项目：首次 `workspace-write` 被本机 bubblewrap 权限阻塞，未计通过；改用受限工作目录的 `danger-full-access` 重试后生成 25 个质检包文件。独立回读确认全部摘要匹配、必需产物存在，机械状态 `HOLD`、真实性 `NOT_ESTABLISHED`、总报告技术状态 `BLOCKED`，未产生客户批准。
- 静态脱敏扫描：仓库文件未检出私网地址、私钥头、本机用户绝对路径或 GitHub token 形态。

端到端产物只存本机合成验收目录，不提交本仓库，也不作为客户业务证据。
