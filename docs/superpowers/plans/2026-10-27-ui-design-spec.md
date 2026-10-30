# 记忆 UI 设计规格（dsh-memory UI Design Spec）

> 日期：2026-10-27　｜　上游：`docs/superpowers/plans/2026-10-27-ui-handoff.md`（事实）+ `docs/superpowers/plans/2026-10-24-ui-memory-panel-spec.md`（意图）
> 本文是**设计决策 + 规格**，不是实现。接口实现细节的冻结真源是 `.superpowers/sdd/2026-10-27-ui-handoff/build-contract.md`。
> 交付边界：两个界面 —— ① 顶栏「记忆」按钮 + 面板；② 知识库只读页。**面板只读 + L3 两个动作；知识库页纯只读。**

---

## 1. 目标判定（先回答交接文档 §4 的歧义）

交接文档把「应用/编辑 在哪一层」列为开工前必须判定的歧义，证据是矛盾的。实测结论如下。

### 1.1 结论

**它们是 DOM，但不是 slot。** 载体是桌面 **preload** 往 `document.body` 挂的一枚 `div[data-windows-menu]`，内部是 **open shadow root**：

```
div[data-windows-menu]                  ← preload 创建，挂到 body
└── #shadow-root (mode: "open")
    ├── <style>  :host { position: fixed; top: 0;
    │                    left: var(--dsh-windows-menu-start, 48px);
    │                    z-index: 1100;
    │                    height: var(--dsh-windows-titlebar-height);
    │                    display: flex; align-items: center;
    │                    -webkit-app-region: no-drag }
    └── div[role=menubar]
        ├── button[role=menuitem] "应用"   → IPC dsh-desktop:windows-menu("application", x, y)
        └── button[role=menuitem] "编辑"   → IPC dsh-desktop:windows-menu("edit", x, y)
```

### 1.2 证据

| 事实 | 出处 |
|---|---|
| menubar 由 preload 创建并挂 body、含两枚按钮、点击走 IPC 弹**原生**菜单 | `resources/app/lib/preload-app.cjs:454`（`installWindowsMenu`），按钮文案 `:556-557`（`messages.application` / `messages.edit`），IPC `:515` |
| 定位链：`left: var(--dsh-windows-menu-start, 48px)`、`z-index: 1100`、`height: var(--dsh-windows-titlebar-height)` | 同上 `:460-462` |
| 侧栏收起时该变量被改成 `84px` | `...\@deepseek-ai\dsh-client-ui-sidebar\lib\client.js:91`（`html[data-windows-titlebar]:has([data-sidebar-collapsed=true]){--dsh-windows-menu-start:84px}`） |
| Windows 标题栏高度写死 `40px`，且 `html[data-windows-titlebar]` 由 preload 设置 | `preload-app.cjs:578` |
| menubar 只在页面出现 `[data-shell-overlay]` 后才挂载 | `preload-app.cjs:543` |
| win32 下 `Menu.setApplicationMenu(devToolsItems)`（原生菜单栏被换成不可见的 devTools 项） | `resources/app/lib/main.js:12845` |
| web 侧 i18n 里**没有**「应用」，中文来自 preload 的 `messages` | `preload-app.cjs:298`/`:317`；web i18n 无该串（交接文档已核） |
| `shell.leading` 是 `single` 型且已被官方占用 | `...\@deepseek-ai\dsh-client-ui-sidebar\lib\client.js:522`（注册 `HeaderLeadingControls`）；槽位文档 `...\dsh-cordis-client-runner\lib\client.js:5404`（`kind: "single"`，`replaceRisk: shadows-shipped-ui`） |

### 1.3 推论

1. 这条 menubar **不是槽位**，web 插件无法"注册"进它 → 交接文档 §3.3 的注册手法在这里用不上。
2. 但它是 **open** shadow root ⇒ 可以**读**它的 `getBoundingClientRect()`，因此可以**测量后贴位**：在 `shell.overlay` 里放一枚自己的 fixed 按钮，贴到「编辑」右边界之右。
3. macOS / 纯 web 没有这条 menubar ⇒ 必须有降级链（§2.3）。

---

## 2. 落位决策

### 2.1 候选与取舍

