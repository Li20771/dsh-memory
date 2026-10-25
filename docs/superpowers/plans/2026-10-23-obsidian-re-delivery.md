# Obsidian 逆向 —— 交付清单（对应 v2 设计 §10）

> 对象：Obsidian **1.13.7**（`D:\Obsidian\Obsidian.exe`，`obsidian.asar` sha256 `a52a7daf…0599d`）
> 方法：静态（REA 解包 + `app.js` 定位）+ 运行时（隔离实例 CDP 只读探查；两个 fixture 库）
> 深水区细节见 [2026-10-22-obsidian-re-spec.md](<2026-10-22-obsidian-re-spec.md>)
> 复跑：`research\make-fixture.mjs`、`make-10k.mjs`、`probe-cdp{2,3}.mjs`、`probe-10k.mjs`、`probe-graph.mjs`
> 状态：**Obsidian 侧 10 项全部闭合**（v2 §10 的 8 项 + v2.1 §6 新增的删除语义 2 项；NotebookLM 六项按你的指示不在范围内）

---

## 0. 覆盖矩阵

| # | 需求 | 状态 | 一句话结论 |
|---|---|---|---|
| 3 | 链接解析文法 | ✅ | 三种形态 + 大小写不敏感；消歧 = 裸名唯一 → 相对 → 全路径 → 后缀（同目录→短路径） |
| 4 | 块 id 模型 | ✅ | `^[A-Za-z0-9-]+`，行尾+前置空白；**单独一行 `^id` 给上一个块打标**；区间 = 块节点 position |
| ⑤ | `.obsidian/` 分层 | ✅ | 权威依据是官方 Sync 白名单分类器；`workspace.json` 是唯一被显式排除的配置 |
| 7 | 反链索引维护 | ✅ | `fs.watch`+去抖；`{mtime,size,hash}`；IndexedDB `<vault>-cache@19`；10k 冷启 **1416ms** |
| 8 | 搜索算子文法 | ✅ | 完整 token 表；**AND 优先于 OR**；`exclusive`=不可嵌套（非"吞剩余"） |
| 12 | frontmatter 属性类型 | ✅ | `types.json` = 用户指派表；未指派时按样本值 `UF(v)` 推断；日期靠两条正则 |
| 13 | Graph view 边模型 | ✅ | 节点=**文件路径**，边=links+embeds，**含未解析**；canvas 参与；tag 节点受 `showTags` 控制 |
| 14 | Canvas JSON schema | ✅ | 四类节点 `text/file/link/group`；未知类型**静默跳过**；未知字段**原样保留**；边端点缺失即丢 |
| v2.1-7 | 删除语义（新 P0） | ✅ | `trashOption` 默认 `system`；`local` → `<vault>/.trash/名字 2.ext` 去重、**无期限**；断链不消失只变灰（`is-unresolved`）；索引 `onDelete→deletePath` 即时更新 |
| v2.1-8 | 已删但被引用（新 P1） | ✅ | 图里留的是**未解析 ghost 节点**（不是已删文件残留），按原始 linkpath 字符串保留，**大小写不同即两个节点** |

---

## 1. ⑤ `.obsidian/` 分层

### 1.1 权威依据：官方 Sync 白名单分类器

`allowSyncFile(path, isFolder)`（@3625708）就是 Obsidian 自己的"哪些配置算库级数据"判定：

```js
// .obsidian/ 内部
workspace.json / workspace-mobile.json              → 直接排除（机器级）
app.json / types.json                               → "app"
appearance.json                                     → "appearance"
hotkeys.json                                        → "hotkey"
core-plugins.json / core-plugins-migration.json      → "core-plugin"
community-plugins.json                              → "community-plugin"
themes/<name>/theme.css|manifest.json                → "appearance-data"
snippets/<name>.css                                 → "appearance-data"
<单层>.json  (graph.json, bookmarks.json, …)         → "core-plugin-data"
plugins/<id>/{manifest.json,main.js,styles.css,data.json} → "community-plugin-data"
路径段以 "." 开头 或等于 "node_modules"              → 一律排除
allowSpecialFiles = ["app","appearance","appearance-data","hotkey","core-plugin","core-plugin-data"]
allowTypes        = ["image","audio","pdf","video"]
```
`community-plugin(-data)` **不在默认白名单**：官方认为第三方插件数据默认不同步。

