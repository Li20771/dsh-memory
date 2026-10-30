// P4 test suite: episode lifecycle, harvest contract, purge, supersedes.
//   node --test tools/lifecycle.test.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rm, access, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  CLOSING_DAYS,
  assertTransition,
  canTransition,
  checkHarvestCoverage,
  closingElapsed,
  isStale,
  parseDispositions,
  renderDisposition
} from '../plugin/lib/memory/lifecycle.js'
import plugin from '../plugin/lib/index.js'
import { readMarker, writeMarker } from '../plugin/lib/workspace.js'

// ------------------------------------------------------------------ state machine

test('lifecycle: transitions are explicit and refuse the rest', () => {
  assert.equal(canTransition('active', 'harvesting'), true)
  assert.equal(canTransition('harvesting', 'closing'), true)
  // A stalled harvest may reopen; that is the one deliberate cycle.
  assert.equal(canTransition('harvesting', 'active'), true)
  assert.equal(canTransition('closing', 'purged'), true)
  assert.equal(canTransition('purged', 'active'), false)
  assert.equal(canTransition('open', 'closing'), false)
  assert.throws(() => assertTransition('purged', 'active'), /非法状态迁移/)
})

test('lifecycle: staleness and cool-down read the clock, not a guess', () => {
  const now = Date.parse('2026-10-24T00:00:00Z')
  assert.equal(isStale('2026-10-01T00:00:00Z', now, 30), false)
  assert.equal(isStale('2026-09-01T00:00:00Z', now, 30), true)
  assert.equal(isStale(null, now, 30), false)

  assert.equal(closingElapsed('2026-10-20T00:00:00Z', now), true)
  assert.equal(closingElapsed('2026-11-20T00:00:00Z', now), false)
  assert.equal(closingElapsed(null, now), false)
})

test('lifecycle: coverage demands a disposition for every record', () => {
  const records = ['a.md', 'b.md', 'c.md']
  const partial = checkHarvestCoverage(records, [
    { path: 'a.md', disposition: 'harvested', target: 'workflows/x.md' },
    { path: 'b.md', disposition: 'discarded', reason: '噪声' }
  ])
  assert.equal(partial.ok, false)
  assert.deepEqual(partial.missing, ['c.md'])
  assert.equal(partial.covered, 2)

  const complete = checkHarvestCoverage(records, [
    { path: 'a.md', disposition: 'harvested', target: 'workflows/x.md' },
    { path: 'b.md', disposition: 'discarded', reason: '噪声' },
    { path: 'c.md', disposition: 'deferred' }
  ])
  assert.equal(complete.ok, true)
  assert.equal(complete.covered, 3)
})

test('lifecycle: an invalid disposition is reported, not silently accepted', () => {
  const result = checkHarvestCoverage(
    ['a.md', 'b.md'],
    [
      { path: 'a.md', disposition: 'harvested' }, // missing target
      { path: 'b.md', disposition: 'discarded' } // missing reason
    ]
  )
  assert.equal(result.ok, false)
  assert.equal(result.invalid.length, 2)
  assert.ok(result.invalid.some((line) => line.includes('target')))
  assert.ok(result.invalid.some((line) => line.includes('reason')))
})

test('lifecycle: report lines round-trip through text', () => {
  const entry = { path: 'workspaces/ws_x/memory/a.md', disposition: 'harvested', target: 'workflows/y.md', at: '2026-10-24T00:00:00Z' }
  const line = renderDisposition(entry)
  const parsed = parseDispositions(`# 报告\n\n${line}\n`)
  assert.equal(parsed.length, 1)
  assert.equal(parsed[0].path, entry.path)
  assert.equal(parsed[0].disposition, 'harvested')
  assert.equal(parsed[0].target, 'workflows/y.md')
  assert.equal(parsed[0].at, '2026-10-24T00:00:00Z')
})

// ---------------------------------------------------------------------- harness

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

async function fixture() {
  const base = await mkdtemp(join(tmpdir(), 'dsh-p4-'))
  const vaultRoot = join(base, 'kb')
  const workspace = join(base, 'SecurityLab')
  const cwd = join(workspace, 'p1')
  await mkdir(join(vaultRoot, 'workflows'), { recursive: true })
  await mkdir(cwd, { recursive: true })
  await writeFile(join(vaultRoot, 'positioning.md'), '---\ntype: positioning\nvisibility: user-global\n---\n# 定位\n\n契约。\n', 'utf8')
  await writeMarker(workspace, {
    schema: 1,
    enabled: true,
    id: 'ws_demo',
    episode: 'ep_1',
    coordinators: ['sess_coord'],
    state: 'active',
    lastActivity: new Date().toISOString()
  })
  const harness = makeCtx()
  plugin.apply(harness.ctx, { vaultRoot, fullStatIntervalMs: 0 })
  const byName = new Map(harness.tools.map((t) => [t.name, t]))
  return { base, vaultRoot, workspace, cwd, harness, byName }
}

