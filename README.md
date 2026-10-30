# DSH 记忆系统

一个给 DSH（DeepSeek Harness）用的分层持久记忆插件 + 它的知识库。
**零运行时依赖**：插件只用 Node 内置模块。

换成另一台机器、另一个目录，只需要改一个设置（`vaultRoot`）。笔记、链接、引用、revision 全部随仓库走。

---

## 这是什么

四层记忆，各有各的寿命：

| 层 | 内容 | 何时注入 | 寿命 |
|---|---|---|---|
| **L1 定位** | 我为谁做什么、输出标准、不接受什么 | **每轮全文** | 永久（你改它） |
| **L2 工作区地图** | 某个工作区是什么、结构、约定 | 按 cwd 命中 | 永久 |
| **L3 工作流** | 可复用的做事步骤 | 按任务相似度召回 | **会衰减**；可固定、可提前遗忘 |
| **L4 工作区记忆** | 本项目当前所需的全部上下文（事实/决策/坑/卡点）——让同工作区的多次会话接力 | 工作区开启时召回 | **收割后销毁** |

外加一个知识库（`kb/projects/`），放项目沉淀：发现、决策、未解问题、证据。

L4 存在的理由：让同一工作区的多次会话能接力，而不是每次从零开始。它**是暂时的**——项目出成果（项目文档 / 工作流 / 知识库条目）后就该收割然后销毁。系统对此有强制：**任何一条记录没有处置结论，就不允许关闭这个段。**

---

## 目录

```
plugin/            DSH 插件本体（零依赖）
  lib/index.js       入口：四层注入、10 个工具、prompt 分节
  lib/workspace.js   工作区 marker 解析（fail-closed）
  lib/vault/         解析 / 链接 / 索引 / 检索 / 引用 / 可选向量
  lib/memory/        准入策略 / 生命周期 / 笔记回写
kb/                知识库（内容，随仓库走）
tools/             测试与校验脚本
docs/              设计文档与逐期交付报告
research/          逆向证据与文献语料
```

`kb/` 的布局：

```
kb/positioning.md                  L1
kb/workspaces/<id>.md              L2
kb/workspaces/<id>/memory/*.md     L4（用完即销）
kb/workspaces/<id>/harvest/<ep>.md 收割报告
kb/workflows/*.md                  L3
kb/projects/<slug>/{README,findings,decisions,questions,research,log,artifacts}/
kb/templates/                      模板（不参与索引）
```

---

## 装进 DSH

插件以 `link:` 方式挂进 profile，改动即时可见。

```powershell
# 1) 在 profile 的 package.json 里加依赖
#    "dsh-memory": "link:D:\\DSH记忆\\plugin"
# 2) 在 profile 的 cordis.patch.yml 里插入插件
#    - insert:
#        - id: dsh-memory
#          name: dsh-memory
```

配置项（全部可选，默认值即推荐值）：

```yaml
- id: dsh-memory
  config:
    vaultRoot: D:\DSH记忆\kb      # 唯一与机器相关的设置
    embedding:                    # 语义扩召回，默认关
      enabled: false
      endpoint: http://127.0.0.1:8001/v1/embeddings
      model: your-embedding-model
```

---

## 启用某个工作区的 L4

**marker 在工作区里，不在记忆仓库里**——这样它随该仓库走，且"打开"必须由你显式做。

```powershell
node tools/enable-workspace.mjs "D:\SecurityLab" --id ws_securitylab --episode ep_2026_10
```

`role` 由 marker 里的 `coordinators` 白名单决定：白名单内的会话是协调会话（可审查、可修订他人记忆、可收割、可销毁），其余是作业会话。

没有 marker 的目录 → L4 **关闭**（fail closed）。这是有意的：宁可不注入，也不要悄悄注入到错的工作区。

---

## 工具（12 个）

| 工具 | 作用 |
|---|---|
| `memory_search` | 检索；也用于**校验引用**（`verify`）。默认只返回授权切片，`scope`/`allScopes` 不能扩权 |
| `memory_write` | 写入（过准入）；支持 `supersedes` / `sources`。**仅 Curator/主 DSH** |
| `memory_candidate` | worker 提交 pending 候选（存 `.kb-index/`，不进入 recall/MemoryPack） |
| `memory_revise` | 修订正文（Curator/主 DSH） |
| `memory_review` | 审查 pending（Curator/主 DSH） |
| `memory_forget` | 失效化 / 硬删除（Curator/主 DSH） |
| `memory_harvest` | 收割：plan / record / finish |
| `memory_migration_report` | 只读 legacy 迁移清单；不读正文、不改写 vault（Curator/主 DSH） |
| `memory_purge` | 销毁段落（两段式确认，Curator/主 DSH） |
| `memory_workflow` | L3 池：list / pin / unpin / forget / sweep（变更仅 Curator） |
| `memory_stats` | 计数 |
| `memory_diagnose` | 诊断：作用域、开关、段状态、收割覆盖、链接健康、引用审计、可迁移性、语义扩展状态 |

---

## Fleet v3 读写边界

### 可见性（MemoryPack v1.1.0）

**只有显式 `visibility: user-global` 的记录可以跨 workspace。** 不再按 L1/L3/KB
类型自动推断全局。

| visibility | worker 读取规则 |
|---|---|
| `user-global` | 可跨 workspace 读取（**唯一**跨 workspace 的可见性；必须显式出现在 frontmatter） |
| `workspace-shared` | 仅同一 `workspace_id` |
| `episode-shared` | 同 workspace + 同 `episode_id` |
| `run-private` | 同 `run_id`（来自可信 host 绑定） |
| `restricted` | 拒绝；不进入 recall/MemoryPack |
| 无显式 `visibility`（`unmarked`） | 不进入 worker recall/MemoryPack；只出现在 `memory_migration_report` |