### 1.2 运行时实测（10k fixture 库）

| 动作 | 落盘结果 |
|---|---|
| 首次启动（空 `.obsidian`） | `core-plugins.json`(696B) → `app.json`(2B `{}`) → `appearance.json`(2B `{}`) → `workspace.json`(4849B) |
| `setConfig("showLineNumber",true)`+`setConfig("readableLineLength",false)` | **只更新 `app.json`**（59B，内容正是这两项）；`appearance.json` mtime 被触碰、内容仍 `{}` |
| 打开文件（布局变化） | `workspace.json` 1.5s 内**未落盘** → 布局是 debounce 写 |
| 关闭核心插件 | 1.2s 内 `core-plugins.json` 未变 → 写入有延迟/走 UI 路径，不能据此判定"不写" |

真实库旁证（`D:\Obsidian-repository\.obsidian`，仅文件名）：
```
app.json  appearance.json  community-plugins.json  core-plugins.json
graph.json  workspace.json  workspace-mobile.json
plugins/obsidian-local-rest-api/{data.json,main.js,manifest.json,styles.css}
~syncthing~graph.json.tmp  ~syncthing~workspace-mobile.json.tmp
```

### 1.3 可直接执行的 .gitignore / 提交清单

**提交**：`app.json` `types.json` `appearance.json` `hotkeys.json` `core-plugins.json` `core-plugins-migration.json` `graph.json` `bookmarks.json` `snippets/*.css` `themes/<name>/{theme.css,manifest.json}`

**忽略**：`workspace.json` `workspace-mobile.json` `plugins/*/main.js` `plugins/*/data.json` `**/node_modules/` `~syncthing~*` `.stfolder` `.kb-index/`

> `workspace.json` 是唯一被 Obsidian 显式排除同级的配置，也是绝对路径泄漏的主要来源。

---

## 2. ⑦ 反链索引的维护与性能

| 问题 | 答案 | 证据 |
|---|---|---|
| 监听还是扫描 | **监听**：`startWatchPath()` → `fs.watch(path,{persistent:false,encoding:"utf8",recursive})`，`on("change")`→`onFileChange()`，套 `setTimeout` 去抖 | @561916 |
| 变更判定 | `fileCache[path]={mtime,size,hash}`（hash 64-hex 内容摘要） | 运行时 `fileCacheSample` |
| 磁盘缓存 | 不在 `.obsidian/`：IndexedDB `<vault>-cache@19`（stores `file`,`metadata`），另有 `<vault>-backup@1`、`<vault>-sync@1` | `probe-3.json` |
| 反链算法 | `iterateAllRefs()` 全量遍历 `fileCache` → 回调每个 link/embed/frontmatterLink；`getBacklinksForFile(f)` 用 `getFirstLinkpathDest` 反查 | @1739735 |
| 10k 首次索引 | 冷启 **1416 ms**（进程启动→10000 文件 `didFinish`）；CDP 就绪 720ms；热启 1600ms | `probe-10k-cold.json`/`-warm.json` |
| 缓存值不值 | 冷热差异在噪声内 → **持久缓存不省启动时间**（仍要 stat 全库），只省"未变文件的重新解析" | 同上 |

**给 P1**：10k 全量 <2s 现实可达（Obsidian 自己 1.4s）；增量先 `(mtime,size)` 筛、再对候选算哈希。

---

## 3. ⑧ 搜索算子文法

### 3.1 词法（`fP` @1427509）

