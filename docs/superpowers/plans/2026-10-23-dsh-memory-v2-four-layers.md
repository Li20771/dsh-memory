# DSH 记忆系统 v2 —— 四层记忆 + 研究知识库

> 日期：2026-10-23　｜　状态：**设计定稿待你拍板**　｜　v1 已撤除
> 变更：+工作区记忆层、+知识库三要素、+可迁移性架构、存储格式统一为 markdown

---

## 0. 本轮变更摘要

| | v1 | v2 |
|---|---|---|
| 层数 | 3（定位/地图/工作流） | **4**（+ 工作区记忆，可开关、跨会话） |
| 知识库 | 背景/过程/知识/坑 | **+ 未解问题 + 决策记录 + 逐条可信度** |
| 存储格式 | JSON（记忆） | **统一 markdown + YAML frontmatter** |
| 可迁移性 | 未设计 | **独立仓库 + 无绝对路径 + 按记录分文件（git 可合并）** |
| 状态 | 已装进 profile | **已撤除**（配置无残留、联接已删、备份保留） |

---

## 1. 一条决定新层设计的文献结论

这是本轮最重要的发现，先单独说。

**`arXiv:2609.29144`《Scope Before You Persist: Preventing Cross-Family Interference in Agent Memory》**（2026-09-24）在 12 轮代码修复流（ProcStream-RSI）上做了对照实验，结论是一记闷棍：

| 配置 | 平均轨迹效用 | 有害部署 |
|---|---|---|
| 全局记忆（所有任务共用一个池） | **0.713** | **6/8** |
| **无记忆的静态 agent** | **0.775** | — |
| **作用域记忆（每条只对来源任务族可见）** | **0.816** | **0/8** |

**全局记忆比完全没有记忆还差。** 原因是"局部有效的修改会干扰无关的任务族"。作者的原话：

> *certification determines whether an edit is supported, while retrieval scope determines where that evidence authorizes its use.*

**认证决定"这条记忆成不成立"，检索作用域决定"它在哪儿有权被使用"。两者必须匹配。**

这条直接锁死了工作区记忆的形态：**它不是"一个大池子按工作区过滤"，而是"每个工作区的记忆有独立的认证作用域与检索作用域"**。你直觉要"每个工作区可选打开"，方向是对的——但比"可选"更硬：**不隔离就是负收益**。

配套证据：**`arXiv:2609.36373`《Audience-Bound Persistent Memory》** 在 10,000 条多方历史上前瞻性验证——**未作用域化的检索在 82% 的上下文里暴露了不该出现的条目；作用域化后 0 条**，同时 Recall@5 还高 0.30。它的机制值得照抄：

> 每条记忆携带"记录时在场的受众"；派生条目按受众分区、或取来源受众的交集、或被抑制；受众只能通过**显式、对象级授权**扩大；条目只有在**当前每个观察者都属于其授权受众**时才进入模型尝试；**无法判定的观察者 fail closed 到 public-only**。

这就是"工作区开关"的严格形式：**开关是读侧授权，必须失败即关闭（fail closed），不能靠模型自觉**。

---

## 2. 四层模型

```
L1 定位            全局，每轮注入（约 1KB）
  ↓
L2 工作区地图       按 cwd 命中哪个工作区 → 只注入那一个
  ↓
L3 工作流          全局池，按任务相似度召回 top-k
  ↓
L4 工作区记忆       按 cwd 命中 + 该工作区已打开 → 与 L2 同作用域，参与跨会话累积
  ↓
KB 知识库          按研究项目组织，人读为主，DSH 读为辅
```

### L1 定位
**它是谁、为你做什么。** 不是人格设定，是协作契约：职责边界、输出标准、你不接受什么。
- 载体：单篇 `positioning.md`，带 `history`（每次变更留旧版）
- 注入：每轮全文（<1KB，可忽略成本）
- 变更：你来改，或 DSH 提议 + 你确认

### L2 工作区地图
**这块地是什么、结构、入口、约定。** 目前两块：
- `D:\AI-Security-Research-Workbench` —— 研究执行治理（Python + pytest，273 .py / 128 .md，其中已经有一条 `SPEC → EXECUTION_PLAN → STEP0_REALITY_REPORT → STEP1_DESIGN_REPORT → PHASE3A_INDEPENDENT_REVIEW → FINAL_GATE_REPORT` 的治理链）
- `D:\SecurityLab` —— 工作项目总库（`projects/ labs/ reverse/ ctf/ firmware/ pcaps/ notes/ reports/ docs/phases/`，已有 `AGENTS.md` 5670B）
- 载体：`workspaces/<id>.md`，含结构快照 + 约定 + 入口
- 注入：**按 cwd 只注入命中的那一个**

