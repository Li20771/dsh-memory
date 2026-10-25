// Deleting a workspace in the GUI must destroy its workspace memory — but only
// after its harvest is complete.
//   node --test tools/registry-watch.test.mjs
//
// The desktop app persists its workspace list at `<DSH_HOME>/storages/workspace.json`
// (verified shape: `tables.workspaces[<uuid>].path`). A host plugin can therefore
// observe deletion without any client bundle. These tests drive that path directly.
//
// The interesting case is the SECOND one: the user deletes the workspace while
// something is still undisposed. Destroying it then would discard a conclusion that
// was never written down, so the purge is deferred and reported instead.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm, access, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import plugin from '../plugin/lib/index.js'
import { writeMarker } from '../plugin/lib/workspace.js'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

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

/** A registry file in the shape the installed host actually writes. */
function registryJson(entries) {
  const workspaces = {}
  const ids = []
  for (const [id, entry] of Object.entries(entries)) {
    ids.push(id)
    workspaces[id] = { path: entry.path, title: entry.title ?? null, sessionIds: [], createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z' }
  }
  return `${JSON.stringify(
    {
      unit: { name: 'workspace', version: 2 },
      global: { initialized: true, workspaceIds: ids, archivedSessionIds: [], pinnedSessionIds: [] },
      tables: { workspaces }
    },
    null,
    2
  )}\n`
}

async function fixture() {
  const base = await mkdtemp(join(tmpdir(), 'dsh-regwatch-'))
  const vaultRoot = join(base, 'kb')
  const workspace = join(base, 'Lab')
  const cwd = join(workspace, 'p1')
  await mkdir(cwd, { recursive: true })
  await mkdir(vaultRoot, { recursive: true })
  await writeFile(join(vaultRoot, 'positioning.md'), '---\ntype: positioning\n---\n# 定位\n\n契约。\n', 'utf8')
  await writeMarker(workspace, {
    schema: 1,
    enabled: true,
    id: 'ws_demo',
    episode: 'ep_1',
    coordinators: ['sess_coord'],
    state: 'active',
    lastActivity: new Date().toISOString()
  })

  const registry = join(base, 'workspace.json')
  await writeFile(registry, registryJson({ 'id-demo': { path: workspace, title: 'Lab' } }), 'utf8')

  const harness = makeCtx()
  plugin.apply(harness.ctx, { vaultRoot, fullStatIntervalMs: 0, workspaceRegistryPath: registry })
  return { base, vaultRoot, workspace, cwd, registry, byName: new Map(harness.tools.map((t) => [t.name, t])) }
}

const asCoord = (cwd) => ({ workingDirectory: cwd, session: { id: 'sess_coord' } })

async function seedRecords(byName, cwd, titles) {
  const paths = []
  for (const title of titles) {
    const out = await byName.get('memory_write').execute(
      { type: 'memory', title, body: `${title} 的实测结论`, authority: 'agent-observed' },
      { agent: asCoord(cwd) }
    )
    paths.push(out.match(/workspaces\/ws_demo\/memory\/[^\s]+\.md/)[0])
  }
  return paths
}

// ------------------------------------------------- 1. complete harvest → purge

test('deleting a workspace destroys its records once the harvest is complete', async () => {
  const { base, vaultRoot, workspace, cwd, registry, byName } = await fixture()
  try {
    const agent = asCoord(cwd)
    const records = await seedRecords(byName, cwd, ['甲', '乙'])

    // First reconcile: the snapshot is learned (no removals yet).
    const first = await byName.get('memory_diagnose').execute({}, { agent })
    assert.ok(first.includes('工作区删除: 无待处理'), first)
    for (const rel of records) await access(join(vaultRoot, ...rel.split('/')))

    // Harvest both completely, so nothing is lost by destroying them.
    await byName.get('memory_write').execute({ type: 'workflow', title: '甲流程', body: '内容' }, { agent })
    await byName.get('memory_write').execute({ type: 'workflow', title: '乙流程', body: '内容' }, { agent })
    await byName.get('memory_harvest').execute(
      { action: 'record', path: records[0], disposition: 'harvested', target: 'workflows/甲流程.md' },
      { agent }
    )
    await byName.get('memory_harvest').execute(
      { action: 'record', path: records[1], disposition: 'harvested', target: 'workflows/乙流程.md' },
      { agent }
    )
    // Coverage alone is not permission: a review session signs off first.
    const cert = await byName.get('memory_harvest').execute({ action: 'certify' }, { agent })
    assert.ok(cert.includes('已认证'), cert)

    // The GUI deletion: the workspace disappears from the registry.
    await sleep(25)
    await writeFile(registry, registryJson({}), 'utf8')

    const after = await byName.get('memory_diagnose').execute({}, { agent })
    assert.ok(after.includes('已清除 1'), after)
    // Nothing is left waiting: the line only lists non-zero pending buckets.
    assert.ok(!after.includes('待认证'), after)
    assert.ok(!after.includes('未清除'), after)

    for (const rel of records) await assert.rejects(access(join(vaultRoot, ...rel.split('/'))), `${rel} 应已销毁`)
    const tomb = await readFile(join(vaultRoot, '.trash', 'tombstones.jsonl'), 'utf8')
    const line = JSON.parse(tomb.trim().split('\n').pop())
    assert.equal(line.op, 'purge-workspace')
    assert.equal(line.scope, 'ws_demo')
    assert.equal(line.reason, 'workspace-removed')
    assert.equal(line.moved, 2)
    assert.equal(line.paths.length, 2, '墓碑必须记下销毁了哪几条，否则无法与"失效"区分')

    // The marker's own directory is untouched — deleting from the list is not deleting files.
    await access(join(workspace, '.dsh', 'memory.json'))
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

// -------------------------------- 2. incomplete harvest → defer, do not destroy

test('deleting a workspace with undisposed records defers instead of destroying', async () => {
  const { base, vaultRoot, cwd, registry, byName } = await fixture()
  try {
    const agent = asCoord(cwd)
    const records = await seedRecords(byName, cwd, ['甲', '乙'])

    await byName.get('memory_diagnose').execute({}, { agent })

    // Only one of the two gets a disposition.
    await byName.get('memory_write').execute({ type: 'workflow', title: '甲流程', body: '内容' }, { agent })
    await byName.get('memory_harvest').execute(
      { action: 'record', path: records[0], disposition: 'harvested', target: 'workflows/甲流程.md' },
      { agent }
    )

    await sleep(25)
    await writeFile(registry, registryJson({}), 'utf8')

    const after = await byName.get('memory_diagnose').execute({}, { agent })
    assert.ok(after.includes('待收割 1'), after)
    assert.ok(after.includes('缺 1 条记录'), after)

    // Nothing was destroyed: the undisposed conclusion is still on disk.
    for (const rel of records) await access(join(vaultRoot, ...rel.split('/')))
    await assert.rejects(
      access(join(vaultRoot, '.trash', 'tombstones.jsonl')),
      '不完整的收割不应产生墓碑'
    )

    // ---- and once the gap is closed, the next pass finishes the job --------
    await byName.get('memory_write').execute({ type: 'workflow', title: '乙流程', body: '内容' }, { agent })
    await byName.get('memory_harvest').execute(
      { action: 'record', path: records[1], disposition: 'discarded', reason: '重复结论' },
      { agent }
    )
    const cert = await byName.get('memory_harvest').execute({ action: 'certify' }, { agent })
    assert.ok(cert.includes('已认证'), cert)
    // Touch the registry so the watcher re-runs (content unchanged, mtime bumped).
    await sleep(25)
    await writeFile(registry, `${registryJson({})}`, 'utf8')
    await sleep(5)

    const done = await byName.get('memory_diagnose').execute({}, { agent })
    // The pending entry is carried over, so a later pass can still complete it.
    assert.ok(/已清除 1|待收割 0|无待处理/.test(done), done)
    for (const rel of records) await assert.rejects(access(join(vaultRoot, ...rel.split('/'))), `${rel} 应在补齐收割后销毁`)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

// ------------------------- 2b. complete but UNREVIEWED → defer for certification

test('a complete-but-uncertified harvest is not enough to destroy anything', async () => {
  const { base, vaultRoot, cwd, registry, byName } = await fixture()
  try {
    const agent = asCoord(cwd)
    const records = await seedRecords(byName, cwd, ['甲'])
    await byName.get('memory_diagnose').execute({}, { agent })

    await byName.get('memory_write').execute({ type: 'workflow', title: '甲流程', body: '内容' }, { agent })
    await byName.get('memory_harvest').execute(
      { action: 'record', path: records[0], disposition: 'harvested', target: 'workflows/甲流程.md' },
      { agent }
    )
    // No certify call on purpose.

    await sleep(25)
    await writeFile(registry, registryJson({}), 'utf8')

    const after = await byName.get('memory_diagnose').execute({}, { agent })
    assert.ok(after.includes('待认证 1'), after)
    assert.ok(after.includes('未清除'), after)
    await access(join(vaultRoot, ...records[0].split('/')))
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

// ------------------- 2c. the purge is acted on from ANY session, not that one

test('the deletion is acted on from any session, not only inside that workspace', async () => {
  const { base, vaultRoot, cwd, registry, byName } = await fixture()
  try {
    const agent = asCoord(cwd)
    const records = await seedRecords(byName, cwd, ['甲'])
    await byName.get('memory_diagnose').execute({}, { agent })

    await byName.get('memory_write').execute({ type: 'workflow', title: '甲流程', body: '内容' }, { agent })
    await byName.get('memory_harvest').execute(
      { action: 'record', path: records[0], disposition: 'harvested', target: 'workflows/甲流程.md' },
      { agent }
    )
    await byName.get('memory_harvest').execute({ action: 'certify' }, { agent })

    await sleep(25)
    await writeFile(registry, registryJson({}), 'utf8')

    // Work somewhere that is not a workspace at all — the deleted workspace must not
    // need to be "visited" for its memory to be cleaned up.
    const elsewhere = join(base, 'unrelated')
    await mkdir(elsewhere, { recursive: true })
    const out = await byName.get('memory_diagnose').execute(
      {},
      { agent: { workingDirectory: elsewhere, session: { id: 'sess_elsewhere' } } }
    )
    assert.ok(out.includes('已清除 1'), out)
    await assert.rejects(access(join(vaultRoot, ...records[0].split('/'))))
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

// --------------------------------------------- 3. unrelated changes are no-ops

test('adding a workspace or rewriting the registry does not touch records', async () => {
  const { base, vaultRoot, workspace, cwd, registry, byName } = await fixture()
  try {
    const agent = asCoord(cwd)
    const records = await seedRecords(byName, cwd, ['甲'])
    await byName.get('memory_diagnose').execute({}, { agent })

    await sleep(25)
    const extra = join(base, 'Other')
    await mkdir(extra, { recursive: true })
    await writeFile(registry, registryJson({ 'id-demo': { path: workspace }, 'id-other': { path: extra, title: 'Other' } }), 'utf8')

    const after = await byName.get('memory_diagnose').execute({}, { agent })
    assert.ok(after.includes('工作区删除: 无待处理'), after)
    for (const rel of records) await access(join(vaultRoot, ...rel.split('/')))
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})
