# 两篇 arXiv 的实验设置核对（拟作验收基线）

核对日期：2026-10-23
核对方式：arxiv.org/abs 摘要页 + arxiv.org/html 全文（v1），逐段抽原文数字与定义；未依赖二手转述。
本地全文快照：`research/_papers/29144.txt`、`research/_papers/36373.txt`（HTML 原文另存 `.html`）。

结论先给：**两个数字都存在、口径都能落地，但都不是"通用基准线"**。
0.713 vs 0.775 是"特定 12 轮流 + 特定模型 + 预先熟悉语义"的绝对分，能对标的只有**对比条件**；
82% 是**该合成生成器在 d=8 剂量下的未防护基线**，能对标的是**暴露率的定义与分母口径**，不是那个百分数本身。

---

## A. arXiv:2609.29144 — 0.713 vs 0.775

**书目**：Yezhou Cheng, Runjia Du, Zeming Liu, Qibai Chen, Hang Lyu, Yankai Zeng, Yilan Wei, Bojun Lin.
*Scope Before You Persist: Preventing Cross-Family Interference in Agent Memory.* cs.AI，2026-09-24 提交（v1，56 KB）。

### A.1 任务族怎么划分（ProcStream-RSI v3.1）

- **12 轮流、9 个任务族**，族序**固定**：
  `boundary → rotation → ordering → normalization → boundary → rotation → nested → missing → prefix → chunk → tie-breaking → ordering`
  即 9 族里有 4 族重复出现——**重复是为了让"保留/回退"可观测**，不是为了增加难度。
- 每族发一个 **seed 派生的不透明 protocol token**（族身份不靠名字泄漏，靠 token 区分）。
- **例子分三类角色，这是划分的关键**：
  - *discovery* 的 public 例子**能区分该族的修复规则**（唯一能看出「这族要什么」的地方）；
  - *probe / checkpoint / final* 的 public 例子是**中性**的——给的有 bug 的程序**本来就通过它们**，看不出规则；
  - immutable 的 private / metamorphic / hidden 用例才真正考这条规则。
- **每轮 4 个 discovery + 4 个 probe**；另有独立生成的固定银行：**每族 1 个 checkpoint + 2 个 final**（9×3=27），合计 **123 个任务/流**。
- public / private / hidden 输入**两两不相交**；hidden 对在线 agent 不可见。
- **重要限定**（作者原文）：oracle 语义与族序在所有流上固定，seed 只变 token、名字、程序变体和用例，**不变语义**。所以它测的是"procedurally instantiated familiar contracts"，不是"适应随机新语义"。作者的 0.775 之所以高，正是"substantial prior competence"。

### A.2 指标定义

- `U_t` = 策略 `K_t` 在**固定 balanced checkpoint bank** 上的 hidden utility（每轮都有）。
- **MTU（mean trajectory utility）= 1/(T+1) Σ_{t=0..T} U_t**，T=12 → 13 个点取均值。**0.713 / 0.775 都是 MTU，不是终局分。**
- 另报：terminal utility、mean backward transfer（BWT）、worst-family retention、final-bank score。**不用 archive-best**。

### A.3 0.713 vs 0.775 的确切对比条件

这是"干预式对照"，不是"两套系统对比"：

1. 主流 **8 条 paired streams**，每条 12 轮全跑；
2. 每条流里 Global-ORC **都恰好接受了同一种 round-0 boundary 规则**；
3. **proposals、gate 决策、任务程序、分数全部保持不变**，只改 **task→skill 的指配**：
   - **Global**：一份 360 字全局 skill 覆盖所有族（接受后替换全局 `K_t`）；
   - **Scoped**：接受的候选存进**本族 slot**，其他族回落到 `K_0`；
   - 二者**prompt 预算完全相同**（skill 文本统一 pad 到 360 字符）。
4. 因此这组数字**只隔离"检索作用域"这一个机制**，不掺"更强的编辑器/验证器"。

