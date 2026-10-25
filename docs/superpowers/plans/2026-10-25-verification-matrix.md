# 需求 → 证据 对照表（插件整体验收）

> 日期：2026-10-25　｜　口径：**每条需求必须指到一个能跑的测试或一次实测**，不能只写"已实现"
> 总量：118 单元/保真度测试 · 6 真实 SDK 集成 · 8 可迁移性检查 · 46 条逆向断言

---

## 一、逐条对照

| # | 你要的效果 | 证据（测试名） | 状态 |
|---|---|---|---|
| 1 | 四层各司其职，按需出现 | `inject: L1 always, L2 by workspace, L3 by task, L4 only when the switch is on`<br>`inject: L4 fails CLOSED and says so, while L2 still appears`<br>`inject: outside any workspace, L1 only and coverage explains why` | ✅ |
| 2 | 工作区可选开关，打开后跨会话 | `workspace: no marker anywhere fails closed`<br>`workspace: nearest marker wins, role comes from the coordinator list` | ✅ |
| 3 | 工作区记忆是暂时的，收割后销毁 | `memory_harvest finish refuses on any gap, then accepts when complete`<br>`memory_harvest finish catches a record written after harvesting began`<br>`lifecycle: transitions are explicit and refuse the rest`<br>`memory_purge: first call only reports, confirm moves to .trash and tombstones` | ✅ |
| 4 | **删除工作区即清除** | `deleting a workspace destroys its records once the harvest is complete`<br>`deleting a workspace with undisposed records defers instead of destroying`<br>`adding a workspace or rewriting the registry does not touch records`<br>`memory_purge scope= destroys a whole workspace and leaves others alone` | ✅ **自动**（宿主注册表监视） |
| 5 | 特殊会话权限更高，执行会话能读能写自己的 | `memory_review: worker refused, coordinator approves`<br>`memory_revise: worker refused, coordinator replaces body and keeps the old hash`<br>`memory_forget: own note retractable by a worker, hard delete is coordinator-only`<br>`memory_harvest record: workers refused…`<br>`memory_workflow pin: worker refused…`<br>`memory_purge: worker refused`<br>`injection: every row carries credibility`（含 worker 读全工作区） | ✅ |
| 6 | **可信度标注：哪条实测、哪条推测** | `injection: every row carries credibility (review state + where the claim came from)`（本轮新增）<br>`admission: tool-output / inferred cannot take workspace-wide effect unconfirmed` | ✅ |
| 7 | 敏感内容不落盘 | `admission: sensitive content never reaches disk`<br>`memory_write refuses sensitive content and writes no file` | ✅ |
| 8 | 反回声（同源不重复占位） | `familyOf: same session+source is one family…`<br>`dedupeByFamily keeps one representative per family, in order`<br>`injection: one representative per source family, and the coverage says so` | ✅ |
| 9 | Obsidian 式双向链接 | `links: resolution precedence…` / `links: backslashes are NOT normalized` / `index: backlinks, outlinks…`<br>外加 **46 条逆向断言**（conformance） | ✅ |
| 10 | 引用闭环：双 id + 句子级 + 陈旧审计 | `resolveCitation: an edited note makes the old citation STALE…`<br>`resolveCitation: missing note and moved block are distinct outcomes`<br>`search hits carry a citation, revision and best sentence`<br>`memory_diagnose flags a citation whose target note changed` | ✅ |
| 11 | 工作区记忆不跨区泄漏 | `exposure: injected contexts contain zero foreign-workspace records (0/N)`<br>`exposure: the foreign record exists and is findable…`（可证伪对照）<br>`exposure: memory_search withholds foreign memory unless asked for it` | ✅ 0/3，样本小 |
| 12 | 语义扩召回可选 | `provider is inert unless enabled…` / `a failing embedder returns null instead of throwing` / `expand only returns paths inside the scope predicate`／`a boosted candidate is admitted but still ranked below a lexical hit` | ✅ 默认关 |
| 13 | L3 会衰减、可固定、可提前遗忘 | `workflowDecay: pinned wins, freshness beats staleness, recall keeps a workflow alive`<br>`memory_workflow pin: …pinned note survives sweep`<br>`memory_workflow forget: preview then evict to .trash with a tombstone`<br>`memory_workflow forget refuses a pinned workflow` | ✅ |
| 14 | 知识库写入门禁 | `admission: a decision must name at least two alternatives`<br>`admission: a project must state its non-goals`<br>`memory_harvest record rejects a harvested target that does not exist` | ✅ |
| 15 | 可迁移（clone 可用） | `portability: 8 checks`（无绝对路径 / 克隆重建 / 同查询同结果含 revision / 引用仍 ok / ignore 覆盖） | ✅ |
| 16 | 零依赖、能装进 DSH | 静态检查：`plugin/lib` 下所有 import 均为 `node:` 或相对路径；profile 里 `dsh-memory 1.0.0 <- D:\DSH记忆\plugin` 解析成功 | ✅ |
| 17 | 断链告警 | `linkHealth separates unresolved from ambiguous` + `memory_diagnose` 输出链接健康 | ✅ |
| 18 | 未解问题 / 决策记录类型 | `admission: a decision must name at least two alternatives`（决策） | 🟡 `question` 类型只做了类型允许，没有专门的写入测试 |
| 19 | 停滞检测 | `lifecycle: staleness and cool-down read the clock, not a guess`<br>`memory_diagnose surfaces lifecycle state, staleness and harvest coverage` | ✅ |
| 20 | 销毁 L4 不丢结论（端到端） | `journey: measure → promote → harvest → destroy, and the conclusion survives`（本轮新增）<br>`journey: a second run in the same workspace starts from the KB, not from scratch`（本轮新增） | ✅ |

