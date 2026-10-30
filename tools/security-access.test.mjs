// Workspace isolation, authorization ordering, citation/diagnostic leakage and
// write-boundary tests. Offline synthetic fixtures only.
//   node --test tools/security-access.test.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import plugin, { renderNote } from '../plugin/lib/index.js'
import { writeMarker } from '../plugin/lib/workspace.js'

const RUN_ID = 'run_abc12345'

function makeCtx() {
  const tools = []
  const hooks = new Map()
  return {
    tools,
    hooks,
    ctx: {
      systemPrompt: { section: () => () => {} },
      tools: { register: (t) => (tools.push(t), () => {}) },
      on: (event, handler) => {
        if (!hooks.has(event)) hooks.set(event, [])
        hooks.get(event).push(handler)
      },
      logger: { warn: (m) => console.log(`  [warn] ${m}`) }
    }
  }
}

async function put(vaultRoot, rel, frontmatter, body) {
  const abs = join(vaultRoot, ...rel.split('/'))
  await mkdir(join(abs, '..'), { recursive: true })
  await writeFile(abs, renderNote(frontmatter, body), 'utf8')
}

async function fixture({ manyForeign = false, withForeignUnique = false, brokenForeign = false } = {}) {
  const base = await mkdtemp(join(tmpdir(), 'dsh-sec-'))
  const vaultRoot = join(base, 'kb')
  const workspace = join(base, 'Lab')
  const cwd = join(workspace, 'p1')
  await mkdir(cwd, { recursive: true })

  await put(vaultRoot, 'positioning.md', { type: 'positioning', title: 'L1', visibility: 'user-global' }, '契约')
  await put(
    vaultRoot,
    'workspaces/ws_a.md',
    { type: 'workspace', scope: 'ws_a', title: 'ws_a map', visibility: 'workspace-shared' },
    'WS_A_MAP'
  )
  await put(
    vaultRoot,
    'workspaces/ws_b.md',
    { type: 'workspace', scope: 'ws_b', title: 'ws_b map', visibility: 'workspace-shared' },
    'WS_B_MAP'
  )

  const approvedMemory = (scope, visibility, body, extra = {}) => ({
    type: 'memory',
    scope,
    visibility,
    review: { state: 'approved' },
    authority: 'agent-observed',
    created: '2026-10-30T00:00:00Z',
    ...extra
  })

  await put(
    vaultRoot,
    'workspaces/ws_a/memory/approved.md',
    approvedMemory('ws_a/ep_1', 'episode-shared', ''),
    'SHARED_TOKEN WS_A_CANARY'
  )
  await put(
    vaultRoot,
    'workspaces/ws_b/memory/canary.md',
    approvedMemory('ws_b', 'workspace-shared', ''),
    'SHARED_TOKEN WS_B_CANARY'
  )
  await put(
    vaultRoot,
    'workspaces/ws_b/memory/user-global.md',
    { type: 'knowledge', scope: 'ws_b', visibility: 'user-global', review: { state: 'approved' }, authority: 'human-approved' },
    'GLOBAL_CANARY'
  )
  await put(
    vaultRoot,
    'workspaces/ws_a/memory/run.md',
    approvedMemory('ws_a/ep_1', 'run-private', '', { run_id: RUN_ID }),
    'RUN_CANARY'
  )
  await put(
    vaultRoot,
    'workspaces/ws_a/memory/other-episode.md',
    approvedMemory('ws_a/ep_2', 'episode-shared', ''),
    'EP2_CANARY'
  )
  await put(
    vaultRoot,
    'workspaces/ws_a/memory/pending.md',
    { type: 'memory', scope: 'ws_a', visibility: 'workspace-shared', review: { state: 'pending' } },
    'PENDING_A'
  )
  await put(
    vaultRoot,
    'workspaces/ws_a/memory/rejected.md',
    { type: 'memory', scope: 'ws_a', visibility: 'workspace-shared', review: { state: 'rejected' } },
    'REJECTED_A'
  )
  await put(
    vaultRoot,
    'workspaces/ws_a/memory/superseded.md',
    { type: 'memory', scope: 'ws_a', visibility: 'workspace-shared', status: 'superseded', review: { state: 'approved' } },
    'SUPERSEDED_A'
  )
  await put(
    vaultRoot,
    'workspaces/ws_a/memory/restricted.md',
    { type: 'memory', scope: 'ws_a', visibility: 'restricted', review: { state: 'approved' } },
    'RESTRICTED_A'
  )
  await put(
    vaultRoot,
    'projects/p1/findings/approved.md',
    { type: 'finding', review: { state: 'approved' }, title: 'KB', visibility: 'user-global' },
    'KB_CANARY'
  )
  await put(
    vaultRoot,
    'workflows/wf.md',
    { type: 'workflow', title: 'WF', visibility: 'user-global' },
    'WF_CANARY'
  )
  // Legacy records without explicit visibility: excluded from worker reads/pack,
  // but visible in the read-only migration inventory.
  await put(
    vaultRoot,
    'workspaces/ws_a/memory/legacy-unmarked.md',
    { type: 'memory', scope: 'ws_a', review: { state: 'approved' } },
    'LEGACY_L4_CANARY'
  )
  await put(
    vaultRoot,
    'projects/p1/findings/legacy-unmarked.md',
    { type: 'finding', review: { state: 'approved' }, title: 'legacy KB' },
    'LEGACY_KB_CANARY'
  )
  await put(
    vaultRoot,
    'workflows/legacy-unmarked.md',
    { type: 'workflow', title: 'legacy WF' },
    'LEGACY_WF_CANARY'
  )

  if (withForeignUnique) {
    await put(
      vaultRoot,
      'workspaces/ws_b/memory/unique.md',
      approvedMemory('ws_b', 'workspace-shared', ''),
      'FOREIGN_UNIQUE_TOKEN'
    )
  }
  if (manyForeign) {
    for (let i = 0; i < 20; i++) {
      await put(
        vaultRoot,
        `workspaces/ws_b/memory/rank-${i}.md`,
        approvedMemory('ws_b', 'workspace-shared', '', { salience: 5 }),
        `SHARED_TOKEN WS_B_RANK_${i}`
      )
    }
  }
  if (brokenForeign) {
    await put(
      vaultRoot,
      'workspaces/ws_b/memory/broken-foreign.md',
      { type: 'memory', scope: 'ws_b', visibility: 'workspace-shared', review: { state: 'approved' } },
      'BROKEN_FOREIGN_CANARY ::: not yaml'
    )
  }

  await writeMarker(workspace, {
    schema: 1,
    enabled: true,
    id: 'ws_a',
    episode: 'ep_1',
    coordinators: ['sess_coord'],
    state: 'active',
    lastActivity: new Date().toISOString()
  })

  const harness = makeCtx()
  plugin.apply(harness.ctx, { vaultRoot, fullStatIntervalMs: 0 })
  return { base, vaultRoot, workspace, cwd, harness, byName: new Map(harness.tools.map((t) => [t.name, t])) }
}

