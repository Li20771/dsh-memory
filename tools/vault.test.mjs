// P1 test suite — calibrated against the Obsidian 1.13.7 and NotebookLM
// reconstructions.
//   node --test tools/vault.test.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { parseNote, maskCode } from '../plugin/lib/vault/parse.js'
import { extractLinks, resolveTarget, resolveAnchor, normalizeTarget } from '../plugin/lib/vault/links.js'
import { VaultIndex } from '../plugin/lib/vault/index.js'
import { parseQuery, lex, search, tokenize } from '../plugin/lib/vault/query.js'
import { buildCanonical, toOriginal, segmentPassages } from '../plugin/lib/vault/canonical.js'

// ---------------------------------------------------------------- frontmatter

test('frontmatter: scalars, inline lists, nested maps, block lists', () => {
  const doc = `---
title: Hello World
status: active
salience: 4
draft: false
nothing: null
tags: [a, b/c]
list:
  - one
  - two
origin:
  session: sess_1
  turn: 7
review:
  state: pending
  by: sess_coord
---
body here`
  const note = parseNote(doc)
  assert.equal(note.frontmatter.title, 'Hello World')
  assert.equal(note.frontmatter.salience, 4)
  assert.equal(note.frontmatter.draft, false)
  assert.equal(note.frontmatter.nothing, null)
  assert.deepEqual(note.frontmatter.tags, ['a', 'b/c'])
  assert.deepEqual(note.frontmatter.list, ['one', 'two'])
  assert.equal(note.frontmatter.origin.turn, 7)
  assert.equal(note.frontmatter.review.state, 'pending')
  assert.equal(doc.slice(note.bodyOffset), 'body here')
})

test('frontmatter: quoted values, block-list of maps', () => {
  const doc = `---
title: "with: colon"
items:
  - name: first
    weight: 2
  - name: second
    weight: 3
---
x`
  const note = parseNote(doc)
  assert.equal(note.frontmatter.title, 'with: colon')
  assert.deepEqual(note.frontmatter.items, [
    { name: 'first', weight: 2 },
    { name: 'second', weight: 3 }
  ])
})

test('frontmatter: absent, and unclosed fence falls back to body', () => {
  const plain = parseNote('# Just a note\n\ntext')
  assert.equal(plain.frontmatter, null)
  assert.equal(plain.bodyOffset, 0)
  const unclosed = parseNote('---\ntitle: x\n\nno close here')
  assert.equal(unclosed.frontmatter, null)
  assert.ok(unclosed.warnings.some((w) => w.includes('without a closing')))
})

// ---------------------------------------------------------------------- masks

test('maskCode preserves length and newlines', () => {
  const src = 'a `x` b\n```\ncode\n```\nc'
  const masked = maskCode(src)
  assert.equal(masked.length, src.length)
  assert.equal(masked.split('\n').length, src.split('\n').length)
  assert.ok(!masked.includes('code'))
})

test('links and tags inside code are inert', () => {
  const doc = 'real [[link1]] #realtag\n\n```\n[[fake]] #nottag\n```\n\ninline `[[inlinefake]]` tail'
  const note = parseNote(doc)
  assert.deepEqual(extractLinks(note.masked, note.bodyOffset).map((l) => l.target), ['link1'])
  assert.ok(note.tags.includes('realtag'))
  assert.ok(!note.tags.includes('nottag'))
})

// ---------------------------------------------------------------------- blocks

test('blocks: paragraph and list-item ranges', () => {
  const doc = `Intro paragraph here. ^blk-intro

- item one
- item two ^blk-item

Closing paragraph.`
  const note = parseNote(doc)
  const intro = note.blocks.find((b) => b.id === 'blk-intro')
  const item = note.blocks.find((b) => b.id === 'blk-item')
  assert.equal(intro.kind, 'paragraph')
  assert.equal(intro.text, 'Intro paragraph here. ^blk-intro')
  assert.equal(item.kind, 'list-item')
  assert.equal(item.text, '- item two ^blk-item')
  assert.equal(doc.slice(intro.start, intro.start + 5), 'Intro')
})