| token | 触发 | 说明 |
|---|---|---|
| `text` | 默认 | 空格分割；`[` `]` `(` `)` `:` `>` `<` 会切断当前词 |
| `true`/`false`/`empty`/`or` | **仅全大写** `TRUE`/`FALSE`/`EMPTY`/`OR` | 小写 `or` 是普通词 |
| `bracket` | `[` `]` | 属性 `[prop:value]` |
| `parenthesis` | `(` `)` | 算子参数分组 `section:(…)` |
| `colon` | `:` | 算子分隔 |
| `>`/`<` | — | 数值/文本比较算子 |
| `not` | `-` | 独立 token，作用于紧随的一个 matcher |
| `quote` | `"…"` | 短语，`\"` 转义 |
| `regex` | `/…/` | 正则，`\/`、`\\` 转义 |

### 3.2 语法与优先级（`cP`/`uP`/`iP`/`rP`/`sP`/`hP`）

- `cP`：循环 `term = uP()`；遇 `or` token 才把已收集的 AND 链合并进 `rP`（MatchAny）→ **`AND` 优先于 `OR`**，`a b OR c` = `(a AND b) OR c`。
- `iP`=全命中（任一 null 则 null）；`rP`=任一命中；`sP`=排除（内层命中→null）。
- **`exclusive` 的真义（`hP`，已确认）**：不是"吞掉剩余 token"，而是**不许把该算子嵌套进另一个 exclusive 算子**：

```js
if (a.exclusive) for (c of operatorStack) {
  const u = operators[c]
  if (u.exclusive && (!u.allowSelf || c !== o))
    throw new Error(`Operator "${o}" cannot be nested within "${c}"`)
}
```
  → `section:(a section:(b))` 合法（`section` 有 `allowSelf`）；`path:(tag:x)` 抛错。未知算子直接抛 `Operator "x" not recognized`。
- 算子表：`path`(filepath) `file`(filename) `content` `line` `block` `section`(allowSelf) `task` `task-todo` `task-done` `tag` `match-case` `ignore-case` + `[property]` + `>`/`<`。
- `line:` 按行切分逐行匹配；`block:`/`section:` 按块/章范围匹配。

---

## 4. ⑫ frontmatter 属性类型（types.json）

```js
// 三个内置属性有固定 widget
HF = { aliases:{widget:"aliases"}, cssclasses:{widget:"multitext"}, tags:{widget:"tags"} }

// 未指派时的样本值推断
WF = /^\d{4}-[01]\d-[0-3]\d$/                  // date
jF = /^\d{4}-[01]\d-[0-3]\dT[0-2]\d:[0-5]\d$/  // datetime
UF(v):
  null → "text"
  string → jF? "datetime" : WF? "date" : "text"
  number → "number"
  boolean → "checkbox"
  Array  → "multitext"
  其他   → "unknown"
// 已知格式串
zF = ["YYYY-MM-DD"]
qF = ["YYYY-MM-DD[T]HH:mm:ss","YYYY-MM-DD[T]HH:mm","YYYY-MM-DD HH:mm:ss","YYYY-MM-DD HH:mm"]
```

- **`types.json` 是"属性 → 控件类型"的用户指派表**（`metadataTypeManager` 的 `assignedWidgets`），不是自动推断结果；它通过监听 `configDir + "/types.json"` 的 `raw` 事件热加载。
- 未指派时按**样本值**推断（同一属性不同文件值类型不一致时，先到的值决定 widget）。
- `getAllPropertyInfos()` 扫全库 frontmatter 产出 `{propLower: {name, widget, occurrences}}`（含使用频次）——这对我们"属性统计/索引"是现成语义。
- 值本身仍是 YAML 原样（`2026-10-22` 是字符串，不转 Date），类型只影响**呈现控件**，不影响存储。

---

## 5. ⑭ Canvas JSON schema

```jsonc
{ "nodes": [
    { "id":"n1", "type":"text",  "text":"...", "x":0,"y":0,"width":250,"height":60,"zIndex":0,"color":"1" },
    { "id":"n2", "type":"file",  "file":"Note.md", "subpath":"#Heading", "x":300,"y":0,"width":250,"height":60 },
    { "id":"n3", "type":"link",  "url":"https://…", "x":0,"y":200,"width":250,"height":60 },
    { "id":"n4", "type":"group", "label":"…", "background":"bg.png", "x":0,"y":0,"width":400,"height":300 }
  ],
  "edges": [
    { "id":"e1", "fromNode":"n1", "fromSide":"right", "fromEnd":"none",
      "toNode":"n2", "toSide":"left", "toEnd":"arrow", "color":"1", "label":"…" }
  ] }
```

