# dsh-memory

DeepSeek Harness 的**受治理持久记忆**：一个 markdown 记忆库（vault）是唯一底料，四层是库里的笔记类型，召回是带"覆盖度"明示的作用域检索，遗忘是有阈值的衰减与收割。零运行时依赖。

## 四层

| 层 | 是什么 | 注入 |
|---|---|---|
| L1 定位 | 它为我做什么（`positioning.md`） | 常开 |
| L2 工作区地图 | 这个仓库是什么（`workspaces/<scope>.md`） | 默认常开 |
| L3 工作流 | 可复用做法（`workflows/*.md`），带衰减与固定 | 按当轮问题召回 |
| L4 工作区记录 | 本次会话/阶段的记录（`projects/**`），收割后销毁 | 受工作区开关约束，**关则 fail-closed** |

模型可见工具共 10 个：`memory_search` / `memory_write` / `memory_revise` / `memory_review` / `memory_forget` / `memory_harvest` / `memory_purge` / `memory_workflow` / `memory_stats` / `memory_diagnose`。

## 界面（client 半部 + 只读页）

- **顶栏「记忆」按钮**：注册进 `shell.overlay`（不是 `shell.leading` —— 那是 `single` 型，会顶掉官方控件）。位置靠**测量**桌面 preload 挂的 `div[data-windows-menu]`（open shadow root，内含「应用」「编辑」）的右边界，贴到它右侧；三级降级见 `plugin/client/02-model.js`。
- **面板**：与设置面板同级尺寸，四段只读（L1/L2/L4）+ L3 每行两个受治理动作（永久保留 / 彻底删除）+ 知识库入口。
- **知识库只读页**：`<prefix>/kb/`（默认 `/dsh-memory/kb/`），三栏 + 反向链接 + **引用五态徽标**（`ok / stale / missing / moved / unknown`）。

## 前缀与路由的单真源

`plugin/ui-contract.json` 是**唯一**真源，被三边消费：host 路由（`lib/routes/contract.js`）、构建产物（`scripts/build-client.mjs` 构建期内联）、知识库页（运行时 fetch + 内联常量兜底）。`tools/ui-contract.test.mjs` 断言三边一致。

## 开发

```powershell
node scripts/build-client.mjs          # 重建 lib/client.js（纯 node 内置、幂等：同输入同字节）
node --test tools/*.test.mjs           # host 基线 + 路由 + 跨边契约
node --test tools/client-smoke.mjs     # client 产物形态
node --test tools/kb-page-smoke.mjs    # 知识库页形态（含平台 token 名录守卫）
node tools/integration.mjs             # 真 registry 集成
node tools/portability.mjs             # 可迁移性
node tools/ui-live-proof.mjs           # 对着真实 vault 逐条打路由（只读）
```

改了 `plugin/client/**` 必须重建产物；**重启桌面版**才会加载 client 半部。

## 安装与挂载（踩过的坑，写下来免得再踩）

- profile 里 `dsh-memory` 要在**两处**出现：
  1. `dependencies`（`"dsh-memory": "link:<插件目录>"`）
  2. **`dsh.profile.bundles`** —— 只加 `dependencies` **不会挂载**：`cordis.yml` 是空数组，插件树完全由 bundles 组成。漏了这一条的症状是"插件装好了但 `/dsh-memory/*` 全是 404、工具列表里没有 `memory_*`"。
- 插件的 bundle patch（`cordis.patch.yml`）只做 `insert: - id: dsh-memory`；要覆盖配置（例如 `vaultRoot`），在 profile 自己的 patch 里按 id 覆写：
  ```yaml
  - id: dsh-memory
    name: 'dsh-memory'
    config:
      vaultRoot: 'D:\DSH记忆\kb'
  ```
- 未配置 `vaultRoot` 时用默认库 `<DSH_HOME>/memory/kb`。工作区作用域靠**向上找 `.dsh/memory.json`** 决定；没有标记 ⇒ 作用域为空、L4 关、角色 `worker`（fail-closed，面板会明说，不是召回失败）。

## 已知边界（显式写下，而不是留在断言里）

1. **HTTP 面没有调用方身份**。面板的动作把 `cwd`/`session` 放在请求体里，角色由 `session` 是否在该工作区 `coordinators` 名单里决定；而 `overview` 会把名单原文返回。也就是说：**任何能连上这个端口的进程/页面，读到名单后都能以协调者身份发动作**。根因在 `lib/workspace.js` 自己写明的模型——"the marker is a cooperative control … DSH has no server-side principal to bind to"。因此本插件的 HTTP 面是**同机可信边界内的合作式控制**，不是鉴权面：别把它暴露到本机之外（本 profile 若装了 tailnet 门户之类，请自行评估）。
2. **面板的破坏性确认在界面侧**。`forget` 的二次确认由面板持有，路由对 `forget` 恒按已确认处理；插件自身无法拒绝"非 UI 调用方"。
3. **macOS 上的落位未取证**：Windows 走"测量 menubar"这条路；macOS/纯 web 走 P2 兜底，其 `left` 取值只由平台 CSS 推得，**未在 macOS 上实测**。
4. `shell.overlay` 层是 `z-index:20` 的独立层叠上下文，因此在重叠区它**画在** preload 的 menubar（1100）**之下**；本插件的对策是"让两者永不重叠"（跟随侧栏折叠重测），而不是靠 z-index 压过去。

## 许可

MIT