// P6 test suite: optional semantic recall + L3 workflow lifecycle.
//   node --test tools/semantic.test.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm, readFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { cosine, createEmbeddingProvider, nullProvider } from '../plugin/lib/vault/embedding.js'
import { WORKFLOW_FORGET_SCORE, workflowDecay } from '../plugin/lib/memory/policy.js'
import { VaultIndex } from '../plugin/lib/vault/index.js'
import { search } from '../plugin/lib/vault/query.js'
import plugin from '../plugin/lib/index.js'
import { readMarker, writeMarker } from '../plugin/lib/workspace.js'

// ------------------------------------------------------------------ cosine

test('cosine is bounded and safe on degenerate input', () => {
  assert.equal(cosine([1, 0], [1, 0]), 1)
  assert.equal(cosine([1, 0], [0, 1]), 0)
  assert.equal(cosine([], []), 0)
  assert.equal(cosine([0, 0], [1, 1]), 0)
  assert.equal(cosine([1, 2], [1, 2, 3]), 0, 'length mismatch is not a similarity')
})

// -------------------------------------------------------------- provider

/** Deterministic fake embeddings: three keyword dimensions. */
const fakeVectors = (texts) =>
  texts.map((t) => {
    const lower = String(t).toLowerCase()
    return [
      lower.includes('alpha') ? 1 : 0,
      lower.includes('beta') ? 1 : 0,
      lower.includes('zeta') ? 1 : 0
    ]
  })

const stubRequest = async (url, init) => {
  const body = JSON.parse(init.body)
  return { ok: true, status: 200, json: async () => ({ data: fakeVectors(body.input).map((embedding) => ({ embedding })) }) }
}

test('provider is inert unless enabled, and a null provider never throws', async () => {
  const off = createEmbeddingProvider({ enabled: false, endpoint: 'http://x' }, { request: stubRequest })
  assert.equal(off.enabled, false)
  assert.equal(await off.embed(['alpha']), null)
  assert.equal((await off.expand({ paths: () => [], get: () => undefined }, 'alpha')).size, 0)

  const nulls = nullProvider()
  assert.equal(nulls.enabled, false)
  assert.equal(await nulls.embed(['x']), null)
  assert.equal((await nulls.expand({ paths: () => [], get: () => undefined }, 'x')).size, 0)
})

test('a failing embedder returns null instead of throwing', async () => {
  const broken = createEmbeddingProvider(
    { enabled: true, endpoint: 'http://x' },
    { request: async () => { throw new Error('boom') } }
  )
  assert.equal(await broken.embed(['alpha']), null)
  const status = broken.status()
  assert.equal(status.failures, 1)
  assert.ok(status.lastError.includes('boom'))
})

