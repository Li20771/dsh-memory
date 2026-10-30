// Host-side UI routes: `/dsh-memory/panel/*` and `/dsh-memory/kb/api/*`.
//   node --test tools/ui-routes.test.mjs
//
// What this file proves, and why each part exists:
//
//   · every contract route answers 200 with the frozen shape (build-contract §3)
//   · malformed input is refused with 400 and never reaches the vault
//   · a missing note is 404 — the UI's "missing" state, not an empty note
//   · a path parameter can never leave vaultRoot (`..`, absolute, symlink)
//   · `ok` / `changed` / `refused` keep their three distinct meanings, and the
//     governance gates (coordinator role, pinned-forget) are NOT bypassed by
//     going through HTTP instead of the tool
//   · `l3.items` and `memory_workflow(action:"list")` render byte for byte alike,
//     which is the observable form of "one shared implementation, no second copy"
//
// The expected strings are written out here as the SPEC, not read back from the
// production renderer: a test that asks production what it produced proves
// nothing. The prefix and the route paths are read from plugin/ui-contract.json
// (the single source) so this file cannot drift from it.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { dirname, join, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'

import plugin from '../plugin/lib/index.js'
import { writeMarker } from '../plugin/lib/workspace.js'
import { revisionOf } from '../plugin/lib/vault/cite.js'
import { parseNote } from '../plugin/lib/vault/parse.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '..')
const PLUGIN = join(REPO, 'plugin')

const CONTRACT = JSON.parse(await readFile(join(PLUGIN, 'ui-contract.json'), 'utf8'))
const PREFIX = CONTRACT.prefix
const PANEL = CONTRACT.panel
const KB = CONTRACT.kb
const KBPAGE_BASE = `${PREFIX}${KB.page.replace(/\/+$/, '')}`

const EXPECTED_WARN = 'dsh-memory: webServer 不可用，UI 路由未注册'

// ------------------------------------------------------------------ harness

function makeCtx({ withWebServer = true } = {}) {
  const routes = new Map()
  const registrations = []
  const warns = []
  const tools = []
  const sections = []
  let disposed = 0
  const ctx = {
    systemPrompt: { section: (section) => (sections.push(section), () => {}) },
    tools: { register: (tool) => (tools.push(tool), () => {}) },
    on: () => {},
    logger: { warn: (message) => warns.push(String(message)) }
  }
  if (withWebServer) {
    ctx.webServer = {
      register(route) {
        const key = `${route.kind} ${route.path}`
        if (routes.has(key)) throw new Error(`duplicate route ${key}`)
        routes.set(key, route)
        registrations.push(key)
        return () => {
          routes.delete(key)
          disposed++
        }
      }
    }
  }
  return { ctx, routes, registrations, warns, tools, sections, disposedCount: () => disposed }
}

/** The host's own matcher (dsh-host-webserver `match()`): exact first, then longest prefix. */
function matchRoute(routes, pathname) {
  const exact = routes.get(`exact ${pathname}`)
  if (exact !== undefined) return exact
  let best = null
  for (const [key, route] of routes) {
    if (!key.startsWith('prefix ')) continue
    const prefix = key.slice('prefix '.length)
    if (pathname !== prefix && !pathname.startsWith(`${prefix}/`)) continue
    if (best === null || prefix.length > best.path.length) best = route
  }
  return best
}

function fakeRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: Buffer.alloc(0),
    ended: false,
    setHeader(name, value) {
      res.headers[String(name).toLowerCase()] = value
    },
    getHeader(name) {
      return res.headers[String(name).toLowerCase()]
    },
    end(chunk) {
      if (chunk !== undefined && chunk !== null) {
        res.body = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), 'utf8')
      }
      res.ended = true
    }
  }
  return res
}

/**
 * Call one registered route the way the host would: the pathname is normalized
 * by WHATWG URL first (so a plain `../` collapses before routing, exactly as in
 * the real server) while the raw url is handed to the handler intact.
 */
async function call(harness, pathname, options = {}) {
  const { method, search, body, raw, allowUnmatched = false } = options
  const encoded = search ? `${pathname}?${new URLSearchParams(search)}` : pathname
  const url = raw ?? encoded
  const target = matchRoute(harness.routes, new URL(url, 'http://127.0.0.1').pathname)
  // No registered route means the real host's fallback seat answers 404 — but in
  // this harness that must never be how a test "passes", so it throws instead
  // unless the test is explicitly about the fallback.
  if (!target) {
    if (!allowUnmatched) throw new Error(`no route registered for ${url}`)
    return { status: 404, json: null, text: '', headers: {}, route: null }
  }
  const payload =
    body === undefined ? null : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body), 'utf8')
  const req = Readable.from(payload === null ? [] : [payload], { objectMode: false })
  req.method = method ?? (payload === null ? 'GET' : 'POST')
  req.url = url
  req.headers = { host: '127.0.0.1:0' }
  const res = fakeRes()
  await target.handler(req, res)
  const text = res.body.toString('utf8')
  let json = null
  try {
    json = JSON.parse(text)
  } catch {
    json = null
  }
  return { status: res.statusCode, json, text, headers: res.headers, body: res.body, route: target }
}

const asCoord = (cwd) => ({ workingDirectory: cwd, session: { id: 'sess_coord' } })

// ------------------------------------------------------------------ fixture