**加载器的容错规则（逐条来自反编译）**：
| 情况 | 行为 |
|---|---|
| 节点 `type` 不属于 `text/file/link/group` | `continue` —— **静默跳过**，不报错、不中断加载 |
| 边端点 `fromNode`/`toNode` 不在节点集合中 | 该边**被忽略**；若它已存在则 `removeEdge` |
| 边缺 `fromSide`/`toSide` | 按两节点几何关系自动推断（内部 `$7(nodeA,nodeB)`） |
| 边缺 `fromEnd`/`toEnd` | 取内部默认 `i9`/`r9`（序列化时若等于默认值则**不写回**） |
| 节点/边含未知字段 | 存进 `unknownData`，`getData()` 时 **spread 原样保留** —— 未知字段不丢 |
| `type:"file"` 的 `file` 指向不存在文件 | 保留节点，链接解析为 unresolved |
| `type:"group"` 且有 `background` | 也算一条文件引用（进图/进搜索） |

引用图与搜索：`text` 节点内容按 markdown 解析（其中的 `[[…]]` 进引用图）；搜索按 `nodes[].type==="text"` 逐节点匹配，命中键 `canvas-<nodeId>`。

---

## 6. ⑬ Graph view 边模型

**运行时实测**（`probe-graph.json`，fixture 库全局图谱）：

```jsonc
nodes: ["Big.md","Blocks.md","CRLF.md","Frontmatter.md","Headings.md","Hub.md",
        "Links.md","Map.canvas","Note.md","中文 笔记.md","a/Index.md","b/Index.md"]
links: [ {"source":"Links.md","target":"Note.md"},
         {"source":"Links.md","target":"a/Index.md"},
         {"source":"Links.md","target":"Does Not Exist"},   // ← 未解析也成边
         {"source":"Map.canvas","target":"Note.md"},        // ← canvas 参与
         {"source":"Hub.md","target":"Blocks.md"}, … ]
```

**结论**：
1. **节点标识 = 文件路径**（`a/Index.md`，不是 basename），所以同名文件是两个节点。
2. **边 = links + embeds**（与 `resolvedLinks` 的计数口径一致），**未解析链接同样成边**（默认 `hideUnresolved:false`）。
3. **`.canvas` 文件参与图**：canvas 内 `type:"file"` 节点成为该 canvas 的出链。
4. **tag 不是默认边/节点**：选项 `a$ = {showAttachments:false, hideUnresolved:false, showOrphans:true, showTags:false, localFile:null, localJumps:1, localInterlinks:false, localForelinks:true, localBacklinks:true}`；`showTags:true` 时才有 `type:"tag"` 节点（内部标记 `c$={tag:true}`），此时 tag 才成为图的一部分。
5. **alias 不成边**，而且**连链接解析都不参与**：实测 `[[N1]]`（`Note.md` 的 alias）→ `null`，进 `unresolvedLinks`；`[[目标笔记]]` 同样。别名只在**渲染显示与链接建议列表**里起作用。节点集合是路径集合，没有 alias 节点。
6. 节点对象形态：`{ x,fx,y,fy, forward:{path→link}, reverse:{}, weight, color, rendered, fadeAlpha, … }` —— 边权重来自链接次数累计（`weight`）。
7. 局部图：`localFile/localJumps/localInterlinks/localForelinks/localBacklinks` 决定邻居扩展深度与方向（`localJumps:1` 默认一跳）。

> 对 v2 的意义：Graph 完全是**派生视图**，零额外存储；我们要的"概念图"可以直接按同一口径从 `resolvedLinks + unresolvedLinks` 生成，不需要另建图库。

---

## 7. 删除语义（v2.1 §6 新增 P0/P1）

### 7.1 回收站策略：`trashOption`（默认 `system`）

`app.json` 里的三档配置，实测默认值是 **`system`**（不是本地 `.trash`）：

