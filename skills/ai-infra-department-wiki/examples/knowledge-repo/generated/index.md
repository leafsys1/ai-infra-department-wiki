# Department Knowledge Index

Generated from reviewed records. Do not edit manually.

Read the title and metadata here, then open the record for the full case.

## case

- [CASE-2026-0001: 生成的交付脚本必须通过 bash -n 门禁](../records/cases/deployment/CASE-2026-0001.md) — verified · areas=交付复现/交付脚本质量 · owners=ai-infra · model=qwen2.5 · accel=910B2C · updated=2026-09-23
- [CASE-2026-0002: 权重存在性判定必须使用 api/models，不能用 resolve 路径](../records/cases/deployment/CASE-2026-0002.md) — verified · areas=下载通路/权重获取 · owners=ai-infra · model=cogvideox · accel=910B2C · updated=2026-09-23
- [CASE-2026-0004: 面向人的知识看板必须随 Skill 分发并经 HTTP 可直接访问](../records/cases/deployment/CASE-2026-0004.md) — verified · areas=分发/知识看板 · owners=ai-infra · model=n/a · accel=cpu · updated=2026-09-23
- [CASE-2026-0005: 单文件页面读取产物里不存在的字段时会静默降级](../records/cases/deployment/CASE-2026-0005.md) — verified · areas=字段契约/知识看板 · owners=ai-infra · model=n/a · accel=cpu · updated=2026-09-23
- [CASE-2026-0010: scatter_nd_update_sk 最小 backport：端到端 6/6 为正，但逐毫秒归因只到 partially-supported](../records/cases/inference/CASE-2026-0010.md) — observed · areas=性能调优/服务化 TTFT/算子替换 · owners=ai-infra · model=deepseek-v4-flash · accel=910B3 · updated=2026-09-23
- [CASE-2026-0011: DSA-CP A2 prefill：把完整 o-proj 权重收集前移，用 attention 主链覆盖通信](../records/cases/inference/CASE-2026-0011.md) — observed · areas=prefill/性能调优/通信重叠 · owners=ai-infra · model=deepseek-v4-flash · accel=910B3 · updated=2026-09-23
- [CASE-2026-0012: FlashComm1 DP2 严格 identity 布局下跳过 prefill 的大 tensor copy](../records/cases/inference/CASE-2026-0012.md) — observed · areas=prefill/性能调优/通信优化 · owners=ai-infra · model=deepseek-v4-flash · accel=910B3 · updated=2026-09-23
- [CASE-2026-0013: 线性注意力因果卷积权重改为加载时转置：解码每步少 384 次 Transpose kernel](../records/cases/inference/CASE-2026-0013.md) — observed · areas=性能调优/权重布局/解码 · owners=ai-infra · model=qwen3.8 · accel=910C · updated=2026-09-23
- [CASE-2026-0014: 单 token 解码的 QKV 拼接改为视图：每步少 384 次拼接 kernel](../records/cases/inference/CASE-2026-0014.md) — observed · areas=张量视图/性能调优/解码 · owners=ai-infra · model=qwen3.8 · accel=910C · updated=2026-09-23
- [CASE-2026-0020: Qwen3.8-27B W8A8 单 die 解码：每步 28.427 GB 权重读取已贴住 HBM 带宽上限](../records/cases/inference/CASE-2026-0020.md) — observed · areas=带宽定标/推理性能 · owners=ai-infra · model=qwen3.8 · accel=910C/A3 · updated=2026-09-23
- [CASE-2026-0021: 同样 4 个 die：1 个 TP4 实例与 4 个 TP1 副本的形态对比](../records/cases/inference/CASE-2026-0021.md) — observed · areas=推理性能/部署形态 · owners=ai-infra · model=qwen3.8 · accel=910C/A3 · updated=2026-09-23
- [CASE-2026-0022: DSv4-Flash DSpark 的 draft 长度与 token 预算共用一个池：B/D 两臂的长提示收益](../records/cases/inference/CASE-2026-0022.md) — observed · areas=推理性能/预算配置 · owners=ai-infra · model=deepseek-v4-flash · accel=910C · updated=2026-09-23
- [CASE-2026-0023: Qwen3.8-27B GDN chunked-prefill metadata 的 exact-shape 缓存：机制命中成立、端到端收益落在噪声内](../records/cases/inference/CASE-2026-0023.md) — observed · areas=推理性能/机制定标 · owners=ai-infra · model=qwen3.8 · accel=910B3 · updated=2026-09-23
- [CASE-2026-0024: DSv4-Flash 单实例 prefix caching 命中链不可用：同串重复请求命中恒为 0](../records/cases/inference/CASE-2026-0024.md) — observed · areas=推理性能/机制定标 · owners=ai-infra · model=deepseek-v4-flash · accel=910C · updated=2026-09-23
- [CASE-2026-0030: R0007 DSA-CP drafting metadata 跨 KV-cache group 复用：局部 −27.7% 但同会话正式吞吐 −5.67%/−6.47% → REVERT](../records/cases/inference/CASE-2026-0030.md) — observed · areas=否证归档/投机解码/推理性能 · owners=ai-infra · model=deepseek-v4-flash · accel=910B3 · updated=2026-09-23
- [CASE-2026-0031: R0038 DSpark copy-and-expand grid-stride：单算子 5.55–6.07× 但冻结同会话 4 对吞吐全部负向 → REVERT](../records/cases/inference/CASE-2026-0031.md) — observed · areas=否证归档/推理性能/算子优化 · owners=ai-infra · model=deepseek-v4-flash · accel=910B3 · updated=2026-09-23
- [CASE-2026-0032: R0050 KV 池后端 mooncake→memcache+device_rdma：主指标 −48.497% 达标但每臂 5 单元未达 → 收益 UNVERIFIED](../records/cases/inference/CASE-2026-0032.md) — observed · areas=KV 缓存池/推理性能/验收口径 · owners=ai-infra · model=deepseek-v4-flash · accel=910C · updated=2026-09-23
- [CASE-2026-0033: R0056 两条零卡静态否证：本引擎无 multi-step 旋钮 / 补齐 decode 图捕获覆盖 248→256 无收益对象](../records/cases/inference/CASE-2026-0033.md) — observed · areas=推理性能/调度/零卡静态否证 · owners=ai-infra · model=multiple · accel=910C · updated=2026-09-23
- [CASE-2026-0034: R0055 显式 compile 范围被静默丢弃 + iteration_tokens_total 指标语义闭证](../records/cases/inference/CASE-2026-0034.md) — observed · areas=推理性能/编译与指标口径/零卡静态闭证 · owners=ai-infra · model=deepseek-v4-flash · accel=910C · updated=2026-09-23
- [CASE-2026-0040: 客户自理复现暴露的四类交付缺口：设备权限、镜像、权重与依赖](../records/cases/deployment/CASE-2026-0040.md) — verified · areas=交付复现/交付脚本质量/环境 · owners=ai-infra · model=multiple · accel=910B3 · updated=2026-09-23
- [CASE-2026-0041: 单一基础镜像 + 每模型最小文件的交付形态](../records/cases/deployment/CASE-2026-0041.md) — observed · areas=交付复现/交付形态/证据 · owners=ai-infra · model=multiple · accel=910B3 · updated=2026-09-23
- [CASE-2026-0042: 三个架构家族复用同一条六步适配流水线，零代码改动](../records/cases/deployment/CASE-2026-0042.md) — observed · areas=交付复现/模型适配/验收 · owners=ai-infra · model=multiple · accel=910B3 · updated=2026-09-23
- [CASE-2026-0043: 同一份交付包在另一台环境复现失败：同名镜像 tag 不是同一构建](../records/cases/deployment/CASE-2026-0043.md) — observed · areas=交付复现/环境 · owners=ai-infra · model=video-generation · accel=910B3 · updated=2026-09-23

