// P5 test suite: citations, revision pinning, sentence location, link health.
//   node --test tools/citation.test.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  extractAnchors,
  lineRangeOf,
  linkHealth,
  locateSentence,
  locateSentences,
  makeCitation,
  parseCitation,
  resolveCitation,
  revisionOf,
  splitSentences
} from '../plugin/lib/vault/cite.js'
import { VaultIndex } from '../plugin/lib/vault/index.js'
import { search, tokenize } from '../plugin/lib/vault/query.js'
import plugin from '../plugin/lib/index.js'
import { writeMarker } from '../plugin/lib/workspace.js'

// ------------------------------------------------------------------ revision

test('revisionOf is stable and changes with any edit', () => {
  const a = revisionOf('阈值是 0.8')
  const b = revisionOf('阈值是 0.8')
  const c = revisionOf('阈值是 0.86')
  assert.equal(a, b)
  assert.notEqual(a, c)
  assert.match(a, /^[0-9a-f]{12}$/)
})

// ------------------------------------------------------------------ citation

test('makeCitation prefers a block id over a heading, and renders Obsidian-compatible refs', () => {
  const withBlock = makeCitation({ note: 'a/b.md', block: 'blk1', heading: '发现', revision: 'r1', range: { start: 1, end: 9 } })
  assert.equal(withBlock.ref, 'a/b.md#^blk1')

  const withHeading = makeCitation({ note: 'a/b.md', block: null, heading: '发现', revision: 'r1' })
  assert.equal(withHeading.ref, 'a/b.md#发现')

  const bare = makeCitation({ note: 'a/b.md', revision: 'r1' })
  assert.equal(bare.ref, 'a/b.md')
})

test('parseCitation round-trips all three forms', () => {
  assert.deepEqual(parseCitation('a/b.md#^blk1'), { note: 'a/b.md', block: 'blk1', heading: null })
  assert.deepEqual(parseCitation('a/b.md#发现'), { note: 'a/b.md', block: null, heading: '发现' })
  assert.deepEqual(parseCitation('a/b.md'), { note: 'a/b.md', block: null, heading: null })
  // Block ids are case-insensitive on the way in.
  assert.equal(parseCitation('a/b.md#^BLK1').block, 'blk1')
})

// ------------------------------------------------------------- resolution

async function vaultOf(files) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-cite-'))
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(root, ...rel.split('/'))
    await mkdir(join(abs, '..'), { recursive: true })
    await writeFile(abs, body, 'utf8')
  }
  const index = new VaultIndex(root)
  await index.rebuild()
  return { root, index }
}

const NOTE = `---
type: finding
---
# 发现

接口在并发 8 时丢事件 ^blk1

阈值是 0.86 MPa。
`