| 取值 | 动作 | 落点 | 期限 |
|---|---|---|---|
| `system`（默认） | `vault.trash(f, true)` → Electron `shell.trashItem` | 操作系统回收站 | 由系统决定 |
| `local` | `vault.trash(f, false)` → `trashLocal()` | `<vault>/.trash/` | **无期限，永不自动清理** |
| `none` | `vault.delete(f, true)` 永久删 | — | — |

`trashLocal()` 的重名规则（逐字）：`mkdir .trash` → 目标名 `<basename>.<ext>`，若已存在则 `名字 2.ext`、`名字 3.ext`……；随后 `rename` 移入并 `reconcileInternalFile`。`.trash` 是点目录 → Obsidian 自己不索引它。

配套配置：`promptDelete:true`（删前确认）、`deleteUnlinkedAttachments:"ask"`（是否连带删除孤立附件）。

**另一套独立的"删除兜底"**是核心插件 `file-recovery`：`{intervalMinutes:5, keepDays:7}`，快照存 IndexedDB 的 `backups` store（按 `path` 建索引）。所以"删除后还能不能找回"的答案是**两条路**：回收站（无期限、走文件系统）+ 快照（7 天、每 5 分钟）。

### 7.2 断链怎么表现：不消失，只变灰 + 变成未解析计数

- 删除实测（默认 `system`，1.9s 内）：`getFirstLinkpathDest("Note","Links.md")` → `null`；`resolvedLinks["Links.md"]` 里 `Note.md` 键**被移除**、其余键保留；`unresolvedLinks["Links.md"]` 立即变成 `{Note:9, NOTE:1, "Does Not Exist":1}`。
- **`unresolvedLinks` 的键是原始 linkpath，不做大小写归一** → `[[Note]]` 与 `[[NOTE]]` 算两个条目。
- 渲染：`<a>` 的 `is-unresolved` class 由 `metadataCache.isUnresolved(path, sourcePath)` 实时 `toggleClass`。链接文本**照常显示**、变灰、点击可"创建该文件"——不是消失、也不是占位符。

### 7.3 索引更新链（即时，不等 watcher）

```js
onDelete(f):  uniqueFileLookup.remove(basename.toLowerCase(), f)
              trigger("deleted", f, getFileCache(f))
              deletePath(f.path)
deletePath(p): delete resolvedLinks[p]; delete unresolvedLinks[p]
              saveFileCache(p, null)                  // 从持久缓存里摘掉
              updateRelatedLinks([basename(p)])       // 所有引用该 basename 的文件重新入队解析
              queueFileForLinkResolution(null)
```
兜底：`initialize()` 末尾 60s 一次 + 每 `600000ms`（10 分钟）`cleanupDeletedCache()` 一次。

### 7.4 已删但被引用：留 ghost，且按原始字符串留

运行时实测（删掉 `Note.md` 后打开全局图谱）：节点集合里出现 **`"Note"` 和 `"NOTE"` 两个节点**，而 `Note.md` 节点消失。

→ 图的 ghost **不是"已删文件的残留对象"，而是"未解析链接目标"**：只要还有链接指向它就一直存在，指向它的链接全删掉就自动消失；**且按原始 linkpath 字符串区分大小写**。

### 7.5 对 v2 的四条直接结论

1. **不要复用 Obsidian 的 trash 语义**：我们记忆的"删除"是逻辑状态（`retracted`），必须保留审计与 `supersedes` 链；文件系统回收站没有版本语义，且 `system` 档我们连文件都摸不到。
2. **断链告警必须先归一化**：按原始 linkpath 计数会把 `[[Note]]`/`[[NOTE]]`/`[[note]]` 算成 3 条断链（Obsidian 自己就是这样），我们要 lowercase + `DD/TD` 归一后再聚合。
3. **概念图会出现大小写不同的幽灵节点**：生成 artifacts 图时必须先归一，否则 `Note`/`NOTE` 两个节点画在同一张图上。
4. **"记住删过什么"要自己存**：Obsidian 不提供"删除日志"（`trigger("deleted")` 是内存事件，插件才能听到）。我们的 journal 要做这件事——这正是 v2 里 `status: retracted` + append-only journal 的价值。