| 方案 | 位置符合度 | 顶替风险 | 成本/脆弱点 | 结论 |
|---|---|---|---|---|
| **A. `shell.overlay` 测量贴位到「编辑」右侧** | ★★★ 完全符合需求原文 | 无（list 型、自己的 id） | 依赖测量 preload 的 open shadow root；DSH 若改 closed 则需降级 | **采用** |
| B. `shell.leading` | ★★★ 视觉同区 | **高**：`single` 型，注册即顶掉官方 `HeaderLeadingControls`（New Session / 开侧栏） | — | **禁用** |
| C. `settings.trigger` 旁 | ★ 不在顶栏 | 无 | 语义通顺但位置不符 | 备选（本轮不做） |
| D. `conversation.header.leading` | ★ 每个会话可见，仍不在顶栏 | `single` 型 | 位置不符 | 备选（本轮不做） |
| E. `tool.call.toolview` | ★ 没有面板 | 无 | 与"面板"需求形态不符 | 备选（本轮不做） |

### 2.2 选择 A 的代价（要能事后解释）

- **依赖别人的私有结构**：测 preload 的 shadow root 宽度。DSH 升级若改成 `closed` 或改结构，按钮会掉到降级位。缓解：三级降级 + 启动后重测（`ResizeObserver`）。
- **z 序（已按实测勘误）**：`shell.overlay` 那一层是 `z-index:20` 的**独立层叠上下文**（`dsh-client-ui-layout` 的 `.BynINW_overlayLayer{z-index:20;position:absolute;inset:0}`），preload 的 menubar 是根上下文里的 `1100`。**所以在重叠区我们的按钮画在 menubar 之下**——写 `z-index:1101` 跨不出那个层叠上下文，属于我最初设计时的错误假设（"1101>1100 所以压得住"）。正确对策不是抢 z 序，而是**让两者永不重叠**：跟随侧栏折叠等布局属性翻转按帧重测（见 §12）。
- **命中区域**：`shell.overlay` 是全窗浮层且点击穿透 → 只有按钮自身 `pointer-events: auto`，其余父层保持穿透，绝不吞掉宿主界面的点击。
- **拖拽**：Windows 标题栏行是窗口拖拽几何，按钮必须 `-webkit-app-region: no-drag`，否则既拖不动窗口也点不动按钮。

### 2.3 三级降级链（必须全部实现且可观测）

| 级别 | 触发条件 | 落位规则 | 自证方式 |
|---|---|---|---|
| P0 | `document.querySelector('[data-windows-menu]')?.shadowRoot?.querySelector('[role=menubar]')` 可读 | `position: fixed; top: <menubar 垂直中心 - 14px>; left: <menubar.right + 8px>` | DOM 断言：按钮 `getBoundingClientRect().left === menubar.right + 8 ± 1` |
| P1 | 有 `[data-windows-menu]` 但读不到 shadowRoot | `left: calc(var(--dsh-windows-menu-start, 48px) + var(--dsh-memory-menu-width, 96px))`，`top: calc((var(--dsh-windows-titlebar-height, 40px) - 28px) / 2)` | 断言 CSS 变量被引用 |
| P2 | 完全没有该元素（macOS / 纯 web） | `top: max(var(--dsh-frame-overlay-top, 20px), 12px)`；`left: max(var(--dsh-frame-leading-clearance, 0px), 12px)` | 断言变量被引用 |

`ResizeObserver` 监听 menubar（宽度随语言变化），`MutationObserver` 监听其文本变化 → 重测。按钮挂载等 `[data-shell-overlay]` 出现（preload 也等它），避免测到 0。

---

## 3. 界面 A：「记忆」按钮 + 面板

### 3.1 按钮

| 项 | 规格 |
|---|---|
| 文案 | 「记忆」（en：Memory）；`label` 传 thunk，跟随语言切换 |
| 形态 | 与 menubar 按钮同构：高 28px、左右内边距 10px、圆角 6px、字号 14px、字重 inherit |
| 常态 | 前景 `--dsw-alias-label-secondary`、背景透明 |
| hover / 展开 | 前景 `--dsw-alias-label-primary`、背景 `--dsw-alias-interactive-bg-hover` |
| 焦点 | `outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: -2px`（指针模态下透明，跟随平台 `html[data-input-modality='pointer']` 规则） |
| 语义 | `aria-haspopup="dialog"`、`aria-expanded` 跟随面板开合、`aria-controls` 指向面板 id |
| 状态点（可选） | 当 `l3.byState.expired > 0` 时按钮右上角一枚 6px 点，色 `--dsw-alias-state-warn-primary`，`title` 说明"N 条工作流已过遗忘阈值" |