async function fixture() {
  const base = await mkdtemp(join(tmpdir(), 'dsh-ui-'))
  const vaultRoot = join(base, 'kb')
  const workspace = join(base, 'Lab')
  const cwd = join(workspace, 'p1')
  const plainDir = join(base, 'no-marker')
  const pageDir = join(base, 'kbpage')
  await mkdir(plainDir, { recursive: true })
  await mkdir(pageDir, { recursive: true })

  const write = async (rel, text) => {
    const abs = join(vaultRoot, ...rel.split('/'))
    await mkdir(dirname(abs), { recursive: true })
    await writeFile(abs, text, 'utf8')
  }

  await write('positioning.md', '---\ntype: positioning\ntitle: 定位\nvisibility: user-global\ncreated: 2026-01-01T00:00:00Z\nupdated: 2026-01-02T00:00:00Z\n---\n# 定位\n\n我是执行代理。\n')
  await write('workspaces/ws_demo.md', '---\ntype: workspace\ntitle: 工作区地图\nscope: ws_demo\nvisibility: workspace-shared\n---\n# Lab\n\n库在这。\n')
  await write('workflows/a-old.md', '---\ntype: workflow\ntitle: 老流程\nvisibility: user-global\ncreated: 2020-01-01T00:00:00Z\nstatus: active\n---\n# 老流程\n\n很久没用。\n')
  await write('workflows/b-new.md', '---\ntype: workflow\ntitle: 新流程\nvisibility: user-global\nstatus: active\n---\n# 新流程\n\n在用。\n')
  await write('workflows/c-pinned.md', '---\ntype: workflow\ntitle: 固定的\nvisibility: user-global\npinned: true\nstatus: active\n---\n# 固定的\n\n永久。\n')
  await write('workflows/d-retracted.md', '---\ntype: workflow\ntitle: 已撤回\nvisibility: user-global\nstatus: retracted\n---\n# 已撤回\n\n不该出现。\n')
  await write('projects/p1/findings/f2.md', '---\ntype: finding\ntitle: 目标\nscope: ws_demo\nvisibility: user-global\n---\n# 目标\n\n引用目标段落。 ^f2blk\n')

  const f2 = parseNote(await readFile(join(vaultRoot, 'projects/p1/findings/f2.md'), 'utf8'))
  const f2Revision = revisionOf(f2.body)

  await write(
    'projects/p1/findings/f1.md',
    [
      '---',
      'type: finding',
      'title: 发现',
      'scope: ws_demo',
      'visibility: user-global',
      'tags: [alpha, beta]',
      "sources: ['projects/p1/findings/f2.md#^f2blk@" + f2Revision + "', 'projects/p1/findings/f2.md#^f2blk@deadbeefdead']",
      'created: 2026-02-01T00:00:00Z',
      'updated: 2026-02-02T00:00:00Z',
      '---',
      '# 发现',
      '',
      '## 小节',
      '',
      '第一行提到 [[f2]]。 ^b1',
      '第二行收尾。',
      ''
    ].join('\n')
  )
  await write('projects/p1/notes/n2.md', '---\ntype: note\ntitle: 引用者\nscope: ws_demo\nvisibility: user-global\ntags: [beta]\n---\n# 引用者\n\n见 [[f1]]。\n')

  await mkdir(join(vaultRoot, '.kb-index'), { recursive: true })
  await writeFile(
    join(vaultRoot, '.kb-index', 'usage.jsonl'),
    [
      JSON.stringify({ at: new Date().toISOString(), path: 'workflows/b-new.md' }),
      JSON.stringify({ at: new Date().toISOString(), path: 'workflows/b-new.md' }),
      ''
    ].join('\n'),
    'utf8'
  )

  await mkdir(cwd, { recursive: true })
  await writeMarker(workspace, {
    schema: 1,
    enabled: true,
    id: 'ws_demo',
    episode: 'ep_1',
    coordinators: ['sess_coord'],
    state: 'active'
  })

  await writeFile(join(pageDir, 'index.html'), '<!doctype html><title>kb</title>\n', 'utf8')
  await writeFile(join(pageDir, 'app.js'), 'console.log("kb")\n', 'utf8')
  await writeFile(join(pageDir, 'app.css'), 'body{}\n', 'utf8')
  await writeFile(join(pageDir, 'secret.txt'), 'not served\n', 'utf8')

  return {
    base,
    vaultRoot,
    workspace,
    cwd,
    plainDir,
    pageDir,
    f2Revision,
    f1Abs: join(vaultRoot, 'projects/p1/findings/f1.md')
  }
}

async function mounted({ withWebServer = true, uiDir } = {}) {
  const fx = await fixture()
  const harness = makeCtx({ withWebServer })
  const teardown = plugin.apply(harness.ctx, {
    vaultRoot: fx.vaultRoot,
    fullStatIntervalMs: 0,
    ...(uiDir === undefined ? {} : { uiDir })
  })
  const byName = new Map(harness.tools.map((tool) => [tool.name, tool]))
  return { ...fx, harness, byName, teardown }
}

async function mountedWithPage() {
  const fx = await fixture()
  const harness = makeCtx()
  const teardown = plugin.apply(harness.ctx, {
    vaultRoot: fx.vaultRoot,
    fullStatIntervalMs: 0,
    uiDir: fx.pageDir
  })
  const byName = new Map(harness.tools.map((tool) => [tool.name, tool]))
  return { ...fx, harness, byName, teardown }
}

const keysOf = (value) => Object.keys(value).sort()

/** The list line, written out as the spec (§3.1 + the tool's own renderer). */
function expectedLine(item) {
  const score = item.score < 0.001 ? '<0.001' : item.score.toFixed(3)
  const age = item.ageDays === null ? '未记录使用' : `${item.ageDays} 天未用`
  return `- ${item.state === 'pinned' ? '📌' : '·'} ${item.path}｜${item.state}｜score=${score}｜${age}｜召回 ${item.useCount} 次`
}

// ------------------------------------------------------- inject & registration

test('inject: webServer stays OUT of the hard list; the routes acquire it at runtime', async () => {
  // build-contract §3.4 asks for `{ required: [...], optional: ['webServer'] }`.
  // This host's Cordis (4.0.5) has no optional-dependency form: `Inject.resolve`
  // turns every key of an object declaration into a REQUIRED service, so that
  // literal leaves the fiber PENDING forever — measured, with `tools` present:
  //   inject = { required: ['tools'], optional: ['webServer'] }  ->  state=PENDING
  // Declaring it would cost every memory tool on every profile, which is the one
  // outcome the contract's own rationale exists to prevent. So the hard list is
  // unchanged and `webServer` is asked for at runtime.
  const ns = await import('../plugin/lib/index.js')
  assert.deepEqual(plugin.inject, ['tools', 'systemPrompt'])
  assert.deepEqual(ns.inject, ['tools', 'systemPrompt'])
  assert.deepEqual(ns.OPTIONAL_INJECT, ['webServer'])
  assert.equal(plugin.inject.includes('webServer'), false)
})

test('routes: every contract route is registered under the prefix and unwound on unload', async () => {
  const fx = await mountedWithPage()
  try {
    assert.deepEqual(fx.harness.registrations.slice().sort(), [
      `exact ${PREFIX}${PANEL.overview}`,
      `exact ${PREFIX}${PANEL.workflow}`,
      `exact ${PREFIX}${KB.tree}`,
      `exact ${PREFIX}${KB.note}`,
      `exact ${PREFIX}${KB.resolve}`,
      `exact ${PREFIX}${KB.search}`,
      `exact ${PREFIX}${KB.open}`,
      `prefix ${KBPAGE_BASE}`
    ].sort())
    assert.equal(typeof fx.teardown, 'function')
    assert.equal(fx.harness.disposedCount(), 0)

    fx.teardown()
    assert.equal(fx.harness.routes.size, 0, 'unload must remove every route')
    assert.equal(fx.harness.disposedCount(), fx.harness.registrations.length)
  } finally {
    await rm(fx.base, { recursive: true, force: true })
  }
})

test('routes: without ctx.webServer only a warn is emitted; tools and prompt still mount', async () => {
  const fx = await mounted({ withWebServer: false })
  try {
    assert.equal(fx.harness.routes.size, 0)
    assert.ok(fx.harness.warns.includes(EXPECTED_WARN), fx.harness.warns.join(' | '))
    assert.equal(fx.harness.tools.length, 12)
    assert.equal(fx.harness.sections.length, 1)
    assert.equal(typeof fx.teardown, 'function')
    // The tools still work: the warning is not a degraded memory plugin.
    const out = await fx.byName.get('memory_workflow').execute({ action: 'list' }, { agent: asCoord(fx.cwd) })
    assert.ok(out.includes('L3 工作流 3 条'), out)
  } finally {
    await rm(fx.base, { recursive: true, force: true })
  }
})

// ------------------------------------------------------------ panel/overview