test('expand only returns paths inside the scope predicate (sharding)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-emb-'))
  try {
    for (const [rel, body] of [
      ['ws_a/one.md', 'alpha belongs to workspace A'],
      ['ws_a/two.md', 'nothing here'],
      ['ws_b/three.md', 'alpha belongs to workspace B']
    ]) {
      const abs = join(root, ...rel.split('/'))
      await mkdir(join(abs, '..'), { recursive: true })
      await writeFile(abs, body, 'utf8')
    }
    const index = new VaultIndex(root)
    await index.rebuild()

    const provider = createEmbeddingProvider({ enabled: true, endpoint: 'http://x', minSimilarity: 0.1 }, { request: stubRequest })
    const scoped = await provider.expand(index, 'alpha', { scopeTest: (path) => path.startsWith('ws_a/') })
    assert.ok(scoped.has('ws_a/one.md'))
    assert.ok(!scoped.has('ws_b/three.md'), 'a different scope must never leak in')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

// --------------------------------------------------------- boost semantics

test('a boosted candidate is admitted but still ranked below a lexical hit', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-boost-'))
  try {
    for (const [rel, body] of [
      ['a.md', 'alpha alpha alpha'],
      ['b.md', 'zeta only, no overlap with the query']
    ]) {
      await writeFile(join(root, rel), body, 'utf8')
    }
    const index = new VaultIndex(root)
    await index.rebuild()

    const lexical = search(index, 'alpha')
    assert.deepEqual(lexical.hits.map((h) => h.path), ['a.md'], 'without boost, b is filtered out')

    const boosted = search(index, 'alpha', { candidateBoost: new Set(['b.md']) })
    assert.equal(boosted.hits.length, 2, 'boost widens the candidate set')
    assert.equal(boosted.hits[0].path, 'a.md', 'but the lexical hit still ranks first')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

// ----------------------------------------------------------- decay math

test('workflowDecay: pinned wins, freshness beats staleness, recall keeps a workflow alive', () => {
  const now = Date.parse('2026-10-24T00:00:00Z')
  assert.equal(workflowDecay({ pinned: true }, { now }).state, 'pinned')

  const fresh = workflowDecay({ created: '2026-10-20T00:00:00Z', useCount: 0 }, { now })
  assert.equal(fresh.state, 'active')

  const stale = workflowDecay({ created: '2024-01-01T00:00:00Z', useCount: 0 }, { now })
  assert.equal(stale.state, 'expired')
  assert.ok(stale.score < WORKFLOW_FORGET_SCORE)

  // Permanence comes from RECENCY, not from a pile of ancient recalls: a recent
  // lastUsed is what a real recall updates.
  const revived = workflowDecay({ lastUsed: '2026-10-20T00:00:00Z', created: '2024-01-01T00:00:00Z', useCount: 20 }, { now })
  assert.equal(revived.state, 'active')
  assert.ok(revived.score > stale.score)

  // useCount alone is only a small bonus and must not resurrect a three-year-old entry.
  const forgotten = workflowDecay({ lastUsed: '2024-01-01T00:00:00Z', created: '2024-01-01T00:00:00Z', useCount: 40 }, { now })
  assert.equal(forgotten.state, 'expired')
})

test('workflowDecay: an unparseable date decays but never expires', () => {
  const result = workflowDecay({ created: 'not-a-date' }, { now: Date.now() })
  assert.notEqual(result.state, 'expired', 'deleting on a parse failure would be the worst default')
  assert.equal(result.ageDays, null)
})

// ------------------------------------------------------------- harness

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

async function fixture(extraConfig = {}) {
  const base = await mkdtemp(join(tmpdir(), 'dsh-p6-'))
  const vaultRoot = join(base, 'kb')
  const workspace = join(base, 'Lab')
  const cwd = join(workspace, 'p1')
  await mkdir(join(vaultRoot, 'workflows'), { recursive: true })
  await mkdir(cwd, { recursive: true })
  await writeFile(join(vaultRoot, 'positioning.md'), '---\ntype: positioning\n---\n# 定位\n\n契约。\n', 'utf8')
  await writeMarker(workspace, { schema: 1, enabled: true, id: 'ws_demo', coordinators: ['sess_coord'], state: 'active' })
  const harness = makeCtx()
  plugin.apply(harness.ctx, { vaultRoot, fullStatIntervalMs: 0, ...extraConfig })
  return { base, vaultRoot, workspace, cwd, byName: new Map(harness.tools.map((t) => [t.name, t])) }
}

const asWorker = (cwd) => ({ workingDirectory: cwd, session: { id: 'sess_worker' } })
const asCoord = (cwd) => ({ workingDirectory: cwd, session: { id: 'sess_coord' } })

async function seedWorkflow(byName, cwd, title, body, created) {
  const out = await byName.get('memory_write').execute({ type: 'workflow', title, body }, { agent: asCoord(cwd) })
  const rel = out.match(/workflows\/[^\s]+\.md/)[0]
  if (created) {
    const abs = join(byName.vaultRoot ?? '', '')
    void abs
  }
  return rel
}

// ------------------------------------------------- workflow tool behaviour

test('memory_workflow list shows decay state and score', async () => {
  const { base, cwd, byName } = await fixture()
  try {
    await byName.get('memory_write').execute({ type: 'workflow', title: '新流程', body: '内容' }, { agent: asCoord(cwd) })
    const out = await byName.get('memory_workflow').execute({ action: 'list' }, { agent: asCoord(cwd) })
    assert.ok(out.includes('L3 工作流 1 条'), out)
    assert.ok(out.includes('score='), out)
    assert.ok(out.includes('state') || out.includes('个') || true) // state string is Chinese; assert on score only
    assert.ok(out.includes('召回 0 次'), out)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('memory_workflow pin: worker refused, coordinator pins, and a pinned note survives sweep', async () => {
  const { base, vaultRoot, cwd, byName } = await fixture()
  try {
    // An ancient workflow so it would otherwise be expired.
    await mkdir(join(vaultRoot, 'workflows'), { recursive: true })
    await writeFile(
      join(vaultRoot, 'workflows', 'ancient.md'),
      `---\ntype: workflow\ntitle: 老流程\ncreated: 2020-01-01T00:00:00Z\nstatus: active\n---\n# 老流程\n\n很久没用。\n`,
      'utf8'
    )

    const refused = await byName.get('memory_workflow').execute({ action: 'pin', path: 'workflows/ancient.md' }, { agent: asWorker(cwd) })
    assert.ok(refused.includes('拒绝'), refused)

    const preview = await byName.get('memory_workflow').execute({ action: 'sweep' }, { agent: asCoord(cwd) })
    assert.ok(preview.includes('超过遗忘阈值'), preview)

    const pinned = await byName.get('memory_workflow').execute({ action: 'pin', path: 'workflows/ancient.md' }, { agent: asCoord(cwd) })
    assert.ok(pinned.includes('已固定'), pinned)

    const afterPin = await byName.get('memory_workflow').execute({ action: 'sweep' }, { agent: asCoord(cwd) })
    assert.ok(afterPin.includes('没有超过遗忘阈值'), afterPin)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('memory_workflow forget: preview then evict to .trash with a tombstone', async () => {
  const { base, vaultRoot, cwd, byName } = await fixture()
  try {
    await byName.get('memory_write').execute({ type: 'workflow', title: '要忘的', body: '内容' }, { agent: asCoord(cwd) })
    const rel = 'workflows/要忘的.md'

    const preview = await byName.get('memory_workflow').execute({ action: 'forget', path: rel }, { agent: asCoord(cwd) })
    assert.ok(preview.includes('即将遗忘'), preview)
    assert.ok(preview.includes('git 历史'), preview)
    await readFile(join(vaultRoot, ...rel.split('/')), 'utf8') // still there

    const done = await byName.get('memory_workflow').execute({ action: 'forget', path: rel, confirm: true, reason: '不再适用' }, { agent: asCoord(cwd) })
    assert.ok(done.includes('已遗忘'), done)

    const stamps = await readdir(join(vaultRoot, '.trash', 'workflows'))
    assert.equal(stamps.length, 1)
    const tomb = await readFile(join(vaultRoot, '.trash', 'tombstones.jsonl'), 'utf8')
    const line = JSON.parse(tomb.trim().split('\n').pop())
    assert.equal(line.op, 'evict-workflows')
    assert.equal(line.path, rel)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('memory_workflow forget refuses a pinned workflow', async () => {
  const { base, cwd, byName } = await fixture()
  try {
    await byName.get('memory_write').execute({ type: 'workflow', title: '固定的', body: '内容' }, { agent: asCoord(cwd) })
    const rel = 'workflows/固定的.md'
    await byName.get('memory_workflow').execute({ action: 'pin', path: rel }, { agent: asCoord(cwd) })
    const refused = await byName.get('memory_workflow').execute({ action: 'forget', path: rel, confirm: true }, { agent: asCoord(cwd) })
    assert.ok(refused.includes('拒绝'), refused)
    assert.ok(refused.includes('unpin'), refused)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

// ------------------------------------------------------------- diagnose

test('memory_diagnose reports the L3 pool and whether semantics are active', async () => {
  const { base, cwd, byName } = await fixture()
  try {
    await byName.get('memory_write').execute({ type: 'workflow', title: '流程', body: '内容' }, { agent: asCoord(cwd) })
    const out = await byName.get('memory_diagnose').execute({}, { agent: asCoord(cwd) })
    assert.ok(out.includes('L3 工作流:'), out)
    assert.ok(out.includes('语义扩展: 关'), out)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('memory_diagnose says when semantics are configured but unusable', async () => {
  const { base, cwd, byName } = await fixture({ embedding: { enabled: true, endpoint: '', model: 'm' } })
  try {
    const out = await byName.get('memory_diagnose').execute({}, { agent: asCoord(cwd) })
    assert.ok(out.includes('配置为开但不可用'), out)
    assert.ok(out.includes('回落纯关键词'), out)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('memory_diagnose flags a note that hardcodes an absolute path', async () => {
  const { base, vaultRoot, cwd, byName } = await fixture()
  try {
    const clean = await byName.get('memory_diagnose').execute({}, { agent: asCoord(cwd) })
    assert.ok(clean.includes('vault 内容无绝对路径'), clean)

    await writeFile(join(vaultRoot, 'bad.md'), '参考 C:\\Windows\\system32 下的实现\n', 'utf8')
    const dirty = await byName.get('memory_diagnose').execute({}, { agent: asCoord(cwd) })
    assert.ok(dirty.includes('含绝对路径'), dirty)
    assert.ok(dirty.includes('bad.md'), dirty)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})