### 3.2 面板骨架

| 项 | 规格 |
|---|---|
| 尺寸 | 宽 `min(720px, 100vw - 32px)`，高 `min(560px, 100vh - 96px)`（与「设置」面板同尺寸口径） |
| 定位 | 锚在按钮左下：`left` 与按钮对齐（不足则夹到视口内边距 16px），`top = 按钮底 + 8px` |
| 层级 | `z-index: 1102`（在按钮之上，避免与 menubar 1100 打架） |
| 材质 | 沿用输入框同款材质 = `background: var(--dsw-alias-bg-base)` + `backdrop-filter` 取平台既有层级；拿不到就用 `--dsw-alias-bg-base` 不透明 |
| 边框/圆角 | `border: .5px solid var(--dsw-alias-border-l2)`；圆角取平台 md 半径变量 |
| 结构 | header（标题「记忆」+ 作用域徽标 + 关闭按钮）→ 可滚动 body（四段）→ footer（可诊断行 + 「进入知识库」） |
| 动效 | 跟随 `--ds-transition-duration-slow` / `--ds-ease-in-out`；`prefers-reduced-motion: reduce` 时取消 |
| 关闭 | 按钮再点、`Esc`、点面板外（仅当焦点不在面板内）、关闭按钮；关闭后焦点回到按钮 |

### 3.3 四段信息架构（顺序固定）

| 段 | 内容 | 数据来源（契约 §3.1） | 只读性 |
|---|---|---|---|
| **L1 定位** | 标题 + 更新时间 + markdown-lite 正文，默认展开 | `layers.l1.{title,updated,body,revision,present}` | 只读 |
| **L2 工作区地图** | 同 L1，默认展开 | `layers.l2.*` | 只读 |
| **L4 工作区记忆** | 同 L1，默认**折叠**（量大）；`present:false` 或本段开关关时显示显式空态 | `layers.l4.*` + `workspace.enabled` | 只读 |
| **L3 工作流** | 列表：每条 = 状态徽标 + 路径标题 + `score` + `N 天未用 / 召回 M 次` + 两枚动作 | `l3.items[]`、`l3.byState`、`l3.halfLifeDays` | 动作：pin/unpin/forget |
| **知识库（footer）** | 一枚「进入」按钮 + 笔记数/断链数摘要 | `knowledge.notes`、`knowledge.linkHealth`、`knowledge.entryUrl` | 只读；`window.open(entryUrl,'_blank','noopener')` |

每段标题右侧给**来源路径**的小字（如 `positioning.md`、`workflows/l3-panel-design.md`），让"这条记忆从哪来"当场可查。

### 3.4 L3 行规格

```
[徽标] workflows/xxx.md                                    score 0.412
       📌 永久保留 | decaying 衰减中 | 7 天未用 | 召回 2 次
                                          [永久保留] [彻底删除]
```

| 元素 | 规格 |
|---|---|
| 状态徽标 | `pinned` → 📌 + `--dsw-alias-state-success-primary`；`active` → `--dsw-alias-state-success-primary` 弱化；`decaying` → `--dsw-alias-state-warn-primary`；`expired` → `--dsw-alias-state-error-primary` |
| 排序 | host 已按 `score` 升序（最该忘的在最前），UI **不重排** |
| 「永久保留」 | `pinned:false` 时显示，调 `pin`；`pinned:true` 时显示为「取消保留」调 `unpin`（可逆，需求未禁，属于同一动作的反向） |
| 「彻底删除」 | 常显；`pinned:true` 时置灰 + 说明「已固定（永久保留）。先取消保留再删除」；`expired` 行**高亮**该按钮（它正是衰减要淘汰的） |
| 二次确认 | 删除必须二次确认，文案含：即将删除的路径、当前 `state`/`score`/召回次数、**「内容会移入 .trash/（可捞回），并留下墓碑。残余：git 历史里仍可找回旧版本。」** |
| 角色门 | `workspace.role !== 'coordinator'` 时两枚动作**置灰**，`title`/悬停说明「只有协调会话可以固定/遗忘工作流（当前角色：worker，协调会话白名单：[…]）」 |
| 拒绝回显 | host 若回 `refused`，**原样**贴在行下方（红框），不改写文案 —— 工具与界面必须说同一句话 |

