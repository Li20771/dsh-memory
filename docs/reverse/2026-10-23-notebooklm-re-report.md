# NotebookLM（Gemini Notebook）逆向报告 —— 引用模型 / 摄取切分 / 检索 / 摘要 / 权限

> 日期：2026-10-23
> 目标：`https://notebook.google.com/notebook/<id>`（原 NotebookLM，现产品名「Gemini Notebook」）
> 目的：只取**数据结构与语义**，供 DSH 记忆 v2 的 P1（解析层）/ P5（引用闭环）落地
> 覆盖：计划书 §10 的 **P0-1 / P0-2 / P0-6 / P1-9** 四项（Obsidian 那 5 项不在本次范围）

---

## 0. 一句话结论

NotebookLM 的引用不是"句子级语义匹配"，而是 **"来源文本被展平成一条字符流，切成 ~900 字的 passage，引用 = 指向某个 passage 的字符区间"**。序号 `[n]` 不是来源编号，而是**引用条目的出现序号**；**一个锚点可以挂多个条目，渲染成 `[1, 2]`**（三来源同事实实验已验证）。检索是**带覆盖率注记的 agent 循环**，不是固定 top-k。权限只有 **notebook 级**，没有来源级受众。

---

## 1. 传输层：全部走一个 batchexecute 端点

| 用途 | 端点 / rpcid |
|---|---|
| 通用 RPC | `POST /_/LabsTailwindUi/data/batchexecute?rpcids=<ID>` |
| 生成回答（流式） | `POST /_/LabsTailwindUi/data/google.internal.labs.tailwind.orchestration.v1.LabsTailwindOrchestrationService/GenerateFreeFormStreamed` |
| 上传"复制的文字"来源 | `rpcids=izAoDd` |
| 笔记本 + 来源清单（含元数据） | `rpcids=wXbhsf` |
| 来源自动摘要 + 选题 | `rpcids=VfAZjd` |
| 来源详情（含下载 URL / Drive 预览 URL） | `rpcids=rLM1Ne` |
| 配额 / 用量 | `rpcids=EylDcb` |
| 分享 / 权限状态 | `rpcids=JFMDGd` |
| 分享对象搜索 | `https://peoplestack-pa.clients6.google.com/$rpc/peoplestack.PeopleStackAutocompleteService` |

**流式帧格式**（关键，客户端解析必踩的坑）：

```
)]}'
<byteLen>\n<json>
<byteLen>\n<json>
...
<byteLen>\n[["e",4,null,null,<elapsed>]]
```

三条实测要点：

1. 长度前缀是**字节数**，不是字符数 —— 中文内容下按 JS 字符串切片会错位（我第一版就踩了）。
2. 每个实体帧是 `[["wrb.fr", null, "<inner JSON 字符串>"]]`，**double-encoded**：要 `JSON.parse` 两次才拿到业务体。
3. 帧是**累积快照**而非增量：同一答案从 469B 一路长到 6232B，每帧都含"目前全文"。取**最大帧**即最终答案。
4. 长度前缀并不总是可靠（末帧常无前缀），稳健做法是**从帧首括号配平**切片（见 `stream_frames.mjs`）。

---

## 2. P0-1 引用数据模型（核心交付）

### 2.1 来源被展平成"规范字符流"

一个来源在服务端不是 HTML、不是 PDF 页，而是**一条规范化文本 + 一套块结构**。

实测样本：粘贴 672 字的 Markdown，服务端展平为 **612 字**。规范化规则（对照原文逐字比对得出）：

| 原文 | 规范流 |
|---|---|
| `## 标题` / `### 小标题` | 去掉 `#`，标题文字保留 |
| 段落间 `\n` | 变成**单个空格** `" "`（作为独立 segment） |
| 行内 `**加粗**` | 变成段内 segment 的样式位 `[true]` |

块结构（`type` 位已观测到值）：

```
block  = [ start, end, segments, type? ]
segment= [ start, end, [ text, styles? ] ]      // styles: [true] = 加粗
type   = [ null, 5 ]   ← 对应 H2 级标题（原文 "## "）
       = [ null, 6 ]   ← 对应 H3 级标题（原文 "### "）
```

实测（672 字文档 → 612 字规范流）：