test('blocks: standalone ^id labels the block above and is excluded from the range', () => {
  const doc = 'First paragraph text.\n\n^blk-above\n\nSecond paragraph.'
  const note = parseNote(doc)
  const block = note.blocks.find((b) => b.id === 'blk-above')
  assert.ok(block, 'block found')
  assert.equal(block.kind, 'paragraph')
  assert.equal(block.text, 'First paragraph text.')
  // The ^id line itself must not be inside the block range.
  assert.ok(!doc.slice(block.start, block.end).includes('^blk-above'))
})

test('blocks: heading / blockquote / table kinds', () => {
  const doc = '# Heading block ^h1\n\n> quoted line one\n> quoted two ^q1\n\n| a | b |\n| - | - | ^t1'
  const note = parseNote(doc)
  assert.equal(note.blocks.find((b) => b.id === 'h1').kind, 'heading')
  assert.equal(note.blocks.find((b) => b.id === 'q1').kind, 'blockquote')
  assert.equal(note.blocks.find((b) => b.id === 't1').kind, 'table')
})

test('blocks: ids are case-insensitive and duplicates keep the first', () => {
  const note = parseNote('a ^DUP\n\nb ^dup')
  assert.equal(note.blocks.length, 1)
  // The id is stored AS WRITTEN (Obsidian keeps the original and only lowercases
  // the cache key); comparison is what is case-insensitive.
  assert.equal(note.blocks[0].id, 'DUP')
  assert.equal(note.blocks[0].id.toLowerCase(), 'dup')
  assert.ok(note.warnings.some((w) => w.includes('more than once')))

  // And resolution still finds it from either casing.
  assert.notEqual(resolveAnchor(note, null, 'dup').kind, 'none')
  assert.notEqual(resolveAnchor(note, null, 'DUP').kind, 'none')
})

// -------------------------------------------------------------------- headings

test('headings: range ends at next same-or-higher level', () => {
  const doc = '# A\na-text\n## B\nb-text\n# C\nc-text'
  const note = parseNote(doc)
  const [a, b, c] = note.headings
  assert.equal(doc.slice(a.start, a.end), '# A\na-text\n## B\nb-text\n')
  assert.equal(doc.slice(b.start, b.end), '## B\nb-text\n')
  assert.equal(a.end, c.start)
})

// ----------------------------------------------------------------------- links

test('links: all supported forms', () => {
  const body = '[[Note]] [[Note|alias]] [[Note#Heading]] [[Note#^BLK1]] ![[Embed]] [[#Self]]'
  const links = extractLinks(body, 0)
  assert.deepEqual(
    links.map((l) => [l.target, l.anchor, l.block, l.alias, l.embed]),
    [
      ['Note', null, null, null, false],
      ['Note', null, null, 'alias', false],
      ['Note', 'Heading', null, null, false],
      ['Note', null, 'blk1', null, false], // block ids are lowercased
      ['Embed', null, null, null, true],
      ['', 'Self', null, null, false]
    ]
  )
})

test('links: backslashes are NOT normalized (Obsidian leaves them unresolved)', () => {
  // RE §10.1: `[[a\Index]]` -> null. My first version rewrote `\` to `/`.
  assert.equal(normalizeTarget('a\\Index').path, 'a\\index')
  const lookup = { byPath: () => undefined, byBasename: () => [], bySuffix: () => [] }
  assert.deepEqual(resolveTarget('a\\Index', lookup, 'root.md'), { kind: 'unresolved' })
})

test('links: ./ resolves, ../ escaping the root does not', () => {
  const lookup = {
    byPath: (p) => (p === 'a/index' ? 'a/Index.md' : undefined),
    byBasename: () => [],
    bySuffix: () => []
  }
  assert.deepEqual(resolveTarget('./a/Index', lookup, 'root.md'), { kind: 'file', fileId: 'a/Index.md' })
  assert.deepEqual(resolveTarget('../Index', lookup, 'root.md'), { kind: 'unresolved' })
})