### 3.5 状态机

| 状态 | 触发 | 呈现 |
|---|---|---|
| `loading` | 首次 `fetch(overview)` 未回 | 骨架块（四段占位 + 文案「正在读取记忆…」），不空转 spinner |
| `ready` | 200 且 `ok:true` | 正常四段 |
| `partial` | 200 但某段 `present:false` | 该段显式空态：「这条记忆还没有内容」+ 该段的写入方式提示（不给按钮，只给一句话） |
| `error` | 网络失败 / 非 200 / `ok:false` | 顶部一条错误条：文案 + 「重试」按钮 + host 返回的 `error` 原文 |
| `refused` | 动作返回 `refused` | 行内拒绝条（见上），面板其余部分保持可用 |
| `roleGated` | `role === 'worker'` | 按钮置灰 + 一行说明（不是错误，是权限事实）+ 白名单可见 |
| `contextUnknown` | 未取到 cwd/session | 顶部一行灰字：「未能确定当前会话目录，已按 Host 默认目录解析」+ 显示 host 回的 `workspace.root/id` 供对账 |

### 3.6 诊断行（footer 左）

取 `diagnose.lines` 的前若干条（`cwd` / 工作区根 / 作用域 / 角色 / L4 开关 / 刷新 / 段状态 / 收割覆盖 / 引用审计 / 可迁移性 / 语义扩展 / 链接健康），折叠在「为什么看到这些？」里。理由：记忆系统最容易的失败模式是**静默少召回**，界面必须把"作用域/开关/角色"摆在明面上。

### 3.7 交互与可访问性

| 规则 | 规格 |
|---|---|
| 键盘 | 按钮 `Tab` 可达、`Enter`/`Space` 开合、`Esc` 关闭；面板内 `Tab` 循环（焦点陷阱），关闭后焦点回按钮 |
| 焦点 | 打开时焦点落到面板 header 的关闭按钮（不用自动聚焦可输入元素，面板本来没有输入框） |
| 屏幕阅读器 | 面板 `role="dialog"` + `aria-modal="false"`（它是浮层面板不是模态）+ `aria-labelledby` 指 header 标题 |
| 指针 | 默认光标（不是 pointer）：与 menubar 按钮一致，符合桌面 caption 惯例 |
| 穿透 | 面板与按钮之外的浮层区域 `pointer-events: none` |
| 主题 | 只引用平台 CSS 变量；深色/浅色/跟随系统都不需要额外分支 |
| 降级 | 窄窗口（<768px）面板占满可用宽度，四段照常纵向排列 |

---

## 4. 界面 B：知识库只读页

### 4.1 形态

单页、零依赖、零构建、离线可开；由 host 路由 `GET /dsh-memory/kb/` 直出 `plugin/ui/kb/index.html` 字节，页内只相对引用 `app.css` / `app.js`。**不许任何 CDN/http 外链**（本机离线时也要能开）。

### 4.2 三栏布局（Obsidian 参考）

```
┌───────────────┬───────────────────────────────────┬──────────────────────┐
│ 左栏 264px    │ 中栏 自适应                        │ 右栏 320px            │
│ · 搜索框      │ 笔记标题                          │ · 反向链接 (N)        │
│ · 标签云      │ 元信息条：type/scope/updated/rev   │   每条：来源 + 原文片段│
│ · 笔记树      │ ──────────────────────────────    │ · 出链 (N)            │
│   （按 scope  │ 正文（markdown-lite）              │   未解析的显式标红     │
│    分组，       │ 每行带行号锚点                     │ · 标签 (N)            │
│    层级可折叠） │ 引用处内嵌五态徽标                 │ · 引用审计            │
└───────────────┴───────────────────────────────────┴──────────────────────┘
```