```
[0,   15, [ [[0,15,["文档甲：ZX 系列设备技术说明"]]] ], [null,5] ]   ← 标题块
[15, 380, [ segment... segment ]]                                  ← 正文块，段间用 [83,84,[" "]] 分隔
[380,385, [ [[380,385,["备件与校准"]]], [null,6] ]]                 ← 二级标题
[385,612, [ segment... ]]
```

### 2.2 引用是三层结构

**第 1 层：答案内的内联锚点**（在"答案消息"里）

```
inlineCitation = [ [citationId], [null, spanStart, spanEnd] ]       // 变体 A
               = [ [null, spanStart, spanEnd], [groupIndex, ...] ]   // 变体 B：索引是**列表**，可多个
```

**span 是答案文本（规范化后）里的字符区间，不是来源区间。** 实测两种形态：

| 样本 | span | 含义 |
|---|---|---|
| "…**640 运行小时** [1]。" | `[31,31]` | 零宽插入点：正好在粗体段结束(31)与句号(31→32)之间 |
| "…**0.86 MPa** [1]。" | `[50,50]` | 同上 |
| 答案全文只有 "47.3 [1]" | `[0,4]` | 覆盖整段数值 |

→ **不要**把 span 当"被支持的句子区间"来用；它只是**标记的落点**。要精确高亮"被支持的那句话"，必须自己按句子切。

**第 2 层：引用条目（citation group）**

```
group = [
  null,
  null,
  score,                       // ← 相关度/置信度（实测 1 与 0.9），不是区间条数
  [ [null, srcStart, srcEnd] ],// ← 来源侧字符区间（真正的高亮范围）
  passageBlocks,               // 该来源的块结构（用来渲染带高亮的原文）
  [ [ [sourceId], revisionId ] ],   // 来源标识；四次实验里**恒为 1 个元素**（多来源走多 group）
  [ citationId ]
]
```

**第 3 层：序号（修正版，已用三来源实验验证）**

- 一个锚点带的是 **group 索引列表**，不是一个索引：
  `[ [null, spanStart, spanEnd], [0, 1] ]` → 渲染成 `[1, 2]`。
- 服务端**直接下发带 `[1, 2]` 的答案文本**（实测原文：`ZX-9 型设备的额定功率为 **47.3 千瓦** [1, 2]。`），前端只是把 `1`、`2` 竖排显示。
- 序号 = **group 的 1-based 出现序号**，与来源无关：
  - 单来源长文档：两处引用 → `[1]`、`[2]`，两个 group 的 `sourceId` **相同**（`b4f15277-…`）；
  - 三来源同事实：一处引用 → `[1, 2]`，两个 group 的 `sourceId` **不同**（丙 `eb501715` / 甲 `d1dfeddf`）。
- **所以「多来源重叠怎么合并」的答案是：既不在字符层合并，也不在一个 group 里塞多来源，而是给同一个锚点挂多个 group，序号并排。** 每个 group 各自携带自己来源的块结构，高亮按来源分别渲染。

### 2.3 引用区间的粒度：**精确到 passage，不精确到句子**

这是最重要的一条负面结论。三次实验：

| 问题 | 事实位置 | 返回区间 | 区间宽度 |
|---|---|---|---|
| 单事实（47.3 千瓦） | 第 1 段（规范流 36–83） | `[0, 612]` | **整篇** |
| 跨段两事实 | P03 + P07 | `[0, 612]` | **整篇** |
| 跨章两事实（长文档） | 第 3 章末尾 / 第 11 章末尾 | `[862,1750]` / `[4304,5220]` | **888 / 916** = 单个 passage |
| 同事实跨来源（甲 + 丙） | 甲 §P01 + 丙 §Q01 | `[0,612]`（甲）+ `[0,93]`（丙） | **各自整块**，两个 group 并排 |

→ 区间 = **命中的那个 passage 的完整范围**。原文越长，高亮越粗。所以：

- 你要"点引用跳到确切段落"**可以做到**（passage 级）。
- 你要"点引用跳到确切句子"**抄不到**，必须自己在 passage 内再做一层句子定位（这正是 `[[note#^blk]]` 里 `^blk` 该干的事）。

---

## 3. P0-2 摄取与切分管线

### 3.1 上传载荷（粘贴文本）

