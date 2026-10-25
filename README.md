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

## 工具（10 个）

| 工具 | 作用 |
|---|---|
| `memory_search` | 检索；也用于**校验引用**（`verify`） |
| `memory_write` | 写入（过准入）；支持 `supersedes` / `sources` |
| `memory_revise` | 修订他人正文（协调会话） |
| `memory_review` | 审查 pending（协调会话） |
| `memory_forget` | 失效化 / 硬删除 |
| `memory_harvest` | 收割：plan / record / finish |
| `memory_purge` | 销毁段落（两段式确认） |
| `memory_workflow` | L3 池：list / pin / unpin / forget / sweep |
| `memory_stats` | 计数 |
| `memory_diagnose` | 诊断：作用域、开关、段状态、收割覆盖、链接健康、引用审计、可迁移性、语义扩展状态 |

---

## 验证

```powershell
node --test tools/*.test.mjs   # 110 项：解析/保真度/插件/策略/生命周期/引用/语义
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