| 栏 | 内容 | 数据来源（契约 §3.3） |
|---|---|---|
| 左 | 笔记树（scope 分组 → type 分组）、标签云（带计数）、搜索框 | `api/tree`（`notes`/`tags`/`scopes`/`layers`） |
| 中 | 标题、元信息条、正文（行号锚点）、引用徽标、块锚点 `^id` 可点 | `api/note`（`body`/`lines`/`blocks`/`citations`/`revision`） |
| 右 | 反向链接 / 出链 / 标签 / 引用审计 | `api/note`（`backlinks`/`outlinks`/`tags`/`frontmatter`） |

顶部一条面包屑/浅色来源指示：`vault: <root>` + 当前笔记路径（可复制）。**只显示相对路径**，不把绝对路径当卖点（可迁移性是本项目的硬约束）。

### 4.3 引用五态徽标（本页的核心差异点）

状态来自 `resolveCitation()`（`plugin/lib/vault/cite.js:80`），**实际是五态**（交接文档写的"四态"少算了 `unknown`；`unknown` 是"无法判定"，与"不存在"语义不同，**不许折叠进 `missing`**）。

| 状态 | 语义 | 文案 | 颜色语义 token | 悬停解释 | 点击行为 |
|---|---|---|---|---|---|
| `ok` | 笔记在、修订号一致、块/区间仍在 | 有效 | `--dsw-alias-state-success-primary` | 「修订 `<rev>` 一致，区间仍存在」 | 跳目标笔记并高亮区间 |
| `stale` | 笔记在，但**修订号变了**（区间可能已不是原意） | 已过期 | `--dsw-alias-state-warn-primary` | 「笔记已被改写（现 `<rev>`，引用时 `<rev>`）」 | 跳目标笔记，高亮**现存**区间 + 顶部提示"内容已变，请复核" |
| `missing` | 笔记不存在 | 缺失 | `--dsw-alias-state-error-primary` | 「目标笔记已删除或从未存在」 | 跳到树中该路径的 missing 态占位（可看墓碑提示） |
| `moved` | 笔记未变，但**被引块 id 已不在原位** | 已移动 | `--dsw-alias-state-idle-primary` | 「笔记未变，但 `^<block>` 已不在原处」 | 跳目标笔记，正文顶部提示定位失败 + 显示块的最后已知行号 |
| `unknown` | 无法判定（缺修订号/结构不可解析） | 未判定 | `--dsw-alias-label-tertiary` | 原样显示 host 的 `reason` | 仅展开解释，不跳转 |

统一形态：16px 高的小胶囊，等宽字状态图标 + 文案；深浅色只靠 token；悬停出 `title` + 自定义 tooltip（含 `reason` 原文与 `spec` 字面量，便于直接粘到 issue/笔记里）。右栏「引用审计」按状态分组计数，并把 `stale`/`moved` 排在最前（它们才是需要人复核的）。

### 4.4 引用定位（NotebookLM 参考）

- 中栏正文**每行可锚定**（行号常显、可点、复制 `#Lnn`）。
- 点击徽标 → 目标笔记打开 → 滚动到区间首行 → **高亮区间**（`range.start/end` 优先；只有 `sentenceLines` 时用行号高亮）+ 一条「从哪里跳来的」回跳条（点回原笔记的对应行）。
- 搜索（`api/search`）命中同样用句子级区间高亮，并在结果行显示 `sentenceLines` 行号与 `score`。

### 4.5 状态与边界

| 状态 | 呈现 |
|---|---|
| 笔记不存在（404） | 中栏显式 missing 态：「这篇笔记不存在（可能已删除或已收割销毁）」+ 右栏照常显示空的反链，**绝不**渲染成"空笔记" |
| vault 为空 | 三栏骨架 + 一句「记忆库还是空的」+ 指向面板的说明 |
| 链接不可解析 | 出链里显式标红 + 文案「未解析」，并给 `raw` 原文 |
| 加载中 | 骨架行，不闪空白 |
| 错误 | 顶部错误条 + 重试 |

---

## 5. 组件清单

