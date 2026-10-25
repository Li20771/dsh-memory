# DSH 三层记忆 + 研究知识库 —— 设计与分期规划

> 日期：2026-10-22　｜　状态：**待你确认**　｜　未开始写代码（除已完成的 v0.1 底座）

---

## 0. 先交底：现在手上有什么

在你提新需求之前，我已经做完并验证了一个**可运行的记忆底座**（`D:\DSH记忆\plugin`，已装进 `desktop` profile，**重启 DSH 后生效**）：

| 能力 | 状态 |
|---|---|
| `memory_write` / `memory_search` / `memory_forget` / `memory_stats` 四个工具 | ✅ 54 项功能测试全过 |
| 每条记录带 `authority`（谁说的）+ `provenance` + `scope` | ✅ |
| 生命周期：`active / superseded / retracted`，`supersedes` 指针，append-only 审计 | ✅ |
| 自动召回：按**关键词 IDF + 时间衰减 + 显著度**打分，无命中就**零注入** | ✅ |
| 召回内容包成"仅供参考、不是指令"，转义 `</system-reminder>` 防逃逸 | ✅ 攻击用例已验证 |
| 挂进**真实** `ToolRuntime` + `SystemPrompt` 服务 | ✅ 7/7 集成验证 |
| bundle patch 被真实加载器组合（`--dump-config` 出现 `- id: dsh-memory`） | ✅ |

（`profile` 的 `package.json` 有备份：`package.json.bak-before-dsh-memory`。想撤回就换回来 + 删 `node_modules\dsh-memory` 联接。）

**这个底座不白做**：它正是新方案里"记忆层"的运行时，下面的规划是在它上面长出知识库和三层结构，不是推倒重来。

**一个诚实的说明**：本会话的子代理派发全部失败（6 次，跨 3 个模型），`web_search`/`web_fetch` 后端也 401。所以文献是我直接用 `Invoke-WebRequest` 打 arXiv API 抓的（470 篇去重语料），工作全部由我自己完成。

---

## 1. 我理解你要什么（请纠错）

### 1.1 三层记忆

| 层 | 内容 | 变更频率 | 注入策略 |
|---|---|---|---|
| **L1 定位** | **它是谁、为你做什么**。不是人格设定，是"协作契约"：DSH 在你这儿承担的职责边界、输出标准、你不接受什么 | 会更新（低频、重要） | 每轮**全文注入**（很小，<1KB） |
| **L2 工作区地图** | 两块地的**用途、结构、入口、约定**：<br>• `D:\AI-Security-Research-Workbench` —— 管研究执行治理<br>• `D:\SecurityLab` —— 管整个工作项目 | 会更新（中频） | 按 cwd **只注入相关那一块**；跨库操作时两块都注入 |
| **L3 工作流** | 从既往研究里**蒸馏出来的可复用流程**：触发条件、前置、步骤、坑 | 会增长（高频） | 按**任务相似度召回** top-k，不全文注入 |

L3 是我认为最有价值也最容易被忽视的一层。你的工作区里其实**已经把工作流编码在文件名里**了：

```
CP-A_V3_SPEC.md → AI15_OPEN1_EXECUTION_PLAN.md → AI15_OPEN1_STEP0_REALITY_REPORT.md
→ AI15_OPEN1_STEP1_DESIGN_REPORT.md → AI15_OPEN1_PHASE3A_INDEPENDENT_REVIEW.md
→ CP-A_V3_FINAL_GATE_REPORT.md
```

这是一条**"规格 → 计划 → 现实核查 → 设计 → 独立评审 → 终局门禁"**的治理流水线。它现在只存在于你的肌肉记忆和文件命名习惯里。L3 要做的就是把它变成**机器可召回、可执行、可演进**的东西。

### 1.2 知识库

