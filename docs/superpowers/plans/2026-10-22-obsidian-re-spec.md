# Obsidian 1.13.7 语义规格（REA 逆向结论）

> 目标：给 DSH 记忆插件的 P1 索引器提供**可直接实现**的依据。
> 对象：`D:\Obsidian\Obsidian.exe` 1.13.7 / Electron 43.3.0 / Chrome 150 / `obsidian.asar` sha256 `a52a7daf…059d`
> 方法：静态（REA 解包 + `app.js` 反混淆定位）+ 运行时（隔离实例 CDP 只读探查 `app.metadataCache`）
> 证据：`research/obsidian-1.13.7/app.js`、`research/grep-app-{1..7}.txt`、`research/probe-{1,2,3}.json`、`research/probe-cdp{,2,3}.mjs`（可复跑）

---

## 0. 结论摘要（先看这 8 条）

| # | 结论 | 对 P1 的影响 |
|---|---|---|
| 1 | 链接解析**大小写不敏感**（`[[NOTE]]` → `Note.md`）；文件名消歧 = **同目录优先 → 路径长度短优先**，不是"最近"也不是"先建" | 索引器必须把消歧做成单一函数，反复用 |
| 2 | 块 ID 词法 `^[a-zA-Z0-9-]+$`，**且必须紧贴行尾、前面有空白**；代码块内不算 | 中文/下划线 ID 一律无效 → 我们的 `blk-xxxx` 方案安全 |
| 3 | 可挂块 ID 的节点：paragraph / heading / blockquote / table / listItem（运行时实测）；`#^id` 区间 = 该节点 `position` | `[[note#^blk]]` → 高亮区间可直接用节点区间 |
| 4 | 块 ID 唯一性 **= 单文件**（缓存按文件建、键为小写）；同文件重复 ID 后者覆盖 | 引用必须带文件名；生成器要保证文件内唯一 |
| 5 | **Obsidian 不会自动生成块 ID**：只有在你**插入/接受块链接**时，才把 `^id` 写回源文件（`aO()` 决定插在哪） | "每条论断可溯源"必须**由我们写入时生成 ID**，不能指望 Obsidian |
| 6 | 元数据缓存**不落 `.obsidian/`**，存 **IndexedDB `<vault>-cache@19`（stores: `file`, `metadata`）** | 我们自己做 `.kb-index/` 即可，不与它抢；也无格式可复用 |
| 7 | `cache.links[].link` 保留**原始 linktext（含 `#^id`）**，`displayText` 是 `"Note > ^para-1"`；`resolvedLinks` 只按**路径**判定，子路径无效也算 resolved | 未链接提及/反链统计要按 `link` 拆 path/subpath 后再算 |
| 8 | 搜索算子是**固定表**：`path file content line block section task task-todo task-done tag match-case ignore-case` + `[property]`，部分 `exclusive` | 我们的窄查询器照这张表实现即可，不背 Dataview |

---

## 1. 链接文法（三种解析器，用途不同）

### 1.1 完整匹配形（用于解析整段 linktext，最严格）

```js
sD = /^(!?\[\[)(.*?)(\|(.*))?(]])$/
// 组1: "![[" 或 "[["   → 是否嵌入
// 组2: target（惰性）→ 第一个 "|" 之前
// 组3: "|alias"
// 组4: alias（贪婪）→ 含后续所有 "|"
// 组5: "]]"
```
要点：
- target 里**出现的第一个 `|`** 才是别名分隔符（因为 `(.*?)` 惰性）；别名里可以再含 `|`。
- 同一份代码里还有 Markdown 链接形 `lD=/^(!?\[)(.*?)(]\(\s*)((<[^>]*?>|[^ "]+?)(\s+([^ ]+|"[^"]+"|'[^']+'|\([^']+\)))?)?(\s*\))$/`（`[text](url "title")`）。

### 1.2 内联 tokenizer（渲染/hypermd，边扫边出）