## decision

- [DEC-2026-0001: 客户版材料的边界与术语统一](../records/decisions/DEC-2026-0001.md) — verified · areas=客户交付/术语规范 · owners=ai-infra · updated=2026-09-23
- [DEC-2026-0010: 结论状态纪律：KEEP / scoped KEEP / CONTINUE / REVERT / NOT_APPLICABLE / UNVERIFIED](../records/decisions/DEC-2026-0010.md) — observed · areas=收益判定/记录纪律 · owners=ai-infra · updated=2026-09-23
- [DEC-2026-0020: 交付验收标准：客户在陌生环境仅凭交付物即可复现](../records/decisions/DEC-2026-0020.md) — observed · areas=交付复现/验收 · owners=ai-infra · updated=2026-09-23

## environment

- [ENV-2026-0001: 910B2C 单机 16 卡：每卡单 die、机内两个 8 卡域](../records/environments/ENV-2026-0001.md) — observed · areas=910B/硬件环境 · owners=ai-infra · updated=2026-09-23
- [ENV-2026-0010: perf-lab 的两个实测环境：910B3 八卡 W4A8 长上下文与 910C/A3 逻辑 die 短服务](../records/environments/ENV-2026-0010.md) — observed · areas=910B/910C/硬件环境 · owners=ai-infra · updated=2026-09-23