test('resolveCitation: ok when the note and revision still match', async () => {
  const { root, index } = await vaultOf({ 'p/f.md': NOTE })
  try {
    const entry = index.get('p/f.md')
    const citation = makeCitation({ note: 'p/f.md', block: 'blk1', revision: revisionOf(entry.parsed.body), range: { start: 0, end: 10 } })
    const resolved = resolveCitation(index, citation)
    assert.equal(resolved.status, 'ok')
    assert.equal(resolved.revision, citation.revision)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('resolveCitation: an edited note makes the old citation STALE, not silently valid', async () => {
  const { root, index } = await vaultOf({ 'p/f.md': NOTE })
  try {
    const before = revisionOf(index.get('p/f.md').parsed.body)
    const citation = makeCitation({ note: 'p/f.md', block: 'blk1', revision: before, range: { start: 0, end: 10 } })

    await writeFile(join(root, 'p', 'f.md'), `${NOTE}\n又补了一句。\n`, 'utf8')
    await index.refresh()
    const after = resolveCitation(index, citation)
    assert.equal(after.status, 'stale')
    assert.notEqual(after.revision, before)
    assert.ok(after.text, 'still returns current text so a reader can compare')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('resolveCitation: missing note and moved block are distinct outcomes', async () => {
  const { root, index } = await vaultOf({ 'p/f.md': NOTE })
  try {
    assert.equal(resolveCitation(index, { note: 'gone.md', revision: 'x' }).status, 'missing')

    const blockless = await vaultOf({ 'p/g.md': `# 无块\n\n没有 id 的正文\n` })
    try {
      const moved = resolveCitation(blockless.index, { note: 'p/g.md', block: 'blk1', revision: 'x' })
      assert.equal(moved.status, 'moved')
    } finally {
      await rm(blockless.root, { recursive: true, force: true })
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

// ------------------------------------------------------------- sentences

test('splitSentences keeps offsets and handles CJK and Latin terminators', () => {
  const text = '第一句。第二句！Third one? And a fourth.'
  const parts = splitSentences(text)
  assert.ok(parts.length >= 3, JSON.stringify(parts))
  for (const part of parts) {
    assert.equal(text.slice(part.start, part.end), part.text)
  }
  assert.ok(parts.some((p) => p.text.includes('第一句')))
  assert.ok(parts.some((p) => p.text.includes('Third one')))
})

test('locateSentence picks the supporting sentence inside a passage', () => {
  const body = '背景信息无关紧要。接口在并发 8 时丢事件，这是关键结论。阈值是 0.86 MPa。'
  const all = { start: 0, end: body.length }
  const hit = locateSentence(body, all, '并发 丢事件', { tokenize })
  assert.ok(hit, 'a sentence was located')
  assert.ok(hit.text.includes('并发'), hit.text)
  assert.ok(!hit.text.includes('阈值'), 'the unrelated sentence was not chosen')
  assert.equal(body.slice(hit.start, hit.end), hit.text)
})

// --------------------------------------------------------- search wiring

test('search hits carry a citation, revision and best sentence', async () => {
  const { root, index } = await vaultOf({ 'p/f.md': NOTE })
  try {
    const result = search(index, '并发 丢事件')
    assert.ok(result.hits.length > 0)
    const hit = result.hits[0]
    assert.equal(hit.cite, 'p/f.md#^blk1', 'the encompassing block anchors the citation')
    assert.match(hit.revision, /^[0-9a-f]{12}$/)
    assert.ok(hit.citation && hit.citation.ref === hit.cite)
    assert.ok(hit.sentence, 'sentence-level precision present')
    assert.ok(hit.sentence.text.includes('并发'))
    assert.equal(hit.sentence.range.start >= 0 && hit.sentence.range.end <= index.get('p/f.md').parsed.body.length, true)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

// ------------------------------------------------------------- link health

test('linkHealth separates unresolved from ambiguous', async () => {
  const { root, index } = await vaultOf({
    'a/dup.md': '# a\n',
    'b/dup.md': '# b\n',
    'hub.md': '# hub\n\n[[dup]] 与 [[nope]] 与 [[a/dup]]\n'
  })
  try {
    const health = linkHealth(index)
    assert.equal(health.totalLinks, 3)
    assert.equal(health.resolvedLinks, 1, 'the explicit path resolves')
    assert.equal(health.ambiguous.length, 1, '[[dup]] is ambiguous')
    assert.equal(health.unresolved.length, 1, '[[nope]] is unresolved')
    assert.ok(health.unresolved[0].raw.includes('nope'))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

// ------------------------------------------------------------ tool surface

function makeCtx() {
  const tools = []
  return {
    tools,
    ctx: {
      systemPrompt: { section: () => () => {} },
      tools: { register: (t) => (tools.push(t), () => {}) },
      on: () => {},
      logger: { warn: (m) => console.log(`  [warn] ${m}`) }
    }
  }
}

async function mounted() {
  const base = await mkdtemp(join(tmpdir(), 'dsh-p5-'))
  const vaultRoot = join(base, 'kb')
  const workspace = join(base, 'Lab')
  const cwd = join(workspace, 'p1')
  await mkdir(join(vaultRoot, 'projects', 'p1'), { recursive: true })
  await mkdir(cwd, { recursive: true })
  await writeFile(join(vaultRoot, 'projects/p1/findings.md'), NOTE, 'utf8')
  await writeFile(join(vaultRoot, 'projects/p1/broken.md'), '# 断链\n\n[[不存在]]\n', 'utf8')
  await writeMarker(workspace, { schema: 1, enabled: true, id: 'ws_demo', coordinators: ['sess_coord'], state: 'active' })
  const harness = makeCtx()
  plugin.apply(harness.ctx, { vaultRoot, fullStatIntervalMs: 0 })
  return { base, vaultRoot, cwd, byName: new Map(harness.tools.map((t) => [t.name, t])) }
}

test('memory_search returns a citable hit, and verify turns stale after an edit', async () => {
  const { base, vaultRoot, cwd, byName } = await mounted()
  try {
    const agent = { workingDirectory: cwd, session: { id: 'sess_worker' } }
    const found = await byName.get('memory_search').execute({ query: '并发 丢事件' }, { agent })
    assert.ok(found.includes('projects/p1/findings.md#^blk1'), found)
    const rev = /rev=([0-9a-f]{12})/.exec(found)[1]
    assert.ok(found.includes('句='), found)

    const ok = await byName.get('memory_search').execute({ verify: 'projects/p1/findings.md#^blk1', revision: rev }, { agent })
    assert.ok(ok.includes('状态: ok'), ok)

    await writeFile(join(vaultRoot, 'projects/p1/findings.md'), `${NOTE}\n补充一句。\n`, 'utf8')
    const stale = await byName.get('memory_search').execute({ verify: 'projects/p1/findings.md#^blk1', revision: rev }, { agent })
    assert.ok(stale.includes('状态: stale'), stale)
    assert.ok(stale.includes('已被修改'), stale)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('memory_diagnose reports link health', async () => {
  const { base, cwd, byName } = await mounted()
  try {
    const out = await byName.get('memory_diagnose').execute({}, { agent: { workingDirectory: cwd, session: { id: 'sess_coord' } } })
    assert.ok(out.includes('链接健康'), out)
    assert.ok(out.includes('断链'), out)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('memory_write pins a revision into every source it cites', async () => {
  const { base, vaultRoot, cwd, byName } = await mounted()
  try {
    const agent = { workingDirectory: cwd, session: { id: 'sess_coord' } }
    const out = await byName.get('memory_write').execute(
      {
        type: 'finding',
        project: 'cpa',
        title: '结论甲',
        body: '由原始发现推出的结论。',
        sources: ['projects/p1/findings.md#^blk1']
      },
      { agent }
    )
    assert.ok(out.includes('projects/cpa/findings/'), out)

    const written = await readFile(join(vaultRoot, 'projects', 'cpa', 'findings', '结论甲.md'), 'utf8')
    assert.ok(written.includes('sources:'), written)
    assert.ok(written.includes('projects/p1/findings.md#^blk1@'), written)
    const pinned = /#\^blk1@([0-9a-f]{12})/.exec(written)
    assert.ok(pinned, written)
    // The pinned revision is the target's current one.
    const targetBody = (await import('../plugin/lib/vault/parse.js')).parseNote(NOTE).body
    assert.equal(pinned[1], revisionOf(targetBody))
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('a note under content dirs does not overwrite the project README', async () => {
  const { base, vaultRoot, cwd, byName } = await mounted()
  try {
    const agent = { workingDirectory: cwd, session: { id: 'sess_coord' } }
    await byName.get('memory_write').execute(
      { type: 'project', title: 'CPA', body: '项目总览', nonGoals: ['不做自动化利用'] },
      { agent }
    )
    await byName.get('memory_write').execute({ type: 'finding', project: 'CPA', title: '发现一', body: '内容一' }, { agent })
    await byName.get('memory_write').execute(
      { type: 'decision', project: 'CPA', title: '决策一', body: '内容二', alternatives: ['方案甲', '方案乙'] },
      { agent }
    )

    const readme = await readFile(join(vaultRoot, 'projects', 'cpa', 'README.md'), 'utf8')
    assert.ok(readme.includes('项目总览'), 'the project README keeps its own body')
    assert.ok(!readme.includes('内容一'), readme.slice(0, 300))

    const finding = await readFile(join(vaultRoot, 'projects', 'cpa', 'findings', '发现一.md'), 'utf8')
    assert.ok(finding.includes('内容一'))
    const decision = await readFile(join(vaultRoot, 'projects', 'cpa', 'decisions', '决策一.md'), 'utf8')
    assert.ok(decision.includes('内容二'))
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('memory_diagnose flags a citation whose target note changed', async () => {
  const { base, vaultRoot, cwd, byName } = await mounted()
  try {
    const agent = { workingDirectory: cwd, session: { id: 'sess_coord' } }
    await byName.get('memory_write').execute(
      { type: 'finding', project: 'cpa', title: '会变旧', body: '引用原始发现', sources: ['projects/p1/findings.md#^blk1'] },
      { agent }
    )
    const clean = await byName.get('memory_diagnose').execute({}, { agent })
    assert.ok(clean.includes('引用审计'), clean)
    assert.ok(clean.includes('陈旧 0'), clean)

    await writeFile(join(vaultRoot, 'projects/p1/findings.md'), `${NOTE}\n后续修改。\n`, 'utf8')
    const dirty = await byName.get('memory_diagnose').execute({}, { agent })
    assert.ok(dirty.includes('陈旧 1'), dirty)
    // And the audit explains what it used to say, from the snapshot.
    assert.ok(dirty.includes('引用时'), dirty)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

// ------------------------------------------- anchors, paraphrase, line numbers

test('extractAnchors pulls numbers, identifiers, paths and quotes', () => {
  const anchors = extractAnchors('并发 8 时丢事件，阈值 0.86 MPa，见 dsh-memory/lib/index.js 与 `blk1`')
  assert.ok(anchors.has('8'), [...anchors].join(','))
  assert.ok(anchors.has('0.86mpa'), [...anchors].join(','))
  assert.ok(anchors.has('dsh-memory'), [...anchors].join(','))
  assert.ok(anchors.has('dsh-memory/lib/index.js'), [...anchors].join(','))
  assert.ok(anchors.has('blk1'), [...anchors].join(','))
})

test('anchor matching beats wording: a paraphrase with the same number still finds the sentence', () => {
  const body = '背景无关。并发阈值设为 0.86 MPa 时开始丢事件。第三句也无关。'
  const all = { start: 0, end: body.length }
  // The claim shares almost no words with the supporting sentence, only the number.
  const hit = locateSentence(body, all, '压力到 0.86 MPa 会怎样', { tokenize })
  assert.ok(hit, 'located')
  assert.ok(hit.text.includes('0.86'), hit.text)
  assert.ok(hit.anchorHits.includes('0.86mpa'), JSON.stringify(hit.anchorHits))
})

test('locateSentences returns ranked candidates, not just one guess', () => {
  const body = '无关句。阈值 0.86 MPa。另一句提到 0.86 但无关。'
  const all = { start: 0, end: body.length }
  const ranked = locateSentences(body, all, '0.86 MPa 阈值', { tokenize }, 3)
  assert.ok(ranked.length >= 2, 'more than one candidate')
  assert.ok(ranked[0].score >= ranked[1].score, 'sorted by score')
})

test('lineRangeOf turns a character range into navigable line numbers', () => {
  const body = 'line one\nline two\nline three\n'
  const second = body.indexOf('line two')
  const lines = lineRangeOf(body, { start: second, end: second + 'line two'.length })
  assert.equal(lines.startLine, 2)
  assert.equal(lines.endLine, 2)

  const spanning = lineRangeOf(body, { start: body.indexOf('one'), end: body.indexOf('three') })
  assert.equal(spanning.startLine, 1)
  assert.equal(spanning.endLine, 3)
})

test('search hits expose line numbers and candidate sentences', async () => {
  const { root, index } = await vaultOf({ 'p/f.md': NOTE })
  try {
    const result = search(index, '并发 丢事件')
    const hit = result.hits[0]
    assert.ok(hit.lines && hit.lines.startLine >= 1, JSON.stringify(hit.lines))
    assert.ok(Array.isArray(hit.sentenceCandidates) && hit.sentenceCandidates.length > 0)
    assert.ok(hit.sentenceLines && hit.sentenceLines.startLine >= 1)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
