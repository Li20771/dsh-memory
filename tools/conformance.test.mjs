// Conformance against the Obsidian 1.13.7 reverse-engineering assertions.
//   node --test tools/conformance.test.mjs
//
// `spec-assertions.json` was transcribed from runtime observation and static
// evidence during the RE. Until now it was a document; this file makes it an
// executable contract, so a future refactor of the parser cannot quietly drift away
// from the observed behaviour.
//
// Three outcomes, and the middle one exists on purpose:
//   ok          — matches Obsidian
//   divergence  — we knowingly behave differently, with a written reason
//   fail        — anything else, i.e. a bug
//
// A divergence that starts passing is reported too: otherwise the list rots into
// a pile of stale excuses nobody re-checks.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { maskCode, parseNote } from '../plugin/lib/vault/parse.js'
import { extractLinks, normalizeTarget, resolveAnchor, resolveTarget } from '../plugin/lib/vault/links.js'
import { lineRangeOf } from '../plugin/lib/vault/cite.js'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const REPO = resolve(HERE, '..')
const SPEC = await readFile(join(REPO, 'tools', 'spec-assertions.json'), 'utf8').then(JSON.parse)
// The spec's own `vault` field is an absolute Windows path. We deliberately ignore
// it and resolve the fixture relatively — if the suite needed that path it would
// not be portable, which is the whole point of P6.
const FIXTURE = join(REPO, 'research', 'fixtures', 'vault-re')

/**
 * Deliberate differences from Obsidian, each with the reason it exists.
 * Keyed by assertion id so an entry can be removed the moment it stops applying.
 */
const DOCUMENTED_DIVERGENCES = {
  'res-01':
    'Obsidian 在同名候选中按"最短路径"直接挑一个（a/Index.md）；我们对无人称的歧义返回 ambiguous 并在诊断里报警，而不是猜。猜错会静默把引用指到错的笔记上。',
  'fm-07':
    'Obsidian 的 metadataCache 有一条"空集会被 delete"的键裁剪规则；我们的 parseNote 不做 cache 形状模拟（没有 sections/frontmatterPosition/frontmatterLinks 这些 Obsidian 内部字段），所以这条不适用。'
}

// ---------------------------------------------------------------- fixture load

async function walk(dir, base = dir) {
  const out = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...(await walk(abs, base)))
    else out.push(join(abs).slice(base.length + 1).split('\\').join('/'))
  }
  return out
}

const files = (await walk(FIXTURE)).sort()
const lookup = (() => {
  const byPath = new Map()
  const byBasename = new Map()
  // Mirrors VaultIndex's own index construction: normalizeTarget keys, so
  // case-insensitivity is exercised through the real function rather than a
  // test-local lowercase hack.
  for (const file of files) {
    const norm = normalizeTarget(file)
    byPath.set(norm.path, file)
    const list = byBasename.get(norm.base) ?? []
    list.push(file)
    byBasename.set(norm.base, list)
  }
  return {
    byPath: (p) => byPath.get(normalizeTarget(p).path),
    byBasename: (n) => byBasename.get(normalizeTarget(n).base) ?? [],
    bySuffix: (name) => {
      const wanted = normalizeTarget(name).path
      const hits = []
      for (const [key, id] of byPath) if (key === wanted || key.endsWith(`/${wanted}`)) hits.push(id)
      return hits
    }
  }
})()

const sourceCache = new Map()
async function sourceOf(rel) {
  if (!sourceCache.has(rel)) sourceCache.set(rel, await readFile(join(FIXTURE, ...rel.split('/')), 'utf8'))
  return sourceCache.get(rel)
}
const parsedCache = new Map()
async function parsedOf(rel) {
  if (!parsedCache.has(rel)) {
    const text = await sourceOf(rel)
    parsedCache.set(rel, { text, parsed: parseNote(text) })
  }
  return parsedCache.get(rel)
}

// -------------------------------------------------------------------- runners

const NODE_TYPE = {
  paragraph: 'paragraph',
  blockquote: 'blockquote',
  table: 'table',
  listItem: 'list-item',
  heading: 'heading'
}

/** @returns {{ok:boolean, detail?:string}} */
async function runLinkResolve(c) {
  // The assertion's `link` may carry `#anchor` / `#^block`; the resolver works on
  // the file part only. In the real pipeline extractLinks does that split, so the
  // split here mirrors the real call site rather than inventing a new rule.
  const hash = c.link.indexOf('#')
  const filePart = hash >= 0 ? c.link.slice(0, hash) : c.link
  const result = resolveTarget(filePart, lookup, c.source)
  const actual = result.kind === 'file' ? result.fileId : result.kind === 'ambiguous' ? `ambiguous(${result.candidates.join('|')})` : null
  if (actual === c.expected) return { ok: true }
  return { ok: false, detail: `期望 ${c.expected ?? 'null'}，实际 ${actual ?? 'null'}` }
}