test('links: resolution precedence — unique basename, then same dir, then shortest', () => {
  const lookup = {
    byPath: (p) => (p === 'projects/a/note' ? 'projects/a/note.md' : undefined),
    byBasename: (b) =>
      b === 'uniq' ? ['z/uniq.md'] : b === 'dup' ? ['x/deep/dir/dup.md', 'x/dup.md'] : b === 'here' ? ['src/here.md', 'other/here.md'] : [],
    bySuffix: (n) => (n === 'sub/only' ? ['w/sub/only.md'] : [])
  }
  assert.deepEqual(resolveTarget('uniq', lookup, 'src/x.md'), { kind: 'file', fileId: 'z/uniq.md' })
  assert.deepEqual(resolveTarget('projects/a/note', lookup, 'root.md'), { kind: 'file', fileId: 'projects/a/note.md' })
  assert.deepEqual(resolveTarget('sub/only', lookup, 'root.md'), { kind: 'file', fileId: 'w/sub/only.md' })
  // Duplicate basenames: non-(same-dir) case falls back to shortest path first.
  assert.deepEqual(resolveTarget('dup', lookup, 'root.md'), { kind: 'ambiguous', candidates: ['x/dup.md', 'x/deep/dir/dup.md'] })
  // Same-directory candidate wins outright.
  assert.deepEqual(resolveTarget('here', lookup, 'src/x.md'), { kind: 'file', fileId: 'src/here.md' })
  assert.deepEqual(resolveTarget('missing', lookup, 'root.md'), { kind: 'unresolved' })
})

test('links: aliases do not resolve', () => {
  const lookup = { byPath: () => undefined, byBasename: (b) => (b === 'aliasname' ? ['real.md'] : []), bySuffix: () => [] }
  // `[[aliasname]]` resolves by basename because a file has that name; the
  // point here is that `frontmatter.aliases` is never consulted by resolveTarget.
  assert.equal(resolveTarget('aliasname', lookup, 'r.md').kind, 'file')
})

test('links: anchor resolution is case-insensitive for blocks', () => {
  const parsed = parseNote('# Target Head\nbody ^blk9\n\nmore')
  assert.equal(resolveAnchor(parsed, 'target head', null).kind, 'heading')
  assert.equal(resolveAnchor(parsed, null, 'BLK9').kind, 'block')
  assert.deepEqual(resolveAnchor(parsed, 'Nope', null), { kind: 'none', start: 0, end: 0 })
})

// ----------------------------------------------------------------- canonical

test('canonical: headings, emphasis and newlines flatten; map round-trips', () => {
  const body = '## 标题甲\n\n正文 **加粗** 内容。\n\n第二段。'
  const { text, map } = buildCanonical(body)
  assert.ok(text.startsWith('标题甲 '), text.slice(0, 20))
  assert.ok(!text.includes('##'))
  assert.ok(!text.includes('**'))
  assert.ok(!text.includes('\n'))
  // A canonical range maps back into the original body.
  const at = text.indexOf('正文')
  const original = toOriginal(map, at, at + 2)
  assert.equal(body.slice(original.start, original.end), '正文')
})

test('canonical: passages are ~target sized, non-overlapping, tails kept', () => {
  const body = `${'句子内容。'.repeat(400)}\n\n短尾巴。`
  const { text } = buildCanonical(body)
  const passages = segmentPassages(text, { target: 900 })
  assert.ok(passages.length >= 3)
  for (let i = 1; i < passages.length; i++) {
    assert.equal(passages[i].start, passages[i - 1].end, 'no overlap, no gap')
  }
  assert.equal(passages[passages.length - 1].end, text.length)
})

// ---------------------------------------------------------------- vault index

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-vault-'))
  const write = async (rel, body) => {
    const abs = join(root, ...rel.split('/'))
    await mkdir(join(abs, '..'), { recursive: true })
    await writeFile(abs, body, 'utf8')
  }
  await write(
    'projects/p1/README.md',
    `---
title: CPA 项目
status: active
salience: 4
tags: [adr, p1]
---
# CPA

核心结论见 [[findings#^f1]]。也见 [[glossary]]。

## 背景
用 pnpm 管理依赖。
`
  )
  await write(
    'projects/p1/findings.md',
    `---
tags: [p1/finding]
status: active
---
# 发现

接口在并发 8 时丢事件 ^f1

另一个发现 ^f2
`
  )
  await write('glossary.md', '---\ntags: [glossary]\nstatus: draft\n---\n# 术语\n\nCPA 是跨层规避的缩写。\n')
  await write('workspaces/w1.md', '---\ntags: [workspace]\nstatus: active\n---\n# SecurityLab\n\n工作项目总库。\n')
  // AND/OR precedence probes
  await write('andor/a.md', 'alpha beta\n')
  await write('andor/b.md', 'gamma only\n')
  await write('andor/c.md', 'alpha gamma\n')
  return { root, write }
}

