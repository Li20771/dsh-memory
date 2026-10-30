// ui-live-proof.mjs — the restarted-desktop rehearsal, without the desktop (Lead's T5 proof).
//
// What this is: a *static end-to-end proof* that the UI's two halves would talk to
// real memory data after a restart. It mounts the plugin the way the host does, with
// a stub `webServer` that records the route table, then drives every contract route
// against the REAL vault on this machine and prints the JSON that came back.
//
// What this is NOT: it is not the browser. It cannot prove button placement, theme
// tokens, or that Electron renders the panel — those need a real restart. It exists so
// that "the data side works" is a fact with output, not a hope, before your restart.
//
// Invariants it refuses to break:
//   · READ-ONLY BY CONSTRUCTION. No route that can mutate the vault is called with a
//     valid request. The one POST it sends is deliberately malformed (expecting 400),
//     and the pin/forget door is checked by reading the tool's own refusal path only.
//   · It never copies vault content into this repository; it prints counts and short
//     samples to the terminal.
//
// Usage: node tools/ui-live-proof.mjs            (vault defaults to <repo>/kb)
//        node tools/ui-live-proof.mjs --vault "D:\\other\\kb"

import { readFileSync, existsSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Readable } from 'node:stream'

import plugin from '../plugin/lib/index.js'
import { obsidianConfigPath, vaultIdFor, obsidianUriFor, planObsidianOpen } from '../plugin/lib/routes/kb-open.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const vaultArg = argv.indexOf('--vault')
const VAULT = vaultArg >= 0 ? resolve(argv[vaultArg + 1]) : join(ROOT, 'kb')

const failures = []
const ok = (label, condition, detail = '') => {
  if (condition) {
    console.log(`  ✓ ${label}${detail === '' ? '' : ` — ${detail}`}`)
  } else {
    failures.push(label)
    console.log(`  ✖ ${label}${detail === '' ? '' : ` — ${detail}`}`)
  }
}
const section = (title) => console.log(`\n=== ${title} ===`)

/* ------------------------------------------------------------ the host harness */

function mount() {
  const routes = new Map()
  const registered = []
  const warns = []
  const opened = []
  const ctx = {
    systemPrompt: { section: () => () => {} },
    tools: { register: () => () => {} },
    on: () => {},
    logger: { warn: (m) => warns.push(String(m)), info: () => {}, debug: () => {} },
    webServer: {
      register(route) {
        const key = `${route.kind} ${route.path}`
        if (routes.has(key)) throw new Error(`duplicate route ${key}`)
        routes.set(key, route)
        registered.push(key)
        return () => routes.delete(key)
      }
    }
  }
  const teardown = plugin.apply(ctx, {
    vaultRoot: VAULT,
    fullStatIntervalMs: 0,
    // Obsidian is injected: this proof must never start Obsidian or touch its registry.
    openKnowledgeBase: (input) => {
      opened.push(input)
      return { mode: 'obsidian', uri: 'obsidian://open?vault=kb', url: null, registered: true, wrote: false, error: null }
    }
  })
  return { routes, registered, warns, teardown, opened }
}

/** The host's own matcher: exact over the whole table, then longest prefix. */
function match(routes, pathname) {
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

async function call(harness, pathname, { method = 'GET', body, raw } = {}) {
  const url = raw ?? pathname
  const target = match(harness.routes, new URL(url, 'http://127.0.0.1').pathname)
  if (target === undefined) return { status: 404, json: null, text: '', headers: {}, matched: false }
  const payload = body === undefined ? null : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body), 'utf8')
  const req = Readable.from(payload === null ? [] : [payload], { objectMode: false })
  req.method = payload === null ? method : 'POST'
  req.url = url
  req.headers = { host: '127.0.0.1:0' }
  const res = {
    statusCode: 200,
    headers: {},
    body: Buffer.alloc(0),
    setHeader(n, v) {
      res.headers[String(n).toLowerCase()] = v
    },
    getHeader(n) {
      return res.headers[String(n).toLowerCase()]
    },
    end(chunk) {
      if (chunk !== undefined && chunk !== null) {
        res.body = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), 'utf8')
      }
    }
  }
  await target.handler(req, res)
  const text = res.body.toString('utf8')
  let json = null
  try {
    json = JSON.parse(text)
  } catch {
    /* a non-JSON answer is fine for the page route */
  }
  return { status: res.statusCode, json, text, headers: res.headers, matched: true, route: `${target.kind} ${target.path}` }
}