const asWorker = (cwd) => ({ workingDirectory: cwd, session: { id: 'sess_worker' } })
const asCoord = (cwd) => ({ workingDirectory: cwd, session: { id: 'sess_coord' } })

async function seedRecords(byName, cwd, titles) {
  const paths = []
  for (const title of titles) {
    const out = await byName.get('memory_write').execute(
      { type: 'memory', title, body: `${title} 的正文`, authority: 'user-stated' },
      { agent: asCoord(cwd) }
    )
    const match = out.match(/workspaces\/ws_demo\/memory\/[^\s]+\.md/)
    assert.ok(match, out)
    paths.push(match[0])
  }
  return paths
}

// ------------------------------------------------------------------- harvest

test('memory_harvest plan lists records and what is undisposed', async () => {
  const { base, cwd, byName } = await fixture()
  try {
    const paths = await seedRecords(byName, cwd, ['甲', '乙'])
    const plan = await byName.get('memory_harvest').execute({ action: 'plan' }, { agent: asCoord(cwd) })
    assert.ok(plan.includes('记录 2 条'), plan)
    assert.ok(plan.includes('未处置 2 条'), plan)
    for (const path of paths) assert.ok(plan.includes(path), plan)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('memory_harvest record: workers refused, coordinator appends, coverage grows', async () => {
  const { base, cwd, byName } = await fixture()
  try {
    const [first] = await seedRecords(byName, cwd, ['甲'])
    // The target must really exist before a `harvested` claim is accepted.
    await byName.get('memory_write').execute({ type: 'workflow', title: '甲流程', body: '内容' }, { agent: asCoord(cwd) })

    const refused = await byName.get('memory_harvest').execute(
      { action: 'record', path: first, disposition: 'deferred' },
      { agent: asWorker(cwd) }
    )
    assert.ok(refused.includes('拒绝'), refused)

    const recorded = await byName.get('memory_harvest').execute(
      { action: 'record', path: first, disposition: 'harvested', target: 'workflows/甲流程.md' },
      { agent: asCoord(cwd) }
    )
    assert.ok(recorded.includes('覆盖: 1/1'), recorded)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('memory_harvest record rejects a harvested target that does not exist', async () => {
  const { base, cwd, byName } = await fixture()
  try {
    const [first] = await seedRecords(byName, cwd, ['甲'])

    // The failure this guards against: recording "harvested → workflows/x.md" when
    // nothing was ever written there, then closing the episode on that claim.
    const claimed = await byName.get('memory_harvest').execute(
      { action: 'record', path: first, disposition: 'harvested', target: 'workflows/根本不存在.md' },
      { agent: asCoord(cwd) }
    )
    assert.ok(claimed.includes('拒绝'), claimed)
    assert.ok(claimed.includes('不存在'), claimed)

    // Once the target really exists, the same disposition is accepted.
    await byName.get('memory_write').execute({ type: 'workflow', title: '真的存在', body: '内容' }, { agent: asCoord(cwd) })
    const accepted = await byName.get('memory_harvest').execute(
      { action: 'record', path: first, disposition: 'harvested', target: 'workflows/真的存在.md' },
      { agent: asCoord(cwd) }
    )
    assert.ok(accepted.includes('覆盖: 1/1'), accepted)
    // No source citation was recorded, so it warns rather than blocking.
    assert.ok(accepted.includes('来源链上断了'), accepted)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('memory_harvest finish refuses on any gap, then accepts when complete', async () => {
  const { base, workspace, cwd, byName } = await fixture()
  try {
    const [first, second] = await seedRecords(byName, cwd, ['甲', '乙'])
    await byName.get('memory_write').execute({ type: 'workflow', title: '甲流程', body: '内容' }, { agent: asCoord(cwd) })
    await byName.get('memory_harvest').execute(
      { action: 'record', path: first, disposition: 'harvested', target: 'workflows/甲流程.md' },
      { agent: asCoord(cwd) }
    )

    const blocked = await byName.get('memory_harvest').execute({ action: 'finish' }, { agent: asCoord(cwd) })
    assert.ok(blocked.includes('拒绝进入 closing'), blocked)
    assert.ok(blocked.includes(second), blocked)
    assert.equal((await readMarker(workspace)).state, 'active', 'state must not move while incomplete')

    await byName.get('memory_harvest').execute(
      { action: 'record', path: second, disposition: 'discarded', reason: '一次性结论' },
      { agent: asCoord(cwd) }
    )
    const ok = await byName.get('memory_harvest').execute({ action: 'finish' }, { agent: asCoord(cwd) })
    assert.ok(ok.includes('收割完成'), ok)
    const marker = await readMarker(workspace)
    assert.equal(marker.state, 'closing')
    assert.ok(marker.closingUntil, 'cool-down recorded')
    const days = (Date.parse(marker.closingUntil) - Date.now()) / 86_400_000
    assert.ok(Math.abs(days - CLOSING_DAYS) < 1, `cool-down ≈ ${CLOSING_DAYS}d, got ${days}`)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('memory_harvest finish catches a record written after harvesting began', async () => {
  const { base, cwd, byName } = await fixture()
  try {
    const [first] = await seedRecords(byName, cwd, ['甲'])
    await byName.get('memory_harvest').execute(
      { action: 'record', path: first, disposition: 'deferred' },
      { agent: asCoord(cwd) }
    )
    // A new record appears mid-harvest — the classic "I thought I was done" gap.
    const [latecomer] = await seedRecords(byName, cwd, ['丙'])
    const blocked = await byName.get('memory_harvest').execute({ action: 'finish' }, { agent: asCoord(cwd) })
    assert.ok(blocked.includes('拒绝进入 closing'), blocked)
    assert.ok(blocked.includes(latecomer), blocked)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

// --------------------------------------------------------------------- purge

test('memory_purge: first call only reports, confirm moves to .trash and tombstones', async () => {
  const { base, vaultRoot, workspace, cwd, byName } = await fixture()
  try {
    const paths = await seedRecords(byName, cwd, ['甲', '乙'])

    const preview = await byName.get('memory_purge').execute({}, { agent: asCoord(cwd) })
    assert.ok(preview.includes('即将销毁'), preview)
    assert.ok(preview.includes('未收割'), preview)
    assert.ok(preview.includes('confirm=true'), preview)
    await access(join(vaultRoot, ...paths[0].split('/'))) // still there

    const done = await byName.get('memory_purge').execute({ confirm: true, reason: '项目终止' }, { agent: asCoord(cwd) })
    assert.ok(done.includes('移入 .trash 2 条'), done)
    assert.ok(done.includes('git 历史'), 'states the honest residual')

    // Gone from the vault, present in .trash, tombstone written.
    await assert.rejects(access(join(vaultRoot, ...paths[0].split('/'))))
    const trashRoot = join(vaultRoot, '.trash', 'ep_1')
    const stamps = await readdir(trashRoot)
    assert.equal(stamps.length, 1)
    const moved = await readdir(join(trashRoot, stamps[0]))
    assert.equal(moved.length, 2)

    const tomb = await readFile(join(vaultRoot, '.trash', 'tombstones.jsonl'), 'utf8')
    const line = JSON.parse(tomb.trim().split('\n').pop())
    assert.equal(line.op, 'purge-episode')
    assert.equal(line.scope, 'ws_demo')
    assert.equal(line.moved, 2)
    assert.equal(line.unharvested, 2)
    assert.equal((await readMarker(workspace)).state, 'purged')
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('memory_purge: worker refused', async () => {
  const { base, cwd, byName } = await fixture()
  try {
    await seedRecords(byName, cwd, ['甲'])
    const refused = await byName.get('memory_purge').execute({ confirm: true }, { agent: asWorker(cwd) })
    assert.ok(refused.includes('拒绝'), refused)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------- supersedes

test('memory_purge scope= destroys a whole workspace and leaves others alone', async () => {
  const { base, vaultRoot, cwd, byName } = await fixture()
  try {
    const agent = asCoord(cwd)
    const mine = await seedRecords(byName, cwd, ['甲', '乙'])
    // A second workspace's records, written into the vault directly.
    await mkdir(join(vaultRoot, 'workspaces', 'ws_other', 'memory'), { recursive: true })
    await writeFile(
      join(vaultRoot, 'workspaces', 'ws_other', 'memory', '2026-10-23-o.md'),
      '---\ntype: memory\nscope: ws_other\nvisibility: workspace-shared\n---\n# 别的项目\n\n不该被牵连。\n',
      'utf8'
    )

    const preview = await byName.get('memory_purge').execute({ scope: 'ws_demo' }, { agent })
    assert.ok(preview.includes('工作区 ws_demo'), preview)
    assert.ok(preview.includes('confirm=true'), preview)
    await access(join(vaultRoot, ...mine[0].split('/')))

    const done = await byName.get('memory_purge').execute({ scope: 'ws_demo', confirm: true, reason: '仓库已删除' }, { agent })
    assert.ok(done.includes('已销毁工作区 ws_demo'), done)
    assert.ok(done.includes('移入 .trash 2 条'), done)
    // The L2 map is knowledge about a repo, not this run's records — say so.
    assert.ok(done.includes('L2 地图'), done)

    await assert.rejects(access(join(vaultRoot, ...mine[0].split('/'))))
    // The other workspace is untouched.
    await access(join(vaultRoot, 'workspaces', 'ws_other', 'memory', '2026-10-23-o.md'))

    const tomb = await readFile(join(vaultRoot, '.trash', 'tombstones.jsonl'), 'utf8')
    const line = JSON.parse(tomb.trim().split('\n').pop())
    assert.equal(line.op, 'purge-workspace')
    assert.equal(line.scope, 'ws_demo')
    assert.equal(line.moved, 2)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('supersedes keeps the old note as a pointer, not an overwrite', async () => {
  const { base, vaultRoot, cwd, byName } = await fixture()
  try {
    const out = await byName.get('memory_write').execute(
      { type: 'workflow', title: '阈值', body: '阈值是 0.8' },
      { agent: asCoord(cwd) }
    )
    assert.ok(out.includes('workflows/阈值.md'), out)

    const replacement = await byName.get('memory_write').execute(
      { type: 'workflow', title: '阈值', body: '阈值改为 0.86', supersedes: 'workflows/阈值.md' },
      { agent: asCoord(cwd) }
    )
    assert.ok(replacement.includes('已取代 workflows/阈值.md'), replacement)
    // Same slug would collide, so the replacement is versioned rather than clobbering.
    assert.ok(replacement.includes('workflows/阈值-v2.md'), replacement)

    const oldContent = await readFile(join(vaultRoot, 'workflows', '阈值.md'), 'utf8')
    assert.ok(oldContent.includes('status: superseded'), oldContent)
    // yamlValue quotes non-ASCII paths, so match the key and the target separately.
    assert.ok(oldContent.includes('supersededBy:'), oldContent)
    assert.ok(oldContent.includes('阈值-v2.md'), oldContent)
    // The old body is preserved, not clobbered.
    assert.ok(oldContent.includes('阈值是 0.8'))

    const newContent = await readFile(join(vaultRoot, 'workflows', '阈值-v2.md'), 'utf8')
    assert.ok(newContent.includes('阈值改为 0.86'))
    assert.ok(newContent.includes('supersedes:'), newContent)
    assert.ok(newContent.includes('阈值.md'), newContent)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('supersedes reports a conflict when two notes claim the same predecessor', async () => {
  const { base, cwd, byName } = await fixture()
  try {
    await byName.get('memory_write').execute({ type: 'workflow', title: '基数', body: 'v1' }, { agent: asCoord(cwd) })
    await byName.get('memory_write').execute(
      { type: 'workflow', title: '基数A', body: 'v2-A', supersedes: 'workflows/基数.md' },
      { agent: asCoord(cwd) }
    )
    const second = await byName.get('memory_write').execute(
      { type: 'workflow', title: '基数B', body: 'v2-B', supersedes: 'workflows/基数.md' },
      { agent: asCoord(cwd) }
    )
    assert.ok(second.includes('冲突'), second)
    // slugify lowercases, so 基数A lands at workflows/基数a.md
    assert.ok(second.includes('基数a.md'), second)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

// ------------------------------------------------------------------ diagnose

test('memory_diagnose surfaces lifecycle state, staleness and harvest coverage', async () => {
  const { base, workspace, cwd, byName } = await fixture()
  try {
    await seedRecords(byName, cwd, ['甲'])
    // Age the episode past the stale threshold.
    const old = new Date(Date.now() - 45 * 86_400_000).toISOString()
    await writeMarker(workspace, { ...(await readMarker(workspace)), lastActivity: old })

    const out = await byName.get('memory_diagnose').execute({}, { agent: asCoord(cwd) })
    assert.ok(out.includes('段状态: active'), out)
    assert.ok(out.includes('已停滞'), out)
    assert.ok(out.includes('收割覆盖: 0/1'), out)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})
