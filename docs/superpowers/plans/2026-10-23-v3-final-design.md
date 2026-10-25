# DSH 记忆系统 v3 —— 设计定稿（并入逆向结果）

> 日期：2026-10-23　｜　状态：**权威版**，取代 v2 / v2.1 / v2.2 的设计段落（那些文档保留为决策历史）
> 已锁：5 项决策 + 删除工作区即清除(a) + 逆向校准
> 进度：**P1 ✅（29 测试）· P2 ✅ · P3 ✅（59 测试 + 6 集成）→ 本轮进 P4**
> 实现现状：7 个工具（search / write / revise / review / forget / stats / diagnose）、vault 已 bootstrap 在 `D:\DSH记忆\kb`

---

## 1. 相较 v2 的实质变化

| 变化 | 来源 | 影响 |
|---|---|---|
| **新增规范化文本层（canonical）** | NotebookLM §7.2 | 块区间必须建在规范流上；否则 P5 高亮必偏 |
| 链接/块语义从"假设"变"实测" | Obsidian 报告 | 6 处实现被推翻重写 |
| **引用精度上限 = passage（~900字）** | NotebookLM §2.3 | `^blk` 的粒度应对齐 passage，不是随手放 |
| 引用要钉**双 id** | NotebookLM §2.2 | `[[note#^blk]]` 需带内容哈希，笔记被改后旧引用仍可解释 |
| **检索 = agent 循环 + 覆盖率注记** | NotebookLM §4 | L3/L4 召回不是固定 top-k |
| 性能有了参照系 | Obsidian §2 | 10k 冷启 1416ms；我 4s → touch 驱动是必做项 |
| `.obsidian/` 分层确定 | Obsidian §1 | 只有 `workspace*.json` 是机器级 |
| 来源级受众**服务端不存在** | NotebookLM §6 | 我们的 audience 模型必须自己在文件层实现（设计不必迁就它） |

---

## 2. 组件图

```
vault/parse.js        markdown + frontmatter + 块/标题区间 + 代码掩码
vault/links.js        链接文法与解析（校准完毕：4 档消歧、反斜杠不归一、块 id 小写）
vault/canonical.js    ★新：规范化文本 + 字符级 map + passage 切分(~900字/零重叠)
vault/index.js        索引：反链/出链/标签/块表/未链接提及/增量刷新
vault/query.js        文法（AND>OR、大写OR、/regex/、[prop]、比较、match-case）+ 打分 + 作用域漏斗
workspace.js          ★新：cwd → 工作区根 → marker 文件 → 角色与开关
index.js              插件入口：四层注入 + 工具 + touch 驱动刷新
```

## 3. 四层与可用性

| 层 | vault `type:` | 注入方式 | 作用域 |
|---|---|---|---|
| L1 定位 | `positioning` | 每轮全文（<1KB） | 全局 |
| L2 工作区地图 | `workspace` | 按 cwd 只注入命中的那个 | `ws_<id>` |
| L3 工作流 | `workflow` | 按任务相似度召回 top-k | 全局池 |
| L4 工作区记忆 | `memory` | 命中 + **marker 开关打开** 才注入 | `ws_<id>/ep_<id>` |

> **命名说明**：L4 早期在本系列文档里叫「会话期记忆（Episode Memory）」，按的是**寿命**（一段项目周期，收割后销毁）；对外统一改称**工作区记忆**，按的是**范围**（只有同一工作区的会话能看到，且按工作区单独开关）。两个名字描述的是同一层的两个属性，以「工作区记忆」为准。
| KB | `project`/`research`/`finding`/`decision`/`question` | 人读为主；工具按需检索 | 项目 |

## 4. 工作区 marker（最终 schema）

工作区根目录的 `.dsh/memory.json`（**随仓库走，可迁移**）：

```jsonc
{
  "schema": 1,
  "enabled": true,              // L4 读侧授权；false 时 L4 零注入（fail closed）
  "id": "ws_securitylab",
  "episode": "ep_2026_10_cpa",
  "coordinators": ["sess_x"],   // 角色白名单；不在名单里的一律按 worker 处理
  "mapAlwaysOn": true           // L2 不受 enabled 影响（已拍板）
}
```

## 5. 引用契约（v3，校准后）

```jsonc
{
  "anchor": { "note": "projects/p1/findings.md", "block": "f1", "revision": "sha256:9c31…" },
  "range":  { "start": 862, "end": 1750 },     // 规范化文本坐标，passage 级
  "granularity": "passage"
}
```

三条硬规则：
1. **区间落在 canonical 坐标**，渲染时用 `toOriginal(map, …)` 映回原文。
2. **`revision` 必带**（内容哈希）；笔记被编辑后旧引用可判定为"已变更"而不是静默指错。
3. **序号 `[n]` 是渲染层**：一个锚点可挂多个引用条目（`[1, 2]`），序号不能当外键。

