# UI 阶段交接（给接手的会话）

> 日期：2026-10-27　｜　前置：主体插件已完成（128 测试 / 6 集成 / 8 可迁移性全绿）
> 本文件**取代** `2026-10-24-ui-memory-panel-spec.md` 的技术假设部分（那份仍是需求原稿，读它拿意图，读本文拿事实）

---

## 1. 要做什么

在 DSH 桌面版给记忆系统加两个界面：

### A. 「记忆」按钮 + 面板
- 位置：顶栏左上角「应用」「编辑」按钮**右侧**
- 面板：与「设置」面板同尺寸，沿用输入框同款材质
- 内容：四层各一段
  - L1 定位 / L2 工作区地图 / L4 工作区记忆 → **只读**
  - L3 工作流 → 每条两个动作：**永久保留**（pin）/ **彻底删除**（forget）
  - 知识库 → 一个「进入」按钮

### B. 知识库只读页面
- 点「进入」→ 打开**独立于 DSH 的浏览器页面**
- UI 参考：Obsidian 的三栏 + 反向链接；NotebookLM 的引用定位
- 重点：**引用状态徽标** `ok / stale / missing / moved`（这是我们比 NotebookLM 多的东西）

---

## 2. 已经就绪的东西（不要重造）

### 数据与能力（全部有工具）
| 需要什么 | 现成能力 |
|---|---|
| 四层内容 | `memory_search(type:positioning/workspace/workflow/memory)` |
| 开关/作用域/角色/段状态/收割覆盖/链接健康/引用审计/可迁移性/语义扩展 | `memory_diagnose`（一次全给） |
| L3 列表 + pin/unpin/forget/sweep | `memory_workflow` |
| 删除单条 | `memory_forget` |
| 销毁整个工作区 | `memory_purge(scope=…)` |
| 引用校验 | `memory_search(verify=…)` |
| 反向链接 / 出链 / 标签 / 块 | `VaultIndex.backlinksOf / outlinksOf / tagsIndex / blocksIn` |
| 句子级区间 + 行号 | `hit.sentence.range` / `hit.sentenceLines` |
| 引用四态 | `resolveCitation()` |

**结论：UI 需要的数据后端全有，缺的只有前端本身。**

---

## 3. 技术事实（本轮考古所得，可直接照抄）

### 3.1 client 半部的声明方式
照 `dsh-plugin-wallpaper-engine`（已装在 profile，是活先例）：

```json
{
  "exports": {
    ".": "./lib/index.js",
    "./client": "./lib/client.js"        // ← 必须有
  },
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": {
      "inject": ["@deepseek-ai/dsh-client-runtime"],
      "platform": "web",
      "immediately": true
    }
  }
}
```

peerDependencies（都是平台模块，node_modules 里没有，但浏览器侧有）：
`@deepseek-ai/dsh-client-runtime`、`@deepseek-ai/dsh-client-ui-slots`、`@deepseek-ai/dsh-host-webserver`、`react ^18`

### 3.2 client.js 的产物形态
编译产物是浏览器模块，形如：

```js
window.__ModuleLoader__.load({ id: 'dsh-memory', factory: (require) => { … } })
```

内部可用 `require("react")`、`fetch`、`document`、`window`。参考实现：`dsh-plugin-wallpaper-engine/lib/client.js` + 它的 `scripts/build-client.mjs`。

### 3.3 槽位 API（来自平台自带的 docs）

```js
return {
  inject: ['slots'],
  apply(ctx) {
    ctx.slots.inject('shell.leading', () =>
      ctx.slots.register(
        { name: 'shell.leading', id: 'my-id', order: 100 },
        () => React.createElement('div', null, 'hello'),
      ))
  },
}
```

注册项字段：`id`（必填，用自己的 id 才是"并排新增"，复用官方 id 会**替换**它）、`order`（升序）、`label`（可传 thunk，跟随语言切换）。

### 3.4 已探明的槽位目录（100 个，节选）

| 槽位 | kind | 说明 |
|---|---|---|
| `shell.leading` | **single** | 左上角区域。**已被 `client-ui-sidebar HeaderLeadingControls` 占用**，`replaceRisk: shadows-shipped-ui` |
| `shell.overlay` | list | 全窗浮层，点击穿透，条目之间按 order 排序。**适合"新增而不顶替"** |
| `shell.bottom` | — | 底部 |
| `conversation.header.leading` | — | 会话头部左侧 |
| `settings.section` | — | 设置面板内的分节（wallpaper-engine 用它） |
| `settings.action` / `settings.trigger` | — | 设置入口/动作 |
| `sidebar.brand.mark` / `.name` | — | 侧栏品牌区 |
| `sidebar.right.pane.tab` | — | 右侧面板 tab（配 `ctx.sidebarRightTabs.register`） |
| `tool.call.toolview` | — | **工具结果的自定义渲染**（本节 B 页面的替代路径之一） |

