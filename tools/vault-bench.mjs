// Vault scale benchmark.
//   node tools/vault-bench.mjs [fileCount]
//
// Reports full rebuild, idle refresh, and single-file-change refresh at scale,
// so the "10k files" claim in the plan is backed by a measurement rather than
// an extrapolation from a toy fixture.

import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { VaultIndex } from '../plugin/lib/vault/index.js'

const target = Number(process.argv[2] ?? 2000)
const root = await mkdtemp(join(tmpdir(), 'dsh-vault-bench-'))

const now = Date.now()
for (let i = 0; i < target; i++) {
  const dir = join(root, 'projects', `p${i % 40}`)
  await mkdir(dir, { recursive: true })
  const body = `---
id: kb_${i}
type: research
title: 研究笔记 ${i}
tags: [t${i % 11}, group/t${i % 5}]
status: active
authority: agent-observed
created: 2026-0${1 + (i % 9)}-1${i % 9}T00:00:00+08:00
---
# 笔记 ${i}

这是第 ${i} 篇笔记的正文。${'安全研究方法与执行治理的内容在此展开。'.repeat(12)}

## 发现

接口在并发 ${i % 16} 时行为异常 ^blk-${i}

## 关联

见 [[note-${(i + 1) % target}]] 与 [[note-${(i + 7) % target}#^blk-${(i + 7) % target}]]。
`
  await writeFile(join(dir, `note-${i}.md`), body, 'utf8')
}
const genMs = Date.now() - now

const index = new VaultIndex(root)

const t0 = Date.now()
const full = await index.rebuild()
const rebuildMs = Date.now() - t0

const t1 = Date.now()
const idle = await index.refresh()
const idleMs = Date.now() - t1

await writeFile(
  join(root, 'projects', 'p0', 'note-0.md'),
  `---\ntitle: 改过的\n---\n# 改过\n\n${'新内容。'.repeat(20)}\n`,
  'utf8'
)
const t2 = Date.now()
const one = await index.refresh()
const oneMs = Date.now() - t2

console.log(`files          : ${target} (generated in ${genMs}ms)`)
console.log(`full rebuild   : ${rebuildMs}ms  (${((rebuildMs / target) * 1000).toFixed(0)}µs/file), parsed ${full.parsed}`)
console.log(`idle refresh   : ${idleMs}ms  (parsed ${idle.parsed}, reused ${idle.reused})`)
console.log(`1-file refresh : ${oneMs}ms  (changed ${one.changed.length})`)
console.log(`scale estimate : 10k ≈ ${Math.round((rebuildMs / target) * 10000)}ms rebuild, ${Math.round((idleMs / target) * 10000)}ms idle refresh`)

await rm(root, { recursive: true, force: true })
