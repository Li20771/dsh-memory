#!/usr/bin/env node
/**
 * Bootstrap the memory vault skeleton.
 *
 *   node tools/bootstrap-vault.mjs [vaultRoot]
 *
 * Idempotent: existing files are never overwritten, so re-running after you edit
 * a note is safe. Seeds the layer files from what was actually observed in the
 * two workspaces (directory layout, the SPEC→…→FINAL_GATE artifact chain), not
 * from generic placeholders — a map that says nothing is worse than none.
 *
 * It deliberately does NOT write workspace markers into the real workspaces:
 * enabling episode memory is your opt-in act, not the tool's. Use
 * `node tools/enable-workspace.mjs <dir> --id ws_x --episode ep_y` for that.
 */
import { mkdir, writeFile, access } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const vaultRoot = resolve(process.argv[2] ?? join(process.cwd(), 'kb'))

const exists = async (path) => {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

const written = []
const skipped = []

async function put(rel, body) {
  const abs = join(vaultRoot, ...rel.split('/'))
  if (await exists(abs)) {
    skipped.push(rel)
    return
  }
  await mkdir(join(abs, '..'), { recursive: true })
  await writeFile(abs, body, 'utf8')
  written.push(rel)
}

const now = new Date().toISOString()

await put(
  'positioning.md',
  `---
id: kb_positioning
type: positioning
title: 定位：我为 YG 做什么
status: active
authority: inferred
review:
  state: pending
created: ${now}
updated: ${now}
---

# 定位（草稿，待你改）

> 这是我根据现有协作推出来的草稿。**请直接改**——L1 每轮全文注入，它定义我的行为边界。

## 我为你做什么

安全研究的**执行与取证**代理：把「研究 → 验证 → 固化」这条链跑起来，产出可复核的证据，而不是漂亮的结论。

## 输出标准

1. **结论必须带来源**：能指到具体文件/命令/行。指不到的，标成推测。
2. **实测与推测必须分开**：\`measured\` / \`reported\` / \`inferred\` / \`unverified\`，不许含糊。
3. **不确定就说不确定**：把"没查到"讲清楚，比编一个合理答案有用。
4. **未验证不宣称完成**：跑过的才算过。

## 我不接受自己做的事

- 编造结果、把推测写成实测
- 跳过验证就宣布完成
- 用"应该可以"代替"跑过了"
- 把长文档写得很满却没一个可执行结论

## 协作方式

- 我提议、你裁决；重大选择留 **决策记录**（选 A 不选 B 的理由）。
- 长程任务先出计划，再动手；计划里写清验收标准。
- 发现你给的约束与文献/事实冲突时，我直说，不迎合。
`
)

await put(
  'workspaces/securitylab.md',
  `---
id: kb_ws_securitylab
type: workspace
title: SecurityLab
scope: ws_securitylab
status: active
authority: agent-observed
review:
  state: pending
created: ${now}
updated: ${now}
---

# SecurityLab —— 工作项目总库

> 依据：\`D:\\SecurityLab\` 的目录结构与根文件实测（2026-10-23）。

## 是什么

整条工作线的落地仓：项目、实验、取证、固件、抓包都在这儿。技术栈混合（shell 137 / python 88 / markdown 107），有 \`.git\`、\`pyproject.toml\`、\`conftest.py\`。

## 结构

| 目录 | 用途 |
|---|---|
| \`projects/\` | 具体项目 |
| \`labs/\` | 实验环境（\`firmware/\` \`fuzzing/\` \`reverse/\`） |
| \`ctf/\` \`reverse/\` | 赛题与逆向 |
| \`pcaps/\` \`firmware/\` | 原始二进制证据 |
| \`artifacts/\` \`reports/\` | 产出物 |
| \`notes/\` \`docs/phases/\` | 笔记与阶段文档 |
| \`configs/\` | \`binfmt\` \`environment\` \`network\` \`systemd\` |
| \`scripts/\` \`tools/\` | 自动化与自建工具 |

## 约定

- 根有 \`AGENTS.md\`（约 5.7KB）——**项目指令优先于本文件**。
- 大二进制（pcap / firmware）不进记忆仓库，只记引用 + 哈希。

## 入口

\`README.md\`（7.7KB）、\`AGENTS.md\`、\`SECURITYLAB_AGENT_WORKFLOW_MIGRATION_AUDIT.md\`（49KB，工作流迁移审计）。
`
)

await put(
  'workspaces/ai-security-research-workbench.md',
  `---
id: kb_ws_workbench
type: workspace
title: AI-Security-Research-Workbench
scope: ws_workbench
status: active
authority: agent-observed
review:
  state: pending
created: ${now}
updated: ${now}
---

# AI-Security-Research-Workbench —— 研究执行治理

> 依据：\`D:\\AI-Security-Research-Workbench\` 实测（2026-10-23）。

## 是什么

**研究方法与执行治理**的仓：规格、计划、现实核查、设计、独立评审、终局门禁。Python + pytest（273 \`.py\` / 128 \`.md\`）。

## 结构

\`agents/\`（codex、dsh）· \`benchmarks/\` · \`composition/\` · \`config/\` · \`docs/\` · \`evidence/\` · \`integrations/\` · \`plugins/\` · \`providers/\` · \`review/\` · \`routing/\` · \`scripts/\` · \`tests/\` · \`tools/\` · \`workflows/\` · \`workspaces/\`

## 已经在用的一条治理链

根目录的文件名本身就是流水线（见 [[spec-to-final-gate]]）：

\`CP-A_V3_SPEC\` → \`AI15_OPEN1_EXECUTION_PLAN\` → \`AI15_OPEN1_STEP0_REALITY_REPORT\` → \`AI15_OPEN1_STEP1_DESIGN_REPORT\` → \`AI15_OPEN1_PHASE3A_INDEPENDENT_REVIEW\` → \`CP-A_V3_FINAL_GATE_REPORT\`

## 约定

- \`evidence/\` 存证据，\`review/\` 存独立评审，\`benchmarks/\` 存量化结果。
- 有 \`.pytest_cache\`、\`pytest.ini\`、\`requirements*.txt\` → 改动要有测试。
`
)

await put(
  'workflows/spec-to-final-gate.md',
  `---
id: kb_wf_spec_to_gate
type: workflow
title: 规格到终局门禁（研究执行流水线）
status: active
authority: agent-observed
review:
  state: pending
tags: [governance, review, spec]
created: ${now}
updated: ${now}
---

# 规格 → 终局门禁

> 从 \`AI-Security-Research-Workbench\` 根目录的产物命名反推出来的现成流水线。

## 何时适用

任何"要先定规格、再分阶段实施、且需要独立评审把关"的研究或改造。

## 步骤

1. **SPEC** —— 定死范围、接口、验收标准、非目标。
2. **EXECUTION_PLAN** —— 拆阶段，每阶段有可验证的产出。
3. **STEP0_REALITY_REPORT** —— 先核查现实：现状到底什么样，和规格假设差多少。
4. **STEP1_DESIGN_REPORT** —— 基于现实做设计（不是基于规格想象）。
5. **PHASE*_INDEPENDENT_REVIEW** —— 独立评审，不是自查。
6. **FINAL_GATE_REPORT** —— 终局门禁：逐条对回验收标准。

## 坑

- **跳过 STEP0** 就会在错误假设上做完全部设计。现实核查的成本远低于返工。
- **自查当评审** 等于没评审——独立评审要有不同的上下文与不同的动机。
- 阶段产物要**留档**，否则无法回答"当初为什么这么定"。

## 强化

- 每阶段的决策用 [[decisions]] 记 ADR（选 A 不选 B 的理由）。
- 未解问题单独记 \`type: question\`，并写清"什么证据能回答它"。
`
)

await put(
  'templates/memory-record.md',
  `---
id: kb_TEMPLATE
type: memory
scope: ws_yourworkspace
episode: ep_yourproject
status: active
authority: agent-observed
review:
  state: pending
created: ${now}
updated: ${now}
tags: []
---

# 一条工作区记忆（模板）

写什么：一个**跨会话仍有价值**的事实、决定、坑或步骤。

\`\`\`
- 断言 ^claim-xxxx
  - evidence: measured | reported | inferred | unverified
  - how: 怎么验证的 / 指到 [[note#^blk]]
  - confidence: low | medium | high
\`\`\`
`
)

await put(
  'templates/workflow.md',
  `---
id: kb_TEMPLATE_WF
type: workflow
title: 工作流名称
status: active
authority: agent-observed
review:
  state: pending
tags: []
created: ${now}
updated: ${now}
---

# 工作流名称

## 何时适用

## 前置条件

## 步骤

## 坑（含为什么踩）

## 来源

从哪次研究蒸馏来的：[[project-slug]]
`
)

await put(
  'templates/decision.md',
  `---
id: kb_TEMPLATE_ADR
type: decision
title: 决策标题
status: proposed
authority: inferred
review:
  state: pending
tags: [adr]
created: ${now}
updated: ${now}
---

# ADR：决策标题

## 背景

## 选项

- **A**：代价 / 收益
- **B**：代价 / 收益

## 决定

选 X，因为 …

## 后果

- 正面：
- 负面：
- **什么情况下该重新考虑**：
`
)

console.log(`vault: ${vaultRoot}`)
console.log(`created: ${written.length}`)
for (const rel of written) console.log(`  + ${rel}`)
if (skipped.length > 0) {
  console.log(`kept (already present): ${skipped.length}`)
  for (const rel of skipped) console.log(`  = ${rel}`)
}
console.log('')
console.log('下一步（可选）：给某个工作区打开工作区记忆')
console.log('  node tools/enable-workspace.mjs "D:\\SecurityLab" --id ws_securitylab --episode ep_2026_10')