| 方法 | MTU ↑ | 终局 checkpoint ↑ | 接受数 | 有害接受 |
|---|---|---|---|---|
| **Static**（从不提案） | **0.775 [0.734, 0.814]** | 0.775 | 0 | 0 |
| Frozen-compute（同调用不部署） | 0.775 [0.734, 0.814] | 0.775 | 0 | 0 |
| **ORC = Global-ORC**（全局记忆） | **0.713 [0.653, 0.761]** | 0.707 | 1.00 | **0.75（6/8 轮）** |
| Batch-ORC（一次性更新） | 0.775 [0.734, 0.814] | 0.775 | 0 | 0 |
| **Scoped-ORC**（同候选，仅改作用域） | **0.816** | — | 1.00 | 0 |

- **0.713 / 0.775 的差值 = −0.062，即"有记忆反而比没记忆差"**：全局记忆把一个局部有效的编辑扩散到无关族。
- **族级证据（机制，不是叙事）**：该规则抬高 boundary 族，同时把另外四族压低 **−0.461 / −0.234 / −0.148 / −0.117**。
- **扩展（27 条配对随机入口流，每族起点 3 条）**：Scoped − Global **+0.063 [0.037, 0.094]**；接受 **63** 次 vs Global **12** 次；**19/27** 条流出现多次接受；**有害接受 0/63**。

### A.4 模型与预算（复现必须对齐的）

- actor/editor：**Qwen3-Coder-Next**，Parasail BF16 endpoint，经 OpenRouter，**provider fallback 关闭**，**temperature 0**，固定 stream seed；
- **actor 700 tokens / editor 500 tokens**；actor skill 文本 pad 到 **360 字符**，editor 输入 pad 到 **48,000 字符**（Batch-ORC 为 64,000）——**刻意让 prompt 预算与策略长度无关**；
- 门：ORC = 三通道（4 public / 4 private 精确输出 / ≥6 条无答案的 metamorphic）逐通道单侧 95% paired-bootstrap 下界，`δ_new = 0`、`δ_reg = 0.02`，且**任一历史族不得回退**；模型权重从不训练；
- 外部迁移：HumanEval+ 固定 32 题 + 每流 18 题 sealed final bank（GPT-OSS-120B）。

---

## B. arXiv:2609.36373 — "82% 上下文暴露"

**书目**：Sibo Liu. *Audience-Bound Persistent Memory: Authorization Across the Memory Lifecycle.*
cs.CR（交叉 cs.AI），2026-09-28 提交（v1，23 页 / 6 图 / 15 表，带 ancillary artifact：`abm-artifact/CLAIMS.md`、`REPRODUCE.md`、`MANIFEST.json` 等）。

### B.1 "context" 怎么定义

- 单位是**每一次物理模型调用（physical model attempt）实际组装出的确切上下文（exact assembled context）**，不是一个检索结果列表、也不是最终回复。
- 每个 context 有一个 **viewer 集合** `V(C)`：来自该轮在场的传输层身份（transport identities）；owner 恒定在 `V(C)` 内；**viewer 无法解析时 fail-closed 到 public-only**。
- 每条记忆项带 **audience** `Aud(m)`：写入时由来源容器的已解析 viewers 绑定；派生项按 audience 分区、取来源 audience 的**交集**，或被抑制；audience 只有**显式、对象级 grant** 才能放宽。
- **准入（admission）判据**：`m` 进入 `C` 当且仅当 **`V(C)` 中每一个 viewer 都属于 `Aud(m)` 的某一个授权 audience**。任一 viewer 不在 → 该项**不得进入**。用排除实现，不依赖模型行为。

### B.2 "暴露"怎么判定、82% 怎么算