```
f.req = [null, "[[[[null,[\"<标题>\",\"<正文>\"]]],null,2,null,null,null,null,null,null,1]],
          \"<notebookId>\",
          [2,null,[1],[1,null,null,null,null,null,null,null,null,null,[1,3]]]]"]
```

返回的 source 记录（**这就是来源的最小 schema**）：

```
[ [ "<sourceId>" ], "<标题>",
  [ null,
    68,                          // slot1：含义未定（PDF 为 0；两个文本源为 68 / 251）
    [epoch, nanos],              // 创建时间
    [ "<revisionId>", [epoch,nanos] ],   // 版本 id + 时间
    8,                           // slot4：类型枚举（8 = 粘贴文本，3 = PDF）
    null, 1, null,
    470,                         // slot8：内容规模（672字→470；5336字→4050；PDF→224007）
    null,null,null,null,null,
    [epoch,nanos],               // 更新时间
    null,null,null,null,
    "text/markdown"              // MIME
  ],
  [ null, 2 ]
]
```

- **粘贴文本一律存成 `text/markdown`**，且 `rLM1Ne` 给出的下载 URL 文件名形如 `##_文档甲：….md` → 源码就是 `.md` 文件。
- 逻辑 id 与版本 id 分离（`sourceId` + `revisionId`），**引用记录同时钉住两者**（`[ [[sourceId], revisionId] ]`）→ 来源被编辑后旧引用仍可解释。

**四个样本的数值槽实测**（用来定 slot1 / slot8 的语义）：

| 来源 | 正文字符 | slot1 | slot4 | slot8 | slot8 / 字符 |
|---|---|---|---|---|---|
| 文档丙 | 93 | 13 | 8 | 70 | **0.75** |
| 文档甲 | 672 | 68 | 8 | 470 | **0.70** |
| 长文档乙 | 5336 | 251 | 8 | 4050 | **0.76** |
| 笔记转来源 | ~120 | —（回包 7） | 8 | 58（回包） | — |
| 某 PDF（另一笔记本） | 224007 未知 | 0 | 3 | 224007 | — |

- **slot8 是内容规模，且稳定在 0.70–0.76 × 字符数** → 与中文 tokenizer 的 0.7–0.8 token/汉字高度吻合，**最可能是 token 数**。（PDF 那条 224007 与之不自洽，见 §8。）
- **slot1 仍未定**：93→13、672→68、5336→251，每单位字符数 7.2 / 9.9 / 21.3，不是线性计数；PDF 那条为 0。
- **slot4 = 来源类型枚举**：8 = 粘贴/笔记文本，3 = PDF。

### 3.2 分块：目标 ~900 字、按标题边界、**零重叠**、不合并小尾巴

用 5336 字、12 章（每章 1 个 H2 + 4 段）的长文档实测，检索载荷里一次给出 9 个 passage：

| passage | 字符数 | 覆盖 | 备注 |
|---|---|---|---|
| #1 | 627 | 文档甲 正文 | 单来源主体 |
| #2 | 47 | 文档甲 附注 | **小尾巴单独成块** |
| #3 | 882 | 乙 第1–2章 | |
| #4 | 902 | 乙 第3–4章 | |
| #5 | 862 | 乙 第5–6章 | |
| #6 | 862 | 乙 第7–8章 | |
| #7 | 872 | 乙 第9–10章 | |
| #8 | 930 | 乙 第11–12章 | |
| #9 | 42 | 乙 附注 | **小尾巴单独成块** |

结论：

- **块大小 ≈ 860–930 字**（目标约 900），按**段落/标题边界**切，不切断段落。
- **无 overlap**：相邻块首尾无重复文本（overlap 检测里出现的 174 字重合只是我刻意重复的样板句）。
- **不做最小块合并**：42 / 47 字的尾块独立成块。
- **passage 序号是"检索结果内全局"的**：多个来源被串进**同一个** `<passage index>` 序列（甲 #1–2，乙 #3–9），不是每来源独立编号。

### 3.3 给模型的 passage 文本形态（可直接照抄的模板）

```
\nNEW SOURCE\nExcerpts from "<来源标题原文>":\n\n
<passage index="1">\n#### <来源标题>\n<正文…>\n</passage>\n\n
<passage index="2">\n…\n</passage>\n\n
```

