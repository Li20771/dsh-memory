# 记忆面板 + 知识库只读页面 —— 规格（待另开会话实现）

> 日期：2026-10-24　｜　状态：**已记录，等记忆插件主体完成后单独开工**
> 来源：用户口述规格；本文只做记录与可行性校准，不含实现

---

## 1. 入口与面板

### 1.1 触发位置
DSH **桌面版顶栏**，左上角「应用」「编辑」按钮**右侧**，新增一个按钮：**记忆**。

### 1.2 面板形态
- 尺寸：与**「设置」面板同样大**
- 材质：沿用**输入框同款材质**（不是模态窗、不是侧边抽屉）

### 1.3 面板内容：按层展示

| 层 | 交互 | 说明 |
|---|---|---|
| **L1 定位** | **只读** | 全文展示（它每轮注入，需可读） |
| **L2 工作区地图** | **只读** | 若当前目录不在任何工作区，显示"未覆盖"而非空白 |
| **L3 工作流** | **每条两个动作** | 见 §1.4 |
| **L4 会话期记忆** | **只读** | 显示开关状态；关闭时明示"fail-closed，未注入" |
| **知识库** | **「进入」按钮** | 见 §2 |

### 1.4 L3 工作流的两个动作

> **语义澄清（用户 2026-10-24）**：这里的"彻底删除"**不是**要清除 git 历史，而是**把"长期不用自动遗忘"变成你能提前主动触发**。所以它不是越权承诺，而是同一个衰减机制的手动版本。

| 动作 | 语义 | 后端状态 |
|---|---|---|
| **永久保留** | `pinned: true`：不参与衰减、不被 sweep 清除、不被忘记 | ✅ **已实现**（`memory_workflow action=pin`） |
| **彻底删除** | 手动提前遗忘：移入 `.trash/workflows/` + 写墓碑，等效于 decay 到期 | ✅ **已实现**（`memory_workflow action=forget`，需 `confirm`） |

衰减机制（已实现）：`score = exp(-age/90天) × (1 + 0.6·ln(1+召回次数))`，`score < 0.18` 记为 `expired`。
**永久性来自"最近被用到"**（每次 L3 注入都会刷新 `lastUsed`），历史召回次数只是小加成——三年前用过 40 次并不能救一个此后没人用的流程。

已固定的工作流，`forget` 会**拒绝**并提示先 `unpin`——否则"永久保留"就失去了意义。

---

## 2. 知识库页面（独立于 DSH）

### 2.1 形态
点击「进入」→ 打开**一个不在 DSH 里的新页面**（浏览器新标签），**只读**。

### 2.2 技术路径（可行性已校准）
- DSH 插件可以注册**只读 HTTP 端点**——`dsh-plugin-wallpaper-engine` 就用 `dsh-host-webserver` 起了媒体服务，是活先例。
- 因此：插件注册 `/memory-kb` 路由，渲染静态页面 + 只读 JSON API（复用现有 `VaultIndex` / `search`）。
- **不引入新的依赖服务**，不开新进程。

### 2.3 UI 参考分工

**取 Obsidian 的：**
- 三栏骨架：左（文件树 + 标签）、中（笔记正文 + 反向链接面板）、右（出链 / 大纲）
- **反向链接面板**（谁引用了我）+ **未链接提及**（提到了但没链）
- **链接可点**：`[[note#^blk]]` 内部跳转，跳到锚点位置
- 局部关系图（一跳邻域）——不是全局图，全局图在几千节点时没有信息量

**取 NotebookLM 的：**
- **来源面板 + 引用定位**：从一条断言点回它引用的原文片段（我们有 `sentence.range` 与 `lines`，可直接高亮）
- **引用状态徽标**：`ok` / `stale` / `missing` / `moved` 用颜色区分——这是我们相对 NotebookLM 多出来的东西，正好在 UI 上兑现
- **单篇摘要**（frontmatter 的摘要块）置于正文上方

**明确不做：**
- 编辑（只读）
- 全局力导向图（信息密度低、性能差）
- NotebookLM 的 Audio Overview
- Obsidian 的插件生态 / 主题

---

## 3. 前置技术条件（P2 已查证的结论）

| 条件 | 状态 |
|---|---|
| client 插件面 | ✅ 存在（`dsh.client` + `platform:'web'` + `exports["./client"]`，wallpaper-engine 为活先例） |
| 独立前端构建 | ✅ 需要：`pnpm run build` 产出 `lib/client.js` 再加载 |
| UI 插槽机制 | ✅ 存在（`dsh-client-ui-session` 文档提到"标准 Slot 钩子"） |
| **插槽包是否可解析** | ⚠️ `dsh-client-ui-slots` / `dsh-client-runtime` **不在 node_modules**，是浏览器侧 `PLATFORM_MODULES` 平台模块 |
| **顶栏按钮的具体槽位** | ❓ **未确认**——需要读 `dsh-client-ui-session/lib/client.js`（40KB）做插槽考古 |
| 只读 HTTP 端点 | ✅ 可行（`dsh-host-webserver`） |

**结论：面板本身要 client bundle，验证成本高于 host 插件；知识库页面反而更容易（纯 HTTP + 静态页）。**

---

## 4. 开工清单（另开会话时按此执行）

1. **插槽考古**：确定顶栏「应用」「编辑」所在槽位的 id 与注册方式。
2. **补后端字段**：`pinned`（永久保留）——需要在 `memory_write` / `memory_review` 之外新增一个动作，且衰减/淘汰逻辑要尊重它。
3. **只读 API**：`GET /memory-kb/api/tree`、`/note?path=`、`/search?q=`、`/backlinks?path=`、`/cites?path=`。
4. **面板前端**：分层只读 + L3 两动作（调 host 工具或 API）。
5. **知识库前端**：三栏 + 反链 + 引用徽标 + 局部图。
6. **端到端**：面板开→看到四层；L3 标 pinned 后不被淘汰；KB 页能从断言跳回原文行号。

---

## 5. 与现有实现的对接点

| 面板要素 | 现成能力 |
|---|---|
| 四层内容 | `search(type:positioning/workspace/workflow/memory)` + `memory_diagnose` |
| L4 开关状态 | marker 的 `enabled`；`memory_diagnose` 已输出 |
| 工作流列表 | `type:workflow` 检索 |
| 删除 | `memory_forget(mode=delete)`（协调会话权限） |
| 知识库树 | `VaultIndex.paths()` |
| 反向链接 | `index.backlinksOf()` |
| 引用定位 | `hit.sentence.range` + `hit.sentenceLines` |
| 引用状态 | `resolveCitation()` 四态 |

**结论：UI 要的数据后端全都有了**，缺的只有 `pinned` 字段和前端本身。