test('GET panel/overview: 200 with the contract shape and a coordinator role', async () => {
  const fx = await mounted()
  try {
    const res = await call(fx.harness, `${PREFIX}${PANEL.overview}`, { search: { cwd: fx.cwd, session: 'sess_coord' } })
    assert.equal(res.status, 200)
    const body = res.json
    assert.deepEqual(keysOf(body), ['audit', 'diagnose', 'knowledge', 'l3', 'layers', 'ok', 'vault', 'workspace'])

    assert.equal(body.ok, true)
    assert.deepEqual(body.vault, { root: fx.vaultRoot })

    assert.deepEqual(keysOf(body.workspace), [
      'coordinators',
      'enabled',
      'episode',
      'harvest',
      'id',
      'lastActivity',
      'mapAlwaysOn',
      'role',
      'root',
      'stale',
      'state'
    ])
    assert.equal(body.workspace.root, fx.workspace)
    assert.equal(body.workspace.id, 'ws_demo')
    assert.equal(body.workspace.episode, 'ep_1')
    assert.equal(body.workspace.enabled, true)
    assert.equal(body.workspace.mapAlwaysOn, true)
    assert.equal(body.workspace.role, 'coordinator')
    assert.deepEqual(body.workspace.coordinators, ['sess_coord'])
    assert.equal(body.workspace.state, 'active')
    assert.equal(body.workspace.lastActivity, null)
    assert.equal(body.workspace.stale, false)
    assert.deepEqual(body.workspace.harvest, { covered: 0, total: 0, missing: [] })

    // L1/L2 are the injected notes, verbatim.
    assert.equal(body.layers.l1.path, 'positioning.md')
    assert.equal(body.layers.l1.title, '定位')
    assert.equal(body.layers.l1.present, true)
    assert.ok(body.layers.l1.body.includes('我是执行代理'), body.layers.l1.body)
    assert.equal(
      body.layers.l1.revision,
      revisionOf(parseNote(await readFile(join(fx.vaultRoot, 'positioning.md'), 'utf8')).body)
    )
    assert.equal(body.layers.l2.path, 'workspaces/ws_demo.md')
    assert.equal(body.layers.l2.title, '工作区地图')
    assert.equal(body.layers.l2.present, true)
    assert.ok(body.layers.l2.body.includes('库在这'), body.layers.l2.body)
    // L4 fails closed and says so through `present:false` — no borrowed text.
    assert.deepEqual(keysOf(body.layers.l4), ['body', 'path', 'present', 'revision', 'title', 'updated'])
    assert.equal(body.layers.l4.present, false)
    assert.equal(body.layers.l4.body, '')
    assert.equal(body.layers.l4.updated, null)
    assert.equal(body.layers.l4.revision, null)

    assert.deepEqual(keysOf(body.l3), ['byState', 'halfLifeDays', 'items'])
    assert.equal(body.l3.halfLifeDays, 90)
    assert.deepEqual(body.l3.byState, { active: 1, decaying: 0, expired: 1, pinned: 1 })
    assert.deepEqual(body.l3.items.map((item) => item.path), [
      'workflows/a-old.md',
      'workflows/b-new.md',
      'workflows/c-pinned.md'
    ])
    for (const item of body.l3.items) {
      assert.deepEqual(keysOf(item), ['ageDays', 'path', 'pinned', 'score', 'state', 'title', 'useCount'])
    }
    const [old, fresh, pinned] = body.l3.items
    assert.equal(old.state, 'expired')
    assert.equal(old.pinned, false)
    assert.equal(old.useCount, 0)
    assert.ok(old.score < 0.001, `ascending order means the oldest is first: ${old.score}`)
    assert.ok(old.ageDays > 2400, String(old.ageDays))
    assert.equal(fresh.state, 'active')
    assert.equal(fresh.score, 1)
    assert.equal(fresh.ageDays, 0)
    assert.equal(fresh.useCount, 2, 'usage.jsonl recall count')
    assert.equal(pinned.state, 'pinned')
    assert.equal(pinned.pinned, true)
    assert.equal(pinned.ageDays, null)
    assert.equal(pinned.score, 1)
    // Ascending by score, so l3.items[0].score <= ... <= last.
    const scores = body.l3.items.map((item) => item.score)
    assert.deepEqual(scores, [...scores].sort((a, b) => a - b))

    assert.deepEqual(keysOf(body.knowledge), ['entryUrl', 'linkHealth', 'notes', 'tags'])
    assert.equal(body.knowledge.notes, 9)
    assert.deepEqual(body.knowledge.tags, [
      { tag: 'beta', count: 2 },
      { tag: 'alpha', count: 1 }
    ])
    assert.equal(body.knowledge.entryUrl, `${PREFIX}${KB.page}`)
    assert.deepEqual(keysOf(body.knowledge.linkHealth), ['ambiguous', 'resolved', 'total', 'unresolved'])
    assert.deepEqual(body.knowledge.linkHealth.unresolved, [])
    assert.deepEqual(body.knowledge.linkHealth.ambiguous, [])
    assert.equal(body.knowledge.linkHealth.total, 2)
    assert.equal(body.knowledge.linkHealth.resolved, 2)

    assert.deepEqual(keysOf(body.audit), ['broken', 'examples', 'gone', 'stale', 'total'])
    assert.equal(body.audit.total, 2)
    assert.equal(body.audit.stale, 1)
    assert.equal(body.audit.broken, 0)
    assert.equal(body.audit.gone, 0)
    assert.equal(body.audit.examples.length, 1)

    assert.deepEqual(keysOf(body.diagnose), ['lines'])
    assert.ok(Array.isArray(body.diagnose.lines))
    assert.ok(body.diagnose.lines[0].startsWith('cwd: '), body.diagnose.lines[0])
    assert.ok(body.diagnose.lines.some((line) => line.startsWith('工作区根: ')), body.diagnose.lines.join('|'))
  } finally {
    await rm(fx.base, { recursive: true, force: true })
  }
})

test('GET panel/overview: diagnose lines are exactly the memory_diagnose tool output', async () => {
  const fx = await mounted()
  try {
    const res = await call(fx.harness, `${PREFIX}${PANEL.overview}`, { search: { cwd: fx.cwd, session: 'sess_coord' } })
    const tool = await fx.byName.get('memory_diagnose').execute({}, { agent: asCoord(fx.cwd) })
    assert.equal(res.json.diagnose.lines.join('\n'), tool)
  } finally {
    await rm(fx.base, { recursive: true, force: true })
  }
})

test('GET panel/overview: no session is a worker; no marker is no workspace', async () => {
  const fx = await mounted()
  try {
    const asWorker = await call(fx.harness, `${PREFIX}${PANEL.overview}`, { search: { cwd: fx.cwd } })
    assert.equal(asWorker.json.workspace.role, 'worker')
    assert.deepEqual(asWorker.json.workspace.coordinators, ['sess_coord'])

    const outside = await call(fx.harness, `${PREFIX}${PANEL.overview}`, { search: { cwd: fx.plainDir } })
    assert.equal(outside.status, 200)
    assert.equal(outside.json.workspace.root, null)
    assert.equal(outside.json.workspace.id, null)
    assert.equal(outside.json.workspace.role, 'worker')
    assert.equal(outside.json.workspace.enabled, false)
    assert.deepEqual(outside.json.workspace.harvest, { covered: 0, total: 0, missing: [] })
    assert.equal(outside.json.layers.l1.present, true, 'L1 is workspace-independent')
    assert.equal(outside.json.layers.l2.present, false)
    assert.equal(outside.json.layers.l4.present, false)
    assert.equal(outside.json.l3.items.length, 3, 'L3 is a global pool, not a workspace layer')

    // Omitting cwd entirely must not throw; it falls back to process.cwd().
    const fallback = await call(fx.harness, `${PREFIX}${PANEL.overview}`)
    assert.equal(fallback.status, 200)
    assert.equal(fallback.json.ok, true)
  } finally {
    await rm(fx.base, { recursive: true, force: true })
  }
})