---

## 8. 这次逆向对 v2 设计的硬修正（5 条）

1. **块 ID 必须我们自己在写入时生成并落盘**（Obsidian 只在你插入块链接时补）→ P3/P4 必须有 ID 分配器（`blk-<8hex>`）。
2. **单独一行 `^id` = 给上一个块打标**，不进入块区间 → 高亮区间别把它算进去。
3. **`workspace.json` 必须 gitignore**，其余 `.obsidian/*.json` 属库级应提交。
4. **搜索语法照抄**：`空格=AND`、`OR`（大写）、`-`=排除、`"…"`=短语、`/…/`=正则、`key:(…)`=作用域；AND 优先；exclusive 不可嵌套。
5. **属性类型是"指派表 + 样本值推断"**，不是 schema 校验 → 我们不该给 frontmatter 做强类型约束，只做"建议类型"。

---

## 9. 残余说明（不影响任何一期）

| 项 | 说明 |
|---|---|
| graph `weight` 的精确累计口径 | 实测存在该字段（链接次数），未逐字确认是否按 link+embed 合并计数 |
| canvas `link` 节点校验 | `url` 是否必须 http(s)、能否为空，未见显式校验（加载器只看 `type`） |
| `types.json` 非法 widget 名 | 未验证回退行为（推测回落到 `UF()` 推断） |

三项都属于"照抄默认行为即可正确"，不需要再额外取证。**Obsidian 侧已无阻塞项。**

---

## 10. 自检：逐条对回设计文档的子问题（2026-10-23 复核）

复核方式：把 v2 §10 与 v2.1 §6 的**每个子问句**单独取出，逐条对上结论与证据；发现 1 处错误陈述 + 4 个未答细的子问题，已在下表修正/补齐。

### 10.1 逐条对照