- **forbidden item 判据**：该项**出现在该 context 里**，且其授权 audience 集合**不包含某个当前 viewer**。
- **计数单位是 context，不是 item**：只要一个 context 里含 **≥1** 个 forbidden item，这个 context 就算"暴露"。82% 是**context 级暴露率**（`含 forbidden 的 context 数 / 该臂 context 总数`），**不是**被暴露条目占比、也不是按 item 加权的比例。
- **分母**：未作用域（unscoped）臂共 **100,000 个 exact context**；其中 **82,266 个**含 forbidden item → **82%**；累计放入 **220,385 个** forbidden item（`scorer` 存储的 exact-context 计数）。
- **对照臂全部为零**：B-Flat、B-Graph 各自组装的 **200,000** 个 context、以及 session-silo / bounded post-filter / principal-postings 的 **180,000** 个 context，**没有一个是含 forbidden 的**。
- 注意：这是 **H1** 的通过条件（"0 of 200,000"），不是"82% 是个阈值"。

### B.3 实验设置（要对标就得照这个抄）

- **10,000 条独立生成的多方历史**（draws 40–10,039；**8 个主题 × 1,250**）；生成自一个**受控事件律**，其 ledger 在**语言渲染之前**就固定了参与者、容器、audience、viewers、gold evidence、答案目标。**0–39 号（含 32 条 pilot）排除**。
- **前瞻冻结**：协议、样本计划、判定规则在任何确认性结果被看过之前冻结（amendments 见 App. B.3）。
- **检索单元**：**48 个 paired retrieval cell/历史**（共 480,000）；6 个臂共用**同一份**查询、记忆状态、模型、prompt 和**确定性词法索引**（FTS5 BM25 + reciprocal-rank fusion；**fetch budget 20，k=5**，平局按 item id）。**不用 embedding** 参与确认排序（`text-embedding-3-small` 仅 pinned 记录，未用于排序）。
- **六臂**：unscoped 相关度检索 / 固定 session silo / bounded post-filter（先无授权排 top-20 再在组装前丢弃——**不是输出过滤**）/ principal postings / **B-Flat** / **B-Graph**（后两个是两个**独立持久化**的参考架构，只共享 policy 包，存储与查询路径互不共享，因此差分一致性测试不同义反复）。
- **剂量设计**：同谓词干扰项（关于其他参与者）按 `d ∈ {0,1,2,4,8}` 投放于 temporal-update 问题；六问端点用 `d = 8`。
- **模型**：`gpt-5.6-luna`，medium reasoning，**无 fallback**，观测身份已核验；答案级 attempt 上限：每答案 ≤2 次同输入、每 100 历史 ≤330、总计 ≤33,000。
- **统计**：主端点 = 配对授权 **Recall@5** 差（六问等权平均）；非劣 margin **−0.05**、单侧 empirical-Bernstein、α=0.025、**8 项全过**才算 H2 通过；通过后开 6 项 **Holm** 家族（α=0.05）；**无中期窥视、无可选停止**。

### B.4 与 82% 配套的召回代价（对标时要一起报）

| 对照臂 | R@5 | 配对 Δ | 97.5% 下界 |
|---|---|---|---|
| Unscoped | 0.674 | **+0.298** | +0.2900 |
| Session silo | 0.740 | **+0.233** | +0.2283 |
| Bounded post-filter | 0.972 | 0.000 | −0.0020 |
| Principal postings | 0.972 | 0.000 | −0.0020 |
| B-Flat / B-Graph | 0.972 | 全部 8 项通过 | — |

机制细节（可复现的"为什么会这样"）：temporal-update 单题上，unscoped 的 R@5 随剂量从 **0.974（d=0）掉到 0.616（d=8）**，两个架构**在所有剂量下都稳定 0.974**——因为 10,000 条历史里它们每次都取到同一批 20 个候选与同一 context，干扰项根本进不了候选集；unscoped 则一条都没有做到。