| 组件 | 归属 | props | 内部状态 |
|---|---|---|---|
| `MemoryButton` | client | —（自取按钮定位上下文） | 定位级别 P0/P1/P2、面板开合 |
| `MemoryPanel` | client | `overview`（契约 §3.1 响应）、`onAction`、`context`（cwd/session 或 null） | 折叠状态（每段）、`pending` 动作集合、`error`、`refusedByPath` |
| `LayerSection` | client | `title`、`path`、`updated`、`body`、`present`、`defaultOpen` | 展开/折叠 |
| `WorkflowRow` | client | `item`（`l3.items[i]`）、`role`、`coordinators`、`onPin`、`onForget` | 行内确认态、`pending`、`refused` |
| `ConfirmPopover` | client | `title`、`body`、`confirmLabel`、`onConfirm` | — |
| `DiagnoseDisclosure` | client | `lines` | 展开/折叠 |
| `MarkdownLite` | client | `text`、`onBlockRef?(id)` | — |
| `KbShell` | kb-page | `tree`（`api/tree`） | 当前笔记路径、左右栏滚动位置 |
| `NoteTree` / `TagCloud` / `SearchPanel` | kb-page | 树/标签/搜索输入 | 过滤词、折叠集合 |
| `NoteView` | kb-page | `note`（`api/note`）、`highlightRange` | 高亮区间、回跳来源 |
| `CitationBadge` | kb-page | `status`、`reason`、`spec`、`revision`、`targetLine`、`onJump` | tooltip 开合 |

---

## 6. 样式变量清单（只列平台真实存在的变量；实现不得硬编码色值）

| 用途 | 变量 |
|---|---|
| 面板底色 / 侧栏底 | `--dsw-alias-bg-base`、`--dsw-specific-sidebar-fill` |
| 文本三级 | `--dsw-alias-label-primary`、`--dsw-alias-label-secondary`、`--dsw-alias-label-tertiary` |
| 交互 | `--dsw-alias-interactive-bg-hover` |
| 边框三档 | `--dsw-alias-border-l1`、`--dsw-alias-border-l2`、`--dsw-alias-border-l3` |
| 状态色（五态徽标唯一来源） | `--dsw-alias-state-success-primary`、`--dsw-alias-state-warn-primary`、`--dsw-alias-state-error-primary`、`--dsw-alias-state-idle-primary`、`--dsw-alias-state-business-primary` |
| 动效 | `--ds-transition-duration-slow`、`--ds-ease-in-out` |
| 焦点环 | `--dsw-focus-ring-width`、`--dsw-focus-ring-color` |
| 框架几何 | `--dsh-windows-titlebar-height`、`--dsh-windows-menu-start`、`--dsh-frame-top-clearance`、`--dsh-frame-overlay-top`、`--dsh-frame-leading-clearance` |

出处：`...\@deepseek-ai\dsh-client-ui-theme\lib\client.js:1586-1625`（状态色 token 表）、`...\dsh-client-ui-layout\lib\client.js:73`（框架几何 + 边框/文字变量）、`preload-app.cjs:460`（menubar 用的 `interactive-bg-hover`）、`preload-app.cjs:469`（`state-business-primary` 焦点环）。

---

## 7. 不变量（违反即为缺陷）

1. **治理不绕过**：面板的 pin/unpin/forget 必须与 `memory_workflow` 工具同一套判定（角色门、pinned 拒删、删除走 `.trash/` + 墓碑）。UI 只是工具的另一张脸。
2. **只读边界**：面板除这三个动作外无任何写入口；知识库页 **零写操作**。
3. **不顶替官方 UI**：只注册自己的 `id`；不碰 `shell.leading`。
4. **不硬编码色值**：所有颜色/圆角/动效走平台 CSS 变量（深色主题必须自动成立）。
5. **不猜上下文**：取不到当前会话 cwd/session 时省略参数并明示，不许默认成"某个猜测的工作区"。
6. **路径不外泄**：界面展示相对路径；`vault.root` 只在面板诊断行与知识库来源条里出现（用户自己要看的机器事实），不进任何分享文案/剪贴板默认值。
7. **不吞点击**：浮层保持点击穿透，只有自己的可交互元素吃事件。
8. **文案同源**：host 的拒绝/确认文案原样上屏，不在前端二次创作。

---

## 8. 待办与已知缺口（本轮明确不做）