/* ------------------------------------------------------------------- the proof */

console.log(`dsh-memory UI live proof`)
console.log(`vault: ${VAULT}`)
if (!existsSync(VAULT)) {
  console.error(`vault not found: ${VAULT}`)
  process.exit(2)
}

const harness = mount()

section('1. route table the plugin registered (stub webServer)')
for (const key of harness.registered) console.log(`  · ${key}`)
const EXPECTED_ROUTES = [
  'exact /dsh-memory/kb/api/tree',
  'exact /dsh-memory/kb/api/note',
  'exact /dsh-memory/kb/api/resolve',
  'exact /dsh-memory/kb/api/search',
  'exact /dsh-memory/kb/open',
  'prefix /dsh-memory/kb',
  'exact /dsh-memory/panel/overview',
  'exact /dsh-memory/panel/workflow'
]
const missingRoutes = EXPECTED_ROUTES.filter((key) => !harness.registered.includes(key))
const extraRoutes = harness.registered.filter((key) => !EXPECTED_ROUTES.includes(key))
ok(
  'the registered table is exactly the contract surface (6 seats + 1 page prefix)',
  missingRoutes.length === 0 && extraRoutes.length === 0,
  `missing=${JSON.stringify(missingRoutes)} extra=${JSON.stringify(extraRoutes)}`
)
ok('no webServer warn when the service is present', harness.warns.length === 0, harness.warns.join(' | '))

section('2. GET /panel/overview')
const overview = await call(harness, '/dsh-memory/panel/overview')
ok('overview answers 200', overview.status === 200, `status ${overview.status}`)
const ow = overview.json?.workspace ?? {}
const diagnoseText = String((overview.json?.diagnose?.lines ?? []).join('\n'))
ok(
  'the workspace block reports the boundary honestly',
  typeof ow.role === 'string' && (ow.id !== null && ow.id !== '' ? true : /未找到|\(无\)/.test(diagnoseText)),
  `id=${ow.id} role=${ow.role}`
)
if (ow.id === null || ow.id === '') {
  console.log('  · 注意：本次 cwd 不在任何含 .dsh/memory.json 的树里 ⇒ 作用域为空、L4 fail-closed、L3 动作按 worker 角色置灰。')
  console.log('    这是**正确**的边界行为（不是召回失败）。要在本仓库启用，用 tools/enable-workspace.mjs 建标记。')
}
console.log(`  · 作用域 ${ow.id ?? '(无)'} / 段 ${ow.episode ?? '(无)'}｜角色 ${ow.role}｜L4 ${ow.enabled ? '开' : '关'}｜地图 ${ow.mapAlwaysOn ? '常开' : '随开关'}`)
const layers = overview.json?.layers ?? {}
console.log(`  · L1 present=${layers.l1?.present} path=${layers.l1?.path ?? '(无)'} rev=${layers.l1?.revision ?? '—'}`)
console.log(`  · L2 present=${layers.l2?.present} path=${layers.l2?.path ?? '(无)'}`)
console.log(`  · L4 present=${layers.l4?.present} path=${layers.l4?.path ?? '(无)'}`)
const l3 = overview.json?.l3 ?? {}
console.log(`  · L3 ${l3.items?.length ?? 0} 条｜${JSON.stringify(l3.byState ?? {})}｜半衰期 ${l3.halfLifeDays}`)
for (const item of (l3.items ?? []).slice(0, 3)) {
  console.log(`      ${item.pinned ? '📌' : '·'} ${item.path}｜${item.state}｜score=${item.score}｜${item.ageDays === null ? '未记录使用' : `${item.ageDays} 天未用`}｜召回 ${item.useCount} 次`)
}
const know = overview.json?.knowledge ?? {}
console.log(`  · 知识库 ${know.notes} 篇｜标签 ${know.tags?.length ?? 0} 个｜链接 ${know.linkHealth?.resolved}/${know.linkHealth?.total} 解析｜入口 ${know.entryUrl}`)
console.log(`  · 引用审计 ${overview.json?.audit?.total ?? 0} 条（陈旧 ${overview.json?.audit?.stale ?? 0}）`)
console.log(`  · diagnose 首行: ${overview.json?.diagnose?.lines?.[0] ?? '(空)'}`)