```js
t = /!?\[\[/g                     // 扫描入口
n = /^(!?)\[\[(.+?)]]/            // 匹配（闭合允许只有一个 ] 后再接 ]，见 1.3 注）
if (inner.indexOf("[[") !== -1) return false;   // 嵌套 [[ 直接拒绝
```
- 只允许一层：`[[a[[b]]]]` 不成立。
- 代码上下文（内联 code / 围栏 code / 缩进 code）里**不产出链接**（运行时实测：`Links.md` 的 13 条 links 不含代码里的两条）。

### 1.3 子路径（subpath）切分

```js
bD(s) = s.indexOf("#") < 0 ? s : s.slice(0, idx)             // 只取路径
wD(s) = { path: <第一个 # 之前>, subpath: <第一个 # 起> }    // subpath 含 #
```
- 只按**第一个** `#` 切；`[[Note#H#X]]` 的 subpath = `#H#X`（由 `PD` 再按 `#` 分段走标题层级）。
- 运行时实测缓存：`{link:"Note#^para-1"}`, `{link:"Note#Heading Two"}`, `displayText:"Note > ^para-1"`。

### 1.4 标题/路径归一化（消歧与匹配用，两个不同的函数）

```js
SD = /[!"#$%&()*+,.:;<=>?@^`{|}~\/\[\]\\\r\n]/g      // 宽集合
xD = /([:#|^\\\r\n]|%%|\[\[|]])/g                    // 窄集合
TD(s) = s.replace(SD," ").replace(/\s+/g," ").trim()
DD(s) = s.replace(xD," ").replace(/\s+/g," ").trim()
```
- 标题匹配用 `TD(...).toLowerCase()`（`PD` 里就是它）→ `## With | pipe` 这类标题可被 `[[N#With pipe]]` 匹配到（`|` 被吞成一个空格）。
- 块/章节变更检测用 `DD`（`%%`、`[[ ]]` 视为分隔）。

---

## 2. 文件解析与消歧（`metadataCache.getLinkpathDest`，逐字复述）

```js
Al(p) = 最后一个 "/" 之后的部分（basename）        // 注意：不是 normalizePath
Pl(p) = 最后一个 "/" 之前的部分（父目录）
GF(a,b) = a.path.length - b.path.length            // 越短越前
uniqueFileLookup: Map<lowercase basename, File[]>  // 同名文件 → 数组
```

```
getLinkpathDest(linkpath, sourcePath):
  if linkpath === "" and sourcePath is a file → [thatFile]

  n = linkpath.toLowerCase()
  i = Al(n)                                   # basename
  r = uniqueFileLookup.get(i)  if i 含 "."
  if !r: n = (linkpath + ".md").toLowerCase(); i = Al(n); r = lookup(i)
  if !r: return []
  if i === n and r.length === 1: return [r[0]]        # 裸名唯一命中 → 直接返回

  o = Pl(sourcePath).toLowerCase()                    # 源文件所在目录
  if n 以 "./" 或 "../" 开头:
        解析成相对路径 resolved（支持 ./../ 混用、逐级上跳）
        for f in r: if f.path.toLowerCase() === resolved → return [f]
  if n 以 "/" 开头: n = n.substr(1)
  for f in r: if f.path.toLowerCase() === n → return [f]     # 全路径精确命中
  if linkpath 以 "/" 开头: return []                          # 绝对路径未命中 → 空

  # 后缀匹配兜底
  u = [], h = []
  for f in r:
      v = f.path.toLowerCase()
      if v.endsWith(n):
          v.startsWith(o) ? u.push(f) : h.push(f)             # 同目录组 / 其他组
  u.sort(GF); h.sort(GF)
  return u.concat(h)                                          # 同目录组优先，组内短路径优先
getFirstLinkpathDest(...) = 上面结果 [0] or null
```

### 2.1 实测矩阵（ran-time，`probe-1.json`）

| linkpath | sourcePath | 结果 |
|---|---|---|
| `Index` | `Links.md`（根） | `a/Index.md` |
| `Index` | `a/x.md` | `a/Index.md` |
| `Index` | `b/x.md` | `b/Index.md` |
| `a/Index` | `Links.md` | `a/Index.md` |
| `note` / `NOTE` / `Note.md` | `Links.md` | `Note.md` |
| `中文 笔记` | `Links.md` | `中文 笔记.md` |
| `Does Not Exist` | `Links.md` | `null` |
| `attachments/pixel.png` | `Links.md` | `attachments/pixel.png` |

### 2.2 推论（写进 P1）
- 不需要"最近邻"或"创建时间"这类启发式；**同目录 + 短路径**就是全部规则。
- Windows 是大小写不敏感文件系统，`Note.md` 与 `note.md` 不可能共存；但链接侧仍**按小写比较**，所以 `[[NOTE]]` 必须解析成功——不要做大小写敏感匹配。
- 后缀匹配用 `endsWith`，所以 `[[Index]]` 能吃掉任意深度的 `Index.md`；这解释了"为什么 Obsidian 常常连到你以为不该连的那个同名文件"。

---

## 3. 块 ID 模型（P0 的第 ④ 项，全部实测 + 静态双证）

### 3.1 词法

```js
// 段落级：整行只有一个块 ID
i = /^\^([a-zA-Z0-9\-]+)(?=$|\n$|\n\n)/
// 内联级：必须以空白开头、且到 token 末尾
t = /^\^([a-zA-Z0-9\-]+)$/, 前置条件 prevChar 匹配 /\s/
```
- 字符集：**ASCII 字母、数字、连字符**。`_`、空格、中文、`.` 一律无效（`i18n/zh.txt`：`块 ID 只能包含字母、数字和破折号`）。
- 必须**行尾**：`^mid-1 and text after` 不成立；`^dot-1.` 不成立（`.` 破坏行尾）。
- 必须**前面有空白**：`before^nosep-1` 不成立。
- 代码块/行内代码里不成立。
- 大小写保留在 `id` 字段，但**缓存键小写**：`^UPPER-1` → `blocks["upper-1"].id === "UPPER-1"`。

### 3.2 能挂 ID 的节点（运行时实测，`Blocks.md`）

| 写法 | 归属节点 | `position` 覆盖 |
|---|---|---|
| `paragraph ^para-1` | `paragraph` | 该段落（含 `^id` 文本） |
| `^lone-paragraph-id` 独占一行 | `paragraph` | 该行 17 字符 |
| `> quote\n> line ^quote-1` | `blockquote` | 整个引用块（跨行） |
| 表格下一行 `^table-1` | `table` | 表格 + ID 行 |
| `- item ^li-1` / 嵌套 `^li-2` / `1. item ^ol-1` | `listItem` | 该列表项 |
| `## Heading ^head-1` | `heading` | 该标题行 |

不成立：`^in-code`（围栏）、`^in-indent-code`（缩进码）、`` `code ^inline-code` ``（行内码）。

### 3.3 缓存结构（每文件一份 FileCache）

```js
{
  headings:  [{ heading, level, position }],
  sections:  [{ type, position, id? }],           // 顶层块，带 id 时同时进 blocks
  listItems: [{ position, parent, task?, id? }],  // parent = 父行号（负值表示文档根）
  links:     [{ position, link, original, displayText? }],
  embeds:    [{ position, link, original, displayText? }],
  tags:      [{ tag, position }],                 // 仅正文 #tag，frontmatter 的 tags 不在此
  blocks:    { "<lowercase id>": { position, id } },
  frontmatter, frontmatterPosition, frontmatterLinks,
  referenceLinks, footnotes, footnoteRefs
}
```
- 空数组/空对象会被 **delete**（`Note.md` 的缓存键只有 `headings, sections, frontmatter, frontmatterPosition, frontmatterLinks`）。
- `blocks` 由两轮赋值：先 sections（paragraph/heading/blockquote/table…），再 listItems；**后者可覆盖前者**。
- 同文件重复 ID：`blocks` 键唯一，**后写覆盖**（实测 `dup-1` 落在一个跨两行的合并段落上，`id` 只留一个）。
- 唯一性范围：**单文件**。跨文件可重复，引用必须带文件名。

### 3.4 插入算法（`aO`，Obsidian 自己怎么把 `^id` 写进文件）

```js
aO(editorCtx, id):
  node = 当前块节点; r = node.position.start.offset; o = node.position.end.offset
  isInlineable = (node.type === "paragraph" || node.type === "listItem")
  addition = "^" + id
  if isInlineable:
      addition = " " + addition                      // 段落/列表项：同行尾加 " ^id"
      if node.type === "listItem" and 子节点 > 1:
          if 最后子节点是 "list": o = 倒数第二子节点.position.end.offset   // 跳到嵌套列表之前
  else:
      addition = "\n\n" + addition                   // 其他块：空行后单独一行
      newlines = 2
      if 原文件 o 处不是 "\\n\\n": addition += "\\n"; newlines++
  return { blockStart: r, blockEnd: o, addition, newlines }
```
写回：`content.slice(0, blockEnd) + addition + content.slice(blockEnd)`；编辑同一文件时按"块文本唯一出现"重定位插入点（出现多次则取离原位置最近的一次）。

> **结论 5 的直接后果**：要让每条论断可引用，我们必须在**写入时**自己生成并落盘 `^blk-xxxx`；Obsidian 只在人工插入块链接时才补。

### 3.5 `#^id` → 字符区间（`PD`，即 `resolveSubpath`）

```js
PD(fileCache, subpath):
  segs = subpath.split("#").filter(Boolean)
  if segs.length === 1:
      if seg[0].startsWith("^"):
            id = seg[0].slice(1).toLowerCase()
            block = fileCache.blocks[id]           // 键已小写
            list  = fileCache.listItems 中 id 小写相同的项（用于扩展列表块）
            return { type:"block", block, list, start: block.position.start, end: block.position.end }
      if seg[0].startsWith("[^"):  → 脚注
  # 标题路径（支持 [[N#H1#H2]] 层级）
  walk headings:
      维护当前匹配深度 g 与当前层级 y
      若已有命中 b 且遇到 level <= y 的标题 → 该标题即 next（区段终点）
      按 TD(heading).toLowerCase() 比较
  return b ? { type:"heading", current:b, next:w,
               start: b.position.start, end: w ? w.position.start : null }  # null = 到文末
  否则 null
```
- **块区间 = 节点 position（含 `^id` 文本）**；高亮想要"干净"区间就自己 `end - (" ^"+id).length`。
- **标题区间 = 从标题行到下一个同级/更高级标题行**；`next === null` 表示到文件末尾。
- 列表块内容扩展（`ID()`）：从该 listItem 起，沿 `parent` 相同、行号连续的后继列表项一直延伸；`start = item.position.start.offset - col`。

---

## 4. 元数据缓存的生命周期与持久化（P0 的 ⑤）

`metadataCache` 实例字段（运行时 `Object.keys`）：

```
worker, db, fileCache, metadataCache, uniqueFileLookup, inProgressTaskCount,
workQueue, didFinish, initialized, linkUpdaters, resolvedLinks, unresolvedLinks,
linkResolverQueue, blockCache{cache,app}, userIgnoreFilters…
```
原型方法（相关子集）：
`getCache / getFileCache / getFileInfo / getCachedFiles / getLinks / iterateAllRefs / getBacklinksForFile / fileToLinktext / computeMetadataAsync / saveFileCache / saveMetaCache / cleanupDeletedCache / checkCleanCache / isCacheClean / preload / initialize / clear / rebuild?`

- `fileCache[path] = { mtime, size, hash }`（`hash` 64 hex；`mtime` 毫秒）。**变更检测 = (mtime,size) 触发重算 + 内容哈希记账**——和设计文档 D6 的思路一致，可以照抄。
- 大文件索引实测：`Big.md` 400 个 `^big-N` 全部进 `blocks`。
- `resolvedLinks[srcPath][destPath] = count`（**links + embeds 合并计数**，只按路径判定，subpath 无效也算 resolved：`[[Note#^does-not-exist]]` 计入 `Note.md`）。
- `unresolvedLinks[srcPath][rawLink] = 1`（实测只有 `Does Not Exist`）。
- **持久化位置**：`indexedDB` 里 `<vault名>-cache@19`，object stores = `file`、`metadata`；另有 `<vault>-backup@1`、`<vault>-sync@1`。`.obsidian/` 只有 `app.json / appearance.json / core-plugins.json / workspace.json`（**没有 cache 文件**）。
- 推论：没有可复用的磁盘缓存格式；我们自己维护 `.kb-index/`，首次全量、之后按 (mtime,size) 增量，是唯一正确做法。

---

## 5. 核心搜索算子（P0 的 ⑥）

算子注册表（`DP`，逐字）：

| 算子 | exclusive | allowSelf | 说明 |
|---|---|---|---|
| `match-case` / `ignore-case` | 否 | — | 切换大小写策略 |
| `path` | ✅ | — | 路径子串/正则 |
| `file` | ✅ | — | 文件名 |
| `content` | ✅ | — | 正文（排除 filename） |
| `line` | ✅ | — | `line:(...)`，行内组合 |
| `block` | ✅ | — | `block:(...)`，块内组合 |
| `section` | ✅ | ✅ | `section:(...)`，章内组合 |
| `task` / `task-todo` / `task-done` | ✅ | — | 任务态 |
| `tag` | ✅ | — | 必须是文本参数，否则抛 `Operator "tag" can only be followed by text` |
| `[property]` | — | — | 属性查询（suggester 里 `[]`） |

- 建议器暴露的 token：`path: file: tag: line:() section:() []`；`content: block:` 解析器支持但不在建议列表。
- `canvas` 文件也参与搜索：按 `nodes[].type === "text"` 逐节点匹配，命中键为 `canvas-<nodeId>`。
- 标签词法（内联）：`/(^|\s)#([^\u2000-\u206F\u2E00-\u2E7F'!"#$%&()*+,.:;<=>?@^`{|}~\[\]\\\s]+)/g` → 除上述标点与空白外的连续串，天然支持 `a/b/c` 层级。
- **词法与优先级（已确认，`fP` @1427509 / `cP`+`iP`+`rP`+`sP` @1424662）**：
  token = `text | true | false | empty | or | bracket[ ] | parenthesis( ) | colon: | > | < | not- | quote"…" | regex/…/`；
  关键字**仅大写**（`OR`/`TRUE`/`FALSE`/`EMPTY`），小写视为普通词；`-` 是独立 token，作用于紧随的一个 matcher；
  **`AND`（空格隐式）优先级高于 `OR`**：`a b OR c` = `(a AND b) OR c`；`"…"`=短语（`\"` 转义）、`/…/`=正则（`\/`、`\\` 转义）。