| 项 | 为什么不做 | 将来怎么做 |
|---|---|---|
| L3 `sweep`（批量清除超期） | 需求边界只要"每行两个动作"；批量删除是更高风险的破坏性操作 | 面板加一处「清理超期」入口，仍走 `confirm` 二次确认 |
| 面板内编辑（改笔记/改定位/写新记忆） | 交接文档 §9 明令不做；写侧已有工具的准入判定，绕过它等于绕过治理 | 永不直接写；将来只做"打开对应工具"的跳转 |
| 知识库页写操作 | 只读需求 | 保持只读 |
| `paragraph` 级高亮 | 契约只给了 `range`/`sentenceLines` | 若 `citation` 补 `paragraph` 再渲染 |
| 面板内历史/时间线视图 | 不在需求内 | 需要时加第五段 |
| macOS 上的 menubar 贴位 | macOS 没有这条 caption menubar（走原生系统菜单栏），P2 降级已覆盖 | 若官方在 darwin 挂 web 标题栏，升 P0 |

---

## 9. 重启验收要点（用户自检）

1. 重启桌面版 → 顶栏「应用」「编辑」右侧出现「记忆」按钮，**「应用/编辑」仍在、位置未变**。
2. 侧边栏收起/展开 → 按钮跟着 menubar 移动，不重叠。
3. 点按钮 → 面板出现，四个段落分别对应 L1/L2/L4/L3；面板尺寸与「设置」面板同级。
4. L3 每行两枚动作可点；若当前会话不是协调会话，按钮应置灰并说明原因（这是设计，不是坏掉）。
5. 「进入」→ 新标签页打开知识库页；三栏都在，右栏反链/出链有内容。
6. 知识库页点任一引用徽标 → 跳到目标笔记对应行并高亮；五态徽标文案可辨。
7. 面板里做一次 pin → 关闭再用 `memory_diagnose` 或重开面板复核状态确实变了。

---

## 10. 实现口径补充（实现完成后回填，避免后人误读规格）

契约里没写到、实现时必须定下来的几处，现在按**已实现的事实**记在这里（与 `.superpowers/sdd/2026-10-27-ui-handoff/build-contract.md` §3 一致）：

| 项 | 口径 |
|---|---|
| `citations[].revision` | 目标笔记**当前** revision（与 `/kb/api/resolve` 的 `revision`、与 `resolveCitation()` 同义）。被**引用时**的那个 revision 留在 `spec` 字面量里（`路径#^块@rev`），所以 stale 徽标不解析 spec 也能解释"哪次改写"。 |
| `layers.l1/l2.revision` | 笔记自身正文的 `revisionOf(parsed.body)` —— 与 `/kb/api/note` 给出的是**同一个** revision；否则同一文件两处会给出两个哈希，"变了没有"就答不出来。 |
| `layers.l4` | L4 是**合成摘要**（不是单篇笔记），其 `revision` 取摘要本身，并用 `path`/`updated` 锚到最新记录。 |
| `knowledge.notes` | 库内**全部已索引**笔记数（不是"仅知识库类文档"）。这个数字用于"知识库入口"的摘要，不是 L4 记录数。 |
| `/panel/workflow` 的 HTTP 码 | 只有一处策略：越界/坏 JSON → 400；方法不匹配 → 405；**格式合法但工作流不存在** → 200 + `{ok:true,changed:false,refused:null,message:"没有找到工作流 x。"}`。`forget` 成功与否看 `changed`。 |
| `forget` 的 `confirm` | **归面板持有**。路由对 `forget` 恒传 `confirm:true`、忽略请求体里的 `confirm`（面板已经用界面确认过一次）。所以"二次确认"是**界面约束**，不是 HTTP 参数。 |
| L3 同分排序 | 确定性 tie-break：`score` 升序 → `path` 升序（旧的"插入序"= 并发读盘完成序，同数据两次运行可不同）。 |
| 知识库页静态资源 | 只服务**同目录单段**文件（白名单扩展名）；`assets/` 这类子目录不服务 —— 与"零构建单页"的形态一致。 |
| `inject` 形态 | **不是** `{required, optional}` 对象。本机 cordis@4.0.5 把该对象的每个键都当硬依赖名（实测：`tools` 已提供仍停在 PENDING），照抄会丢掉全部记忆能力。实现为 `inject = ['tools','systemPrompt']` + 运行时 `ctx.inject(['webServer'], cb)` 取得 webServer（取不到只 warn 并跳过路由，工具照旧）。 |
| 面板材质 | 走"拿不到输入框变量链"的退让分支：`--dsw-alias-bg-base` + `--dsw-alias-border-l1` + `--dsw-radius-lg` + `--dsw-shadow-lv2`。 |