> 句子级定位是我们相对 NotebookLM 的净增量：在 passage 内再切句并匹配。没有参考实现可抄。

## 6. 检索形状（v3）

```
召回(scope漏斗) → 返回结果 + 覆盖率注记 → 模型决定是否再召回
```

覆盖率注记要回答：本次作用域内**候选多少篇**、**返回多少篇**、**还有没有更大的作用域没看**、**是否因预算截断**。对应 NotebookLM 的 `retrieval_status`（"100% of the sources are included… Do not search again"）。

它取代"一次性塞满 token 预算"的做法，也让风险 A（边界划错→安静少召回）变得可见。

## 7. 生命周期（不变，补充触发 B 细节）

```
open → active → harvesting → closing(7d) → purged
         └──── abandoned ────┘
```

| 触发 | 行为 |
|---|---|
| A 收割完成 | 先出 `harvest_report`（每条必须 `harvested/discarded/deferred`），缺一条拒绝进 `closing` |
| **B 删除工作区（从列表移除即触发）** | 跳过收割 → `closing`，**先出未收割清单**给人确认；记忆本体进 `.trash/` 7 天；写墓碑 |

## 8. 权限矩阵（不变）

协调会话可改他人记忆正文、审查、发起收割、提升到 L3/KB；作业会话可读写但**不能改他人、不能审查、不能提升**。`pending` 记忆**降权 + 显式标注**，升级动作强制要 `approved`。

授权边界（如实声明）：**协作式**——marker 白名单 + fail closed 防误用，不防"agent 有写权限去改 marker"。

## 9. 目录布局（最终）

```
<memory-repo>/
  kb/
    positioning.md                      L1
    workspaces/<id>.md                  L2
    workspaces/<id>/memory/*.md         L4（episode 段内记录）
    workflows/*.md                      L3
    projects/<slug>/{README,log,findings,decisions,questions,artifacts}
  memory/items/*.md                     全局原子记忆（P3）
  machines/<host>.json                  gitignored：本机路径映射
  .kb-index/                            gitignored：派生索引
  .gitignore
```

`.gitignore`（来自 Obsidian §1 实测）：忽略 `workspace*.json`、`.kb-index/`、`.trash/`、`machines/`、`~syncthing~*`；其余 `.obsidian/*.json` 属库级应提交。

## 10. 性能目标（用实测校准）

| 指标 | 现状（P1 实测） | P2 目标 |
|---|---|---|
| 10k 全量重建 | ≈4.0s | 后台化，不进请求路径；参照 Obsidian 1416ms |
| 空转刷新 | ≈350ms/轮 ❌ | **<1ms**（touch 驱动：只 stat 被 read/write/edit 触碰的路径） |
| 单文件变更 | ≈60ms | 同左 |

## 11. 风险登记（最终，含残余）

21 项全部有策略，其中 **15 ✅ / 6 🟡（均有明确残余声明）/ 0 无策略**。详见 [risk-closure-matrix](2026-10-23-risk-closure-matrix.md)。唯一曾被标注"无方案"的**风险 D（KB 膨胀）**现有六级漏斗方案：作用域收敛 → 冷热分层 → 块级索引 → 族代表选择 → 链接扩散 → 边际信息增益排序。

## 12. 阶段状态

| 期 | 内容 | 状态 |
|---|---|---|
| P1 | 解析层、链接语义、索引、搜索、规范化文本 | ✅ 29 测试 |
| P2 | 工作区解析、touch 驱动刷新、四层注入、覆盖率注记、`memory_diagnose` | ✅ +15 测试 |
| P3 | 写入准入、反回声（族去重）、权限矩阵、审查状态机 | ✅ +15 测试 |
| **P4**（本轮） | 收割契约、生命周期状态机、停滞检测、`.trash` 冷静期、墓碑、`supersedes` 链、删除工作区触发清除 | 进行中 |
| P5 | 引用闭环（双 id + passage 内句子定位 + 断链告警） | 待 |
| P6 | 可迁移性验收（clone 到别处可用、无绝对路径 grep 断言） | 待 |

**实现事实（供后续对齐）**：vault bootstrap 在 `D:\DSH记忆\kb`；工作区开关靠工作区内 `.dsh/memory.json`；工具 7 个；回归命令见各期报告。

## 13. 明确不做

`task:*` 搜索算子（无任务模型）｜embedding/向量（D5 已排除，且客户端不可观测）｜长 PDF 切块（我们不处理 PDF）｜Mind map/Timeline 结构（NotebookLM 未取到，P7 再说）