test('l3.items and memory_workflow(action:"list") agree byte for byte', async () => {
  const fx = await mounted()
  try {
    const res = await call(fx.harness, `${PREFIX}${PANEL.overview}`, { search: { cwd: fx.cwd, session: 'sess_coord' } })
    const items = res.json.l3.items
    const tool = await fx.byName.get('memory_workflow').execute({ action: 'list' }, { agent: asCoord(fx.cwd) })
    const lines = tool.split('\n')
    assert.equal(lines[0], `L3 工作流 ${items.length} 条（按衰减分升序：最该忘的在最前）`)
    assert.deepEqual(lines.slice(1), items.map(expectedLine))

    // And the same agreement must hold on the POST response's trailing list.
    const post = await call(fx.harness, `${PREFIX}${PANEL.workflow}`, {
      body: { action: 'pin', path: 'workflows/b-new.md', cwd: fx.cwd, session: 'sess_coord' }
    })
    const after = await fx.byName.get('memory_workflow').execute({ action: 'list' }, { agent: asCoord(fx.cwd) })
    assert.equal(after.split('\n')[0], `L3 工作流 ${post.json.l3.items.length} 条（按衰减分升序：最该忘的在最前）`)
    assert.deepEqual(after.split('\n').slice(1), post.json.l3.items.map(expectedLine))
    assert.deepEqual(keysOf(post.json.l3), ['byState', 'halfLifeDays', 'items'])
    assert.deepEqual(post.json.l3.items.map((item) => item.path), ['workflows/a-old.md', 'workflows/b-new.md', 'workflows/c-pinned.md'])
  } finally {
    await rm(fx.base, { recursive: true, force: true })
  }
})

test('GET panel/overview: an empty L3 pool renders the tool\'s empty line', async () => {
  const fx = await mounted()
  try {
    for (const path of ['workflows/a-old.md', 'workflows/b-new.md', 'workflows/c-pinned.md']) {
      await rm(join(fx.vaultRoot, ...path.split('/')), { force: true })
    }
    const res = await call(fx.harness, `${PREFIX}${PANEL.overview}`, { search: { cwd: fx.cwd, session: 'sess_coord' } })
    assert.deepEqual(res.json.l3.items, [])
    assert.deepEqual(res.json.l3.byState, { active: 0, decaying: 0, expired: 0, pinned: 0 })
    const tool = await fx.byName.get('memory_workflow').execute({ action: 'list' }, { agent: asCoord(fx.cwd) })
    assert.equal(tool, 'L3 工作流池为空。')
  } finally {
    await rm(fx.base, { recursive: true, force: true })
  }
})

// ------------------------------------------------------------ panel/workflow

test('POST panel/workflow pin: coordinator changes the vault and reports the tool message', async () => {
  const fx = await mounted()
  try {
    const res = await call(fx.harness, `${PREFIX}${PANEL.workflow}`, {
      body: { action: 'pin', path: 'workflows/a-old.md', cwd: fx.cwd, session: 'sess_coord' }
    })
    assert.equal(res.status, 200)
    assert.deepEqual(keysOf(res.json), ['changed', 'l3', 'message', 'ok', 'refused'])
    assert.equal(res.json.ok, true)
    assert.equal(res.json.changed, true)
    assert.equal(res.json.refused, null)
    assert.equal(res.json.message, 'workflows/a-old.md → 已固定：永久保留，不参与衰减淘汰。')
    assert.equal(res.json.l3.items.find((item) => item.path === 'workflows/a-old.md').state, 'pinned')

    const onDisk = await readFile(join(fx.vaultRoot, 'workflows/a-old.md'), 'utf8')
    assert.ok(/^pinned: true$/m.test(onDisk), onDisk)
  } finally {
    await rm(fx.base, { recursive: true, force: true })
  }
})

test('POST panel/workflow pin: a worker is accepted but refused, and the vault is untouched', async () => {
  const fx = await mounted()
  try {
    const before = await readFile(join(fx.vaultRoot, 'workflows/a-old.md'), 'utf8')
    const res = await call(fx.harness, `${PREFIX}${PANEL.workflow}`, {
      body: { action: 'pin', path: 'workflows/a-old.md', cwd: fx.cwd, session: 'sess_worker' }
    })
    assert.equal(res.status, 200, 'a governance refusal is a successful request')
    assert.equal(res.json.ok, true)
    assert.equal(res.json.changed, false)
    assert.equal(res.json.refused, '拒绝：只有 Curator/主 DSH（orchestrator）可以变更工作流。')
    assert.equal(res.json.message, res.json.refused)
    assert.equal(await readFile(join(fx.vaultRoot, 'workflows/a-old.md'), 'utf8'), before)
    assert.equal(res.json.l3.items.find((item) => item.path === 'workflows/a-old.md').pinned, false)

    const forget = await call(fx.harness, `${PREFIX}${PANEL.workflow}`, {
      body: { action: 'forget', path: 'workflows/b-new.md', cwd: fx.cwd, session: 'sess_worker' }
    })
    assert.equal(forget.json.ok, true)
    assert.equal(forget.json.changed, false)
    assert.equal(forget.json.refused, '拒绝：只有 Curator/主 DSH（orchestrator）可以变更工作流。')
    assert.equal(await readFile(join(fx.vaultRoot, 'workflows/b-new.md'), 'utf8').then(() => 'kept'), 'kept')
  } finally {
    await rm(fx.base, { recursive: true, force: true })
  }
})

test('POST panel/workflow forget: a pinned workflow is refused with the tool wording', async () => {
  const fx = await mounted()
  try {
    const res = await call(fx.harness, `${PREFIX}${PANEL.workflow}`, {
      body: { action: 'forget', path: 'workflows/c-pinned.md', cwd: fx.cwd, session: 'sess_coord' }
    })
    assert.equal(res.status, 200)
    assert.equal(res.json.ok, true)
    assert.equal(res.json.changed, false)
    assert.equal(
      res.json.refused,
      '拒绝：workflows/c-pinned.md 已固定（永久保留）。先 unpin 再遗忘，否则"永久保留"就失去了意义。'
    )
    assert.equal(res.json.message, res.json.refused)
    await readFile(join(fx.vaultRoot, 'workflows/c-pinned.md'), 'utf8')
  } finally {
    await rm(fx.base, { recursive: true, force: true })
  }
})

test('POST panel/workflow forget: evicts into .trash/workflows with a tombstone', async () => {
  const fx = await mounted()
  try {
    const res = await call(fx.harness, `${PREFIX}${PANEL.workflow}`, {
      body: { action: 'forget', path: 'workflows/b-new.md', cwd: fx.cwd, session: 'sess_coord', reason: '不再适用' }
    })
    assert.equal(res.status, 200)
    assert.equal(res.json.ok, true)
    assert.equal(res.json.changed, true)
    assert.equal(res.json.refused, null)
    assert.equal(res.json.message, '已遗忘 workflows/b-new.md（移入 .trash/workflows/，墓碑已记）。残余：git 历史里仍可找回。')

    const stamps = await readdir(join(fx.vaultRoot, '.trash', 'workflows'))
    assert.equal(stamps.length, 1)
    assert.ok(await readdir(join(fx.vaultRoot, '.trash', 'workflows', stamps[0])).then((names) => names.includes('b-new.md')))
    const tombstone = JSON.parse((await readFile(join(fx.vaultRoot, '.trash', 'tombstones.jsonl'), 'utf8')).trim().split('\n').pop())
    assert.equal(tombstone.op, 'evict-workflows')
    assert.equal(tombstone.path, 'workflows/b-new.md')
    assert.equal(tombstone.reason, '不再适用')
    await assert.rejects(readFile(join(fx.vaultRoot, 'workflows/b-new.md'), 'utf8'))
    assert.equal(res.json.l3.items.some((item) => item.path === 'workflows/b-new.md'), false)
    assert.deepEqual(res.json.l3.byState, { active: 0, decaying: 0, expired: 1, pinned: 1 })
  } finally {
    await rm(fx.base, { recursive: true, force: true })
  }
})