const worker = (cwd) => ({ agent: { workingDirectory: cwd, session: { id: 'sess_worker' } } })
const coord = (cwd) => ({ agent: { workingDirectory: cwd, session: { id: 'sess_coord' } } })
const withBinding = (exec, binding) => ({ ...exec, hostContext: { memoryBinding: binding } })

async function injected(harness, exec, text = 'SHARED_TOKEN') {
  const hook = harness.hooks.get('agent/pre-step')[0]
  const decision = {
    kind: 'continue',
    messages: [{ id: 'm1', role: 'user', content: [{ type: 'text', text }], source: { kind: 'user' } }]
  }
  const out = await hook({ ...exec, messages: decision.messages, step: 1, signal: {} }, async () => decision)
  return out.messages.length === decision.messages.length ? '' : out.messages[out.messages.length - 1].content[0].text
}

async function search(byName, exec, args) {
  return byName.get('memory_search').execute(args, exec)
}

// --------------------------------------------------------------- injection

test('injection: ws_b records never appear; own records do', async () => {
  const { base, harness, cwd } = await fixture()
  try {
    const block = await injected(harness, worker(cwd))
    assert.ok(block.includes('WS_A_CANARY'), block)
    assert.ok(block.includes('WS_A_MAP'), block)
    assert.ok(!block.includes('WS_B_CANARY'), block)
    assert.ok(!block.includes('WS_B_MAP'), block)
    assert.ok(!block.includes('ws_b'), block)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

// --------------------------------------------------------- search boundary

test('search: explicit scope and allScopes cannot widen authorization', async () => {
  const { base, cwd, byName } = await fixture()
  try {
    const plain = await search(byName, worker(cwd), { query: 'SHARED_TOKEN' })
    assert.ok(plain.includes('WS_A_CANARY'), plain)
    assert.ok(!plain.includes('WS_B_CANARY'), plain)
    assert.ok(!plain.includes('ws_b'), plain)
    assert.ok(!plain.includes('已排除'), 'no foreign count may be disclosed')

    const widened = await search(byName, worker(cwd), { query: 'SHARED_TOKEN', allScopes: true })
    assert.ok(!widened.includes('WS_B_CANARY'), widened)
    assert.ok(widened.includes('不扩大授权'), widened)

    const foreign = await search(byName, worker(cwd), { query: 'SHARED_TOKEN', scope: 'ws_b' })
    assert.ok(foreign.includes('拒绝'), foreign)
    assert.ok(!foreign.includes('WS_B_CANARY'), foreign)
    assert.ok(!foreign.includes('ws_b'), foreign)

    const queryScope = await search(byName, worker(cwd), { query: 'scope:ws_b SHARED_TOKEN' })
    assert.ok(!queryScope.includes('WS_B_CANARY'), queryScope)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('search: explicit user-global is the only cross-workspace visibility', async () => {
  const { base, cwd, byName } = await fixture()
  try {
    const out = await search(byName, worker(cwd), { query: 'GLOBAL_CANARY' })
    assert.ok(out.includes('GLOBAL_CANARY'), out)
    // The origin path is part of the authorized global record; it may reveal the
    // instance name, but no other ws_b record may accompany it.
    assert.ok(!out.includes('WS_B_CANARY'), out)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('search: foreign records cannot consume top-k slots', async () => {
  const { base, cwd, byName } = await fixture({ manyForeign: true })
  try {
    const out = await search(byName, worker(cwd), { query: 'SHARED_TOKEN', limit: 1 })
    assert.ok(out.includes('WS_A_CANARY'), out)
    assert.ok(!out.includes('WS_B_RANK_'), out)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('search: foreign records do not contribute to IDF', async () => {
  const clean = await fixture()
  const dirty = await fixture({ withForeignUnique: true })
  try {
    const cleanOut = await search(clean.byName, worker(clean.cwd), { query: 'SHARED_TOKEN OR FOREIGN_UNIQUE_TOKEN', limit: 1 })
    const dirtyOut = await search(dirty.byName, worker(dirty.cwd), { query: 'SHARED_TOKEN OR FOREIGN_UNIQUE_TOKEN', limit: 1 })
    const score = (text) => {
      const match = /score ([0-9.]+)/.exec(text)
      return match ? match[1] : null
    }
    assert.equal(score(cleanOut), score(dirtyOut), `${cleanOut}\n---\n${dirtyOut}`)
    assert.ok(cleanOut.includes('WS_A_CANARY'))
    assert.ok(!dirtyOut.includes('FOREIGN_UNIQUE_TOKEN'))
  } finally {
    await rm(clean.base, { recursive: true, force: true })
    await rm(dirty.base, { recursive: true, force: true })
  }
})

test('search: pending is excluded for workers, visible to an explicit coordinator review search', async () => {
  const { base, cwd, byName } = await fixture()
  try {
    const workerOut = await search(byName, worker(cwd), { query: 'PENDING_A' })
    assert.ok(!workerOut.includes('PENDING_A'), workerOut)
    const coordDefault = await search(byName, coord(cwd), { query: 'PENDING_A' })
    assert.ok(!coordDefault.includes('PENDING_A'), coordDefault)
    const coordReview = await search(byName, coord(cwd), { query: 'PENDING_A', includePending: true })
    assert.ok(coordReview.includes('PENDING_A'), coordReview)
    const workerTrying = await search(byName, worker(cwd), { query: 'PENDING_A', includePending: true })
    assert.ok(!workerTrying.includes('PENDING_A'), workerTrying)
    const restricted = await search(byName, coord(cwd), { query: 'RESTRICTED_A', includePending: true })
    assert.ok(!restricted.includes('RESTRICTED_A'), restricted)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

// ------------------------------------------------------------- citations

test('citation: foreign and missing are indistinguishable; pending is coordinator-only', async () => {
  const { base, cwd, byName } = await fixture()
  try {
    const foreign = await search(byName, worker(cwd), { verify: 'workspaces/ws_b/memory/canary.md' })
    assert.ok(foreign.includes('不可用'), foreign)
    assert.ok(!foreign.includes('ws_b'), foreign)
    assert.ok(!foreign.includes('ok'), foreign)
    const ownMissing = await search(byName, worker(cwd), { verify: 'workspaces/ws_a/memory/nope.md' })
    assert.ok(ownMissing.includes('不存在'), ownMissing)

    const own = await search(byName, worker(cwd), { verify: 'workspaces/ws_a/memory/approved.md' })
    assert.ok(own.includes('状态: ok'), own)

    const pendingWorker = await search(byName, worker(cwd), { verify: 'workspaces/ws_a/memory/pending.md' })
    assert.ok(pendingWorker.includes('不可用'), pendingWorker)
    const pendingCoord = await search(byName, coord(cwd), { verify: 'workspaces/ws_a/memory/pending.md' })
    assert.ok(pendingCoord.includes('状态: ok'), pendingCoord)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

// ------------------------------------------------------------ diagnostics

test('diagnostics: no foreign paths, warnings or global counts', async () => {
  const { base, cwd, byName } = await fixture({ brokenForeign: true })
  try {
    const diag = await byName.get('memory_diagnose').execute({}, worker(cwd))
    assert.ok(!diag.includes('ws_b'), diag)
    assert.ok(!diag.includes('WS_B'), diag)
    assert.ok(!diag.includes('BROKEN_FOREIGN'), diag)
    assert.ok(diag.includes('作用域: ws_a / ep_1'), diag)
    assert.ok(diag.includes('库内类型(授权切片)'), diag)

    const stats = await byName.get('memory_stats').execute({}, worker(cwd))
    assert.ok(!stats.includes('ws_b'), stats)
    assert.ok(!stats.includes('BROKEN_FOREIGN'), stats)

    const coordDiag = await byName.get('memory_diagnose').execute({}, coord(cwd))
    assert.ok(!coordDiag.includes('ws_b'), coordDiag)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

// ----------------------------------------------------------- write boundary

test('write: workers cannot use shared write/revise/forget/purge; coordinator is scoped', async () => {
  const { base, vaultRoot, cwd, byName } = await fixture()
  try {
    const workerWrite = await byName.get('memory_write').execute({ type: 'memory', title: 'x', body: 'x' }, worker(cwd))
    assert.ok(workerWrite.includes('拒绝'), workerWrite)

    const workerRevise = await byName.get('memory_revise').execute(
      { path: 'workspaces/ws_a/memory/approved.md', body: 'changed' },
      worker(cwd)
    )
    assert.ok(workerRevise.includes('拒绝'), workerRevise)
    const workerForget = await byName.get('memory_forget').execute({ path: 'workspaces/ws_a/memory/approved.md' }, worker(cwd))
    assert.ok(workerForget.includes('拒绝'), workerForget)
    const workerPurge = await byName.get('memory_purge').execute({ confirm: true }, worker(cwd))
    assert.ok(workerPurge.includes('拒绝'), workerPurge)

    const foreignScope = await byName.get('memory_write').execute(
      { type: 'memory', title: 'x', body: 'x', scope: 'ws_b' },
      coord(cwd)
    )
    assert.ok(foreignScope.includes('拒绝'), foreignScope)

    const foreignSupersede = await byName.get('memory_write').execute(
      { type: 'workflow', title: 'x', body: 'x', supersedes: 'workspaces/ws_b/memory/canary.md' },
      coord(cwd)
    )
    assert.ok(foreignSupersede.includes('拒绝'), foreignSupersede)
    await access(join(vaultRoot, 'workspaces', 'ws_b', 'memory', 'canary.md'))

    const foreignSource = await byName.get('memory_write').execute(
      { type: 'finding', project: 'p', title: 'x', body: 'x', sources: ['workspaces/ws_b/memory/canary.md'] },
      coord(cwd)
    )
    assert.ok(foreignSource.includes('拒绝'), foreignSource)

    const restricted = await byName.get('memory_write').execute(
      { type: 'memory', title: 'x', body: 'x', visibility: 'restricted' },
      coord(cwd)
    )
    assert.ok(restricted.includes('拒绝'), restricted)

    const identity = await byName.get('memory_write').execute(
      { type: 'memory', title: 'x', body: 'x', workspace_id: 'ws_b' },
      coord(cwd)
    )
    assert.ok(identity.includes('拒绝'), identity)

    const ok = await byName.get('memory_write').execute(
      { type: 'memory', title: '本地结论', body: 'LOCAL_WRITE', authority: 'agent-observed' },
      coord(cwd)
    )
    assert.ok(ok.includes('已写入 workspaces/ws_a/memory/'), ok)
    const rel = ok.match(/workspaces\/ws_a\/memory\/[^\s]+\.md/)[0]
    const written = await readFile(join(vaultRoot, ...rel.split('/')), 'utf8')
    assert.ok(written.includes('LOCAL_WRITE'))
    assert.ok(written.includes('visibility: episode-shared'), written)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('write: run-private and user-global memory use the trusted binding, never args', async () => {
  const { base, vaultRoot, cwd, byName } = await fixture()
  try {
    const boundCoord = withBinding(coord(cwd), {
      workspaceId: 'ws_a',
      episodeId: 'ep_1',
      role: 'orchestrator',
      runId: RUN_ID
    })
    const runWrite = await byName.get('memory_write').execute(
      { type: 'memory', title: '运行私有', body: 'RUN_WRITE_CANARY', visibility: 'run-private', review: 'approved' },
      boundCoord
    )
    assert.ok(runWrite.includes('已写入 workspaces/ws_a/memory/'), runWrite)
    const runRel = runWrite.match(/workspaces\/ws_a\/memory\/[^\s]+\.md/)[0]
    const runFile = await readFile(join(vaultRoot, ...runRel.split('/')), 'utf8')
    assert.ok(runFile.includes('visibility: run-private'), runFile)
    assert.ok(runFile.includes(`run_id: ${RUN_ID}`), runFile)

    const globalWrite = await byName.get('memory_write').execute(
      { type: 'memory', title: '全局记忆', body: 'GLOBAL_WRITE_CANARY', visibility: 'user-global', review: 'approved' },
      boundCoord
    )
    assert.ok(globalWrite.includes('已写入 memory/items/'), globalWrite)
    const globalRel = globalWrite.match(/memory\/items\/[^\s]+\.md/)[0]
    const globalFile = await readFile(join(vaultRoot, ...globalRel.split('/')), 'utf8')
    assert.ok(globalFile.includes('visibility: user-global'), globalFile)
    assert.ok(!globalFile.includes('scope:'), globalFile)

    const noRun = await search(byName, worker(cwd), { query: 'RUN_WRITE_CANARY' })
    assert.ok(!noRun.includes('RUN_WRITE_CANARY'), noRun)
    const withRun = await search(
      byName,
      withBinding(worker(cwd), { workspaceId: 'ws_a', episodeId: 'ep_1', role: 'researcher', runId: RUN_ID }),
      { query: 'RUN_WRITE_CANARY' }
    )
    assert.ok(withRun.includes('RUN_WRITE_CANARY'), withRun)

    const globalSeen = await search(byName, worker(cwd), { query: 'GLOBAL_WRITE_CANARY' })
    assert.ok(globalSeen.includes('GLOBAL_WRITE_CANARY'), globalSeen)

    const scopedGlobal = await byName.get('memory_write').execute(
      { type: 'memory', title: '全局带 scope', body: 'x', visibility: 'user-global', scope: 'ws_a' },
      boundCoord
    )
    assert.ok(scopedGlobal.includes('拒绝'), scopedGlobal)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('purge: an episode-qualified scope is refused instead of widening to the workspace', async () => {
  const { base, cwd, byName } = await fixture()
  try {
    const out = await byName.get('memory_purge').execute(
      { scope: 'ws_a/ep_1', confirm: true, reason: 'test' },
      coord(cwd)
    )
    assert.ok(out.includes('拒绝'), out)
    assert.ok(out.includes('省略 scope'), out)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

// ------------------------------------------------------------- candidates

test('candidates: workers can propose, but candidates never enter recall', async () => {
  const { base, cwd, byName } = await fixture()
  try {
    const proposed = await byName.get('memory_candidate').execute(
      { type: 'memory', title: '候选结论', body: 'CANDIDATE_CANARY', authority: 'agent-observed' },
      worker(cwd)
    )
    assert.ok(proposed.includes('候选已记录'), proposed)
    assert.ok(proposed.includes('pending'), proposed)

    const searched = await search(byName, worker(cwd), { query: 'CANDIDATE_CANARY' })
    assert.ok(!searched.includes('CANDIDATE_CANARY'), searched)

    const listed = await byName.get('memory_candidate').execute({ action: 'list' }, worker(cwd))
    assert.ok(listed.includes('候选结论'), listed)
    assert.ok(listed.includes('pending'), listed)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('legacy records without explicit visibility never cross workspaces', async () => {
  const { base, cwd, byName } = await fixture()
  try {
    const other = join(base, 'Other')
    const otherCwd = join(other, 'p1')
    await mkdir(otherCwd, { recursive: true })
    await writeMarker(other, {
      schema: 1,
      enabled: true,
      id: 'ws_c',
      episode: 'ep_c',
      coordinators: [],
      state: 'active',
      lastActivity: new Date().toISOString()
    })

    const kb = await search(byName, worker(otherCwd), { query: 'LEGACY_KB_CANARY' })
    assert.ok(!kb.includes('LEGACY_KB_CANARY'), kb)
    const wf = await search(byName, worker(otherCwd), { query: 'LEGACY_WF_CANARY' })
    assert.ok(!wf.includes('LEGACY_WF_CANARY'), wf)
    const l4 = await search(byName, worker(cwd), { query: 'LEGACY_L4_CANARY' })
    assert.ok(!l4.includes('LEGACY_L4_CANARY'), l4)

    // Explicit user-global KB/workflow still cross.
    assert.ok((await search(byName, worker(otherCwd), { query: 'KB_CANARY' })).includes('KB_CANARY'))
    assert.ok((await search(byName, worker(otherCwd), { query: 'WF_CANARY' })).includes('WF_CANARY'))
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('migration report is read-only, coordinator-only, and lists only own/no-scope legacy records', async () => {
  const { base, vaultRoot, cwd, byName } = await fixture()
  try {
    await put(
      vaultRoot,
      'workspaces/ws_b/memory/legacy-foreign.md',
      { type: 'memory', scope: 'ws_b', review: { state: 'approved' } },
      'LEGACY_FOREIGN_CANARY'
    )

    const refused = await byName.get('memory_migration_report').execute({}, worker(cwd))
    assert.ok(refused.includes('拒绝'), refused)

    const report = await byName.get('memory_migration_report').execute({}, coord(cwd))
    assert.ok(report.includes('只读迁移清单'), report)
    assert.ok(report.includes('workspaces/ws_a/memory/legacy-unmarked.md'), report)
    assert.ok(report.includes('projects/p1/findings/legacy-unmarked.md'), report)
    assert.ok(report.includes('workflows/legacy-unmarked.md'), report)
    assert.ok(!report.includes('ws_b'), report)
    assert.ok(!report.includes('LEGACY_L4_CANARY'), 'report must not read bodies')
    assert.ok(!report.includes('LEGACY_KB_CANARY'), report)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

// ------------------------------------------------------- trusted binding

test('binding: run-private is visible only with a trusted host run binding', async () => {
  const { base, cwd, byName } = await fixture()
  try {
    const noBinding = await search(byName, worker(cwd), { query: 'RUN_CANARY' })
    assert.ok(!noBinding.includes('RUN_CANARY'), noBinding)

    const bound = withBinding(worker(cwd), {
      workspaceId: 'ws_a',
      episodeId: 'ep_1',
      role: 'researcher',
      runId: RUN_ID
    })
    const withRun = await search(byName, bound, { query: 'RUN_CANARY' })
    assert.ok(withRun.includes('RUN_CANARY'), withRun)
    assert.ok(!withRun.includes('EP2_CANARY'), withRun)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('binding: a worker binding overrides the marker coordinator list, and mismatch fails closed', async () => {
  const { base, harness, cwd, byName } = await fixture()
  try {
    const coordAgent = { workingDirectory: cwd, session: { id: 'sess_coord' } }
    const workerBinding = {
      workspaceId: 'ws_a',
      episodeId: 'ep_1',
      role: 'researcher',
      runId: RUN_ID
    }
    const denied = await byName.get('memory_write').execute(
      { type: 'memory', title: 'x', body: 'x' },
      { agent: coordAgent, hostContext: { binding: workerBinding } }
    )
    assert.ok(denied.includes('拒绝'), denied)

    const mismatch = withBinding(worker(cwd), {
      workspaceId: 'ws_b',
      episodeId: 'ep_b',
      role: 'researcher',
      runId: RUN_ID
    })
    const out = await search(byName, mismatch, { query: 'SHARED_TOKEN' })
    assert.ok(out.includes('绑定') || out.includes('拒绝'), out)
    assert.ok(!out.includes('WS_A_CANARY'), out)
    assert.ok(!out.includes('WS_B_CANARY'), out)
    const block = await injected(harness, mismatch)
    assert.equal(block, '', 'mismatched binding must inject nothing')
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})