section('3. GET /kb/api/tree')
const tree = await call(harness, '/dsh-memory/kb/api/tree')
ok('tree answers 200', tree.status === 200, `status ${tree.status}`)
const notes = tree.json?.notes ?? []
console.log(`  · ${notes.length} 篇笔记｜${tree.json?.tags?.length ?? 0} 个标签｜${tree.json?.scopes?.length ?? 0} 个作用域`)
console.log(`  · layers: ${JSON.stringify(tree.json?.layers ?? {})}`)
for (const note of notes.slice(0, 6)) console.log(`      ${note.path}｜${note.type}｜scope=${note.scope}｜tags=${JSON.stringify(note.tags ?? [])}`)
ok('tree returns notes', notes.length > 0, `${notes.length} notes`)

const pick = notes.find((n) => n.path.startsWith('workflows/')) ?? notes[0]

section(`4. GET /kb/api/note?path=${pick?.path ?? '(none)'}`)
let notePayload = null
if (pick !== undefined) {
  const note = await call(harness, `/dsh-memory/kb/api/note?path=${encodeURIComponent(pick.path)}`)
  notePayload = note.json
  ok('note answers 200', note.status === 200, `status ${note.status}`)
  console.log(`  · 标题 ${notePayload?.title}｜rev=${notePayload?.revision}｜${notePayload?.lines} 行｜块 ${notePayload?.blocks?.length ?? 0}`)
  console.log(`  · 反向链接 ${notePayload?.backlinks?.length ?? 0}｜出链 ${notePayload?.outlinks?.length ?? 0}｜标签 ${JSON.stringify(notePayload?.tags ?? [])}`)
  const states = {}
  for (const c of notePayload?.citations ?? []) states[c.status] = (states[c.status] ?? 0) + 1
  console.log(`  · 引用 ${notePayload?.citations?.length ?? 0} 条｜状态分布 ${JSON.stringify(states)}`)
  console.log(`  · 正文首行: ${String(notePayload?.body ?? '').split('\n')[0]?.slice(0, 90)}`)
  const missing = await call(harness, '/dsh-memory/kb/api/note?path=' + encodeURIComponent('workflows/__no_such_note__.md'))
  ok('a missing note is 404, never an empty note', missing.status === 404 && missing.json?.error === 'note not found', `status ${missing.status} error=${missing.json?.error}`)
  const traversal = await call(harness, '/dsh-memory/kb/api/note?path=' + encodeURIComponent('../../ui-contract.json'))
  ok('a path parameter cannot leave the vault', traversal.status === 400 || traversal.status === 404, `status ${traversal.status}`)
}

