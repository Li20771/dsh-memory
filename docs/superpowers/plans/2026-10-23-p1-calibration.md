# P1 校准记录：逆向结果 → 代码改动

> 日期：2026-10-23　｜　输入：`docs/superpowers/plans/2026-10-23-obsidian-re-delivery.md`、`docs/reverse/2026-10-23-notebooklm-re-report.md`
> 结果：**29/29 测试通过**（原 19 → 校准后 29）

---

## 1. Obsidian：推翻我原实现的 6 条

| # | 我原来的实现 | 实测语义 | 改动 |
|---|---|---|---|
| 1 | `normalizeTarget` 把 `\` 换成 `/` | **反斜杠不归一**，`[[a\Index]]` → 未解析 | 删掉该归一化。原来会把 Obsidian 解析不了的链接"修好"，属于静默错解 |
| 2 | 消歧只有「精确路径 → 裸名唯一」两档 | **四档**：裸名唯一 → 相对路径 → 全路径精确 → 后缀匹配（**同目录组优先 → 短路径优先**） | `resolveTarget` 重写，新增 `bySuffix` 查找与 `fromPath` 参数 |
| 3 | 单独一行 `^id` 只标记**它自己那一行** | 单独一行 `^id` **给上一个块打标**，且 `^id` 行**不进块区间** | 块提取重写：先回溯到上一个非空行再展开 |
| 4 | 块只有 `paragraph` / `list-item` | **五种**：paragraph / heading / blockquote / table / list-item | 新增 `expand()` 按行首特征分派 |
| 5 | 块 id 精确匹配 | 块 id **大小写不敏感**（`blocks[id.toLowerCase()]`） | 提取时小写化，`resolveAnchor` 比较时小写化 |
| 6 | 搜索：只有 `tag:/path:/file:/section:/block:` + 短语 + `-` | 完整文法：**AND 优先于 OR**、`OR` 仅大写、`/regex/`（无 flag）、`[prop:value]`、`prop>v`、`match-case`/`ignore-case`、`key:(...)` 分组、`exclusive` 不可嵌套 | `query.js` 整体重写为「词法器 + 递归下降解析器 + 布尔求值器」；排序仍走 IDF/recency/salience，与匹配解耦 |

**确认无需改动的两条**（原来就对了）：`aliases` 不参与链接解析；路径/链接全链路小写比较。

**本轮新抓到的两个我自己的 bug**（由测试暴露）：
- `match-case` 是**无冒号的裸词算子**，词法器原本把它当普通检索词 → 查询变成"正文里得有 `match-case` 这个词"，永不命中。
- 词元回退路径里 `tokenize()` 内部强制小写，导致 `match-case cpa` 从后门匹配到 `CPA`，把标志位抹平了。已改为：大小写敏感时不做词元回退。

## 2. NotebookLM：新增一层（原设计没有）

**`plugin/lib/vault/canonical.js`（新文件）**

报告 §7.2 的硬提醒：*"必须新增一层规范化文本。索引存规范偏移，渲染时再映射回原文件位置。这一层不做，P5 的高亮一定会偏。"*

实现按实测规则展平：标题去 `#`、围栏标记删掉、行内反引号删掉、`**`/`__` 删掉、**任意换行run → 单个空格**；并保留 `map[i] = 原文字符索引`，`toOriginal()` 把规范区间映回原文。

配套 `segmentPassages()`：目标 ~900 字、按句/空格边界切、**零重叠**、**短尾巴独立成块**（实测 47/42 字的尾块都独立成块）。

## 3. 对 P5 引用的三条设计修正

1. **块 id 的粒度应对齐 passage（~900 字），不是"作者随手放 `^id` 的地方"**。NotebookLM 的引用精度上限就是 passage：单事实查询返回的是整篇 `[0,612]`，跨章查询返回 888/916 字的单 passage。要做到句子级定位，必须在 passage 内再做一层句子索引 —— **那是我们比它多做的事，没有参考实现可抄**。
2. **引用要钉"双 id"**：`sourceId` + `revision`。我们的 `[[note#^blk]]` 同样要带内容哈希，否则笔记被编辑后旧引用会静默指错。
3. **序号 `[1]` 是渲染层概念，不能当外键**。一个锚点可挂多个 group 并排成 `[1, 2]`；存的是 group 列表，序号渲染时生成。

## 4. 两条会影响 P2/P3 的观测

- **检索该做成 agent 循环 + 覆盖率注记**，不是固定 top-k。NotebookLM 用 `retrieval_status`（"100% of the sources are included… Do not semantic search again"）回灌"还剩多少没看"，让模型决定要不要再搜。→ 我们 L3/L4 的召回应照这个形状，而不是一次性塞满预算。
- **"没有答案"也会有引用**。实测问库里没有的内容，描述性句子仍挂了 `[1]`。→ 不能用"引用为空"判断幻觉，只能判断"引用指向的段落是否真的支持该断言"。

## 5. 性能：Obsidian 给了参照系

实测 Obsidian 10k md 冷启 **1416ms**。我 2000 文件 798ms → 外推 10k ≈ 4s，**慢约 3 倍**。所以"10k <2s"是现实可达的，不是幻想。
修法不变：**touch 驱动增量**（P2 必做）。Obsidian 自己也是 `fs.watch` + 去抖 + `{mtime,size,hash}`，与我的两段式一致；差别在它用 IndexedDB 持久缓存，我目前每次进程启动全量重解析。

## 6. 明确不做（诚实标注）

| 项 | 理由 |
|---|---|
| `task:` / `task-todo` / `task-done` 算子 | 需要一套任务模型（开闭状态、到期日），本层没有；写个错的比留白更糟。代码里已注明 |
| embedding / 向量检索 | 设计 D5 已排除，且 NotebookLM 侧**客户端不可观测**（抓包里无向量数据），没有可抄的实现 |
| 长 PDF 分页切块 | NotebookLM 报告 §8 未测；属 P5 边界情况，且我们不处理 PDF |
| 10k 全量重建压到 <2s | 属 P2 的 touch 驱动改造，不在 P1 范围 |

## 7. 复跑

```powershell
cd 'D:\DSH记忆'
node --test tools/vault.test.mjs     # 29 pass / 0 fail
node tools/vault-bench.mjs 2000      # 规模基准
```