旧记录没有显式 `visibility` 时：

- 不得按 `positioning`/`workflow`/`finding` 等 type 推断为 `user-global`；
- 在 Curator 人工确认并迁移前，不进入 worker MemoryPack；
- 只读迁移清单只列路径/type/scope/review 和未确认建议，不读正文、不改写 vault。

授权在**检索、排序、top-k、IDF、citation、诊断之前**发生：未授权记录不会进入
候选集/DF/排序位置。`scope`/`allScopes` 只能缩小，不能扩大可信范围；citation 对
foreign/missing 统一返回 `unavailable`，诊断只统计授权切片。

`pending`/`rejected`/`superseded`/`restricted` 默认不进入普通 recall 或 worker
MemoryPack。

### 可信身份

`workspace_id`/`episode_id`/`role`/`run_id` 来自 host 绑定（测试中通过
`exec.hostContext.binding` 注入）或工作区 marker，**不读工具参数**。出现
`workspace_id`、`role`、`run_id` 等参数会被拒绝。marker 的 coordinator 白名单
只决定 legacy 角色；host 绑定是 worker 时不能被 marker 升级。

### 只读 MemoryPack

```js
import { createMemoryPackContext, createMemoryPackService } from 'dsh-memory'

const service = createMemoryPackService({
  vaultRoot,
  workspace: { id: 'ws_a', episode: 'ep_1' },
  workspaces: ['ws_a', 'ws_b'] // 可选：host 侧 enabled 注册表
})
const context = createMemoryPackContext({
  workspace_id: 'ws_a',
  episode_id: 'ep_1',
  role: 'researcher',
  run_id: 'run_0123456789abcdef',
  task_id: 'analysis_a',
  purpose: 'phase pack',
  max_entries: 100
})
const pack = await service.getPack(context) // deep-frozen, read_only: true
```

`getPack` 只接受由 `createMemoryPackContext` 创建的 context（防止 model 自报身份）。
接口没有 `write/update/delete/purge/revise`。pack 按 **`MEMORYPACK_V1_1.md`
v1.1.0** 生成 `snapshot_id/hash`；hash 不含 `generated_at`/`run_id`。`excluded` 只
统计授权切片内的 pending/rejected/superseded/restricted/unmarked/path_invalid/
entry_invalid，foreign 记录不计数。

- `path` 使用 NFC 规范化的 Unicode 相对路径（`/` 分隔）；仍拒绝绝对路径、盘符、
  UNC、`\`、`.`/`..`、空段、控制字符、NUL 和 ADS 冒号。无效路径计入
  `excluded.path_invalid`，不会静默漏掉中文笔记。
- 显式 `user-global` 且无来源 scope 的条目使用保留 owner `workspace_id: "global"`；
  不会把请求方 workspace_id 填成旧记录 owner。
- `policy.cross_workspace` 由实际 `entries` 重新计算：存在
  `visibility: user-global` 且 `workspace_id != scope.workspace_id` 的条目时为 true；
  `global` 视为跨 workspace。
- `workspaces` 可传 Set/Map/数组/对象作为 host 侧注册表；marker 的 `enabled` 是
  L4 注入开关，不等于 workspace 注册状态（注册状态用 `workspaces`/`registered`）。
- 历史 v1.0.0 合同/schema 保留在 `brief/contracts/`，不被覆盖；消费者必须按
  `contract_version` 精确校验。

---

## 验证

```powershell
node --test tools/*.test.mjs   # 全部离线测试：解析/保真度/插件/策略/生命周期/引用/语义/隔离/路径/MemoryPack
node tools/integration.mjs     # 6 项：真实 SystemPrompt + ToolRuntime
node tools/portability.mjs     # 8 项：无绝对路径 / 克隆可用 / ignore 覆盖
node tools/vault-check.mjs kb  # 人工检查某个 vault
```

`tools/conformance.test.mjs` 会拿 `tools/spec-assertions.json`（逆向 Obsidian 1.13.7 得到的 46 条断言）逐条跑真代码，输出三类结论：**通过 / 已记录偏离（附理由）/ 失败**。偏离一旦开始通过也会报警，防止清单腐化。

---

## 三条硬规则

1. **sensitive 内容拒绝落盘。** 笔记是 git 跟踪的文件，写下去之后"以后再删"是做不到的承诺。这类内容只能待在当前会话上下文里。
2. **推断不能自封效力。** `tool-output` / `inferred` 写工作区级记忆时强制降级为待审查，注入时降权并标注。内容可以记，效力不能自己给。
3. **删除不假装干净。** 所有销毁都进 `.trash/` 并留墓碑，返回里明确写"git 历史里仍可找回"。我们不演"已经彻底消失"。

---

## 设计文档

- `docs/superpowers/plans/2026-10-23-v3-final-design.md` —— 权威设计
- 逐期交付报告：`2026-10-23-p1/…`、`p2`、`p3`、`p4`、`p5`、`p6-*`
- `2026-10-24-adr-0001-embedding.md` —— 为什么引入向量、又为什么只让它扩召回
- `2026-10-24-ui-memory-panel-spec.md` —— UI 阶段规格（未实现）
- `调研-2026-Agent记忆技术与文献综述.md` —— 470 篇文献的综述，每条设计决策的出处

---

## 尚未实现

**UI 阶段**：DSH 顶栏的「记忆」面板 + 独立的知识库只读页面。规格已写，后端数据齐备，缺 `pinned` 之外的前端与插槽考古。