- 唯一未逐字确认：`exclusive:true` 的使用点（推测为"该算子吞掉其后括号/剩余 token"，`section:(…)`/`line:(…)`/`block:(…)` 皆用括号形式）。详见 `2026-10-23-obsidian-re-delivery.md` §3。

---

## 6. Frontmatter / 属性（P0 的 ⑩）

实测（`Frontmatter.md`）：

| YAML | `frontmatter` 值 | 说明 |
|---|---|---|
| `string_prop: hello world` | `"hello world"` | 原样 |
| `number_prop: 42` / `float_prop: 3.14` | `42` / `3.14` | YAML 数字 |
| `bool_prop: true` | `true` | 布尔 |
| `date_prop: 2026-10-22` | `"2026-10-22"` | **不转 Date**，保持字符串 |
| `datetime_prop: …+08:00` | 原字符串 | 同上 |
| `list_prop:` 块列表 / `inline_list: [x,y,z]` | 数组 | 两种写法等价 |
| `nested: {a:1,b:[p,q]}` | 嵌套对象 | 原样 |
| `empty_prop:` | `null` | 空值即 null |
| `aliases: single-alias` | `"single-alias"` | **不强制数组**（消费方自己归一） |
| `tags: nested/tag/deep` | `"nested/tag/deep"` | 同上；且**不进 `cache.tags`** |