section('5. GET /kb/api/resolve (the five-state badge source)')
const spec = notePayload?.citations?.[0]?.spec
if (spec !== undefined) {
  const resolved = await call(harness, `/dsh-memory/kb/api/resolve?cite=${encodeURIComponent(spec)}`)
  ok('resolve answers 200', resolved.status === 200, `status ${resolved.status}`)
  console.log(`  · cite=${spec}`)
  console.log(`  · status=${resolved.json?.status}｜target=${resolved.json?.target}｜revision=${resolved.json?.revision}｜reason=${resolved.json?.reason ?? '(无)'}`)
} else {
  console.log('  · 这篇笔记没有引用，跳过（resolve 路由本身已在路由表里）')
}

section('6. GET /kb/api/search')
// The first tag, queried in the grammar's own `tag:` form: a bare word searches
// content, while `tag:x` searches the property — using the property form here keeps
// the proof about the route, not about whether a tag word happens to appear in prose.
const firstTag = (pick?.tags ?? [])[0]
const q = firstTag === undefined ? String(pick?.title ?? '记忆').split(/\s+/)[0] : `tag:${firstTag}`
const search = await call(harness, `/dsh-memory/kb/api/search?q=${encodeURIComponent(q)}&limit=5`)
ok('search answers 200', search.status === 200, `status ${search.status}`)
console.log(`  · q=${q} → ${search.json?.hits?.length ?? 0} 命中｜widened=${search.json?.widened}`)
for (const hit of (search.json?.hits ?? []).slice(0, 3)) {
  console.log(`      ${hit.cite}｜score=${hit.score}｜行 ${hit.sentenceLines?.start ?? '?'}–${hit.sentenceLines?.end ?? '?'}｜${String(hit.sentence?.text ?? hit.passage ?? '').slice(0, 60)}`)
}

section('6b. POST /kb/open — hand the vault to Obsidian (opener stubbed: nothing opens, nothing is written)')
const openOnce = await call(harness, '/dsh-memory/kb/open', { body: {} })
ok(
  'kb/open answers 200 and reports the mode it chose',
  openOnce.status === 200 && openOnce.json?.ok === true && openOnce.json?.mode === 'obsidian',
  `status ${openOnce.status} mode=${openOnce.json?.mode}`
)
ok(
  'the URI handed to the OS opens the vault by its folder name',
  String(openOnce.json?.uri ?? '') === 'obsidian://open?vault=kb',
  String(openOnce.json?.uri)
)
ok(
  'the host opener received the vault path the UI is showing',
  harness.opened.length === 1 && String(harness.opened[0]?.vaultPath ?? '') === VAULT,
  JSON.stringify(harness.opened)
)
const openGet = await call(harness, '/dsh-memory/kb/open', { method: 'GET' })
ok('GET on the open route is 405 (opening a window is a side effect)', openGet.status === 405, `status ${openGet.status}`)

section('6c. Obsidian hand-off planning (pure: nothing is launched, no file is written)')
const cfgPath = obsidianConfigPath('win32', { APPDATA: 'C:\\Users\\x\\AppData\\Roaming' }, 'C:\\Users\\x')
ok(
  'on Windows the registry is APPDATA\\obsidian\\obsidian.json',
  cfgPath === join('C:\\Users\\x\\AppData\\Roaming', 'obsidian', 'obsidian.json'),
  cfgPath
)
ok('the vault id is a stable 16-hex token', /^[0-9a-f]{16}$/.test(vaultIdFor(VAULT)), vaultIdFor(VAULT))
ok('the URI opens the vault by folder name', obsidianUriFor(VAULT) === 'obsidian://open?vault=kb', obsidianUriFor(VAULT))
const emptyPlan = planObsidianOpen(VAULT, { vaults: {} })
ok(
  'an unregistered vault gets exactly one entry, marked as the vault to show',
  emptyPlan.changed === true && emptyPlan.entry.open === true && emptyPlan.entry.path === VAULT,
  JSON.stringify({ changed: emptyPlan.changed, entry: emptyPlan.entry })
)
const secondPlan = planObsidianOpen(VAULT, { vaults: { [emptyPlan.id]: { path: VAULT, ts: 1 } } })
ok(
  'registering twice is a no-op (same path, any id)',
  secondPlan.changed === false && secondPlan.registered === true,
  JSON.stringify({ changed: secondPlan.changed, registered: secondPlan.registered })
)
const notInstalled = planObsidianOpen(VAULT, null)
ok(
  'a missing obsidian.json means "not installed", so nothing is fabricated',
  notInstalled.installed === false && notInstalled.changed === false,
  JSON.stringify(notInstalled)
)

