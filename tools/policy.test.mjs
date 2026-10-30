// P3 test suite: write admission, source families, review states, role matrix.
//   node --test tools/policy.test.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { applyReview, checkAdmission, dedupeByFamily, familyOf } from '../plugin/lib/memory/policy.js'
import plugin from '../plugin/lib/index.js'
import { writeMarker } from '../plugin/lib/workspace.js'

// ------------------------------------------------------------------- policy

test('familyOf: same session+source is one family, a different session is not', () => {
  const a = familyOf({ sessionId: 's1', source: 'note.md', tool: 'memory_write' })
  const b = familyOf({ sessionId: 's1', source: 'note.md', tool: 'memory_write' })
  const c = familyOf({ sessionId: 's2', source: 'note.md', tool: 'memory_write' })
  assert.equal(a, b)
  assert.notEqual(a, c)
  assert.match(a, /^fam_[0-9a-f]{10}$/)
})

test('admission: sensitive content never reaches disk', () => {
  const verdict = checkAdmission({ type: 'memory', sensitivity: 'sensitive', body: '内部 IP 10.0.0.5' })
  assert.equal(verdict.ok, false)
  assert.equal(verdict.code, 'sensitive-refused')
  assert.ok(verdict.reason.includes('git'))
})

test('admission: unknown type and empty body are refused', () => {
  assert.equal(checkAdmission({ type: 'nonsense', body: 'x' }).code, 'unknown-type')
  assert.equal(checkAdmission({ type: 'memory', body: '   ' }).code, 'empty-body')
})

test('admission: only a coordinator may define L1', () => {
  assert.equal(checkAdmission({ type: 'positioning', body: 'x', role: 'worker' }).code, 'positioning-needs-coordinator')
  assert.equal(checkAdmission({ type: 'positioning', body: 'x', role: 'coordinator' }).code, 'admitted')
})

test('admission: tool-output / inferred cannot take workspace-wide effect unconfirmed', () => {
  const forced = checkAdmission({ type: 'memory', authority: 'inferred', body: 'x' })
  assert.equal(forced.ok, true)
  assert.equal(forced.code, 'forced-proposed')
  assert.equal(forced.forced.review.state, 'pending')

  const confirmed = checkAdmission({ type: 'memory', authority: 'inferred', body: 'x', confirmed: true })
  assert.equal(confirmed.code, 'admitted-confirmed')

  // A workflow note is not workspace-wide, so an inference may be stored normally.
  assert.equal(checkAdmission({ type: 'workflow', authority: 'inferred', body: 'x' }).code, 'admitted')
  // And an explicit user statement on a memory note is fine.
  assert.equal(checkAdmission({ type: 'memory', authority: 'user-stated', body: 'x' }).code, 'admitted')
})

test('admission: a decision must name at least two alternatives', () => {
  const none = checkAdmission({ type: 'decision', body: '我们选了 A' })
  assert.equal(none.ok, false)
  assert.equal(none.code, 'decision-needs-alternatives')

  const one = checkAdmission({ type: 'decision', body: '我们选了 A', alternatives: ['A'] })
  assert.equal(one.ok, false, '只记被选中的那一项仍然不算决策')

  const two = checkAdmission({ type: 'decision', body: '我们选了 A，因为 B 更慢', alternatives: ['A', 'B'] })
  assert.equal(two.ok, true)
})

test('admission: a project must state its non-goals', () => {
  const none = checkAdmission({ type: 'project', body: '做一个审计工具' })
  assert.equal(none.ok, false)
  assert.equal(none.code, 'project-needs-nongoals')

  const ok = checkAdmission({ type: 'project', body: '做一个审计工具', nonGoals: ['不做自动化利用'] })
  assert.equal(ok.ok, true)
})