### L3 工作流
**从既往研究蒸馏出来的可复用流程。**
- 载体：`workflows/<slug>.md`
- frontmatter 关键字段：`triggers`（何时适用）、`preconditions`、`steps`、`pitfalls`（含"为什么踩"）、`origin`（哪次研究蒸馏来的，链到 KB）
- 注入：**按任务相似度召回 top-k，不全文注入**
- 来源：主要从 KB 的过程日志里**人工或半自动蒸馏**，不是自动生成（理由见 §3）

### L4 工作区记忆（新增）
**在这个工作区里发生过什么、学到什么、反复踩什么。** 目标：同一工作区的所有会话共享它，实现跨会话工作。

- 载体：`workspaces/<id>/memory/*.md`（每条一个文件）
- 开关：工作区根目录的 `.dsh/memory.json` → `{"enabled": true}`（**随仓库走，可迁移**）
- 作用域：`ws_<id>`；命中条件 = 会话 cwd 在该工作区根之下 **且** 开关为 true
- **与 L2 共作用域**：同一个工作区的"地图"和"记忆"是一个作用域单元，只是通道不同（声明 vs 积累）

**为什么开关状态放在工作区里而不是 DSH 配置里**：你要可迁移性。开关跟着仓库走，换机器 clone 下来就是开的；放 profile 配置里就丢了。

---

## 3. 必须防的两个坑（否则工作区记忆会自我毒化）

工作区记忆是**跨会话累积**的，这恰好是两个已知失败模式的高发区。

### 坑一：记忆回声（Memory Echo）
**`arXiv:2610.17763`** 定义：*历史信息因同一来源被反复检索而获得超额曝光，却没有新增独立证据*。

机制：你写了一篇笔记 → 会话 A 召回它并回写一条记忆 → 会话 B 同时召回笔记和那条记忆（其实是同一事实）→ 看起来"被多次确认"，其实只有一次来源。你越用，它越"真"。

**实证数据**：`arXiv:2609.30813` 的 Correlated Promotion Benchmark 显示——**一旦一个无争议的假信念进入记忆，下游消费者在 0.97–0.99 的探测里都会断言它**；而且**没有非 oracle 策略能在不知道来源谱系的情况下稳定拒掉假声明**。

**设计对策（照 FPA 框架）**：
1. **每条记忆存 `origin`**：`{session, turn, tool, family}`，`family = sha1(session_id + 诱发来源)`。同一 family = 同一来源。
2. **召回时每个 family 只取一条代表**，避免同源多条占据多个位置。
3. **"复发→提升"必须按不同 family 计数**，不是按命中次数。3 个**独立来源**指向同一结论才算复发；同一来源被检索 10 次不算。
4. **已修正的旧记录不得进入答案上下文**（`status: superseded/retracted` 一律不注入）。
5. **权威证据兜底**：`authority: user-stated` 优先于 `agent-observed` 优先于 `tool-output`/`inferred`。

### 坑二：写入即固化（formation is irreversible）
**`arXiv:2610.11270`《Gated Memory》**：*"永久用户属性"与"临时情境"的区别只存在于原始话语里，一旦抽取成 subject-relation-object 三元组就**不可逆地丢失**了。*

它的对策是**在抽取之前**加准入闸门，并且每条事实标注 *provenance（directly stated vs inferred）* 和 *condition of applicability*。

**设计对策**：
1. 记忆条目带 `condition`（适用条件：哪个工作区、哪个项目、什么前提）
2. 带 `provenance.kind`：`user-stated | agent-observed | tool-output | inferred`
3. **`inferred` 与 `tool-output` 不得单独获得"工作区级"权限**——它们只能进项目作用域，或标 `status: proposed` 等确认（对应 `arXiv:2608.01679` 的 authority collapse）
4. 写入前准入：**只做机械判定**（字段齐不齐、作用域合不合法、authority 与 scope 是否匹配），不做 LLM 判断（成本 + 可解释性）

---

## 4. 可迁移性架构

### 4.1 你的问题：塞进 Workbench，还是单开仓库？

**推荐：单开一个仓库。** 理由按重要性排：