- 标题层级被**下推 2 级**：原文 `##` → `####`，`###` → `#####`。
- `index` 是文本里的 XML 属性，`####` 是 Markdown —— **混合格式**，解析时要分开处理。

---

## 4. 检索管线（不是 top-k）

从 `GenerateFreeFormStreamed` 的 thought 块里能直接读到工具调用参数：

```
["semantic_search", [ ["user_queries", [ ... [null,null,"<子查询1>"], [null,null,"<子查询2>"] ] ] ]]
["semantic_search", [ ["passages", [ ... "<上面那坨 passage 文本>" ] ],
                      ["retrieval_status", [ ... "[SYSTEM NOTE: End of notebook reached.
                          100% of the sources are included in this result. Do not semantic search again.]" ] ] ]]
```

要点：

1. **查询会被拆成多个子查询**。实测："维护周期是多少，阈值是多少" → `["ZX-9 的定期维护周期是多少运行小时", "ZX-9 安全泄压阀的整定阈值是多少 MPa"]`（multi-query，不是单查询）。
2. **检索是 agent 循环**：模型自己决定何时再搜；系统用 `retrieval_status` 回灌**覆盖率**（`100% of the sources are included`）并显式要求"别再搜了"。→ 这是**覆盖率驱动的收敛**，不是 top-k 截断。
3. **没有 rerank 的痕迹**：检索结果直接以 passage 文本喂给模型，客户端不参与排序。
4. **思考步骤可见**：`Analyzing …` → `semantic_search` → `Reviewing… / Verifying…` → `Answering`。存在**独立的 verify 阶段**（"Verifying the Answer"）。
5. 三个 ceiling 数字出现在 notebook 记录里：`[1,100,50,500000,1,500]`（疑似上限配置：100 = 来源数上限？500000 = 总字符预算？**未验证**）。

---

## 5. P1-9 来源自动摘要的字段结构

`rpcids=VfAZjd`，响应体：

```
[ [ [ "<摘要 Markdown>" ],
    [ [ [ "<选题1>", "Create a detailed briefing document designed to address this topic: \"<选题1>\". Include quotes from the original sources where appropriate." ],
        [ "<选题2>", "<同上模板>" ],
        [ "<选题3>", "<同上模板>" ] ] ],
    null, null, null,
    [ [ [ "<选题1>", 9 ], [ "<选题2>", 9 ], [ "<选题3>", 9 ] ] ] ],
  "<summaryId>" ]
```

- 摘要 = **一段 Markdown**（带 `**加粗**`），无结构化字段（无 key topics 数组、无 entity 列表）。
- "关键主题" = **3 个选题**，每个配一条**可直接用的 briefing 提示词模板**（"Create a detailed briefing document designed to address this topic: … Include quotes from the original sources where appropriate."）。
- 权重 `9` 出现在选题三元组里（含义未定，可能是排序/优先级）。
- 摘要与选题**一次返回**，不是两次调用。

---

## 6. P0-6 来源有没有"受众/共享"概念

`rpcids=JFMDGd`（分享面板打开时）：

```
[ [ [ "<email>", 1, [], [ "<显示名>", "<头像URL>" ] ] ],   // 分享对象 + 角色(1)
  null, 1000, true, null, null, [3,true,true], false ]
```

同时 `peoplestack` 被调用做联系人搜索。

**结论：**

- 权限模型是 **notebook 级**：请求只带 `notebookId`，返回"谁 + 角色"。
- **来源记录与引用记录里没有任何受众字段**：引用只钉 `[sourceId, revisionId]`；来源记录只有标题/时间/类型/大小/mime。
- 也就是说：**来源继承 notebook 的可见性，无法单独授权某个来源**。

对你的直接影响：`arXiv:2609.36373` 的 audience 模型**不能照抄**，因为服务端根本没有来源级受众。要落地必须在**文件系统/索引层自己实现**（每条记录带 audience，读侧 fail closed）。这反过来是个好消息：你的设计不需要迁就服务端语义，可以更严。

---

## 6.5 P2-10 Note ↔ Source 关系（补测）

实测链路（全部走 UI 真实点击 + 抓包）:

1. 答案下方有 **「保存到笔记」** → 生成一条 **note**。note 详情页写明 **"已保存的回答只能查看"**，并给出两个动作：`delete` / **`转换为来源`**。
2. 点 **`转换为来源`** → 客户端调用 **`izAoDd`（和"粘贴文本"完全同一个上传 RPC）**，把笔记正文当成一篇新文本上传。
3. 回包给出**新的 source 记录**：`[["96cf83c2-…"],"ZX-9技术参数",[null,…],…,"text/markdown"]`，来源列表从 3 条变 4 条。

结论：

- **保存的笔记默认不进语料**，不参与检索、不被引用。它只是"答案的只读快照"。
- **只有在显式「转换为来源」后**，笔记才以**新来源（新 sourceId、新 revisionId）**的身份进入语料。
- 也就是说 **note 与 source 之间没有引用关系**，没有 "note 引用了哪些 source" 的字段；转换是**复制成独立文档**，原来那天的引用链（`[1, 2]`）在新来源里退化成纯文本 `[1, 2]`。

对你的设计意味着：**"从对话提升为笔记"必须是显式的二级动作**（`promote`），且提升后要保留来源谱系（NotebookLM 这里没做，你可以做得更好 —— 提升时记住被引用块的 `[[note#^blk]]`，而不是把序号烤进正文）。

---

## 7. 直接喂给 P1 / P5 的东西

### 7.1 最小可用引用记录（建议 schema）

```jsonc
{
  "answerSpan": [31, 31],          // 答案规范文本里的落点（零宽也合法）
  "groups": [                       // ← 一个锚点可挂多个 group（实测 [1, 2]）
    {
      "citationId": "c75f7f36-…",
      "score": 1,                   // 实测 1 / 0.9
      "sourceId": "eb501715-…",
      "revision": "a3b54ebe-…",
      "range": [0, 93],             // 来源规范文本里的字符区间（passage 级）
      "passageBlockRef": 0          // 指向该来源块结构，用于渲染高亮原文
    },
    { "citationId": "b4ec7bf2-…", "score": 0.9, "sourceId": "d1dfeddf-…", "revision": "664ff6ae-…", "range": [0, 612] }
  ]
}
```

要点三条（照抄能省很多返工）：

1. **双 id**：`sourceId` + `revision`，引用钉死两者；来源一编辑，旧引用可解释而不失效。
2. **区间两层**：答案侧 span（标记落点）+ 来源侧 range（高亮范围）。二者**不可互相推导**。
3. **序号是渲染层概念**：存 group 列表，`[n]` 在渲染时按出现顺序生成；不要把它当外键，也不要用它指代来源。

### 7.2 映射到 `[[note#^block-id]]`

| NotebookLM | 你的 vault |
|---|---|
| passage（~900 字，标题边界，零 overlap） | **块**：一个 `^blk-xxxx` = 一个 passage 级的块 |
| 来源规范字符流 + 块结构 | **`kb/.kb-index/blocks.json`**：`blockId → (file, charStart, charEnd)`，索引基于**规范文本** |
| `[null, srcStart, srcEnd]` | 直接落到上面的 char 区间 |
| 答案侧 span | 生成侧记录，不写进 vault |
| 块结构里的 `[null,5] / [null,6]` 标题类型 | frontmatter 的 `heading_level`，用于"按标题切块" |

**必须新增一层：规范化文本（canonical text）。** 你的块区间如果直接对着原始 `.md` 文件的偏移，会把 `#`、`**`、段落换行都算进去，和服务端语义对不上。做法：`canonical = strip_headings + collapse_paragraph_breaks_to_single_space`，索引存**规范偏移**，渲染时再映射回原文件位置。这一层不做，P5 的高亮一定会偏。

### 7.3 三条能直接改设计的观测

1. **"没有答案"也会有引用**。问"最佳烹饪温度"，回答是"文档里没有相关内容"，但紧接着的**描述性句子仍然挂了一个 `[1]`**。→ 你不能用"引用为空"当作"这是幻觉"的判据；要用"引用指向的段落是否真的支持该断言"。
2. **引用粒度天然粗（passage 级）**。→ 想做到"每条论断都能定位到确切句子"，你得在 passage 内部再做句子切分与匹配，这部分 NotebookLM 没做，也没有参考实现可抄。
3. **检索该做成 agent 循环 + 覆盖率注记**。它的 `retrieval_status` 就是"我还剩多少来源没看"的回灌。你的 L3/L4 召回可以照这个形状：**召回 → 告诉模型"库里还有多少没看" → 模型决定是否再召回**，而不是一次性 top-k 塞进去。