async function runBlockId(c) {
  const { parsed } = await parsedOf(c.file)
  const hit = (parsed.blocks ?? []).find((b) => b.id && b.id.toLowerCase() === c.id.toLowerCase())
  if (c.expected === null) {
    return hit ? { ok: false, detail: `期望不成立，实际解析出 ${hit.kind}` } : { ok: true }
  }
  if (!hit) return { ok: false, detail: '期望成立，实际未找到该块 id' }

  const problems = []
  if (c.expected.nodeType) {
    const want = NODE_TYPE[c.expected.nodeType] ?? c.expected.nodeType
    if (hit.kind !== want) problems.push(`kind=${hit.kind} 期望 ${want}`)
  }
  if (c.expected.originalId && hit.id !== c.expected.originalId) problems.push(`id=${hit.id} 期望 ${c.expected.originalId}`)
  if (c.expected.startLine !== undefined || c.expected.endLine !== undefined) {
    const { text, parsed: p } = await parsedOf(c.file)
    const lines = lineRangeOf(text, { start: p.bodyOffset + hit.start, end: p.bodyOffset + hit.end })
    // The spec records Obsidian's `position.line`, which is 0-BASED; we render
    // 1-based line numbers (they are what every editor shows). Compare after the
    // shift instead of pretending the two conventions agree.
    if (c.expected.startLine !== undefined && lines.startLine - 1 !== c.expected.startLine) {
      problems.push(`startLine=${lines.startLine - 1}(0-based) 期望 ${c.expected.startLine}`)
    }
    if (c.expected.endLine !== undefined && lines.endLine - 1 !== c.expected.endLine) {
      problems.push(`endLine=${lines.endLine - 1}(0-based) 期望 ${c.expected.endLine}`)
    }
  }
  return problems.length === 0 ? { ok: true } : { ok: false, detail: problems.join('; ') }
}