1. **可迁移性的单位是"一个 clone"**。记忆分散在两个仓库里，迁移就永远不完整。
2. **commit 语义污染**。`AI-Security-Research-Workbench` 是一个有意义的工程仓库（spec/audit/plan/report），它的 commit 应该有语义。每天一条 "memory log" 会把它的历史糊掉。
3. **敏感边界**。安全研究的记忆里会有攻击面、内部 IP、PoC 思路。独立仓库 = 独立的可见性控制（可 private、可单独授权、可**整仓销毁**而不影响工程档案）。
4. **体积其实不是问题**——这点我用数算给你看：

| 内容 | 单条/单日 | 一年 |
|---|---|---|
| 记忆条目（~500B × 100 条/天） | 50 KB | ~18 MB |
| 过程日志（~3KB/天，按月滚动） | 3 KB | ~1 MB |
| KB 笔记（每项目 5–20 篇 × 50–200KB，年增 10 个项目） | — | ~10–20 MB |
| **合计** | | **~30–40 MB/年** |

纯文本，git 完全无压力。**真正的成本是文件数量和 commit 噪声，不是字节。**

### 4.2 噪声与增长的三条对策

1. **按记录分文件**（`memory/<id>.md`）。这带来一个关键好处：**git 可合并**。唯一 id 的文件永不冲突——如果哪天你有第二台机器同时写，合并是干净的。单一大 JSON 做不到这点。（对照 `arXiv:2607.27773` ChronoMem 的版本控制与语义回滚。）
2. **日志按月滚动**（`log/2026-10.md`），不是按天。文件数降 30×，内容一条不少。
3. **每日一次 squash 式提交 + push**，不是每条一提交。

### 4.3 无绝对路径（这是可迁移的真正门槛）

带绝对路径的数据换机器就废。所以：
- 存 **逻辑 id**（`ws_securitylab`、`proj_cp-a-trae`），不存 `D:\...`
- 机器相关的根路径放 **gitignored** 的 `machines/<hostname>.json`
- 派生索引 `.kb-index/` 一律 gitignored，启动重建

### 4.4 跨仓引用（让 KB 和 Workbench 既分家又可追溯）

分仓不等于断链。约定：
- KB 侧记录外部产物时存 `source_repo` + `source_path` + `source_sha256`（**不存 blob**）
- Workbench 侧的文档若要指向 KB，用普通路径 `dsh-mind:kb/projects/<slug>/...`
- **大二进制（pcap、firmware、截图）永不进记忆仓库**，只存引用 + 哈希

---

## 5. 知识库数据模型 v2

### 5.1 目录

```
kb/projects/<slug>/
  README.md            综合页：背景 + 结论 + 导航（可重写）
  log/2026-10.md       过程日志（只追加，按月滚动）
  findings/*.md        单个发现/结论
  decisions/NNNN-*.md  决策记录（选 A 不选 B 的理由）
  questions.md         未解问题
  artifacts/           时间线 / 概念图 / 问答集 / 简报
```

### 5.2 决策记录（ADR 模式）

用业界成熟的 **Architecture Decision Record** 格式，因为它天生就是"选 A 不选 B 的理由"：

```yaml
---
id: kb_adr_0007
type: decision
number: 7
title: 记忆检索基线不做 embedding
status: accepted        # proposed | accepted | superseded | rejected
date: 2026-10-23
supersedes: null
authority: user-stated
confidence: high
---
```

正文固定四段：**背景** → **选项**（A/B/C 各自代价）→ **决定** → **后果**（含"什么时候该重新考虑"）。

`status: superseded` + `supersedes` 形成决策链，能回答"为什么当初这么定、后来为什么改"。

### 5.3 未解问题

```yaml
---
id: kb_q_0012
type: question
status: open            # open | investigating | answered | abandoned
priority: high
blocks: [kb_cp-a-trae]
asked: 2026-10-23
answered: null
authority: agent-observed
confidence: high
---
```

正文要求写清：**问题**、**为什么现在答不了**、**什么样的证据能回答它**、**如果一直答不了会怎样**。

最后一条很重要——它把"未解"和"没想清楚"区分开。

### 5.4 逐条可信度（你要的"哪条是实测、哪条是推测"）

**这是块级的，不是文档级的。** 一篇笔记整体 `confidence: high` 没用，因为里面必然混着实测和推测。

```markdown
- 该接口在并发 8 时丢事件 ^claim-3f2a
  - evidence: measured          ← measured | inferred | reported | unverified
  - how: 2026-10-20 复现 3/3，见 [[run-2026-10-20#^blk-9c1]]
  - confidence: high
```