- `frontmatterPosition = {start:{line:0,col:0,offset:0}, end:{line:4,col:3,offset:69}}` → 含 `---` 定界符的区间。
- `frontmatterLinks` = YAML 里出现的 `[[...]]`（由 `cD()` 收集）。
- 结论：我们 D2 的 frontmatter 设计与之兼容；但**自己解析时不要做日期强转**，否则和 Obsidian 的 `types.json` 推断不一致。

---

## 7. 对设计文档的修正清单（重要）

| 原假设 | 实测/静态结果 | 动作 |
|---|---|---|
| D3：`[[note#^blk]]` 是支点 | ✅ 成立；区间来自 `blocks[id].position` | 保留 |
| "块 ID 由 Obsidian 自动生成" | ❌ 不会。只在插入块链接时写回（`aO`） | P1 必须自带 ID 分配器 + 写回 |
| 块 ID 可用中文/下划线 | ❌ `[a-zA-Z0-9-]` only | `blk-7f3a91c2` 方案正确，别改 |
| 块 ID 全库唯一 | ❌ 单文件唯一，键小写 | 引用一律 `[[file#^id]]` |
| 同名文件"路径最近" | ⚠️ 实际是"同目录优先 → 短路径优先" | 消歧函数照 §2 实现 |
| 大小写敏感 | ❌ 全链路小写比较 | 别做大小写敏感匹配 |
| `.obsidian/cache` 可复用 | ❌ 1.13 存 IndexedDB | 自建 `.kb-index/`，不碰它 |
| 链接缓存存"解析后路径" | ⚠️ `links[].link` 存**原始 linktext**（含 `#^id`），`displayText` 才是 `Note > ^para-1` | 反链/未链接提及要自己拆 path/subpath |
| 未链接提及需专门算法 | 未找到专用实现；Obsidian 用的是"反向：所有 link 的 target 字段 vs 全文单词"模式（`getLinkSuggestions`/`uniqueFileLookup` 支撑） | P1 自己实现；按 §1.4 的 `TD` 归一后比对 |