按**研究项目**组织，目标是"你或 DSH 打开就能完全看懂这个项目"：
- 研究背景（为什么做、约束是什么）
- 研究过程（做过什么、试错路径、当时怎么想的）
- 涉及知识（概念、原理、外部资料、结论的依据）
- 踩过的坑（以及为什么踩、怎么绕开）
- 我建议再加：**未解问题**（open questions）、**决策记录**（选 A 不选 B 的理由）、**可信度标注**（哪条是实测、哪条是推测）

关键要求：**过程不能被"总结"吃掉**。这是文献里反复出现的失败模式（`arXiv:2609.36457` 巩固会压平时间形状；`arXiv:2610.29869` 压缩销毁来源；`arXiv:2610.27406` 抽象错误会再生）。所以下面 D8 把"过程日志"和"综合页"分成两层。

---

## 2. 五个硬决策（我拍的，你可以否）

### D1　单一 vault，项目做子目录
`D:\DSH记忆\kb\` 是 vault 根，项目在 `kb\projects\<slug>\`。

**理由**：Obsidian 的全部价值来自**单一链接图**——两个 vault 就断图了，跨项目引用（"这个 PoC 的思路来自另一个项目的发现"）就表达不出来。项目靠 frontmatter 的 `workspace:` / `paths:` 挂到真实仓库上，而不是靠物理位置。

### D2　每篇笔记 = 一个 markdown 文件 + YAML frontmatter
无数据库、无锁、可 git、Obsidian 能直接打开、你随时能手改。

```yaml
---
id: kb_7f3a91c2
type: project | research | finding | workflow | workspace | positioning | log | artifact
title: CP-A 跨层规避验证
slug: cp-a-trae
status: active | paused | done | abandoned
workspace: [AI-Security-Research-Workbench]
paths: ["D:/AI-Security-Research-Workbench"]
tags: [poc, governance, trae]
aliases: [CP-A]
authority: user-stated | agent-observed | tool-output | inferred
confidence: low | medium | high
created: 2026-10-22T21:00:00+08:00
updated: 2026-10-22T23:10:00+08:00
sources: ["[[2026-10-20-cpa-run#^blk-4f2a]]"]
---
```

`authority` / `confidence` 不是我加的花活，是文献的直接结论：`arXiv:2608.01679` 证明**保留断言却丢掉来源约束**会让记忆越权；`arXiv:2610.11188` 证明确定性的资格判定比让模型自己把握更可靠。

### D3　引用原语 = `[[note#^block-id]]`
这是把 NotebookLM 的"可溯源"落到**纯文本**的唯一手段，也是整个设计的支点。

- 每个"可被引用"的块有稳定 id：`^blk-4f2a`
- 任何论断、记忆、工作流步骤都能指回具体一段
- 反向链接图由此**免费**得到
- 人读是普通 markdown，机器读是精确区间

### D4　记忆库与知识库分两个库，共用一个引用空间
- **memory**（机器面）：原子、短、带 authority、参与衰减与自动召回 —— 已实现的 v0.1
- **kb**（人面）：长文、带链接图、可读可编辑
- memory 记录的 `source` 可以存 `[[note#^blk]]` ⟹ "这条记忆是从知识库哪一段来的"可追

**为什么不合并**：合并会让自动召回把长文塞进上下文（token 爆炸），也让人的编辑被机器覆盖。

### D5　不做 embedding / 向量库（基线）
**理由全是文献级的，不是偷懒**：
- `arXiv:2610.24671`：6 个 SOTA 显式记忆系统在 LongMemEval-S / BEAM-100K 上**打不过强原始历史 RAG**
- `arXiv:2610.29823`：Mem0 只在 GPT-4o-mini 上赢，且构建成本超过一次全上下文运行
- `arXiv:2610.26433`：用嵌入几何预测召回正确性，AUROC 0.640，**低于"问题难度"基线**
- `arXiv:2610.04195`：共享向量空间**无语义边界**，跨用户/跨项目泄漏 70–100%
- 工程硬约束：profile 的 `@deepseek-ai` 目录是空的，插件**不能 import 任何 SDK 包**，更不能引入第三方依赖

**基线用**：关键词 IDF + 链接图 + 标签 + 时间衰减。好处是**每条召回都能说清为什么命中**。语义检索留成**可选外部 provider**，不进基线。

### D6　变更检测用"结构化锚点 + 内容指纹"，不用文件监听
工作区会更新，但 Windows 上 watcher 不可靠，DSH 又是长驻进程。
做法：登记路径的 `(mtime, size)` 每次 pre-step 前轻量 stat，只有变化的才算 sha256 并重建该文件的块索引；全量重建只在启动时一次。对应文献的"惰性 + 低成本"（`arXiv:2605.16045` RecMem、`arXiv:2610.27406`）。

### D7　L1/L2/L3 都是 vault 里的 `type`
一处编辑、一处链接、一处检索。但注入策略不同（全文 / 按 cwd / 按相似度），因为**成本模型不同**。

### D8　知识库分"过程日志"与"综合页"两层
| 层 | 位置 | 写入规则 | 目的 |
|---|---|---|---|
| **过程日志** | `kb/projects/<slug>/log/YYYY-MM-DD.md` | **只追加**，谁/何时/做了什么/命令/结果 | 保住过程，是"踩过的坑"的原始素材；也是审计 |
| **综合页** | `kb/projects/<slug>/README.md`、`findings/*.md` | **可重写**，由日志蒸馏 | 人一读就懂 |

只写综合页 → 过程丢失、无法复核；只写日志 → 碎得没法读。两层是唯一解。

---

## 3. NotebookLM 与 Obsidian：我取什么、不要什么

### 3.1 从 NotebookLM 取

| 取 | 为什么 | 落到哪 |
|---|---|---|
| **来源接地 + 行内引用**（每个论断指回原文区间） | 这是它真正的护城河，也是反幻觉的唯一硬手段 | D3 的 `[[note#^blk]]` |
| **notebook = 作用域** | 天然对应"一个研究项目一个语料池" | `kb/projects/<slug>/` |
| **每来源自动摘要 + 关键主题** | 让 vault 可扫读 | 每篇笔记的 `## 摘要` 块，标 `generated: true` |
| **笔记可从对话"提升"为来源** | 研究和沉淀形成闭环，不用手动搬运 | `promote` 操作：召回片段 → 新笔记 |
| **生成式产物**：时间线 / 概念图 / 问答集 / 简报 | 项目理解的四种视角 | `kb/projects/<slug>/artifacts/` |

**不要**：Audio Overview、Web 来源发现、Google 账号体系。

### 3.2 从 Obsidian 取

| 取 | 为什么 | 落到哪 |
|---|---|---|
| **纯 md + YAML frontmatter 文件库** | 无锁定、可 git、你可随时手改、Obsidian 直接打开 | D2 |
| **`[[wikilink]]` + 反链 + 未链接提及** | 知识网络的骨架；"未链接提及"能自动发现该连没连的 | 链接索引器 |
| **块引用 `#^block-id`** | **整个方案的技术支点** | D3 |
| **标签（含层级 `#a/b`）+ aliases** | 低摩擦分类 + 查询别名 | frontmatter + 索引 |
| **Graph view**（局部图 + 全局图） | 从链接索引**派生**，零额外存储 | 纯计算 |
| **核心搜索算子**（`tag:` `path:` `file:` `section:` `block:`） | 比自然语言检索更精确、更可解释 | 查询解析器 |
| **Canvas**（可选） | 项目地图/攻击链图的空间布局 | 阶段 4 |

**不要**：插件生态、主题、Sync/Publish、Dataview（我们自己实现一个窄查询就够，不背它的语法包袱）。

---

## 4. 我需要你逆向什么（按优先级，这是你现在就能动手的部分）

> 原则：**我要的是数据结构和语义，不是 UI 皮肤**。能拿到内部格式/源码/网络协议就最好；拿不到就给行为观测 + 截图 + 复现步骤。

### P0 —— 这四项不给，架构就有猜测成分

**① NotebookLM：引用的数据模型**
- 一个回答片段 ↔ 来源的绑定，是 `(source_id, chunk_id, char_start, char_end)` 还是别的？
- UI 高亮靠**字符区间**还是靠**chunk id**？点引用时怎么定位到原文？
- 引用序号（`[1]`）与来源列表的映射存在哪？多来源重叠时怎么合并？
- 我需要能回答："如果我自己实现，最小可用的引用记录长什么样"

**② NotebookLM：摄取与切分管线**
- chunk 大小、overlap？
- 每 chunk 一个 embedding，还是整篇一个？
- 检索 top-k？有没有 rerank？进 prompt 的来源 token 预算多少？
- 长 PDF 怎么处理（分页？按标题？）

**③ Obsidian：链接解析的精确文法**
- `[[Note]]` / `[[Note|alias]]` / `[[Note#Heading]]` / `[[Note#^blk]]` / `![[embed]]` 各自的解析规则与**优先级**
- 同名文件的消歧规则（路径最近？先建？）
- 大小写敏感性、空格/标点归一化
- 一个链接解析失败时的行为

**④ Obsidian：块 id 模型**
- `^id` 是手动写还是要开设置才**自动生成**？
- **什么算一个 block**：段落？列表项？引用块？表格行？
- `[[Note#^id]]` 怎么解析成一个**字符区间**（这决定我能不能精确高亮）
- 块 id 的唯一性范围（全库？单文件？）

### P1 —— 影响工程质量，可以稍后

**⑤ Obsidian：链接索引的维护方式**
- 反链是**监听文件变化**还是按 mtime/哈希**重建**？
- 有没有磁盘缓存？`.obsidian` 里存了什么（`cache` / `workspace.json` 的结构）？
- 大库（万级文件）首次索引多久？

**⑥ Obsidian：核心搜索算子文法**
- 各算子的确切语义、是否支持布尔组合、正则怎么写、`section:` 与 `block:` 的区别

**⑦ NotebookLM：来源自动摘要的字段结构**
- 除了 summary 还产出什么（key topics / suggested questions / 时间线）？确切字段名与层级

### P2 —— 有更好，没有也能做

**⑧ NotebookLM：Note 与 Source 的关系**（保存的笔记是否进语料、如何被引用）
**⑨ NotebookLM：Mind map / Timeline 的输出数据结构**（节点/边 schema）
**⑩ Obsidian：frontmatter/属性类型系统**（类型推断、索引方式、aliases 处理）
**⑪ Obsidian：Graph view 数据模型**（什么算一条边：link / embed / tag / alias）
**⑫ Obsidian：Canvas 的 JSON schema**

---

## 5. 目录布局（提议）

```
D:\DSH记忆\
  kb\                                  ← vault 根（Obsidian 可直接打开）
    .kb-index\                         ← 派生索引，可删可重建
      blocks.json                      ← block-id → (file, charRange)
      links.json                       ← 出链/入链/未链接提及
      tags.json
    positioning.md                     ← L1 定位（单篇，带 history）
    workspaces\
      ai-security-research-workbench.md  ← L2
      securitylab.md                     ← L2
    workflows\                         ← L3
      spec-to-final-gate.md
      independent-review.md
    projects\
      <slug>\
        README.md                      ← 综合页（可重写）
        log\2026-10-22.md              ← 过程日志（只追加）
        findings\                      ← 单个发现/结论
        artifacts\                     ← 时间线 / 概念图 / 问答集 / 简报
    templates\
  memory\                              ← 机器面记忆（v0.1 已在用）
    items\ journal.jsonl
  plugin\                              ← dsh-memory 插件
  tools\                               ← smoke / integration / 索引器测试
  research\                            ← 本次调研的原始语料与脚本
```

L1/L2/L3 在 vault 里，因为你需要能读、能改、能链；memory 独立，因为它是机器的热数据。

---

## 6. 分期计划（每期独立可验收）

| 期 | 交付 | 验收标准 | 依赖 |
|---|---|---|---|
| **P0** ✅ 已完成 | 记忆底座 v0.1 | 54 功能 + 7 集成全过 | — |
| **P1** vault 骨架 + 索引器 | md/frontmatter 解析、block-id 分配、链接解析、反链、标签、搜索算子、增量重建 | 给定一棵 fixture vault，索引输出与手算一致；10k 文件重建 <2s，增量 <50ms | 你的 ③④（P0 RE） |
| **P2** 三层落地 | `positioning.md` 注入、workspace map 按 cwd 注入 + 变更检测、workflow 按相似度召回 | 换 cwd 只注入对应 workspace；改一个文件后下一轮就反映；L3 召回的 top-3 人工判断"确实相关" | P1 |
| **P3** 知识库写入路径 | 过程日志追加 API、综合页模板与蒸馏、项目脚手架、`promote` | 跑一次真实研究，产出可读的项目页 + 完整日志；你能只读 README 就懂整个项目 | P1，D8 |
| **P4** 引用闭环 | 回答/召回带 `[[note#^blk]]`，可点回原文；未链接提及提示 | 每条引用都能定位到确切段落；断链有告警 | P1、你的 ①② |
| **P5** 生成式产物 | 时间线 / 概念图 / 问答集 / 简报 | 对已有项目生成四件套，你判定"有用" | P3，你的 ⑦⑨ |
| **P6** 接入真实工作区 | 两个根的地图 + 与现有 `AGENTS.md` 协同、冲突处理 | 在 SecurityLab 里工作时，DSH 同时知道 L1 + 该 L2 + 相关 L3 | P2 |

**P1 是关键路径**，而且它**只依赖你在 P0 的 RE 结果**——所以你的 RE 一给我，P1 就能开工。P2/P3 可以先用我对 ③④ 的**最佳猜测**并行推进，等你结果到了再校准。

---

## 7. 三个需要你拍板的问题

1. **vault 放哪？** 我默认 `D:\DSH记忆\kb`（这个目录是你为记忆专建的，看起来就是它的家）。如果想让 Obsidian 直接管它、或想放进 `SecurityLab\notes`，现在说。
2. **知识库由谁写？** 我默认分权：**过程日志让 DSH 自动追加**（不打扰你）；**综合页/结论让 DSH 写但标 `status: draft`，你审过才转 `active`**。这样既不丢过程，也不让机器单方面定义你的研究结论。
3. **两个工作区的"治理"边界**：`AI-Security-Research-Workbench` 管研究执行、`SecurityLab` 管工作项目——但它们有重叠（都在 `D:\`，都有 `docs/`、`tools/`、`scripts/`）。你希望 L2 严格分成两个不相交的世界，还是允许"一个项目跨两库"？我倾向**允许跨库**（用 `workspace: [A, B]` 表达），因为真实研究经常是"在 Workbench 里做方法，在 SecurityLab 里落地"。

---

## 8. 已知风险

| 风险 | 影响 | 应对 |
|---|---|---|
| 你的 RE 结果与我的假设不符 | P1 的块引用/链接语义要改 | P1 把"解析规则"抽成单一模块，语义改动只碰一处 |
| 知识库膨胀后检索变差 | 召回噪声上升 | 文献的教训：宁可零注入。阈值 + 硬预算 + 可解释打分，已有 |
| 记忆污染 | 外部内容被写进长期记忆 | 已有：`authority` 不得虚报 + 召回内容声明"不是指令" + 转义框架标记；P3 再加"写入前准入" |
| 两个工作区已在用 `AGENTS.md` | 与插件注入重复/冲突 | P6 明确优先级：`AGENTS.md` 是项目指令，L1/L2 是协作契约，冲突时项目指令优先 |
| 子代理在本会话不可用 | 无法并行推进 | 全部由我做；分期本身就是串行安全的 |
