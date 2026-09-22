# 机械检查输入协议 v1

所有路径参数由调用者选定；`audit --root` 指向证据白名单根目录，`--input` 指向 JSON，`--out` 指向新报告目录。输出与证据目录不得嵌套/重叠，不能覆盖旧报告。证据路径只能是 root 内的相对普通文件；拒绝逃逸路径与敏感文件。路径被允许不代表内容已经脱敏。

## 顶层

| 字段 | 类型 | 含义 |
|---|---|---|
| schema_version | integer | 固定为 1 |
| project | 非空 string | 项目名，不填示例冒充真实 |
| claims | object array | 全部待审结论；空列表不通过 |
| evidence | object array | 明确列出的文件，避免全盘扫描 |
| gates | object array | G0–G8 各一次，共九项 |
| datasets | object array，可选 | 本轮需要重算的逐请求 CSV；缺性能原始数据时 G4 必须未验证 |

claims 每项：`id` 唯一；`text` 原结论；`evidence` 引用证据 ID 数组。

evidence 每项：`id` 唯一；`path` 相对 root；`sha256` 可选的预期摘要。摘要来自谁/何时写在 provenance.md；自填预期值不等于独立核验。

gates 每项：`id` 为 G0…G8；`status` 为 PASS/FAIL/BLOCKED/UNVERIFIED/NA；`reason` 说明实际理由；`evidence` 引用证据 ID 数组。PASS 必须有实际可读证据。NA 须说明为何不涉及任何已冻结 claim。**脚本不理解理由的技术真实性，因此 PASS 始终为提供者/agent 声明**。

## datasets 与 CSV

每项必须明确：

- `id`：数据集 ID；一次独立运行/数据集独立编号，避免混合不同批次重复 request ID。
- `evidence_id`：CSV 的证据 ID。
- `expected_rows`：预先冻结计划或可信运行登记表的请求总数，成功和失败都计入；不能从当前表行数反填假装完整。
- `columns`：对象，键为 `request_id,status,ttft_ms,e2e_ms,output_tokens,tpot_ms`，值为实际 CSV 列名。
- `success_values`：实际工具的成功状态字符串列表；其它状态均保留并计为失败。
- `tpot_denominator`：`output_tokens` 或 `output_tokens_minus_one`，从工具定义取得，不猜测。
- `tolerance_ms`：时序自洽绝对容差，单位 ms；依据时间戳精度/舍入定义冻结，不为让结果通过而调大。
- `sentinel_values`：可选数值数组；仅在工具明确将某值作失败占位时填写。没有依据不要设。

CSV UTF-8；所有 latency 字段单位固定 ms，token 数为整数。若原数据为秒，需转换并留转换脚本、命令、版本和原始文件哈希。失败行允许无计时值，但必须保留 request ID 与失败状态。成功行不允许 NaN/Inf、负数、E2E<TTFT、无效 token 数。分母为 N-1 且 N=1 时 TPOT 不适用，不用于 TPOT 分布。

脚本逐数据集输出计数与有效成功样本的 mean/p50/p95/p99；分位数方法以 result.json 实际标注为准。失败率、遗漏和异常保留，不能把条件统计写成“所有请求性能”。脚本不比较跨数据集因果收益，不自动判断噪声，应由 agent 依据实验设计分析。

## 输出契约

`result.json` 包含机械检查结果、提交门禁、问题、数据统计及保守的放行状态；`report.md` 是可读机械报告；`evidence-index.json` 对应实际读取文件；`findings.csv` 供筛选问题；`checksums.sha256` 绑定本轮生成的检查产物。

输出是**本轮检查记录**，不是原始数据存储替代品。原始证据保留在 evidence 根目录，最终 skill 包含必要证据副本；不能只发 checksums 就称交付证据齐全。脚本没读到/不支持的内容在技术报告中明确列出。JSON/CSV 中的 unknown/missing 不允许转成 PASS。

退出码：0 机械检查完成且无发现；2 存在检查发现；1 工具错误。任何 rc 都不能代替报告和语义成功检查。脚本不会自动写 `CUSTOMER_APPROVED`。

脚本的 `release=HOLD` 表示存在任意机械发现，包括缺证据；不是“技术方案失败”。总报告依据实际事实区分技术不满足（HOLD）与无法核验（BLOCKED），同时原样引用机械状态并说明区别，不覆盖 result.json。没有发现时脚本的 `PENDING_INDEPENDENT_REVIEW` 也不是技术评审通过。
