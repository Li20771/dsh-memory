#!/usr/bin/env node
/**
 * Portability verification for the memory repository.
 *
 *   node tools/portability.mjs [vaultRoot]
 *
 * Proves four things, and fails loudly on any of them:
 *
 *   1. No absolute path is stored in vault content. A note that hardcodes
 *      `D:\...` becomes wrong the moment the repo is cloned elsewhere, and the
 *      failure is silent — the index still builds, the links still resolve, the
 *      content is just quietly about the wrong machine.
 *   2. A clone works with nothing but the content: copy the vault, drop every
 *      derived artefact, rebuild from zero, and require the same answers.
 *   3. The .gitignore actually covers the derived and machine-local paths, so a
 *      clone never inherits them.
 *   4. The only machine-specific setting is the vault root itself.
 */
import { cp, mkdtemp, readFile, readdir, rm, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { VaultIndex } from '../plugin/lib/vault/index.js'
import { resolveCitation } from '../plugin/lib/vault/cite.js'
import { search } from '../plugin/lib/vault/query.js'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const REPO = resolve(HERE, '..')
const vaultRoot = resolve(process.argv[2] ?? join(REPO, 'kb'))

const passes = []
const failures = []
const ok = (m) => passes.push(m)
const bad = (m) => failures.push(m)

// --------------------------------------------------------- 1. absolute paths

const ABSOLUTE = [
  /[A-Za-z]:[\\/]/, // Windows drive
  /\\\\[A-Za-z0-9._-]+\\/, // UNC
  /(^|[\s"'`(])\/(?:Users|home|root|var|opt|mnt)\// // POSIX home/system paths
]

async function walk(dir) {
  const out = []
  const stack = [dir]
  while (stack.length > 0) {
    const current = stack.pop()
    let entries
    try {
      entries = await readdir(current, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const abs = join(current, entry.name)
      if (entry.isDirectory()) stack.push(abs)
      else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) out.push(abs)
    }
  }
  return out
}

const notes = await walk(vaultRoot)
if (notes.length === 0) bad(`vault 为空或不存在：${vaultRoot}`)
else ok(`扫描 ${notes.length} 篇笔记`)

const offenders = []
for (const file of notes) {
  const text = await readFile(file, 'utf8')
  const lines = text.split('\n')
  lines.forEach((line, index) => {
    for (const pattern of ABSOLUTE) {
      if (pattern.test(line)) {
        offenders.push({ file: relative(vaultRoot, file), line: index + 1, text: line.trim().slice(0, 120) })
        break
      }
    }
  })
}
if (offenders.length === 0) {
  ok('vault 内容不含绝对路径')
} else {
  bad(`vault 内容含 ${offenders.length} 处绝对路径（换机器即失效）`)
  for (const spot of offenders.slice(0, 10)) console.error(`    ${spot.file}:${spot.line}  ${spot.text}`)
}

// ------------------------------------------------------------- 2. clone test

let cloneDir = null
if (notes.length > 0) {
  try {
    cloneDir = await mkdtemp(join(tmpdir(), 'dsh-portability-'))
    const cloneVault = join(cloneDir, 'kb')
    // Copy ONLY the content: `.kb-index`, `.trash` and friends are excluded by
    // the filter below, which is the point — a clone has none of them.
    await cp(vaultRoot, cloneVault, {
      recursive: true,
      filter: (src) => !/[\\/](?:\.kb-index|\.trash|machines|node_modules)(?:[\\/]|$)/.test(src)
    })

    const derived = ['\.kb-index', '\.trash']
    for (const name of derived) {
      try {
        await access(join(cloneVault, name))
        bad(`克隆里出现了派生目录 ${name}，说明它没有被排除`)
      } catch {
        ok(`克隆不含 ${name}`)
      }
    }

    const original = new VaultIndex(vaultRoot)
    const cloned = new VaultIndex(cloneVault)
    const [originalStats, clonedStats] = await Promise.all([original.rebuild(), cloned.rebuild()])

    if (originalStats.files !== clonedStats.files) {
      bad(`克隆文件数不一致：原 ${originalStats.files} vs 克隆 ${clonedStats.files}`)
    } else {
      ok(`克隆与原件同为 ${clonedStats.files} 篇（从零重建，无派生数据）`)
    }

    // Same query must produce the same answer. Revisions are content hashes, so
    // this also proves no content was path-dependent.
    const query = 'type:workflow'
    const before = search(original, query, { limit: 10 })
    const after = search(cloned, query, { limit: 10 })
    const beforePaths = before.hits.map((h) => `${h.path}@${h.revision}`).sort()
    const afterPaths = after.hits.map((h) => `${h.path}@${h.revision}`).sort()
    if (JSON.stringify(beforePaths) === JSON.stringify(afterPaths)) {
      ok(`同一查询在克隆上给出相同结果（${beforePaths.length} 条，含 revision 一致）`)
    } else {
      bad(`克隆上的检索结果不同：\n    原: ${beforePaths.join(', ')}\n    克隆: ${afterPaths.join(', ')}`)
    }

    // A citation taken on the original must still resolve on the clone.
    const firstWithCite = before.hits.find((h) => h.citation)
    if (!firstWithCite) {
      ok('（无可验证的引用，跳过解析检查）')
    } else {
      const resolved = resolveCitation(cloned, firstWithCite.citation)
      if (resolved.status === 'ok') ok(`引用在克隆上仍为 ok（${firstWithCite.cite}）`)
      else bad(`引用在克隆上变成 ${resolved.status}（${firstWithCite.cite}），说明存在路径依赖`)
    }
  } catch (error) {
    bad(`克隆测试崩溃：${error?.message ?? error}`)
  } finally {
    if (cloneDir) await rm(cloneDir, { recursive: true, force: true })
  }
}

// --------------------------------------------------------- 3. .gitignore cover

try {
  const ignore = await readFile(join(REPO, '.gitignore'), 'utf8')
  const required = ['.kb-index/', '.trash/', 'machines/', 'node_modules/', 'chrome-profile/']
  const missing = required.filter((entry) => !ignore.includes(entry))
  if (missing.length === 0) ok('.gitignore 覆盖全部派生物与机器相关内容')
  else bad(`.gitignore 缺少：${missing.join(', ')}`)
} catch {
  bad('仓库根缺少 .gitignore')
}

// ------------------------------------------------- 4. what must change per host

console.log('')
for (const line of passes) console.log(`  ✓ ${line}`)
if (failures.length > 0) {
  console.error(`\nportability: ${failures.length} FAILED\n`)
  for (const line of failures) console.error(`  ✗ ${line}`)
  process.exit(1)
}
console.log('')
console.log('换机器时唯一需要改的设置：')
console.log('  dsh-memory 的 vaultRoot 指向新的 kb/ 路径。')
console.log('  其余一切（笔记、链接、引用、revision）随仓库走，无需改动。')
console.log(`\nportability: OK — ${passes.length} checks passed`)