## evidence

- [EVD-2026-0001: bash -n 门禁在错误引号写法上失败、在修正写法上通过的实测输出](../records/evidence/EVD-2026-0001.md) — verified · areas=交付复现/证据 · owners=ai-infra · updated=2026-09-23
- [EVD-2026-0002: 权重存在性探测：api/models 与 resolve/main 的实测状态码对比](../records/evidence/EVD-2026-0002.md) — verified · areas=权重获取/证据 · owners=ai-infra · updated=2026-09-23
- [EVD-2026-0003: 看板分发与 HTTP 访问通路的实测输出](../records/evidence/EVD-2026-0003.md) — verified · areas=知识看板/证据 · owners=ai-infra · updated=2026-09-23
- [EVD-2026-0004: 看板字段契约检查的冻结输出：页面读取的字段名与产物实际字段的比对](../records/evidence/EVD-2026-0004.md) — verified · areas=知识看板/证据 · owners=ai-infra · updated=2026-09-23
- [EVD-2026-0010: R0017 关键数字的冻结摘录：三口径倍数、噪声地板与两轮反序短服务 A/B](../records/evidence/EVD-2026-0010.md) — verified · areas=性能调优/证据 · owners=ai-infra · updated=2026-09-23
- [EVD-2026-0011: R0029 关键数字的冻结摘录：夹心 A/B/A 的 6/6 正向与 Level 3 通信字节量](../records/evidence/EVD-2026-0011.md) — verified · areas=性能调优/证据 · owners=ai-infra · updated=2026-09-23
- [EVD-2026-0012: R0032 关键数字的冻结摘录：两轮同会话冷 32K A/B 的 8/8 正向](../records/evidence/EVD-2026-0012.md) — verified · areas=性能调优/证据 · owners=ai-infra · updated=2026-09-23
- [EVD-2026-0013: R0043 关键数字的冻结摘录：384 次 Transpose 归零与成对 TPOT 改善](../records/evidence/EVD-2026-0013.md) — verified · areas=性能调优/证据 · owners=ai-infra · updated=2026-09-23
- [EVD-2026-0014: R0044 关键数字的冻结摘录：384 次拼接归零与成对 TPOT 改善](../records/evidence/EVD-2026-0014.md) — verified · areas=性能调优/证据 · owners=ai-infra · updated=2026-09-23
- [EVD-2026-0020: R0046 解码权重流量账目与单 die HBM 带宽上限的实测输出](../records/evidence/EVD-2026-0020.md) — verified · areas=带宽定标/推理性能/证据 · owners=ai-infra · updated=2026-09-23
- [EVD-2026-0021: R0048 同 4 die 上 1×TP4 与 4×TP1 副本的形态对比实测输出](../records/evidence/EVD-2026-0021.md) — verified · areas=推理性能/证据/部署形态 · owners=ai-infra · updated=2026-09-23
- [EVD-2026-0022: R0059 DSpark 预算池实测输出：可调度 token 数与配对窗口收益](../records/evidence/EVD-2026-0022.md) — verified · areas=推理性能/证据/预算配置 · owners=ai-infra · updated=2026-09-23
- [EVD-2026-0023: R0060 GDN exact-shape metadata cache 的逐 rank 计数与端到端噪声内输出](../records/evidence/EVD-2026-0023.md) — verified · areas=推理性能/机制定标/证据 · owners=ai-infra · updated=2026-09-23
- [EVD-2026-0024: R0057 单实例同 prompt 重复请求的 prefix cache 计数器增量（命中恒为 0）](../records/evidence/EVD-2026-0024.md) — verified · areas=推理性能/机制定标/证据 · owners=ai-infra · updated=2026-09-23
- [EVD-2026-0030: R0007 DSA-CP drafting metadata 跨 KV-cache group 复用的端到端反降摘录](../records/evidence/EVD-2026-0030.md) — verified · areas=否证归档/投机解码/推理性能 · owners=ai-infra · updated=2026-09-23
- [EVD-2026-0031: R0038 DSpark copy-and-expand grid-stride：单算子 5.55–6.07× 与冻结同会话 4 对负向的并存摘录](../records/evidence/EVD-2026-0031.md) — verified · areas=否证归档/推理性能/算子优化 · owners=ai-infra · updated=2026-09-23
- [EVD-2026-0032: R0050 KV 池后端换 memcache+device_rdma 的验收摘录：主指标通过而收益仍判 UNVERIFIED](../records/evidence/EVD-2026-0032.md) — verified · areas=KV 缓存池/推理性能/验收口径 · owners=ai-infra · updated=2026-09-23
- [EVD-2026-0033: R0056 两条零卡静态否证的判据回显摘录（multi-step 旋钮不存在 / 图捕获覆盖 248→256 无收益对象）](../records/evidence/EVD-2026-0033.md) — verified · areas=图捕获/调度/零卡静态否证 · owners=ai-infra · updated=2026-09-23
- [EVD-2026-0034: R0055 两条只读闭证摘录：显式 compile 范围被静默丢弃 + iteration_tokens_total 的观测粒度](../records/evidence/EVD-2026-0034.md) — verified · areas=指标语义/编译范围/零卡静态否证 · owners=ai-infra · updated=2026-09-23
- [EVD-2026-0040: 客户自理复现缺陷的冻结摘录：设备权限、CANN 环境、自建镜像、权重路径、缺依赖与空参数](../records/evidence/EVD-2026-0040.md) — verified · areas=交付复现/交付脚本质量/环境 · owners=ai-infra · updated=2026-09-23
- [EVD-2026-0041: 单一基础镜像交付形态的冻结摘录：交付物清单、每模型三文件、版本锁定与下载脚本](../records/evidence/EVD-2026-0041.md) — verified · areas=交付复现/交付形态/证据 · owners=ai-infra · updated=2026-09-23
- [EVD-2026-0042: 跨架构家族复用同一流水线的冻结摘录：三模型表、六步流程、分类决策与验收口径](../records/evidence/EVD-2026-0042.md) — verified · areas=交付复现/模型适配/验收 · owners=ai-infra · updated=2026-09-23
- [EVD-2026-0043: 同名镜像 tag 跨环境复现事件的冻结摘录：交付文档的摘要字段与容器 CANN 环境要求](../records/evidence/EVD-2026-0043.md) — observed · areas=交付复现/环境 · owners=ai-infra · updated=2026-09-23