---

## 8. 未解（明确标注，不含糊）

| # | 问题 | 现状 | 怎么解 |
|---|---|---|---|
| 1 | source 记录 slot1（93→13 / 672→68 / 5336→251 / PDF→0）语义 | 未定，非线性 | 需要更多长度样本做回归（尤其是英文与纯代码文档） |
| 2 | source 记录 slot8（70 / 470 / 4050 / PDF 224007）单位 | 文本源稳定 ≈ 0.70–0.76 × 字符数（像 token 数）；PDF 的 224007 与之不自洽 | 同一内容上传 PDF 与 txt 对比 |
| 3 | 长 PDF 的分页/切块 | **未测**（未接 CDP 文件上传） | `DOM.setFileInputFiles` 传真 PDF，看 passage 是否按页断 |
| 4 | 「每 chunk 一个 embedding 还是整篇一个」 | **客户端不可观测**：全量抓包里没有任何向量/数值数组（`numericRuns(len≥13)=0`、无 base64 块），向量只在服务端 | 只能从外部行为推断；或放弃这个问题（你的基线本来就不做 embedding） |
| 5 | 进 prompt 的来源 token 预算 | **未测**：生成请求里没有问题之外的预算字段；`[1,100,50,500000,1,500]` 只是猜测 | 用超长来源 + 计数观察截断点 |
| 6 | `retrieval_status` 非 100% 时的文案与行为 | 只观测到 `100%`（4 个来源、10 个 passage 时仍是 100%） | 造更多来源/更长语料 |
| 7 | 分享角色枚举（观测到 `1`）与 `[3,true,true]` 含义 | 部分 | 再造协作者 / 公开链接样本 |
| 8 | P2-11 Mind map / Timeline 数据结构 | **未做**（Studio 需先生成产物；计划书列为可选，且 Audio/Video 明确跳过） | 在 Studio 里生成一次思维导图后抓包 |

---

## 10. 需求覆盖审计（对照计划书 §10：NotebookLM 部分）

| 计划书条目 | 子问题 | 状态 | 证据 |
|---|---|---|---|
| **P0-1** 引用数据模型 | 绑定方式 `(source_id, chunk_id, char_start, char_end)`？ | ✅ **比这更简**：`[ [sourceId], revisionId ] + [null, start, end]`，**没有 chunk_id** | §2.2 + `audit_ids.mjs`（全包只有 5 类 uuid，无 chunk id） |
| | UI 高亮靠字符区间还是 chunk id？ | ✅ 字符区间 + 块结构（区间 = passage 范围） | §2.2 / §2.3 |
| | 点引用怎么定位原文？ | ✅ 用 group 自带的 `passageBlocks`（该来源的块结构）渲染，区间直接落在规范文本上 | §2.1 / §2.2 |
| | `[1]` 与来源列表映射在哪？ | ✅ 锚点携带 group 索引列表；序号 = group 的 1-based 出现序 | §2.2 第 3 层 |
| | 多来源重叠怎么合并？ | ✅ **一个锚点挂多个 group，序号并排 `[1, 2]`**；不合并字符区间 | §2.2 + 三来源实验 `captures/09-overlap-raw.json` |
| **P0-2** 摄取/切分 | chunk 大小 / overlap | ✅ ≈900 字（862–930），**零 overlap**，按标题/段落边界切，小尾巴（42/47 字）独立成块 | §3.2 表格 |
| | 每 chunk 一个 embedding 还是整篇一个 | ⚠️ **不可观测**（客户端无向量数据）。只能说"客户端不参与向量" | §8 第 4 行 |
| | 检索 top-k？有无 rerank？ | ✅ **不是 top-k**：agent 循环 + 覆盖率注记；无 rerank 痕迹 | §4 |
| | 进 prompt 的来源 token 预算 | ❌ **未测**（请求里无预算字段，服务端决定） | §8 第 5 行 |
| | 长 PDF 怎么处理 | ❌ **未测**（未接文件上传通道；只拿到 PDF 的来源记录形状） | §8 第 3 行 |
| **P0-6** 来源是否有 audience | 来源级有没有共享/权限概念 | ✅ **没有**：权限是 notebook 级（`JFMDGd`），来源与引用记录都无受众字段 | §6 |
| **P1-9** 来源自动摘要字段 | summary / key topics / 数据层级 | ✅ 一段 Markdown 摘要 + 3 个选题（各配 briefing 提示词模板）+ 权重 9，一次返回 | §5 |
| **P2-10** Note ↔ Source | 保存的笔记是否进语料、如何被引用 | ✅ **不进**；需显式「转换为来源」，转换 = 用 `izAoDd` 重新上传为新来源，**无引用关系** | §6.5 |
| **P2-11** Mind map / Timeline schema | 节点/边结构 | ❌ **未做**（可选，且需先跑生成） | §8 第 8 行 |