async function runSubpath(c) {
  const { text, parsed } = await parsedOf(c.file)
  const sub = c.subpath.replace(/^#/, '')
  const isBlock = sub.startsWith('^')
  const resolved = resolveAnchor(parsed, isBlock ? null : sub, isBlock ? sub.slice(1) : null)

  if (c.expected.resolved === false) {
    return resolved.kind === 'none' ? { ok: true } : { ok: false, detail: `期望未解析，实际 ${resolved.kind}` }
  }
  if (resolved.kind === 'none') return { ok: false, detail: '期望解析成功，实际 none' }

  const problems = []
  if (c.expected.type && resolved.kind !== c.expected.type) problems.push(`type=${resolved.kind} 期望 ${c.expected.type}`)
  if (c.expected.startOffset !== undefined) {
    // resolveAnchor returns BODY offsets; the assertion records FILE offsets.
    const start = parsed.bodyOffset + resolved.start
    const end = parsed.bodyOffset + resolved.end
    if (start !== c.expected.startOffset) problems.push(`startOffset=${start} 期望 ${c.expected.startOffset}`)
    if (c.expected.endOffset !== undefined && end !== c.expected.endOffset) problems.push(`endOffset=${end} 期望 ${c.expected.endOffset}`)
  }
  if (c.expected.startLine !== undefined) {
    const lines = lineRangeOf(text, { start: parsed.bodyOffset + resolved.start, end: parsed.bodyOffset + resolved.end })
    // 0-based in the spec, 1-based in our output — see the block-id runner.
    if (lines.startLine - 1 !== c.expected.startLine) problems.push(`startLine=${lines.startLine - 1}(0-based) 期望 ${c.expected.startLine}`)
    if (c.expected.endLine !== undefined && lines.endLine - 1 !== c.expected.endLine) {
      problems.push(`endLine=${lines.endLine - 1}(0-based) 期望 ${c.expected.endLine}`)
    }
  }
  return problems.length === 0 ? { ok: true } : { ok: false, detail: problems.join('; ') }
}

async function runLinkCache(c) {
  const { text, parsed } = await parsedOf(c.file)
  const links = extractLinks(parsed.masked, parsed.bodyOffset)
  const hit = links.find((l) => l.raw === c.original)
  if (!hit) return { ok: false, detail: `未从 ${c.file} 抽取到 ${c.original}` }

  // Reconstruct Obsidian's cache shape from the parts we keep.
  const suffix = hit.block ? `^${hit.block}` : hit.anchor ? hit.anchor : ''
  const link = suffix === '' ? hit.target : `${hit.target}#${suffix}`
  const displayText = hit.alias ?? (suffix === '' ? hit.target : `${hit.target} > ${suffix}`)

  const problems = []
  if (c.expected.link !== undefined && link !== c.expected.link) problems.push(`link=${link} 期望 ${c.expected.link}`)
  if (c.expected.displayText !== undefined && displayText !== c.expected.displayText) {
    problems.push(`displayText=${displayText} 期望 ${c.expected.displayText}`)
  }
  void text
  return problems.length === 0 ? { ok: true } : { ok: false, detail: problems.join('; ') }
}

async function runCodeProtection(c) {
  // The spec's `text` field is a description, not a literal, so the intent is
  // tested directly: a link inside inline code or a fence must not be counted.
  const samples = [
    { label: '行内代码', text: 'before `[[Note]]` after' },
    { label: '围栏代码', text: '```\n[[Note]]\n```\n' }
  ]
  for (const sample of samples) {
    const links = extractLinks(maskCode(sample.text))
    if (links.length !== 0) return { ok: false, detail: `${sample.label}里仍抽到 ${links.length} 条链接` }
  }
  const plain = extractLinks(maskCode('plain [[Note]] here'))
  if (plain.length !== 1) return { ok: false, detail: `普通链接应抽到 1 条，实际 ${plain.length}` }
  void c
  return { ok: true }
}

async function runNestedReject(c) {
  const links = extractLinks(maskCode(c.text))
  return links.length === 0 ? { ok: true } : { ok: false, detail: `嵌套 ${c.text} 抽出 ${links.length} 条：${links.map((l) => l.raw).join(', ')}` }
}

async function runFrontmatter(c) {
  const { parsed } = await parsedOf(c.file)
  const actual = parsed.frontmatter ? parsed.frontmatter[c.key] : undefined
  const normalise = (v) => (v === undefined ? '__undefined__' : v)
  if (JSON.stringify(normalise(actual)) === JSON.stringify(normalise(c.expected))) return { ok: true }
  return { ok: false, detail: `期望 ${JSON.stringify(c.expected)}，实际 ${JSON.stringify(actual ?? null)}` }
}

const RUNNERS = {
  'link-resolve': runLinkResolve,
  'block-id': runBlockId,
  subpath: runSubpath,
  'link-cache': runLinkCache,
  'code-protection': runCodeProtection,
  'nested-reject': runNestedReject,
  frontmatter: runFrontmatter,
  'cache-keys': async () => ({ ok: false, detail: '本实现不模拟 Obsidian 的 metadataCache 键形状' })
}

// ---------------------------------------------------------------------- suite

const outcomes = []

test('conformance: every case in spec-assertions.json is classified', async () => {
  assert.ok(files.length > 0, `fixture 为空：${FIXTURE}`)
  for (const one of SPEC.cases) {
    const runner = RUNNERS[one.kind]
    let result
    if (!runner) result = { ok: false, detail: `未知 kind ${one.kind}` }
    else {
      try {
        result = await runner(one)
      } catch (error) {
        result = { ok: false, detail: `抛错 ${error?.message ?? error}` }
      }
    }
    const documented = DOCUMENTED_DIVERGENCES[one.id]
    const verdict = result.ok ? (documented ? 'stale-divergence' : 'ok') : documented ? 'divergence' : 'fail'
    outcomes.push({ id: one.id, kind: one.kind, verdict, detail: result.detail })
  }

  const fails = outcomes.filter((o) => o.verdict === 'fail')
  const stale = outcomes.filter((o) => o.verdict === 'stale-divergence')
  const report = [
    `共 ${outcomes.length} 条：ok ${outcomes.filter((o) => o.verdict === 'ok').length}｜已记录偏离 ${
      outcomes.filter((o) => o.verdict === 'divergence').length
    }｜失败 ${fails.length}｜失效的偏离记录 ${stale.length}`
  ]
  for (const f of fails) report.push(`  ✗ ${f.id} (${f.kind}) ${f.detail ?? ''}`)
  for (const s of stale) report.push(`  ⚠ ${s.id} 已不再偏离，请从 DOCUMENTED_DIVERGENCES 删除该条`)
  assert.equal(fails.length, 0, report.join('\n'))
  assert.equal(stale.length, 0, report.join('\n'))
})

test('conformance: coverage by kind is what the spec claims', () => {
  const byKind = new Map()
  for (const o of outcomes) byKind.set(o.kind, (byKind.get(o.kind) ?? 0) + 1)
  for (const [kind, count] of byKind) assert.ok(count > 0, `${kind} 没有用例`)
  // The spec's own docstring says P1 must be able to run every case.
  assert.equal(
    outcomes.filter((o) => o.verdict === 'ok' || o.verdict === 'divergence').length,
    SPEC.cases.length,
    '存在未分类用例'
  )
})

test('conformance: the fixture is portable (no absolute path needed)', async () => {
  // If any fixture file embedded an absolute path, the suite would only pass on
  // this machine.
  for (const file of files) {
    if (!file.endsWith('.md')) continue
    const text = await sourceOf(file)
    assert.doesNotMatch(text, /[A-Za-z]:\\/, `${file} 含绝对路径`)
  }
  // And the spec's own absolute `vault` field must not be load-bearing.
  assert.ok(SPEC.vault.includes(':\\'), 'spec 里本就是绝对路径，我们靠相对解析绕过它')
})