test('POST panel/workflow forget: the panel confirms, so the body cannot veto it', async () => {
  const fx = await mounted()
  try {
    // §3.2's body has no `confirm` field and §4.3 puts the two-step confirmation in
    // the UI. If an incoming `confirm:false` were honoured, the panel's only
    // destructive button would silently do nothing.
    const res = await call(fx.harness, `${PREFIX}${PANEL.workflow}`, {
      body: { action: 'forget', path: 'workflows/b-new.md', cwd: fx.cwd, session: 'sess_coord', confirm: false }
    })
    assert.equal(res.status, 200)
    assert.equal(res.json.changed, true)
    assert.equal(res.json.refused, null)
    await assert.rejects(readFile(join(fx.vaultRoot, 'workflows/b-new.md'), 'utf8'))
    assert.ok(await readdir(join(fx.vaultRoot, '.trash', 'workflows')))
  } finally {
    await rm(fx.base, { recursive: true, force: true })
  }
})

test('POST panel/workflow unpin: restores decay and reports the pre-change score', async () => {
  const fx = await mounted()
  try {
    const res = await call(fx.harness, `${PREFIX}${PANEL.workflow}`, {
      body: { action: 'unpin', path: 'workflows/c-pinned.md', cwd: fx.cwd, session: 'sess_coord' }
    })
    assert.equal(res.status, 200)
    assert.equal(res.json.ok, true)
    assert.equal(res.json.changed, true)
    assert.equal(res.json.refused, null)
    assert.equal(res.json.message, 'workflows/c-pinned.md → 已解固：重新参与衰减（当前 score=1）。')
    assert.equal(res.json.l3.items.find((item) => item.path === 'workflows/c-pinned.md').pinned, false)
  } finally {
    await rm(fx.base, { recursive: true, force: true })
  }
})

test('POST panel/workflow: a well-formed request about a missing workflow stays 200', async () => {
  const fx = await mounted()
  try {
    const res = await call(fx.harness, `${PREFIX}${PANEL.workflow}`, {
      body: { action: 'pin', path: 'workflows/nope.md', cwd: fx.cwd, session: 'sess_coord' }
    })
    // §3.2: the response is HTTP 200 unless the path escaped or the JSON was bad.
    assert.equal(res.status, 200)
    assert.equal(res.json.ok, true)
    assert.equal(res.json.changed, false)
    assert.equal(res.json.refused, null)
    assert.equal(res.json.message, '没有找到工作流 workflows/nope.md。')

    const retracted = await call(fx.harness, `${PREFIX}${PANEL.workflow}`, {
      body: { action: 'forget', path: 'workflows/d-retracted.md', cwd: fx.cwd, session: 'sess_coord' }
    })
    assert.equal(retracted.status, 200)
    assert.equal(retracted.json.message, '没有找到工作流 workflows/d-retracted.md。')
  } finally {
    await rm(fx.base, { recursive: true, force: true })
  }
})

test('POST panel/workflow: bad input is 400 and the vault never moves', async () => {
  const fx = await mounted()
  try {
    const cases = [
      { label: 'not JSON', body: 'not json at all' },
      { label: 'unknown action', body: { action: 'sweep', cwd: fx.cwd, session: 'sess_coord' } },
      { label: 'missing path', body: { action: 'pin', cwd: fx.cwd, session: 'sess_coord' } },
      { label: 'blank path', body: { action: 'pin', path: '   ', cwd: fx.cwd, session: 'sess_coord' } },
      { label: 'traversal', body: { action: 'pin', path: '../../outside.md', cwd: fx.cwd, session: 'sess_coord' } },
      { label: 'traversal with backslashes', body: { action: 'forget', path: '..\\..\\outside.md', cwd: fx.cwd, session: 'sess_coord' } },
      { label: 'posix absolute', body: { action: 'forget', path: '/etc/passwd', cwd: fx.cwd, session: 'sess_coord' } },
      { label: 'windows absolute', body: { action: 'forget', path: 'C:\\Windows\\win.ini', cwd: fx.cwd, session: 'sess_coord' } }
    ]
    for (const one of cases) {
      const res = await call(fx.harness, `${PREFIX}${PANEL.workflow}`, { body: one.body })
      assert.equal(res.status, 400, one.label)
      assert.equal(res.json.ok, false, one.label)
      assert.ok(['bad-request', 'path outside vault'].includes(res.json.error), `${one.label}: ${res.json.error}`)
      assert.equal(res.json.message, undefined, one.label)
    }
    // The escape cases name the reason the contract froze.
    const escape = await call(fx.harness, `${PREFIX}${PANEL.workflow}`, {
      body: { action: 'pin', path: '../outside.md' }
    })
    assert.equal(escape.json.error, 'path outside vault')

    // Nothing was pinned, forgotten, or read from outside.
    assert.equal(fx.harness.tools.length, 12)
    await readFile(join(fx.vaultRoot, 'workflows/a-old.md'), 'utf8')
    assert.equal((await readdir(join(fx.vaultRoot, 'workflows'))).length, 4)
  } finally {
    await rm(fx.base, { recursive: true, force: true })
  }
})