test('dedupeByFamily keeps one representative per family, in order', () => {
  const hits = [
    { path: 'a', fam: 'f1' },
    { path: 'b', fam: 'f1' },
    { path: 'c', fam: 'f2' },
    { path: 'd', fam: 'f1' }
  ]
  const { kept, dropped } = dedupeByFamily(hits, (h) => h.fam)
  assert.deepEqual(kept.map((h) => h.path), ['a', 'c'])
  assert.equal(dropped, 2)
})

test('applyReview records state, reviewer and the replaced body hash', () => {
  const approved = applyReview({ state: 'pending' }, 'approve', { by: 'sess_c', note: 'ok' })
  assert.equal(approved.state, 'approved')
  assert.equal(approved.by, 'sess_c')
  assert.equal(approved.note, 'ok')

  const revised = applyReview({ state: 'pending' }, 'revise', { by: 'sess_c', originalTextSha: 'abc123' })
  assert.equal(revised.state, 'revised')
  assert.equal(revised.originalTextSha, 'abc123')

  assert.equal(applyReview({}, 'reject', {}).state, 'rejected')
})

// ------------------------------------------------------------------ harness

function makeCtx() {
  const tools = []
  const hooks = new Map()
  const sections = []
  return {
    tools,
    hooks,
    sections,
    ctx: {
      systemPrompt: { section: (s) => (sections.push(s), () => {}) },
      tools: { register: (t) => (tools.push(t), () => {}) },
      on: (event, handler) => {
        if (!hooks.has(event)) hooks.set(event, [])
        hooks.get(event).push(handler)
      },
      logger: { warn: (m) => console.log(`  [warn] ${m}`) }
    }
  }
}

const humanMessage = (id, text) => ({ id, role: 'user', content: [{ type: 'text', text }], source: { kind: 'user' } })

async function fixture() {
  const base = await mkdtemp(join(tmpdir(), 'dsh-p3-'))
  const vaultRoot = join(base, 'kb')
  const workspace = join(base, 'SecurityLab')
  const cwd = join(workspace, 'p1')
  const write = async (rel, body) => {
    const abs = join(vaultRoot, ...rel.split('/'))
    await mkdir(join(abs, '..'), { recursive: true })
    await writeFile(abs, body, 'utf8')
  }
  await write('positioning.md', '---\ntype: positioning\nvisibility: user-global\n---\n# 定位\n\n契约。\n')
  await mkdir(cwd, { recursive: true })
  await writeMarker(workspace, { schema: 1, enabled: true, id: 'ws_demo', episode: 'ep_1', coordinators: ['sess_coord'] })
  const harness = makeCtx()
  plugin.apply(harness.ctx, { vaultRoot, fullStatIntervalMs: 0 })
  const byName = new Map(harness.tools.map((t) => [t.name, t]))
  return { base, vaultRoot, workspace, cwd, harness, byName }
}

const asWorker = (cwd) => ({ workingDirectory: cwd, session: { id: 'sess_worker' } })
const asCoord = (cwd) => ({ workingDirectory: cwd, session: { id: 'sess_coord' } })

// ------------------------------------------------------------- tool: write