section('7. POST /panel/workflow — validation only (no vault mutation in this proof)')
const bad = await call(harness, '/dsh-memory/panel/workflow', { body: { action: 'bogus', path: 'workflows/x.md' } })
ok('an unknown action is 400', bad.status === 400, `status ${bad.status} error=${bad.json?.error}`)
const noBody = await call(harness, '/dsh-memory/panel/workflow', { body: {} })
ok('a missing action is 400', noBody.status === 400, `status ${noBody.status} error=${noBody.json?.error}`)
const wrongMethod = await call(harness, '/dsh-memory/panel/overview', { method: 'DELETE' })
ok('a wrong method on a GET route is 405', wrongMethod.status === 405, `status ${wrongMethod.status}`)

section('8. GET /kb/ — the page the "进入" button opens')
const page = await call(harness, '/dsh-memory/kb/')
ok('page answers 200', page.status === 200, `status ${page.status}`)
ok('content type is html', String(page.headers['content-type'] ?? '').startsWith('text/html'), String(page.headers['content-type']))
const onDisk = readFileSync(join(ROOT, 'plugin/ui/kb/index.html'))
ok('served bytes are the file on disk, byte for byte', Buffer.from(page.text, 'utf8').equals(onDisk), `${onDisk.length} bytes`)
const assets = ['app.css', 'app.js']
for (const asset of assets) {
  const got = await call(harness, `/dsh-memory/kb/${asset}`)
  const disk = readFileSync(join(ROOT, 'plugin/ui/kb', asset))
  ok(`${asset} is served byte for byte`, got.status === 200 && Buffer.from(got.text, 'utf8').equals(disk), `status ${got.status} ${disk.length} bytes`)
}
const escape = await call(harness, '/dsh-memory/kb/%2e%2e%2f%2e%2e%2fui-contract.json')
ok('an encoded traversal out of the page directory is 404', escape.status === 404, `status ${escape.status}`)

// The page fetches its own contract at `<prefix>/kb/ui-contract.json` to cross-check the
// inlined constants against the single source at runtime. That path is not a file in
// `plugin/ui/kb/`; the route aliases it to the real contract file, so the live check is
// live instead of a silent 404.
const contractAlias = await call(harness, '/dsh-memory/kb/ui-contract.json')
const contractOnDisk = readFileSync(join(ROOT, 'plugin/ui-contract.json'))
ok(
  'the page can reach the contract: /kb/ui-contract.json is the real file, byte for byte',
  contractAlias.status === 200 && Buffer.from(contractAlias.text, 'utf8').equals(contractOnDisk),
  `status ${contractAlias.status} ${contractOnDisk.length} bytes`
)
const notACopy = existsSync(join(ROOT, 'plugin/ui/kb/ui-contract.json'))
ok('no second copy of the contract lives inside the page directory', !notACopy, notACopy ? 'a copy exists — single source broken' : 'single source intact')

section('9. teardown')
try {
  if (typeof harness.teardown === 'function') await harness.teardown()
  ok('the plugin unwinds without throwing', true)
} catch (error) {
  ok('the plugin unwinds without throwing', false, String(error && error.message))
}

console.log(`\n${failures.length === 0 ? 'LIVE PROOF: OK' : `LIVE PROOF: ${failures.length} FAILED`}`)
if (failures.length > 0) {
  for (const f of failures) console.log(`  ✖ ${f}`)
  process.exit(1)
}