---

## 8. 未验证项（下一轮再补，不阻塞 P1）

1. 搜索布尔优先级与 `exclusive` 精确语义（§5 末）。
2. 块 ID 与 `%%` 注释、callout（`> [!note]`）、引用块内多段时的归属细节（实测 blockquote 整体归一个 ID）。
3. `.canvas` 的完整 schema（已确认 `nodes[{id,type,text|file,x,y,width,height}] + edges[{id,fromNode,fromSide,toNode,toSide}]` 能被 canvas 插件接受；节点/边校验规则未逆）。
4. Graph view 的边集合定义（`resolvedLinks` + `unresolvedLinks` 是强候选，未证明 tag/alias 也成边）。
5. `types.json` 属性类型推断规则。

---

## 9. 复跑方式

```powershell
# 静态：解包（已产出 research\obsidian-1.13.7\）
node research\make-fixture.mjs                 # 重建 fixture vault
# 运行时：隔离实例 + CDP 只读探查
$ud="$env:TEMP\obs-re-userdata"; # 写入 obsidian.json 指向 fixture vault
Start-Process D:\Obsidian\Obsidian.exe "--user-data-dir=$ud","--remote-debugging-port=9333"
node research\probe-cdp.mjs ; node research\probe-cdp2.mjs ; node research\probe-cdp3.mjs
# 干净收尾
Get-Process Obsidian | Stop-Process -Force ; Remove-Item $ud -Recurse -Force
```