---

## 二、两处诚实标注

### 🟡 #4 删除工作区：命令式，不是自动检测

**为什么不能自动**：要判断"这个工作区没了吗"，必须知道它的路径。而记忆仓库里**故意不存绝对路径**（P6 的可迁移性要求），所以插件无法主动发现某个工作区被删。

**取舍**：可迁移性 > 自动检测。因此把删除当成**你的信号**，并提供一个动作：

```js
memory_purge({ scope: 'ws_securitylab', confirm: true, reason: '仓库已删除' })
```

它执行的保证和"按段销毁"完全一样：协调会话限定、两段确认、移入 `.trash`（7 天可捞回）、写墓碑（`op: purge-workspace`）、如实说明残余。**只删该 scope 的记录**，其他工作区不受影响；L2 地图**不删**（它描述的是仓库，不是这次的记录），并在返回里提示如何手动丢弃。

### ~~🟡 #20 缺一条端到端验证~~ → 已补，并因此修掉一个真 bug

`tools/journey.test.mjs` 跑完整条链：执行会话实测 → 记进 L4 → 协调会话提升进知识库（同时引用**耐久证据**和**工作记录**）→ 逐条收割 → 销毁 → 结论仍可检索。

写这条测试时抓出两个问题：

1. **墓碑只记了数量，没记是哪些笔记**（`moved: 1`，没有 `paths`）。后果：一个正常收割之后，知识库里那条"引用已销毁工作记录"的引用会永远显示为**失效**——审计从此对每次收割都误报。已修：墓碑增加 `paths`，审计据此区分 `已销毁 N（有意，见墓碑）` 与 `失效 N`。
2. **收割报告里保留已销毁记录的路径是正确行为**（那是审计痕），我最初的断言把它当成泄漏。已改为按"引用是否可解析"判断，并额外断言收割报告**必须**留着那条路径。

### ✅ #4 删除工作区：已自动（不是命令式了）

**凭什么能自动**：桌面版把工作区列表持久化在 `<DSH_HOME>/storages/workspace.json`，实测形状：

```
{ unit:{name:'workspace',version:2},
  global:{ workspaceIds:[uuid...] },
  tables:{ workspaces:{ '<uuid>': { path, title, sessionIds, createdAt, updatedAt } } } }
```

所以宿主侧插件能观察到删除：**某个 uuid 从 `tables.workspaces` 消失 = 该工作区被删除**。不需要 client bundle。

**你要求的"保证知识库写入完整后再删"** 落实为：

| 情形 | 行为 |
|---|---|
| 收割完整（每条记录都有处置） | **立即销毁**该 scope 的记录 → `.trash` + 墓碑（`op: purge-workspace`，含 `paths`） |
| 收割不完整 | **不销毁**，记为 `pending`，`memory_diagnose` 报 `待收割 1（缺 1 条记录，未清除）` |
| 之后补齐收割 | 下一轮检测**自动**完成销毁（pending 里保存了 scope，否则删完就找不回来了） |

**延迟**：不是点击瞬间，而是**下一次工具调用/下一轮**（插件在 `refresh()` 里观察）。点删除 → 下次交互时生效。

**L2 地图不删**：它描述"这个仓库是什么"，不是本次记录；返回里会提示如何手动丢弃。

**授权说明（诚实版）**：这条自动销毁**绕过**协调会话检查——因为触发者是**你在 GUI 里的动作**，不是 agent。残余风险：理论上 agent 可以改 `workspace.json` 触发销毁；缓解是"只有收割完整才销毁"（此时已无内容损失）+ 墓碑记下 `paths` 可追。这个风险写在这里，不藏。

**快照位置**：`.kb-index/workspaces.json`（gitignored）。它必须存绝对路径才能记住"被删的是哪个目录"，而记忆仓库本身必须保持无绝对路径。

---

## 三、可复跑的验收命令

```powershell
cd 'D:\DSH记忆'
node --test tools/*.test.mjs        # 118 pass
node tools/integration.mjs          # 6 confirmed（真实 SystemPrompt + ToolRuntime）
node tools/portability.mjs          # 8 checks
node tools/vault-check.mjs kb       # 人工看某个 vault
```

测试文件与职责：

| 文件 | 覆盖 |
|---|---|
| `vault.test.mjs` | 解析 / 链接语义 / 索引 / 检索语法 / 性能 |
| `conformance.test.mjs` | 46 条逆向断言（含 2 条已记录偏离） |
| `plugin.test.mjs` | 工具注册 / prompt 分节 / 四层注入 / 追加性 |
| `policy.test.mjs` | 准入 / 反回声 / 权限矩阵 / 可信度可见性 |
| `lifecycle.test.mjs` | 状态机 / 收割覆盖 / 销毁 / supersedes / 按 scope 销毁 |
| `citation.test.mjs` | 双 id / 句子定位 / 行号 / 陈旧与断链审计 |
| `semantic.test.mjs` | 向量 provider / 扩召回不排序 / L3 衰减 |
| `exposure.test.mjs` | 跨工作区暴露率（含可证伪对照） |