test('routes: a wrong method is 405, not a silent 200', async () => {
  const fx = await mounted()
  try {
    const getOnPost = await call(fx.harness, `${PREFIX}${PANEL.workflow}`)
    assert.equal(getOnPost.status, 405)
    assert.equal(getOnPost.json.error, 'method-not-allowed')

    const postOnGet = await call(fx.harness, `${PREFIX}${PANEL.overview}`, { body: {} })
    assert.equal(postOnGet.status, 405)
    assert.equal(postOnGet.json.error, 'method-not-allowed')

    const postOnSearch = await call(fx.harness, `${PREFIX}${KB.search}`, { body: {} })
    assert.equal(postOnSearch.status, 405)
  } finally {
    await rm(fx.base, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------- kb/api/tree

test('GET kb/api/tree: 200 with layers, notes, tags and scopes', async () => {
  const fx = await mounted()
  try {
    const res = await call(fx.harness, `${PREFIX}${KB.tree}`, { search: { cwd: fx.cwd, session: 'sess_coord' } })
    assert.equal(res.status, 200)
    const body = res.json
    assert.deepEqual(keysOf(body), ['layers', 'notes', 'ok', 'scopes', 'tags', 'vault'])
    assert.equal(body.ok, true)
    assert.deepEqual(body.vault, { root: fx.vaultRoot })
    assert.deepEqual(keysOf(body.layers), ['l1', 'l2', 'l4'])
    assert.equal(body.layers.l1, 'positioning.md')
    assert.equal(body.layers.l2, 'workspaces/ws_demo.md')
    assert.equal(body.layers.l4, null, 'no episode records yet')

    assert.equal(body.notes.length, 9)
    for (const note of body.notes) {
      assert.deepEqual(keysOf(note), ['path', 'scope', 'status', 'tags', 'title', 'type', 'updated'])
    }
    const f1 = body.notes.find((note) => note.path === 'projects/p1/findings/f1.md')
    assert.deepEqual(f1, {
      path: 'projects/p1/findings/f1.md',
      title: '发现',
      type: 'finding',
      scope: 'ws_demo',
      tags: ['alpha', 'beta'],
      updated: '2026-02-02T00:00:00Z',
      status: 'active'
    })
    const untitled = body.notes.find((note) => note.path === 'workflows/b-new.md')
    assert.equal(untitled.title, '新流程')
    assert.equal(untitled.status, 'active')
    assert.deepEqual(untitled.tags, [])

    assert.deepEqual(body.tags, [
      { tag: 'beta', count: 2 },
      { tag: 'alpha', count: 1 }
    ])

    assert.equal(body.scopes.length, 1)
    assert.deepEqual(keysOf(body.scopes[0]), ['id', 'notes', 'title'])
    assert.equal(body.scopes[0].id, 'ws_demo')
    assert.equal(body.scopes[0].title, '工作区地图')
    assert.deepEqual(body.scopes[0].notes, [
      'projects/p1/findings/f1.md',
      'projects/p1/findings/f2.md',
      'projects/p1/notes/n2.md'
    ])
  } finally {
    await rm(fx.base, { recursive: true, force: true })
  }
})

test('GET kb/api/tree: layers.l4 points at the newest episode record when one exists', async () => {
  const fx = await mounted()
  try {
    await mkdir(join(fx.vaultRoot, 'workspaces/ws_demo/memory'), { recursive: true })
    await writeFile(
      join(fx.vaultRoot, 'workspaces/ws_demo/memory/2026-03-01-ep.md'),
      '---\ntype: memory\nscope: ws_demo\nvisibility: workspace-shared\ntitle: 记录\ncreated: 2026-03-01T00:00:00Z\n---\n# 记录\n\n结论。\n',
      'utf8'
    )
    const res = await call(fx.harness, `${PREFIX}${KB.tree}`, { search: { cwd: fx.cwd, session: 'sess_coord' } })
    assert.equal(res.json.layers.l4, 'workspaces/ws_demo/memory/2026-03-01-ep.md')
    assert.equal(res.json.notes.length, 10)
    assert.ok(res.json.scopes[0].notes.includes('workspaces/ws_demo/memory/2026-03-01-ep.md'))
  } finally {
    await rm(fx.base, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------- kb/api/note

test('GET kb/api/note: 200 with body, blocks, links and citation statuses', async () => {
  const fx = await mounted()
  try {
    const res = await call(fx.harness, `${PREFIX}${KB.note}`, {
      search: { path: 'projects/p1/findings/f1.md' }
    })
    assert.equal(res.status, 200)
    const body = res.json
    assert.deepEqual(keysOf(body), [
      'backlinks',
      'blocks',
      'body',
      'citations',
      'frontmatter',
      'lines',
      'ok',
      'outlinks',
      'path',
      'revision',
      'tags',
      'title'
    ])
    assert.equal(body.ok, true)
    assert.equal(body.path, 'projects/p1/findings/f1.md')
    assert.equal(body.title, '发现')
    assert.equal(body.frontmatter.type, 'finding')
    assert.deepEqual(body.frontmatter.tags, ['alpha', 'beta'])
    assert.ok(body.body.includes('第一行提到 [[f2]]。'), body.body)
    assert.equal(body.lines, body.body.split('\n').length)
    assert.equal(
      body.revision,
      revisionOf(parseNote(await readFile(join(fx.vaultRoot, 'projects/p1/findings/f1.md'), 'utf8')).body)
    )
    assert.deepEqual(body.tags, ['alpha', 'beta'])

    const block = body.blocks.find((one) => one.id === 'b1')
    assert.ok(block, JSON.stringify(body.blocks))
    assert.deepEqual(keysOf(block), ['id', 'line'])
    assert.ok(Number.isInteger(block.line) && block.line > 0, String(block.line))
    for (const one of body.blocks) assert.equal(typeof one.id, 'string')

    assert.equal(body.backlinks.length, 1)
    assert.deepEqual(keysOf(body.backlinks[0]), ['from', 'kind', 'raw'])
    assert.equal(body.backlinks[0].from, 'projects/p1/notes/n2.md')
    assert.equal(body.backlinks[0].raw, '[[f1]]')
    assert.equal(body.backlinks[0].kind, 'link')

    assert.equal(body.outlinks.length, 1)
    assert.deepEqual(keysOf(body.outlinks[0]), ['kind', 'raw', 'resolved', 'target'])
    assert.equal(body.outlinks[0].raw, '[[f2]]')
    assert.equal(body.outlinks[0].target, 'projects/p1/findings/f2.md')
    assert.equal(body.outlinks[0].resolved, true)
    assert.equal(body.outlinks[0].kind, 'link')

    assert.equal(body.citations.length, 2)
    for (const one of body.citations) assert.deepEqual(keysOf(one), ['line', 'revision', 'spec', 'status', 'target'])
    const [ok, stale] = body.citations
    assert.equal(ok.status, 'ok')
    assert.equal(ok.target, 'projects/p1/findings/f2.md')
    assert.equal(ok.revision, fx.f2Revision)
    assert.equal(stale.status, 'stale')
    // A citation is CITED at a revision while `revision` is the target's CURRENT
    // one — the same meaning `/kb/api/resolve` gives it, so a stale badge can be
    // explained without asking the page to parse `spec`. The cited revision stays
    // inside `spec` (see the assertion above).
    assert.equal(stale.revision, fx.f2Revision)
    assert.ok(stale.spec.endsWith('@deadbeefdead'), stale.spec)

    // The citation's line is the line in the TARGET note the cite points at —
    // the same line the block listing reports, so the UI can jump to it.
    const target = await call(fx.harness, `${PREFIX}${KB.note}`, {
      search: { path: 'projects/p1/findings/f2.md' }
    })
    const targetBlock = target.json.blocks.find((one) => one.id === 'f2blk')
    assert.ok(targetBlock)
    assert.equal(ok.line, targetBlock.line)
  } finally {
    await rm(fx.base, { recursive: true, force: true })
  }
})

test('GET kb/api/note: a missing note is 404 with the contract literal, never an empty note', async () => {
  const fx = await mounted()
  try {
    const res = await call(fx.harness, `${PREFIX}${KB.note}`, { search: { path: 'projects/p1/findings/absent.md' } })
    assert.equal(res.status, 404)
    assert.deepEqual(res.json, { ok: false, error: 'note not found', path: 'projects/p1/findings/absent.md' })
  } finally {
    await rm(fx.base, { recursive: true, force: true })
  }
})

test('GET kb/api/note: a path parameter can never leave the vault', async () => {
  const fx = await mounted()
  try {
    const escapes = [
      { search: { path: '../../outside.md' }, label: 'traversal' },
      { search: { path: 'projects/../../outside.md' }, label: 'traversal deeper' },
      { search: { path: '..\\..\\outside.md' }, label: 'windows traversal' },
      { search: { path: '/etc/passwd' }, label: 'posix absolute' },
      { search: { path: 'C:\\Windows\\win.ini' }, label: 'windows absolute' },
      { search: { path: '\\\\server\\share\\x.md' }, label: 'unc' },
      { search: { path: 'projects/p1/findings/f1.md\u0000.txt' }, label: 'nul byte' }
    ]
    for (const one of escapes) {
      const res = await call(fx.harness, `${PREFIX}${KB.note}`, { search: one.search })
      assert.equal(res.status, 400, `${one.label}: ${res.text}`)
      assert.deepEqual(res.json, { ok: false, error: 'path outside vault' }, one.label)
    }

    const missing = await call(fx.harness, `${PREFIX}${KB.note}`)
    assert.equal(missing.status, 400)
    assert.deepEqual(missing.json, { ok: false, error: 'bad-request' })
  } finally {
    await rm(fx.base, { recursive: true, force: true })
  }
})

test('GET kb/api/note: a symlink inside the vault cannot point outside it', async (t) => {
  const fx = await mounted()
  try {
    // Symlinks need a privilege on Windows; junctions do not. If neither can be
    // created here, the lexical escapes above remain the proof — say so instead
    // of pretending the check ran.
    let linked = false
    try {
      await symlink(fx.base, join(fx.vaultRoot, 'escape-link'), 'junction')
      linked = true
    } catch {
      try {
        await symlink(fx.base, join(fx.vaultRoot, 'escape-link'), 'dir')
        linked = true
      } catch {
        linked = false
      }
    }
    const target = join(fx.base, 'outside.md')
    await writeFile(target, '---\ntype: note\n---\n# 外面\n\n不该被读到。\n', 'utf8')
    if (!linked) {
      t.diagnostic('no symlink privilege here; lexical escape cases above cover the contract')
      return
    }
    const res = await call(fx.harness, `${PREFIX}${KB.note}`, { search: { path: 'escape-link/outside.md' } })
    assert.equal(res.status, 400, res.text)
    assert.equal(res.json.error, 'path outside vault')
  } finally {
    await rm(fx.base, { recursive: true, force: true })
  }
})

// ------------------------------------------------------------- kb/api/resolve

test('GET kb/api/resolve: the four reachable statuses pass through unfolded', async () => {
  const fx = await mounted()
  try {
    const ok = await call(fx.harness, `${PREFIX}${KB.resolve}`, {
      search: { cite: 'projects/p1/findings/f2.md#^f2blk' }
    })
    assert.equal(ok.status, 200)
    assert.deepEqual(keysOf(ok.json), ['ok', 'range', 'reason', 'revision', 'status', 'target', 'text'])
    assert.equal(ok.json.ok, true)
    assert.equal(ok.json.status, 'ok')
    assert.equal(ok.json.target, 'projects/p1/findings/f2.md')
    assert.equal(ok.json.revision, fx.f2Revision)
    assert.equal(ok.json.reason, '引用有效。')
    assert.ok(ok.json.range.start >= 0 && ok.json.range.end > ok.json.range.start, JSON.stringify(ok.json.range))
    assert.ok(ok.json.text.includes('引用目标段落'), ok.json.text)

    const stale = await call(fx.harness, `${PREFIX}${KB.resolve}`, {
      search: { cite: 'projects/p1/findings/f2.md#^f2blk', revision: 'deadbeefdead' }
    })
    assert.equal(stale.json.status, 'stale')
    assert.equal(stale.json.reason, '该笔记已被修改：旧区间可能指向不同内容，请重新检索确认。')

    const missing = await call(fx.harness, `${PREFIX}${KB.resolve}`, { search: { cite: 'projects/p1/findings/gone.md' } })
    assert.equal(missing.status, 200)
    assert.equal(missing.json.status, 'missing', '`missing` is a status, not an HTTP 404')
    assert.equal(missing.json.target, 'projects/p1/findings/gone.md')
    assert.equal(missing.json.reason, '该笔记已不存在。')
    assert.equal(missing.json.range, null)
    assert.equal(missing.json.text, null)

    const moved = await call(fx.harness, `${PREFIX}${KB.resolve}`, {
      search: { cite: 'projects/p1/findings/f2.md#^nothere' }
    })
    assert.equal(moved.json.status, 'moved', 'a moved block must not be folded into missing')
    assert.equal(moved.json.reason, '笔记还在，但被引用的块 id 不在了（块可能被删或改写）。')

    for (const res of [ok, stale, missing, moved]) {
      assert.ok(['ok', 'stale', 'missing', 'moved', 'unknown'].includes(res.json.status), res.json.status)
    }

    const absent = await call(fx.harness, `${PREFIX}${KB.resolve}`)
    assert.equal(absent.status, 400)
    assert.deepEqual(absent.json, { ok: false, error: 'bad-request' })
  } finally {
    await rm(fx.base, { recursive: true, force: true })
  }
})

// -------------------------------------------------------------- kb/api/search

test('GET kb/api/search: 200 with sentence-level hits and honest no-match', async () => {
  const fx = await mounted()
  try {
    const res = await call(fx.harness, `${PREFIX}${KB.search}`, { search: { q: '目标段落' } })
    assert.equal(res.status, 200)
    const body = res.json
    assert.deepEqual(keysOf(body), ['hits', 'notes', 'ok', 'widened'])
    assert.equal(body.ok, true)
    assert.equal(body.widened, false, 'the knowledge page searches the whole vault, no scope funnel')
    assert.ok(Array.isArray(body.notes))
    assert.equal(body.hits.length, 1)
    const hit = body.hits[0]
    assert.deepEqual(keysOf(hit), ['cite', 'passage', 'path', 'range', 'score', 'section', 'sentence', 'sentenceLines'])
    assert.equal(hit.path, 'projects/p1/findings/f2.md')
    assert.ok(hit.cite === 'projects/p1/findings/f2.md#^f2blk', hit.cite)
    assert.ok(hit.passage.includes('引用目标段落'), hit.passage)
    assert.ok(hit.score > 0)
    assert.ok(hit.range.end > hit.range.start)
    assert.ok(hit.sentence, 'sentence-level precision is part of the contract')
    assert.deepEqual(keysOf(hit.sentence), ['range', 'text'])
    assert.equal(hit.sentence.text.trim(), '引用目标段落。')
    assert.deepEqual(keysOf(hit.sentenceLines), ['end', 'start'])
    assert.ok(hit.sentenceLines.start >= 1 && hit.sentenceLines.end >= hit.sentenceLines.start)

    const none = await call(fx.harness, `${PREFIX}${KB.search}`, { search: { q: 'zzz-绝对不存在的词' } })
    assert.equal(none.status, 200)
    assert.deepEqual(none.json.hits, [])
    assert.ok(none.json.notes.some((line) => line.includes('没有匹配')), none.json.notes.join('|'))

    const absent = await call(fx.harness, `${PREFIX}${KB.search}`)
    assert.equal(absent.status, 400)
    assert.deepEqual(absent.json, { ok: false, error: 'bad-request' })

    const badLimit = await call(fx.harness, `${PREFIX}${KB.search}`, { search: { q: '目标段落', limit: 'soon' } })
    assert.equal(badLimit.status, 400)

    const clamped = await call(fx.harness, `${PREFIX}${KB.search}`, { search: { q: '目标段落', limit: '1' } })
    assert.equal(clamped.status, 200)
    assert.equal(clamped.json.hits.length, 1)
  } finally {
    await rm(fx.base, { recursive: true, force: true })
  }
})

// ------------------------------------------------------------------ kb page

test('GET kb/: serves plugin/ui/kb bytes with the right content type', async () => {
  const fx = await mountedWithPage()
  try {
    const res = await call(fx.harness, `${PREFIX}${KB.page}`, { search: { cwd: fx.cwd, session: 'sess_coord' } })
    assert.equal(res.status, 200)
    assert.equal(res.headers['content-type'], 'text/html; charset=utf-8')
    assert.deepEqual(res.body, Buffer.from(await readFile(join(fx.pageDir, 'index.html'))))

    const bare = await call(fx.harness, KBPAGE_BASE)
    assert.equal(bare.status, 200, '/kb (no trailing slash) must reach the same page')

    const js = await call(fx.harness, `${KBPAGE_BASE}/app.js`)
    assert.equal(js.status, 200)
    assert.equal(js.headers['content-type'], 'text/javascript; charset=utf-8')
    assert.equal(js.text, 'console.log("kb")\n')

    const css = await call(fx.harness, `${KBPAGE_BASE}/app.css`)
    assert.equal(css.status, 200)
    assert.equal(css.headers['content-type'], 'text/css; charset=utf-8')

    const notWhitelisted = await call(fx.harness, `${KBPAGE_BASE}/secret.txt`)
    assert.equal(notWhitelisted.status, 404)
    assert.equal(notWhitelisted.json.error, 'not found')

    const absent = await call(fx.harness, `${KBPAGE_BASE}/app.markdown.js`)
    assert.equal(absent.status, 404, 'a whitelisted name that does not exist is still 404')
  } finally {
    await rm(fx.base, { recursive: true, force: true })
  }
})

test('GET kb/: directory traversal is 404 and can never reach api or the parents', async () => {
  const fx = await mountedWithPage()
  try {
    const encoded = await call(fx.harness, `${KBPAGE_BASE}/%2e%2e%2f%2e%2e%2fplugin%2fpackage.json`)
    assert.equal(encoded.status, 404)
    assert.equal(encoded.json.error, 'not found')

    const nested = await call(fx.harness, `${KBPAGE_BASE}/%2e%2e%2fapi%2ftree`)
    assert.equal(nested.status, 404, 'a traversal must not be able to reach the json api')

    // A Windows-style escape reaches the handler intact (the URL layer only
    // normalizes the forward-slash form), so this is the case that proves the
    // handler itself decodes and refuses rather than trusting the pathname.
    const backslashed = await call(fx.harness, `${KBPAGE_BASE}/..%5capi%5ctree`)
    assert.equal(backslashed.status, 404)
    assert.equal(backslashed.json.error, 'not found')

    // A double-encoded separator reaches the handler too, and must not be decoded
    // twice into something servable.
    const doubleEncoded = await call(fx.harness, `${KBPAGE_BASE}/%252e%252e%252fapi%252ftree`)
    assert.equal(doubleEncoded.status, 404)
    assert.equal(doubleEncoded.json.error, 'not found')

    const plain = await call(fx.harness, `${PREFIX}/kb/../../plugin/package.json`, { allowUnmatched: true })
    assert.equal(plain.route, null, 'the host normalizes `..` before routing, so it lands nowhere')
    assert.equal(plain.status, 404)

    const unknownApi = await call(fx.harness, `${KBPAGE_BASE}/api/unknown`)
    assert.equal(unknownApi.status, 404)
    assert.equal(unknownApi.json.error, 'not found')

    // The api routes still win over the page prefix.
    const api = await call(fx.harness, `${PREFIX}${KB.tree}`, { search: { cwd: fx.cwd } })
    assert.equal(api.status, 200)
    assert.equal(api.json.ok, true)
  } finally {
    await rm(fx.base, { recursive: true, force: true })
  }
})

test('GET kb/ui-contract.json: serves the single source, byte for byte', async () => {
  const fx = await mountedWithPage()
  try {
    // The page fetches this next to itself at runtime. It must be answered from
    // `plugin/ui-contract.json` itself — not from a copy inside `ui/kb/`, which
    // would end "single source" the moment the two drifted.
    const res = await call(fx.harness, `${KBPAGE_BASE}/ui-contract.json`)
    assert.equal(res.status, 200)
    assert.ok(String(res.headers['content-type']).startsWith('application/json'), res.headers['content-type'])
    assert.deepEqual(res.body, await readFile(join(PLUGIN, 'ui-contract.json')))
    assert.deepEqual(JSON.parse(res.text), CONTRACT)
    assert.equal(typeof JSON.parse(res.text).prefix, 'string')

    await assert.rejects(
      readFile(join(fx.pageDir, 'ui-contract.json'), 'utf8'),
      'no copy may be written into ui/kb — the alias must stay an alias'
    )
    // …and the alias is not a door to anything else outside the page directory.
    const sibling = await call(fx.harness, `${KBPAGE_BASE}/package.json`)
    assert.equal(sibling.status, 404)
    const escaped = await call(fx.harness, `${KBPAGE_BASE}/%2e%2e%2fui-contract.json`)
    assert.equal(escaped.status, 404, 'the real path must not be reachable by traversal either')
  } finally {
    await rm(fx.base, { recursive: true, force: true })
  }
})

test('GET kb/: with the shipped ui/kb directory the answer matches what is on disk', async () => {
  const fx = await mounted()
  try {
    const realIndex = join(PLUGIN, 'ui', 'kb', 'index.html')
    let present = true
    try {
      await readFile(realIndex)
    } catch {
      present = false
    }
    const res = await call(fx.harness, `${PREFIX}${KB.page}`)
    assert.equal(res.status, present ? 200 : 404)
    if (present) {
      assert.equal(res.headers['content-type'], 'text/html; charset=utf-8')
      assert.deepEqual(res.body, Buffer.from(await readFile(realIndex)))
    } else {
      assert.equal(res.json.error, 'kb page not available')
    }
  } finally {
    await rm(fx.base, { recursive: true, force: true })
  }
})

// ------------------------------------------------------------------ hygiene

test('routes: zero non-builtin imports outside the repository', async () => {
  const walk = async (dir) => {
    const out = []
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name)
      if (entry.isDirectory()) out.push(...(await walk(abs)))
      else if (entry.isFile() && entry.name.endsWith('.js')) out.push(abs)
    }
    return out
  }
  const files = await walk(join(PLUGIN, 'lib', 'routes'))
  files.push(join(PLUGIN, 'lib', 'memory', 'panel-data.js'))
  assert.ok(files.length >= 5, `expected the route modules on disk: ${files.join(', ')}`)
  for (const file of files) {
    const source = await readFile(file, 'utf8')
    const specifiers = [...source.matchAll(/(?:^|\n)\s*import\s+(?:[\s\S]*?)\s*from\s*['"]([^'"]+)['"]/g)].map((m) => m[1])
    const bare = specifiers.filter((one) => !one.startsWith('node:') && !one.startsWith('.'))
    assert.deepEqual(bare, [], `${file} imports outside the repository: ${bare.join(', ')}`)
  }
})

test('routes: the vault never learns an absolute path from a route response', async () => {
  const fx = await mounted()
  try {
    await call(fx.harness, `${PREFIX}${PANEL.overview}`, { search: { cwd: fx.cwd, session: 'sess_coord' } })
    const notes = []
    const stack = [fx.vaultRoot]
    while (stack.length > 0) {
      const dir = stack.pop()
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        if (entry.name === '.trash' || entry.name === '.kb-index') continue
        const abs = join(dir, entry.name)
        if (entry.isDirectory()) stack.push(abs)
        else if (entry.name.endsWith('.md')) notes.push(abs)
      }
    }
    for (const note of notes) {
      assert.equal((await readFile(note, 'utf8')).includes(fx.vaultRoot.split(sep).join('/')), false, note)
    }
  } finally {
    await rm(fx.base, { recursive: true, force: true })
  }
})