四个 `evidence` 取值：
| 值 | 含义 | 反例（不该这么标） |
|---|---|---|
| `measured` | 我跑过、有输出/日志 | "文档说这样" |
| `reported` | 第三方声称（文档、论文、别人说） | 当成实测 |
| `inferred` | 我从证据推的 | 当成实测 |
| `unverified` | 目前只是猜想 | 悄悄省略 |

对应文献：`arXiv:2610.27115` PROVISO 指出**现有防御判定动作时根本不追踪内容来自用户还是工具输出**；`arXiv:2609.33013` 则把"巩固决策是否可信"本身当作测量对象。

### 5.5 引用原语（沿用 v1 的 D3）

`[[note#^block-id]]` —— 它同时是三样东西：人可读的链接、机器可解析的区间、反链图的边。

---

## 6. 存储格式：统一 markdown

v1 里记忆是 JSON。v2 统一成 **markdown + frontmatter**，理由：

1. **一份解析器**，不是两套
2. **人可读** —— 你能直接看、直接改、直接 git diff
3. **Obsidian 能打开**，即便 memory 不进 vault 的链接图
4. **merge 友好**（按记录分文件 + 纯文本）
5. **可迁移** —— 没有数据库、没有二进制格式、没有 schema 迁移

```markdown
---
id: mem_7f3a91c2
type: memory
scope: ws_securitylab          # 逻辑 id，不是路径
kind: gotcha
authority: agent-observed
evidence: measured
confidence: high
condition: 仅当使用 pnpm workspace 时
status: active                 # active | superseded | retracted | proposed
supersedes: null
supersededBy: null
origin:
  session: sess_ab12
  turn: 7
  tool: pwsh
  family: fam_9c31             # sha1(session + 诱发来源)
created: 2026-10-23T09:00:00+08:00
updated: 2026-10-23T09:00:00+08:00
tags: [pnpm, workspace]
---

DSH 的 profile node_modules/@deepseek-ai 是空目录，插件不能 import 任何 SDK 包。
验证方式：`read` 该目录返回空；`node -e "import('@deepseek-ai/dsh-tools')"` 抛 ERR_MODULE_NOT_FOUND。
```

---

## 7. 目录布局 v2

```
<memory-repo>/                      ← 独立 git 仓库，可整体迁移
  kb/                             ← Obsidian vault 根
    positioning.md                ← L1
    workspaces/
      ai-security-research-workbench.md   ← L2
      securitylab.md                      ← L2
      securitylab/memory/*.md             ← L4（逐条）
      ai-security-research-workbench/memory/*.md
    workflows/*.md                ← L3
    projects/<slug>/{README,log,findings,decisions,questions,artifacts}
    templates/
  memory/
    items/*.md                    ← 全局原子记忆（逐条）
    journal.jsonl                 ← 审计尾（只追加）
  machines/<hostname>.json        ← gitignored：本机路径映射
  .kb-index/                      ← gitignored：派生索引，可重建
  .gitignore
  README.md                       ← 这份系统的自述（供迁移时读）
```

工作区侧的标记文件（**不在仓库里，在工作区里**）：
```
D:\SecurityLab\.dsh\memory.json   → {"schema":1,"enabled":true,"id":"ws_securitylab"}
D:\AI-Security-Research-Workbench\.dsh\memory.json
```

---

## 8. 分期计划 v2

| 期 | 交付 | 验收标准 | 依赖 |
|---|---|---|---|
| **P1** | 解析层 + 索引器 | fixture vault 上索引与手算一致；10k 文件全量重建 <2s，增量 <50ms | 你的 RE ③④ |
| **P2** | 四层注入 | 换 cwd 只注入对应 L2；开关关掉后 L4 零注入（fail closed）；L3 top-3 人工判定相关 | P1 |
| **P3** | 写入准入 + 反回声 | 同源多条只召回一条；`inferred` 无法单独获得工作区权限；已修正记录不进上下文；**跨工作区零泄漏测试** | P1、§3 |
| **P4** | KB 写入路径 | 跑一次真实研究，产出可读项目页 + 完整日志 + 决策记录 + 未解问题；你只读 README 就懂整个项目 | P3 |
| **P5** | 引用闭环 | 每条引用可定位到确切段落；断链告警 | P1、RE ①② |
| **P6** | 可迁移性 | 仓库 clone 到另一路径后，改一行配置即可工作；无绝对路径残留（用 grep 断言） | P3 |
| **P7** | 生成式产物 | 时间线/概念图/问答集/简报 | P4、RE ⑦⑨ |
| **P8** | 接入两个真实工作区 | 在 SecurityLab 工作时同时知道 L1 + 该 L2 + 该 L4 + 相关 L3；与现有 `AGENTS.md` 无冲突 | P2 |