## 11. 已知非确定性（预先存在，本轮未修，已记录待决）

`memory_diagnose` 的 `库内类型:` 行与注入 coverage 的 `可检索类型:` 行，类型顺序来自 `tally().byType`（Map 插入序 = 并发读盘完成序）⇒ **同一份代码连跑两次顺序可能不同**。影响：面板「为什么看到这些？」里的 diagnose 行顺序随开随变；注入文本也会逐轮抖动。修法是渲染 `byType` 的两处各加一次 `[...entries()].sort()`（约 3 行，只改顺序不改内容），但它会改动**注入文本**，因此按"UI 不动 host 语义"的边界留给单独一轮决定。

## 12. 已知边界与勘误（独立评审后补写）

独立评审（全新上下文、只读复核）推翻/修正了本轮若干既有结论。为免后人照错的读，逐条写在规格里：

### 12.1 勘误：P0 的 z 序假设是错的（见 §2.2 已改）

按钮在 `shell.overlay`（`z-index:20` 的层叠上下文）里，**画在** menubar（根上下文 1100）之下。原设计写"`z-index:1101` 压在 menubar 之上"做不到。后果与对策：**保证不重叠**（属性翻转即重测），而不是靠 z 序。

### 12.2 勘误：侧栏折叠不触发重测（已修）

折叠/展开翻转的是 CSS 变量（`--dsh-windows-menu-start` 48px↔84px），menubar **水平位移、尺寸不变**。原实现的三条反应面（ResizeObserver 看尺寸 / shadow 内观察器在 shadow 之内 / window resize 不派发）**全部落空** ⇒ 运行中点一次折叠，按钮停在旧 x、与官方「编辑」重叠约 28px。修法：单独监听**布局属性翻转**（`data-sidebar-collapsed` 等）并连续若干帧重测；两个观察器职责分开，避免流式插入 DOM 触发测量。`client-smoke` 已加三条守卫锁住。

### 12.3 边界：HTTP 面没有调用方身份（不是缺陷，是模型）

动作把 `cwd`/`session` 放请求体，角色由"`session` 是否在该作用域 `coordinators` 名单里"决定，而 `overview` 返回名单原文。实测可构造"读名单 → 以该 id 发 `forget` → 真删"。根因在 `lib/workspace.js` 自述的模型：**marker 是合作式控制，DSH 没有可绑定的服务端主体**。所以本插件的 HTTP 面是**同机可信边界内的合作式控制**，不是鉴权面；插件自身无法拒绝"非 UI 调用方"，破坏性动作的二次确认在**界面侧**。已写进 `plugin/README.md` 的"已知边界"。

### 12.4 边界：macOS / 纯 web 的落位未取证

Windows 走测量路径；macOS/纯 web 走 P2 兜底，其 `left` 取值（`max(--dsh-frame-leading-clearance, 12px)`）只由平台 CSS 推得；而该变量**只在 darwin + 侧栏收起**时定义，展开时回落 12px，可能落在红绿灯/收起按钮区。**没有 macOS 主机 ⇒ 未实测**，留给有该主机的一轮。

### 12.5 勘误：vaultRoot 与"插件在运行"（影响你怎么理解"看不到记忆"）

profile 里**没有**配置 `vaultRoot`，且（修复前）`dsh-memory` **不在 `dsh.profile.bundles`** ⇒ 插件根本没挂载：活体实测 `/wallpaper-engine/inventory` 200 而 `/dsh-memory/*` 全 404，工具列表里没有 `memory_*`。所以"看到的默认库/空作用域"在修复前是**不可观测的假设**，不是现场事实。已修：把 `dsh-memory` 加进 `bundles`（这是"装好了 ≠ 挂上了"的坑，已写进 `plugin/README.md`）。