> 完整 100 条可用同样方法再捞：扫 `node_modules/@deepseek-ai/*client*/**/*.js` 里的 `slots.inject("<id>")`。

---

## 4. 必须先解决的一个歧义（不要跳过）

「应用」「编辑」到底在哪一层，证据是矛盾的：

| 证据 | 指向 |
|---|---|
| web 侧 i18n（`dsh-client-locale`）里**没有** `"应用"` 这个字符串 | 应用按钮**不在 web 层** |
| Electron 主进程 `lib/main.js` 有 `application: "应用"`、`edit: "编辑"` | 在**桌面层** |
| 但 win32 下 `Menu.setApplicationMenu(devToolsItems)`，不走那套中文菜单 | 桌面菜单在 Windows 上**被替换掉了** |

**所以结论未定。** 接手的会话**第一步**必须先判定：

1. 打开桌面版，用开发者工具 / 辅助功能树看顶栏是不是 DOM 元素
2. 若是 DOM → 用 CDP 找它的父容器，反查它属于哪个 slot（`renderSlot(...)` 的容器有 data 属性）
3. 若是原生（Electron）chrome → **web 插件插不进去**，此时按 §5 的替代方案

**不要凭猜测直接往 `shell.leading` 注册** —— 它是 `single`，会顶掉现有的 `HeaderLeadingControls`。

---

## 5. 若按钮无法真实插到「应用/编辑」右边，按此优先级退让

1. **`shell.overlay`**：全窗浮层，点击穿透，可按 `order` 排在左上。视觉上能贴到那个位置，且不顶替任何官方 UI
2. **`settings.trigger` 旁边**：把「记忆」作为设置入口的兄弟项（位置不同，但语义通顺）
3. **`conversation.header.leading`**：会话头部左侧（每个会话可见）
4. **`tool.call.toolview`**：不做面板，把记忆展示成工具结果卡片

记录你选了哪条、为什么——这是设计决策，要能事后解释。

---

## 6. 建议的实施顺序

1. **判定 §4 的歧义**（半小时内应有答案）
2. **最小可行 client**：只做按钮 + 空面板，确认能加载、能看见（先证明管线通）
3. **面板内容**：四层只读 + L3 两个动作（调 host 的 `memory_workflow`）
4. **知识库页面**：插件注册只读 HTTP 路由（`dsh-host-webserver`，wallpaper-engine 有先例），渲染三栏 + 反链 + 引用徽标
5. **端到端**：面板能开、L3 能 pin/forget、KB 页能从断言跳回原文行号

---

## 7. 验证方式

```powershell
cd 'D:\DSH记忆'
node --test tools/*.test.mjs      # 128，改动 host 侧代码后必须保持全绿
node tools/integration.mjs        # 6
node tools/portability.mjs        # 8
```

- host 半部（`plugin/lib/**`）**不要因为 UI 而破坏**：现有 128 个测试是它的合同
- client 半部建议加自己的 smoke：`tools/client-smoke.mjs`，断言 `lib/client.js` 里含 `__ModuleLoader__.load` 与预期 slot id
- 面板里每个动作调完后，回一次 `memory_diagnose` 看状态是否真的变了

---

## 8. 环境与约束

- 工作目录：`D:\DSH记忆`（代码仓 `dsh-memory`）· 记忆库 `D:\DSH记忆\kb`（独立仓 `dsh-memory-vault`，**嵌套仓库**，外层已忽略）
- 两个仓库都是**私有**；push 前先看 `git status`
- 插件已装进 profile：`dsh-memory 1.0.0 <- D:\DSH记忆\plugin`，`dsh.profile.bundles` 里有它
- **改 client 半部后要重新构建** `lib/client.js`（目前还没有 build 脚本——需要新写，参考 wallpaper-engine 的 `scripts/build-client.mjs`）
- 桌面版改动需重启才生效

---

## 9. 不要做的事

- 不要为了 UI 改 host 侧的数据形状（有 128 个测试锁着）
- 不要往 `shell.leading` 硬塞（会顶掉官方控件）
- 不要在面板里做**编辑**功能（只读 + L3 两个动作就是需求边界）
- 不要给知识库页面做写操作（只读）
- 不要把 `kb/` 内容复制进代码仓（两个仓是分开的）