**关键路径是 P1**，只依赖你的 RE ③④。P2–P3 可以先按最佳猜测推进。

---

## 9. 需要你拍板的（5 个）

1. **工作区地图（L2）是否也受开关控制？**
   我倾向：**地图常开，记忆受控**。地图廉价且能防误操作（"这是生产库别乱动"），记忆才是有毒化风险的那个。

2. **开关载体**：工作区根目录 `.dsh/memory.json`（随仓库走、可迁移）vs DSH profile 配置。
   我强烈倾向**前者**，因为你明确要可迁移性。

3. **记忆仓库放哪、叫什么？**
   候选：把 `D:\DSH记忆` 直接变成仓库（当前它已是工作目录，最省事）／新建 `D:\dsh-mind`。**我倾向前者**。

4. **日志按月滚动可否接受？**
   `log/2026-10.md` 一个月一个文件，月内追加。换来的是文件数和 commit 噪声降 30×。若你想要按天，我就按天（但每天一个新文件，一年 365 个）。

5. **敏感内容边界**：安全研究的记忆里会有 PoC 思路、内部 IP、目标特征。
   选项：(a) 仓库 private 全靠访问控制；(b) 加 `sensitivity: normal|sensitive` 字段，`sensitive` 默认不进任何模型上下文，需显式 `memory_search --include-sensitive`；**我倾向 (b)**，因为记忆会被自动注入，纯靠仓库私密挡不住"自动注入到不该出现的会话"。

---

## 10. 需要你逆向的（更新版）

> 只要**数据结构与语义**，不要 UI。P0 四项与上轮相同，新增两项。

### P0（缺了就得靠猜）

1. **NotebookLM 引用数据模型** —— 回答片段 ↔ 来源的绑定方式；高亮靠字符区间还是 chunk id；多来源重叠如何合并。
2. **NotebookLM 摄取/切分管线** —— chunk 大小与 overlap；每 chunk 一个 embedding 还是整篇；检索 top-k；有无 rerank；进 prompt 的来源 token 预算；长 PDF 怎么切。
3. **Obsidian 链接解析文法** —— `[[N]]` / `[[N|alias]]` / `[[N#Heading]]` / `[[N#^blk]]` / `![[embed]]` 的解析规则与优先级；同名文件消歧；大小写与归一化。
4. **Obsidian 块 id 模型** —— `^id` 自动生成的条件；**什么算一个 block**（段落/列表项/引用块/表格行）；`[[N#^id]]` 如何解析成**字符区间**（决定我能否精确高亮）。

### P0 新增

5. **Obsidian `.obsidian/` 的分层** —— 哪些文件是**库级配置**（应随仓库提交）、哪些是**机器级状态**（应 gitignore）。迁移正确性直接依赖这个，搞错会把别人的窗口布局、绝对路径、workspace 缓存提交进去。
6. **NotebookLM 的"来源"是否带共享/权限概念** —— 它支持 notebook 共享，那来源级有没有 audience 概念？我要判断 `arXiv:2609.36373` 的 audience 模型能不能直接落到文件系统上（还是必须有服务端强制）。

### P1

7. Obsidian 反链索引的维护方式（监听 vs mtime/哈希重建；`.obsidian` 缓存结构）
8. Obsidian 核心搜索算子文法
9. NotebookLM 来源自动摘要的字段结构

### P2

10. Note ↔ Source 关系｜11. Mind map/Timeline 数据结构｜12. frontmatter 属性类型系统｜13. Graph view 边模型｜14. Canvas JSON schema

**不要浪费时间在**：Audio Overview、Web 来源发现、主题/插件生态、Sync/Publish。

---

## 11. 风险

| 风险 | 影响 | 应对 |
|---|---|---|
| 工作区边界划错 | 记忆干扰（文献证明比无记忆更差：0.713 vs 0.775） | 作用域=认证作用域强绑定；跨工作区零泄漏测试进 CI |
| 记忆回声自我强化 | 假信念稳固化（0.97–0.99 会断言） | family 去重 + 独立来源计数 + 已修正记录不入上下文 |
| 你的 RE 与假设不符 | 解析层要返工 | 解析语义抽成单一模块 |
| 日志无限膨胀 | 检索变慢、仓库变吵 | 按月滚动 + 复发才提升 + 派生索引可重建 |
| 迁移时带出绝对路径 | 换机器即废 | 逻辑 id + gitignored 机器映射 + grep 断言测试 |
| 子代理在本会话不可用 | 无法并行 | 全部串行由我做 |