test('index: backlinks, outlinks, tags, blocks', async () => {
  const { root } = await fixture()
  try {
    const index = new VaultIndex(root)
    await index.rebuild()
    assert.equal(index.stats.files, 7)

    const out = index.outlinksOf('projects/p1/README.md')
    const targets = out.filter((l) => l.resolution === 'file').map((l) => l.fileId).sort()
    assert.deepEqual(targets, ['glossary.md', 'projects/p1/findings.md'])
    assert.deepEqual(index.backlinksOf('projects/p1/findings.md'), ['projects/p1/README.md'])

    const tags = index.tagsIndex()
    assert.deepEqual(tags['p1'], ['projects/p1/README.md'])
    assert.deepEqual(tags['p1/finding'], ['projects/p1/findings.md'])

    const blocks = index.blocksIn('projects/p1/findings.md')
    assert.deepEqual(blocks.map((b) => b.id), ['f1', 'f2'])
    assert.equal(index.cite('projects/p1/findings.md', { kind: 'block', start: blocks[0].start }), 'projects/p1/findings.md#^f1')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('index: incremental refresh reports added/changed/removed', async () => {
  const { root, write } = await fixture()
  try {
    const index = new VaultIndex(root)
    await index.rebuild()
    const v1 = index.version

    const quiet = await index.refresh()
    assert.equal(quiet.parsed, 0)

    await write('projects/p1/findings.md', '---\ntags: [p1/finding]\n---\n# 发现\n\n改写后的结论 ^f1\n')
    const changed = await index.refresh()
    assert.deepEqual(changed.changed, ['projects/p1/findings.md'])
    assert.ok(index.version > v1)

    await rm(join(root, 'workspaces', 'w1.md'))
    const removed = await index.refresh()
    assert.deepEqual(removed.removed, ['workspaces/w1.md'])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------- query

test('query: lexer understands phrases, regex, property and comparison', () => {
  const tokens = lex('"exact phrase" /ga+m/ [status:active] salience>3 -tag:draft')
  assert.ok(tokens.some((t) => t.type === 'phrase' && t.value === 'exact phrase'))
  assert.ok(tokens.some((t) => t.type === 'regex' && t.value === 'ga+m'))
  assert.ok(tokens.some((t) => t.type === 'prop' && t.value === 'status:active'))
  assert.ok(tokens.some((t) => t.type === 'cmp' && t.op === 'salience' && t.cmp === '>' && t.value === '3'))
  assert.ok(tokens.some((t) => t.type === 'NOT'))
  assert.ok(tokens.some((t) => t.type === 'op' && t.op === 'tag' && t.value === 'draft'))
})

test('query: AND binds tighter than OR', async () => {
  const { root } = await fixture()
  try {
    const index = new VaultIndex(root)
    await index.rebuild()
    // `alpha beta OR gamma` must be (alpha AND beta) OR gamma -> a, b, c.
    const result = search(index, 'alpha beta OR gamma', { scopes: [{ name: 'andor', test: (p) => p.startsWith('andor/') }] })
    const got = result.hits.map((h) => h.path).sort()
    assert.deepEqual(got, ['andor/a.md', 'andor/b.md', 'andor/c.md'])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('query: OR is uppercase-only', async () => {
  const { root } = await fixture()
  try {
    const index = new VaultIndex(root)
    await index.rebuild()
    // lowercase `or` is a plain term: nothing contains all three words.
    const lower = search(index, 'alpha or gamma', { scopes: [{ name: 'andor', test: (p) => p.startsWith('andor/') }] })
    assert.equal(lower.hits.length, 0)
    const upper = search(index, 'alpha OR gamma', { scopes: [{ name: 'andor', test: (p) => p.startsWith('andor/') }] })
    assert.ok(upper.hits.length >= 2)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('query: operators, negation, property, comparison, regex', async () => {
  const { root } = await fixture()
  try {
    const index = new VaultIndex(root)
    await index.rebuild()

    assert.deepEqual(search(index, 'tag:glossary').hits.map((h) => h.path), ['glossary.md'])
    assert.ok(!search(index, 'CPA -pnpm').hits.some((h) => h.path === 'projects/p1/README.md'))
    assert.ok(search(index, '[status:active]').hits.length >= 3)
    assert.ok(!search(index, '[status:draft]').hits.some((h) => h.path === 'projects/p1/README.md'))
    assert.ok(search(index, 'salience>3').hits.some((h) => h.path === 'projects/p1/README.md'))
    // A bare regex matches note CONTENT; a name match needs file:/path:.
    assert.ok(search(index, '/跨层/').hits.some((h) => h.path === 'glossary.md'))
    assert.ok(search(index, 'file:glossary').hits.some((h) => h.path === 'glossary.md'))
    assert.ok(search(index, 'path:projects/**').hits.every((h) => h.path.startsWith('projects/')))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('query: match-case switches case sensitivity', async () => {
  const { root } = await fixture()
  try {
    const index = new VaultIndex(root)
    await index.rebuild()
    const insensitive = search(index, 'cpa')
    assert.ok(insensitive.hits.length > 0)
    const sensitive = search(index, 'match-case CPA')
    assert.ok(sensitive.hits.length > 0)
    const upperOnly = search(index, 'match-case cpa')
    assert.equal(upperOnly.hits.length, 0)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('query: no-match is reported honestly', async () => {
  const { root } = await fixture()
  try {
    const index = new VaultIndex(root)
    await index.rebuild()
    const miss = search(index, '量子色动力学')
    assert.equal(miss.hits.length, 0)
    assert.ok(miss.notes.some((n) => n.includes('没有')))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('query: scope funnel narrows first and reports widening', async () => {
  const { root } = await fixture()
  try {
    const index = new VaultIndex(root)
    await index.rebuild()
    const scopes = [
      { name: 'project', test: (p) => p.startsWith('projects/p1/') },
      { name: 'workspace', test: (p) => p.startsWith('workspaces/') },
      { name: 'all', test: null }
    ]
    const widened = search(index, '术语', { scopes, limit: 5 })
    assert.equal(widened.hits[0].path, 'glossary.md')
    assert.equal(widened.widened, true)
    assert.deepEqual(widened.triedScopes, ['project', 'workspace', 'all'])

    const narrow = search(index, 'pnpm', { scopes, limit: 5 })
    assert.equal(narrow.widened, false)
    assert.deepEqual(narrow.triedScopes, ['project'])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('query: citation carries the section around the best passage', async () => {
  const { root } = await fixture()
  try {
    const index = new VaultIndex(root)
    await index.rebuild()
    const hit = search(index, '并发 丢事件')
    assert.equal(hit.hits[0].path, 'projects/p1/findings.md')
    assert.equal(hit.hits[0].section, '发现')
    assert.ok(hit.hits[0].passage.includes('并发'))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

// ------------------------------------------------------------------ perf note

test('perf: 400-file rebuild and idle refresh stay interactive', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-vault-perf-'))
  try {
    for (let i = 0; i < 400; i++) {
      const dir = join(root, 'projects', `p${i % 20}`)
      await mkdir(dir, { recursive: true })
      await writeFile(
        join(dir, `note-${i}.md`),
        `---\ntitle: note ${i}\ntags: [t${i % 7}]\n---\n# Note ${i}\n\n${'句子内容 '.repeat(40)}\n\n关联 [[note-${(i + 1) % 400}]]\n`,
        'utf8'
      )
    }
    const index = new VaultIndex(root)
    const full = await index.rebuild()
    assert.equal(full.files, 400)
    assert.ok(full.ms < 5000, `full rebuild took ${full.ms}ms`)
    const inc = await index.refresh()
    assert.ok(inc.ms < 2000, `idle refresh took ${inc.ms}ms`)
    console.log(`      [perf] 400 files: rebuild ${full.ms}ms, idle refresh ${inc.ms}ms`)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
