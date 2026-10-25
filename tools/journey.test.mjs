// End-to-end journey: the whole reason this system exists.
//   node --test tools/journey.test.mjs
//
// One project run, start to finish, through the real tool surface:
//
//   1. a worker measures something and records it in workspace memory (L4)
//   2. a coordinator promotes the conclusion into the knowledge base, citing
//      durable evidence AND the working record it came from
//   3. the episode is harvested (every record dispositioned)
//   4. the episode is destroyed
//   5. the conclusion is STILL there, still findable, and the audit says the
//      destroyed citation was destroyed on purpose — not "broken"
//
// Step 5 is the one that was missing: the mechanism existed, but nothing proved
// the chain end to end. Writing it also forced a real fix — see §"已销毁" below.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm, access, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import plugin from '../plugin/lib/index.js'
import { writeMarker, readMarker } from '../plugin/lib/workspace.js'

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
  const base = await mkdtemp(join(tmpdir(), 'dsh-journey-'))
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
    episode: 'ep_42',
    coordinators: ['sess_coord'],
    state: 'active',
    lastActivity: new Date().toISOString()
  })
  const harness = makeCtx()
  plugin.apply(harness.ctx, { vaultRoot, fullStatIntervalMs: 0 })
  return { base, vaultRoot, workspace, cwd, byName: new Map(harness.tools.map((t) => [t.name, t])) }
}

const asWorker = (cwd) => ({ workingDirectory: cwd, session: { id: 'sess_worker' } })
const asCoord = (cwd) => ({ workingDirectory: cwd, session: { id: 'sess_coord' } })

test('journey: measure → promote → harvest → destroy, and the conclusion survives', async () => {
  const { base, vaultRoot, workspace, cwd, byName } = await fixture()
  try {
    // ---- 1. the worker measures something and records it in L4 ---------------
    const recorded = await byName.get('memory_write').execute(
      {
        type: 'memory',
        title: '并发丢事件',
        body: '压测结论：并发到 8 时开始丢事件。',
        authority: 'agent-observed'
      },
      { agent: asWorker(cwd) }
    )
    const record = recorded.match(/workspaces\/ws_demo\/memory\/[^\s]+\.md/)[0]

    // ---- 2. the coordinator promotes it into the KB ------------------------
    // Durable evidence first (a log note that will outlive the episode)...
    await byName.get('memory_write').execute(
      { type: 'log', project: 'cpa', title: 'run-42', body: '压测日志摘要：qps 2000，并发 8，丢事件 3 次。', authority: 'measured' },
      { agent: asCoord(cwd) }
    )
    // ...then the finding, citing BOTH the durable log and the working record.
    const promoted = await byName.get('memory_write').execute(
      {
        type: 'finding',
        project: 'cpa',
        title: '并发丢事件',
        body: '结论：并发到 8 时开始丢事件。证据见压测日志。',
        authority: 'measured',
        sources: ['projects/cpa/log/run-42.md', record]
      },
      { agent: asCoord(cwd) }
    )
    const finding = promoted.match(/projects\/cpa\/findings\/[^\s]+\.md/)[0]
    assert.ok(finding.includes('并发丢事件'), promoted)

    // ---- 3. harvest: every record must be dispositioned ---------------------
    const planned = await byName.get('memory_harvest').execute({ action: 'plan' }, { agent: asCoord(cwd) })
    assert.ok(planned.includes('未处置 1 条'), planned)

    const dispositioned = await byName.get('memory_harvest').execute(
      { action: 'record', path: record, disposition: 'harvested', target: finding },
      { agent: asCoord(cwd) }
    )
    assert.ok(dispositioned.includes('覆盖: 1/1'), dispositioned)

    const closed = await byName.get('memory_harvest').execute({ action: 'finish' }, { agent: asCoord(cwd) })
    assert.ok(closed.includes('收割完成'), closed)
    assert.equal((await readMarker(workspace)).state, 'closing')

    // ---- 4. destroy the episode -------------------------------------------
    const preview = await byName.get('memory_purge').execute({}, { agent: asCoord(cwd) })
    assert.ok(preview.includes('1 条记录'), preview)
    const destroyed = await byName.get('memory_purge').execute({ confirm: true, reason: '项目收尾' }, { agent: asCoord(cwd) })
    assert.ok(destroyed.includes('移入 .trash 1 条'), destroyed)
    await assert.rejects(access(join(vaultRoot, ...record.split('/'))), 'L4 记录必须消失')

    // ---- 5. the conclusion is still there, and still findable --------------
    await access(join(vaultRoot, ...finding.split('/')))
    const found = await byName.get('memory_search').execute({ query: '并发 丢事件' }, { agent: asWorker(cwd) })
    assert.ok(found.includes(finding), `结论必须仍然可检索：${found}`)

    // The record is gone, but its PATH still appears in the harvest report — that is
    // the audit trail and it should stay. So assert on resolvability, not on text.
    const resolvable = await byName.get('memory_search').execute({ verify: record }, { agent: asWorker(cwd) })
    assert.ok(resolvable.includes('状态: missing'), `被销毁的记录应解析为 missing：${resolvable}`)
    const report = await readFile(join(vaultRoot, 'workspaces', 'ws_demo', 'harvest', 'ep_42.md'), 'utf8')
    assert.ok(report.includes(record), '收割报告应保留指向已销毁记录的审计痕迹')

    // ---- and the audit must not cry wolf -----------------------------------
    // The finding cites the destroyed record. That citation is now unresolvable —
    // but on purpose, with a tombstone to prove it. Reporting it as "broken" would
    // make every正常 harvest look like an incident.
    const diag = await byName.get('memory_diagnose').execute({}, { agent: asCoord(cwd) })
    const audit = diag.split('\n').find((line) => line.includes('引用审计')) ?? ''
    assert.match(audit, /失效 0/, `被有意销毁的引用不该算失效：${audit}`)
    assert.match(audit, /已销毁 1/, `必须如实报告有一条引用因销毁而消失：${audit}`)

    // The tombstone is what makes that distinction possible.
    const tombstones = await readFile(join(vaultRoot, '.trash', 'tombstones.jsonl'), 'utf8')
    assert.ok(tombstones.includes(record), '墓碑里必须有被销毁记录的路径')
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('journey: a second run in the same workspace starts from the KB, not from scratch', async () => {
  const { base, vaultRoot, workshop, cwd, byName } = await (async () => {
    const f = await fixture()
    return { ...f, workshop: f.workspace }
  })()
  try {
    // First run leaves a conclusion in the KB and destroys its episode.
    await byName.get('memory_write').execute(
      { type: 'finding', project: 'cpa', title: '阈值结论', body: '阈值是 0.86 MPa。', authority: 'measured' },
      { agent: asCoord(cwd) }
    )

    // Second run: a fresh episode, no L4 records at all.
    await writeMarker(workshop, {
      schema: 1,
      enabled: true,
      id: 'ws_demo',
      episode: 'ep_43',
      coordinators: ['sess_coord'],
      state: 'active',
      lastActivity: new Date().toISOString()
    })
    const found = await byName.get('memory_search').execute({ query: '阈值 0.86' }, { agent: asWorker(cwd) })
    assert.ok(found.includes('projects/cpa/findings/阈值结论.md'), `新段应能从知识库接上：${found}`)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})