| 设计文档原问 | 结论 | 证据 |
|---|---|---|
| 五种链接形态的规则与优先级 | `![[…]]` 先判 `!`；`|` 先切（第一个 `|`）；`#` 再切（第一个 `#`）→ path + subpath | spec §1.1–1.3；`sD`/`wD` |
| 同名文件消歧 | 裸名唯一 → 相对路径 → 全路径精确 → 后缀匹配（同目录组优先 → 短路径优先） | 实测矩阵 6 例 |
| 大小写 | 全链路 lowercase 比较；`[[NOTE]]`→`Note.md` | probe-1 |
| **归一化（补细）** | **反斜杠不归一**：`[[a\Index]]` → `null`；`./a/Index` → `a/Index.md`；`../` 越界 → `null`。路径写入侧有 `Nl()` = `Bl()`(反斜杠→斜杠、折叠、去首尾) + NBSP→空格 + `.normalize("NFC")`，但**链接解析侧只 lowercase，不做 NFC** | probe-alias；`Nl/Bl/Dl` @547121 |
| 块 id 自动生成条件 | 不自动。仅"插入块链接"时由 `aO()` 写回：段落/列表项同行尾 `" ^id"`；其他块 `"\n\n^id"`（原文件非 `\n\n` 时再补 `\n`） | spec §3.4 |
| 什么算一个 block | paragraph / heading / blockquote / table / listItem；代码内不算；**单独一行 `^id` 给上一个块打标** | 实测 10 个 id 的归属表 |
| `#^id` → 字符区间 | `blocks[id.toLowerCase()].position` = 块节点区间（含 `^id` 文本）；列表块按同 `parent` 连续项扩展 | spec §3.5 |
| `.obsidian` 库级 vs 机器级 | 官方 Sync 白名单分类器 + 实测写入路径；`workspace*.json` 属机器级 | §1 |
| 反链：监听 vs 重建 | `fs.watch(recursive)` + 去抖；`{mtime,size,hash}` 判定 | §2 |
| `.obsidian` 缓存结构 | **不在 `.obsidian`**：IndexedDB `<vault>-cache@19`（`file`,`metadata`） | probe-3 |
| 大库首次索引耗时 | 10k md 冷启 **1416ms**；热启 1600ms（缓存不省启动） | probe-10k-* |
| 布尔组合 | 空格=AND（`iP` 全命中），大写 `OR`=`rP` 任一命中，`-`=`sP` 排除；**AND 优先于 OR** | spec §5；`cP/uP/iP/rP/sP` |
| **正则怎么写（补细）** | `/…/` 内**不能带 flag**（字面量被当内容）；匹配期由 `QA(regex, caseSensitive)` 决定是否加 `i`；大小写来源 = `match-case`/`ignore-case` 或搜索框默认；解析期只做 `new RegExp()` 合法性校验，失败抛 `Failed to parse regular expression` | `ZA.match` @1419542 |
| **`section:` 与 `block:` 的区别（补细）** | 都是"作用域内逐段匹配"，区别在**切分单位**：`section:` = 按标题层级切（每个标题起点→下一个同级/更高级标题起点；首标题前的正文单独成段；**无标题文件整篇匹配**）；`block:` = 按**顶层块 + 每个列表项**切（`sections` 里 `type:"list"` 跳过）；`line:` = 按行切 | `SP` @1431987；`CP` @1431267；`kP` |
| frontmatter 类型推断 | `types.json` = 指派表；未指派按样本值 `UF(v)`；日期/datetime 两条正则 | §4 |
| 属性索引方式 | `getAllPropertyInfos()` 扫全库 frontmatter → `{prop: {name, widget, occurrences}}` | @1754586 |
| **aliases 处理（修正）** | **不参与链接解析**（`[[alias]]`→null，进 unresolved）；只用于显示与建议；`frontmatter.aliases` 不强制数组 | probe-alias |
| graph 边：link / embed | 都成边，且**未解析目标也成边** | probe-graph |
| graph 边：tag | 仅 `showTags:true` 时成节点（`type:"tag"`） | 选项表 `a$` |
| graph 边：alias | 不成边、也不成节点 | probe-graph + probe-alias |
| canvas 字段与校验 | 四类节点；未知类型静默跳过；未知字段透传；边端点缺失即丢 | §5 |
| **canvas `link` 节点（补细）** | `type:"link"` 的字段就是 `url`；节点内部创建 Electron `<webview>`（`create-browser-session` + partition），**仅桌面端**，`alwaysKeepLoaded:true` | `G7` @3305877 |
| 删除：进不进回收站、停多久 | `trashOption` 默认 `system`；`local`→`<vault>/.trash/名字 2.ext` 且**无期限**；`file-recovery` 快照 7 天/5 分钟是另一套 | §7.1 |
| 删除：断链怎么表现 | 链接文本保留、`is-unresolved` 变灰、可点击创建；`resolvedLinks` 摘键，`unresolvedLinks` 立增（**按原始字符串，大小写分开计数**） | §7.2 |
| 删除：反链索引怎么更新 | `onDelete → deletePath`：摘 lookup、删 resolved/unresolved、失效缓存、`updateRelatedLinks(basename)` 重解析；另有 60s + 每 10 分钟兜底 | §7.3 |
| 已删但被引用：ghost 还是移除 | 留 **未解析 ghost 节点**，按原始 linkpath 字符串，`Note` 与 `NOTE` 是两个 | §7.4 |

### 10.2 复核结论

- **覆盖**：v2 §10 的 8 项 + v2.1 §6 的 2 项 = **10/10 有结论**；每条都能指到静态位置或运行时 JSON。
- **本次修正**：§6 关于 alias 的说法（原写"aliases 只影响链接解析"）**是错的**，已改为"连解析都不参与"。
- **本次补细**：链接路径归一化（反斜杠不归一）、正则 flag 规则、`section:`/`block:`/`line:` 的切分单位、canvas `link` 节点 = webview。
- **仍未取证（3 条，均不影响实现正确性）**：graph `weight` 精确累计口径、`types.json` 非法 widget 名的回退、`Nl()` 的具体调用点（只知道它存在且做 NFC）。