test('memory_write refuses sensitive content and writes no file', async () => {
  const { base, vaultRoot, cwd, byName } = await fixture()
  try {
    const out = await byName.get('memory_write').execute(
      { type: 'memory', title: 'secrets', body: '内部 IP', sensitivity: 'sensitive' },
      { agent: asCoord(cwd) }
    )
    assert.ok(out.includes('拒绝写入'), out)
    assert.ok(out.includes('sensitive-refused'), out)
    await assert.rejects(access(join(vaultRoot, 'workspaces/ws_demo/memory')), 'no memory dir should exist')
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('memory_write forces pending for an inferred workspace-wide claim', async () => {
  const { base, vaultRoot, cwd, byName } = await fixture()
  try {
    const out = await byName.get('memory_write').execute(
      { type: 'memory', title: 'tool 结论', body: '并发 8 时丢事件', authority: 'inferred' },
      { agent: asCoord(cwd) }
    )
    assert.ok(out.includes('forced-proposed'), out)
    const rel = out.match(/workspaces\/ws_demo\/memory\/[^\s]+\.md/)[0]
    const content = await readFile(join(vaultRoot, ...rel.split('/')), 'utf8')
    assert.ok(content.includes('state: pending'), content)
    assert.ok(content.includes('family: fam_'), 'origin family recorded')
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('memory_write: a worker cannot overwrite a note it did not write', async () => {
  const { base, cwd, byName } = await fixture()
  try {
    const args = { type: 'workflow', title: '共享流程', body: '第一版' }
    await byName.get('memory_write').execute(args, { agent: asCoord(cwd) })
    const second = await byName.get('memory_write').execute({ ...args, body: '第二版' }, { agent: asWorker(cwd) })
    assert.ok(second.includes('拒绝写入'), second)
    assert.ok(second.includes('memory_candidate'), 'points workers at the candidate path')
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

// ------------------------------------------------------ tool: role matrix

test('memory_review: worker refused, coordinator approves', async () => {
  const { base, vaultRoot, cwd, byName } = await fixture()
  try {
    await byName.get('memory_write').execute({ type: 'workflow', title: '待审流程', body: '内容' }, { agent: asCoord(cwd) })
    const rel = 'workflows/待审流程.md'

    const refused = await byName.get('memory_review').execute({ action: 'approve', path: rel }, { agent: asWorker(cwd) })
    assert.ok(refused.includes('拒绝'), refused)

    const done = await byName.get('memory_review').execute({ action: 'approve', path: rel, note: '看过了' }, { agent: asCoord(cwd) })
    assert.ok(done.includes('approved'), done)
    const content = await readFile(join(vaultRoot, ...rel.split('/')), 'utf8')
    assert.ok(content.includes('state: approved'))
    assert.ok(content.includes('sess_coord'), 'reviewer recorded')
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('memory_revise: worker refused, coordinator replaces body and keeps the old hash', async () => {
  const { base, vaultRoot, cwd, byName } = await fixture()
  try {
    await byName.get('memory_write').execute({ type: 'workflow', title: '可修订', body: '旧正文' }, { agent: asCoord(cwd) })
    const rel = 'workflows/可修订.md'

    const refused = await byName.get('memory_revise').execute({ path: rel, body: '新正文' }, { agent: asWorker(cwd) })
    assert.ok(refused.includes('拒绝'), refused)

    const done = await byName.get('memory_revise').execute({ path: rel, body: '新正文', note: '结论修窄了' }, { agent: asCoord(cwd) })
    assert.ok(done.includes('revised'), done)
    const content = await readFile(join(vaultRoot, ...rel.split('/')), 'utf8')
    assert.ok(content.includes('新正文'))
    assert.ok(!content.includes('旧正文'), 'body was replaced')
    assert.ok(content.includes('originalTextSha'), 'the replaced body is provable')
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('memory_forget: workers are refused; coordinator retracts and hard-deletes', async () => {
  const { base, vaultRoot, cwd, byName } = await fixture()
  try {
    const out = await byName.get('memory_write').execute({ type: 'memory', title: '我的记录', body: '会失效' }, { agent: asCoord(cwd) })
    const rel = out.match(/workspaces\/ws_demo\/memory\/[^\s]+\.md/)[0]

    const workerDelete = await byName.get('memory_forget').execute({ path: rel, mode: 'delete' }, { agent: asWorker(cwd) })
    assert.ok(workerDelete.includes('拒绝'), workerDelete)
    const workerRetract = await byName.get('memory_forget').execute({ path: rel, mode: 'retract' }, { agent: asWorker(cwd) })
    assert.ok(workerRetract.includes('拒绝'), workerRetract)

    const retracted = await byName.get('memory_forget').execute({ path: rel, mode: 'retract', reason: '已被推翻' }, { agent: asCoord(cwd) })
    assert.ok(retracted.includes('已失效化'), retracted)
    const content = await readFile(join(vaultRoot, ...rel.split('/')), 'utf8')
    assert.ok(content.includes('status: retracted'))
    assert.ok(content.includes('已被推翻'))

    const gone = await byName.get('memory_forget').execute({ path: rel, mode: 'delete', reason: '清理' }, { agent: asCoord(cwd) })
    assert.ok(gone.includes('已硬删除'), gone)
    await assert.rejects(access(join(vaultRoot, ...rel.split('/'))))
    assert.ok(gone.includes('git 历史'), 'states the honest residual')
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------- injection

test('injection: one representative per source family, and the coverage says so', async () => {
  const { base, vaultRoot, cwd, harness } = await fixture()
  try {
    const dir = join(vaultRoot, 'workspaces', 'ws_demo', 'memory')
    await mkdir(dir, { recursive: true })
    const note = (name, family, body) =>
      writeFile(
        join(dir, name),
        `---\ntype: memory\nscope: ws_demo\nvisibility: workspace-shared\nreview:\n  state: approved\norigin:\n  session: s\n  family: ${family}\ncreated: 2026-10-23T0${name.length}:00:00Z\n---\n# ${name}\n\n${body}\n`,
        'utf8'
      )
    // Three records, two of which are the same evidence seen twice.
    await note('2026-10-23-a.md', 'fam_same', '结论甲：并发 8 丢事件')
    await note('2026-10-23-b.md', 'fam_same', '结论甲（重复记录）：并发 8 丢事件')
    await note('2026-10-23-c.md', 'fam_other', '结论乙：阈值是 0.86')

    const hook = harness.hooks.get('agent/pre-step')[0]
    const decision = { kind: 'continue', messages: [humanMessage('m1', 'zzz 无匹配查询')] }
    const out = await hook({ agent: asWorker(cwd), messages: decision.messages, step: 1, signal: {} }, async () => decision)
    const text = out.messages[out.messages.length - 1].content[0].text

    assert.ok(text.includes('结论甲'), text.slice(0, 600))
    assert.ok(text.includes('结论乙'), text.slice(0, 600))
    assert.ok(text.includes('按来源族去重 1 条'), text.slice(-500))
    assert.equal((text.match(/结论甲/g) || []).length, 1, 'duplicate family collapses to one line')
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('injection: every row carries credibility (review state + where the claim came from)', async () => {
  const { base, vaultRoot, cwd, harness } = await fixture()
  try {
    const dir = join(vaultRoot, 'workspaces', 'ws_demo', 'memory')
    await mkdir(dir, { recursive: true })
    await writeFile(
      join(dir, '2026-10-23-p.md'),
      `---\ntype: memory\nscope: ws_demo\nvisibility: workspace-shared\nauthority: inferred\nreview:\n  state: approved\norigin:\n  session: s\n  family: fam_p\ncreated: 2026-10-23T10:00:00Z\n---\n# p\n\n推断内容\n`,
      'utf8'
    )
    await writeFile(
      join(dir, '2026-10-23-q.md'),
      `---\ntype: memory\nscope: ws_demo\nvisibility: workspace-shared\nauthority: agent-observed\nreview:\n  state: approved\norigin:\n  session: s\n  family: fam_q\ncreated: 2026-10-23T11:00:00Z\n---\n# q\n\n观察内容\n`,
      'utf8'
    )
    const hook = harness.hooks.get('agent/pre-step')[0]
    const decision = { kind: 'continue', messages: [humanMessage('m1', 'zzz')] }
    // A worker reads approved memory in its workspace — role gates writing, not reading.
    const out = await hook({ agent: asWorker(cwd), messages: decision.messages, step: 1, signal: {} }, async () => decision)
    const text = out.messages[out.messages.length - 1].content[0].text

    // "实测 vs 推测" must be visible in the injected block, not only stored.
    assert.ok(text.includes('[已审·推断]'), text.slice(0, 900))
    assert.ok(text.includes('[已审·观察]'), text.slice(0, 900))
    assert.ok(text.includes('推断内容') && text.includes('观察内容'), '两条都要被注入（worker 可读全工作区）')
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})