- 对**策略等价**基线（post-filter / principal postings）**配对差恰为 0**，即在 d=8 下**零召回损失**；对 unscoped / silo 是**净增益**（作用域化反而找回更多"应得证据"，因为 forbidden 项不再抢占 slot）。
- 作者明确写：**"Inference concerns this generator, not natural prevalence."** —— 82% 是该生成器在重剂量下的性质，**不是现实世界的发生率**。

---

## C. 拿来做我们自己的验收基线：能直接对标什么 / 不能

### 可以直接移植（这部分才是资产）

1. **暴露率的定义与分母**：单位 = 一次实际组装出的 context；判据 = `item ∈ context ∧ ∃ viewer ∉ Aud(item)`；只要 `≥1` 即计为暴露；报 `暴露 context 数 / 该臂 context 总数`。**别用"被暴露条目数/总条目数"充数**，两者不可比。
2. **零容忍断言**：作用域化臂 `0 / N`（论文是 0/200,000），并同时报 N，否则"0"没有信息量。
3. **必须配对报召回**：暴露率降低如果伴随 R@5 下滑，是两件事；论文的做法是同查询、同索引、同模型、同 prompt、只换准入，再报**配对差 + 非劣界**（margin −0.05）。
4. **前瞻冻结**：先写死协议/样本计划/判定规则，再看结果；我们 CI 里等价物 = 基线数字在跑之前 commit 进仓库。
5. **合成事件律 + 渲染前固定 ledger**：gold evidence、audience、viewer 在生成文本之前就定好——这条对我们自建 fixture 直接可用，避免"用模型判模型"。

### 不能直接对标（照抄会得到假结论）

1. **0.775 不是"通用静态基线"**：它建立在 9 个 code-contract 族、语义固定、每轮任务同构、actor 已有 substantial prior competence 之上；换个任务族结构，0.775 会整体平移。**可比的是"记忆 vs 无记忆"的相对差与对比条件**（同候选、同门决策、只改作用域、预算等长）。
2. **0.713 也不是"记忆的普遍代价"**：它是 8 条流里**恰好都接受同一条 boundary 规则**造成的；有害率 6/8 是"这条规则跨界"的结果，不是任意记忆系统的期望值。
3. **82% 不是行业基线**：它由 8 个主题、d=8 的重剂量干扰、6 臂、FTS5 词法排序共同决定。我们的语料若干扰更少，未防护暴露率可能远低于 82%——**这不代表我们更安全**。正确用法：在**自己的生成器**上测未防护臂，得自己的数字，只借用**定义**。
4. **两篇的"context"含义不同**：36373 指"一次模型调用的确切上下文"；29144 指"给 actor 的 skill 策略文本（360 字符）"。混用会把"泄漏"和"干扰"两件事搅在一起。

### 建议落到我们验收里的写法（一句话版）

> 泄露类：`exposure_rate = |{C : C 含 ≥1 个 viewer 越权项}| / |C|`，要求作用域化臂 `0/N`，并给出 unscoped 同语料的 `exposure_rate` 作为对照（**不复用 82%**）。
> 干扰类：`MTU = mean_t U_t`，在同候选/同门决策/等长预算下比 `scoped − global`，同时报 `有害接受/总接受`（对标 0/63 与 6/8），并报**最差族保留**而不只是均值。

---

## D. 与本地已有文档的关系

`docs/superpowers/plans/2026-10-23-dsh-memory-v2-four-layers.md`（L24–L40、L390）与 `2026-10-23-v2.1-episode-memory-and-risk-audit.md`（L119）已引用这两个数字，口径与上表一致（0.713 < 0.775、6/8、82%、R@5 +0.30）。
本文补的是**实验设置层面**：族怎么划、hidden 怎么隔离、0.713/0.775 的干预条件、暴露率的计数单位与分母。

来源：
- https://arxiv.org/abs/2609.29144 ｜ https://arxiv.org/html/2609.29144v1
- https://arxiv.org/abs/2609.36373 ｜ https://arxiv.org/html/2609.36373v1