**结论：P0 三项里，P0-1 与 P0-6 完整拿到；P0-2 拿到三分之二（切分与检索循环已闭环，embedding 与 token 预算不可观测、长 PDF 未测）。P1-9、P2-10 完整；P2-11 未做。**

对 P1（解析层）来说，缺的三项都**不影响开工**：块引用语义、父子块规则、区间口径已经确定；embedding 与 token 预算本来就不进你的基线（D5）；长 PDF 属于 P5 的边界情况。

---

## 9. 复现路径与证据文件

工具：**REA 的被动浏览器观测拿不到响应体**（playwright 场景 provider 执行失败、CDP 抓不到流式响应），所以链路是"REA 做被动取证 + 自建 CDP 客户端做驱动与抓包"。

| 文件 | 作用 |
|---|---|
| `research/notebooklm/cdp.mjs` | 最小 CDP 客户端（Node 24 原生 WebSocket） |
| `research/notebooklm/run.mjs` | 在页面里执行一个 step 文件（带 DOM 工具前奏） |
| `research/notebooklm/netcap.mjs` | 边跑 step 边抓 Network 请求/响应体 |
| `research/notebooklm/reload_cap.mjs` | 重载并抓 `wXbhsf`（笔记本+来源清单） |
| `research/notebooklm/stream_frames.mjs` | batchexecute 流式帧的括号配平切分 |
| `research/notebooklm/report.mjs` / `passages.mjs` / `chunks.mjs` | 引用组、passage、分块的定量报告 |
| `research/notebooklm/captures/01-paste-source.json` | 上传 RPC + 来源清单 + 摘要 RPC |
| `captures/02-q1-power.json` | 生成请求载荷（问题 + 配置） |
| `captures/03-q2-raw.json` → `inner-c1-k12.json` | **引用模型原始样本**（含块结构全文） |
| `captures/04-q3q4-raw.json` | 单事实 / 无答案两次问答 |
| `captures/06-cross-raw.json` + `cross-strings.json` | **分块与 passage 实测** |
| `captures/07-share.json` | 分享/权限 RPC |
| `captures/08-reload-content.json` | 两个来源的 source 记录对比 |
| `captures/09-overlap-raw.json` | **三来源同事实 → `[1, 2]` 合并模型**（含 group score 0.9/1） |
| `captures/10-save-note.json` / `11-note-to-source.json` | 保存到笔记 / 转换为来源（`izAoDd` 复用） |
| `audit_ids.mjs` / `promotion.mjs` | uuid 台账审计（无 chunk id）、四来源数值槽对比 |

### APK 路线的结论（负结果，记录以免重走）

`base.apk`（`com.google.android.apps.labs.language.tailwind` v1.63.1，10519 类）：

- Java 层几乎没有 tailwind 的业务 proto（`search_android_classes("proto.labs.tailwind")` 只命中 1 个日志用类）；
- 它是 **Flutter add-to-app**（Pigeon 插件：audio_stream / dragdrop / sharereceiver），业务在 Dart 层；
- 但 `base.apk` 里**没有 `lib/<abi>/libapp.so`**，`identify_flutter_build` 判定 `flutter_detected: false` → Dart 载荷在 ABI split 包里，用户只给了 base。
- **→ 引用模型从 web 侧拿全了，APK 路线不必再走**；若要 protobuf 字段号，需要 `split_config.arm64_v8a.apk`。

### 副作用说明

探针笔记本 `26023d85-…` 里留了两个测试来源（`KB探针-文档甲` / `KB探针-长文档乙`），内容全是夹具文本、不含真实数据。不需要就在 UI 里删掉。