## pattern

- [PAT-2026-0001: 容器内下载段的引号嵌套会截断整份交付脚本](../records/patterns/PAT-2026-0001.md) — verified · areas=交付复现/交付脚本质量 · owners=ai-infra · updated=2026-09-23
- [PAT-2026-0002: 下载前探测：api/models 是存在性判据，resolve 不是](../records/patterns/PAT-2026-0002.md) — verified · areas=下载通路/权重获取 · owners=ai-infra · updated=2026-09-23
- [PAT-2026-0003: 同名镜像 tag 不等于同一构建：跨环境前必须比对 digest](../records/patterns/PAT-2026-0003.md) — observed · areas=交付复现/镜像管理 · owners=ai-infra · updated=2026-09-23
- [PAT-2026-0004: 代码内嵌镜像型交付物：保留交付镜像并给足权限](../records/patterns/PAT-2026-0004.md) — observed · areas=交付复现/镜像管理 · owners=ai-infra · updated=2026-09-23
- [PAT-2026-0005: 重写面向人的页面，必须对照文档承诺的能力清单逐条验证](../records/patterns/PAT-2026-0005.md) — observed · areas=文档契约/知识看板 · owners=ai-infra · updated=2026-09-23
- [PAT-2026-0010: 局部收益不等于端到端收益：实现之前先算该链的理想上界](../records/patterns/PAT-2026-0010.md) — observed · areas=性能优化/收益判定 · owners=ai-infra · updated=2026-09-23
- [PAT-2026-0011: 判据没有判别力时，既不能写「有收益」也不能写「无收益」](../records/patterns/PAT-2026-0011.md) — observed · areas=收益判定/统计口径 · owners=ai-infra · updated=2026-09-23
- [PAT-2026-0012: 机制存在性先于机制优化：能用零卡静态证据否掉的方向不要占卡去试](../records/patterns/PAT-2026-0012.md) — observed · areas=优化方向筛选/零卡验证 · owners=ai-infra · updated=2026-09-23
- [PAT-2026-0013: 倍数读数必须先扣除仪器地板](../records/patterns/PAT-2026-0013.md) — observed · areas=口径标定/性能测量 · owners=ai-infra · updated=2026-09-23
- [PAT-2026-0014: 「能跑」必须证明来自候选：产物同一性 + 运行时加载 + 负控制](../records/patterns/PAT-2026-0014.md) — observed · areas=交付验证/产物同一性 · owners=ai-infra · updated=2026-09-23
- [PAT-2026-0015: 解码步常常先被权重读取带宽卡住，先量带宽再调算子](../records/patterns/PAT-2026-0015.md) — observed · areas=带宽分析/推理性能 · owners=ai-infra · updated=2026-09-23
- [PAT-2026-0016: 同样卡数下「单实例大 TP」与「多副本小 TP」是两种产品形态，先定指标再选拓扑](../records/patterns/PAT-2026-0016.md) — observed · areas=服务化指标/部署拓扑 · owners=ai-infra · updated=2026-09-23
- [PAT-2026-0017: host 下发/胶水常常比设备算子本身更贵：先量 host:device 比例](../records/patterns/PAT-2026-0017.md) — observed · areas=host 开销/性能归因 · owners=ai-infra · updated=2026-09-23
- [PAT-2026-0018: 显式配置可能被静默丢弃：设了不等于生效，必须回读生效值](../records/patterns/PAT-2026-0018.md) — observed · areas=起服校验/配置生效性 · owners=ai-infra · updated=2026-09-23
- [PAT-2026-0020: 交付物必须客户自理：依赖我方环境的交付物在验收时判 FAIL](../records/patterns/PAT-2026-0020.md) — observed · areas=交付复现/交付脚本质量/验收 · owners=ai-infra · updated=2026-09-23
- [PAT-2026-0021: 权重获取要有双通道与存在性判据：hf-mirror 直连 + 备用源，元信息走 api/models](../records/patterns/PAT-2026-0021.md) — observed · areas=交付复现/权重获取 · owners=ai-infra · updated=2026-09-23

## runbook

- [RUN-2026-0001: 跨环境交付复现的标准流程](../records/runbooks/RUN-2026-0001.md) — verified · areas=交付复现/运行手册 · owners=ai-infra · updated=2026-09-23
- [RUN-2026-0010: 性能实验与收益判定流程：从预注册判据到判定档](../records/runbooks/RUN-2026-0010.md) — observed · areas=性能实验/收益判定 · owners=ai-infra · updated=2026-09-23
- [RUN-2026-0011: 零卡静态否证流程：占加速器之前先否掉一个方向](../records/runbooks/RUN-2026-0011.md) — observed · areas=优化方向筛选/零卡验证 · owners=ai-infra · updated=2026-09-23
- [RUN-2026-0012: 客户自理交付包的打包与验收流程](../records/runbooks/RUN-2026-0012.md) — verified · areas=交付复现/交付脚本质量/验收 · owners=ai-infra · updated=2026-09-23
