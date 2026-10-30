// ui-contract.test.mjs — the cross-edge contract test (Lead's T5 gate).
//
// Why this file exists: `plugin/ui-contract.json` is the ONE source for the HTTP
// prefix and the route paths, but it is read by four different consumers that
// never import each other —
//   1. the host routes  (`plugin/lib/routes/contract.js`)
//   2. the client bundle (`plugin/lib/client.js`, inlined at build time)
//   3. the knowledge page (`plugin/ui/kb/app.js`, inline constants + a live fetch)
//   4. the build script    (`scripts/build-client.mjs`, inlines it)
// The per-edge smokes each check their own side; this file checks that all sides
// still agree with the file, so a change made in one place cannot ship a UI whose
// halves speak different paths. It also pins the packaging declarations that make
// the client half discoverable at all (`dsh.client` + `exports["./client"]` are
// checked by the platform loader and throw when either is missing).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const PLUGIN = join(ROOT, 'plugin')

const read = (rel) => readFileSync(join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n')
const contract = JSON.parse(read('plugin/ui-contract.json'))

/** Every route path the contract names, with the family it belongs to. */
const PATHS = [
  ['panel.overview', contract.panel.overview],
  ['panel.workflow', contract.panel.workflow],
  ['kb.page', contract.kb.page],
  ['kb.tree', contract.kb.tree],
  ['kb.note', contract.kb.note],
  ['kb.resolve', contract.kb.resolve],
  ['kb.search', contract.kb.search]
]

/** Strip whole-line comments the way this repository writes them (full-line `//`, `*`, `/*`). */
const codeLines = (source) =>
  source
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim()
      return !(trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*'))
    })
    .join('\n')

/* ------------------------------------------------ 1. packaging declarations */

test('packaging: the client half is discoverable and points at the built bundle', () => {
  const pkg = JSON.parse(read('plugin/package.json'))
  assert.equal(pkg.name, 'dsh-memory', 'the bundle id must equal the package name')
  assert.equal(pkg.exports['./client'], './lib/client.js', 'exports["./client"] must name the built bundle')
  assert.equal(pkg.exports['.'], './lib/index.js', 'the host half stays the root export')
  assert.equal(pkg.dsh?.client?.platform, 'web', 'dsh.client.platform must be web')
  assert.equal(pkg.dsh?.client?.immediately, true, 'dsh.client.immediately must be true')
  assert.ok(
    Array.isArray(pkg.dsh?.client?.inject) && pkg.dsh.client.inject.includes('@deepseek-ai/dsh-client-runtime'),
    'dsh.client.inject must ask for the client runtime'
  )
  assert.equal(pkg.dsh?.bundle?.patch, './cordis.patch.yml', 'the host half still ships its bundle patch')
  assert.ok(pkg.files.includes('lib'), 'the published files must include lib/')
  assert.ok(existsSync(join(PLUGIN, 'lib/client.js')), 'the built client bundle must exist on disk')
})

test('packaging: the client bundle is a module-loader bundle with the contract id', () => {
  const bundle = read('plugin/lib/client.js')
  assert.match(bundle, /window\.__ModuleLoader__\.load\(\{/, 'the bundle must register through __ModuleLoader__')
  assert.match(bundle, /id:\s*'dsh-memory'/, "the bundle id must be 'dsh-memory'")
  assert.equal((bundle.match(/__ModuleLoader__\.load\(/g) || []).length, 1, 'exactly one bundle registration')
  assert.equal((bundle.match(/^\s*(?:import|export)\s/gm) || []).length, 0, 'a browser classic bundle has no top-level import/export')
})

/* --------------------------------------------------- 2. the host route module */

test('host: the route module derives every path from the contract file', async () => {
  const mod = await import('../plugin/lib/routes/contract.js')
  assert.equal(mod.PREFIX, contract.prefix, 'PREFIX must equal contract.prefix')
  assert.equal(mod.PANEL.overview, `${contract.prefix}${contract.panel.overview}`, 'panel.overview path')
  assert.equal(mod.PANEL.workflow, `${contract.prefix}${contract.panel.workflow}`, 'panel.workflow path')
  assert.equal(mod.KB.tree, `${contract.prefix}${contract.kb.tree}`, 'kb.tree path')
  assert.equal(mod.KB.note, `${contract.prefix}${contract.kb.note}`, 'kb.note path')
  assert.equal(mod.KB.resolve, `${contract.prefix}${contract.kb.resolve}`, 'kb.resolve path')
  assert.equal(mod.KB.search, `${contract.prefix}${contract.kb.search}`, 'kb.search path')
  assert.equal(
    mod.KB_PAGE_BASE,
    `${contract.prefix}${contract.kb.page.replace(/\/+$/, '')}`,
    'the page prefix seat drops the trailing slash'
  )
})

test('host: no route module restates the prefix or a path literal in code', () => {
  for (const file of ['contract.js', 'http.js', 'vault-paths.js', 'panel.js', 'kb-api.js', 'kb-page.js', 'index.js']) {
    const code = codeLines(read(`plugin/lib/routes/${file}`))
    assert.ok(!code.includes(contract.prefix), `${file} must not hardcode ${contract.prefix} in code`)
    for (const [name, path] of PATHS) {
      if (path === contract.kb.page) continue // the base constant is derived, and the slash form is comment-only
      assert.ok(!code.includes(`'${path}'`) && !code.includes(`"${path}"`), `${file} must not hardcode ${name} == ${path}`)
    }
  }
})

/* ------------------------------------------------------------- 3. client half */

test('client: the built bundle carries the prefix and every contract path', () => {
  const bundle = read('plugin/lib/client.js')
  assert.ok(bundle.includes(`"prefix": "${contract.prefix}"`), `the inlined contract must carry prefix ${contract.prefix}`)
  for (const [name, path] of PATHS) {
    assert.ok(bundle.includes(`"${path}"`), `the built bundle must carry ${name} == ${path}`)
  }
  assert.match(bundle, /shell\.overlay/, 'the button registers into shell.overlay')
  assert.ok(!bundle.includes("shell.leading"), 'shell.leading is single-typed and must never be registered')
})

/* --------------------------------------------------------- 4. knowledge page */

test('kb page: the inline constants match the contract, and every path is used', () => {
  const app = read('plugin/ui/kb/app.js')
  assert.ok(app.includes(`prefix: '${contract.prefix}'`), `the page must inline the prefix ${contract.prefix}`)
  for (const key of ['page', 'tree', 'note', 'resolve', 'search']) {
    assert.ok(app.includes(`${key}: '${contract.kb[key]}'`), `the page must inline kb.${key} == ${contract.kb[key]}`)
  }
  const html = read('plugin/ui/kb/index.html')
  assert.ok(html.includes(`href="app.css"`) && html.includes(`src="app.js"`), 'the page must load its own same-directory assets')
  assert.ok(!/src="https?:|href="https?:/i.test(html), 'the page must not load anything from another origin')
})

test('kb page: the four edges agree on one prefix string', () => {
  const sources = {
    'plugin/ui-contract.json': read('plugin/ui-contract.json'),
    'plugin/lib/routes/contract.js': read('plugin/lib/routes/contract.js'),
    'plugin/lib/client.js': read('plugin/lib/client.js'),
    'plugin/ui/kb/app.js': read('plugin/ui/kb/app.js')
  }
  for (const [file, source] of Object.entries(sources)) {
    assert.ok(source.includes(contract.prefix), `${file} must mention ${contract.prefix}`)
  }
  // And no edge may invent a second prefix family for this plugin's routes.
  for (const [file, source] of Object.entries(sources)) {
    const foreign = source.match(/['"]\/(?!dsh-memory|$)[a-z][a-z0-9-]*\/panel\//g)
    assert.equal(foreign, null, `${file} must not route another prefix (found ${String(foreign)})`)
  }
})

test('host: mounting the HTTP surface can never abort the plugin row', () => {
  // The desktop failure of 2026-10-29 in one line: this Cordis throws when an
  // undeclared service is read through a bare property, and `ctx.webServer` sat
  // outside every try — so `apply()` aborted, the row failed, the ten tools never
  // registered and every `/dsh-memory/*` route answered 404, while the client half
  // still rendered its button (client discovery reads the manifest, not row health).
  const src = read('plugin/lib/index.js')
  assert.match(src, /const readWebServer = \(\) => \{\n    try \{/, 'the probe must open with a guarded read')
  assert.ok(
    !src.includes('const webServer = ctx.webServer'),
    'the mount probe must not read the undeclared service through a bare property'
  )
  assert.match(src, /reportStatus/, 'the mount result must be written where it can be read back')
  assert.ok(src.includes('ui-status.json'), 'the status file name must stay stable for diagnostics')
})

test('client: the knowledge-base entry degrades when the host denies pop-ups', () => {
  // Desktop `setWindowOpenHandler` returns `deny` for every pop-up and hands only
  // `https:` destinations to the system browser (lib/main.js); `will-navigate` is
  // prevented too. Our entry is http + relative, so "called window.open" is NOT
  // "opened" — the shipped symptom was a click that did nothing at all.
  const src = read('plugin/lib/client.js')
  assert.match(src, /if \(win\) return \{ opened: true, mode: 'window'/, 'only a real window handle counts as opened')
  assert.match(src, /return dmShowInPanelFrame\(href\)/, 'a denied pop-up must fall back to the in-panel page')
  assert.match(src, /data-dsh-memory-frame-page/, 'the fallback renders the page in a same-origin iframe')
  assert.ok(src.includes("mode: 'frame'"), 'the fallback must report its real mode, never a fake success')
})

test('client: the knowledge-base entry goes through the host opener', () => {
  // The desktop renderer cannot open a window at all (setWindowOpenHandler → deny),
  // so the entry asks the HOST to hand the page to the OS. This locks the chain:
  // contract path → host route → client call.
  const hostSrc = read('plugin/lib/routes/kb-open.js')
  assert.match(hostSrc, /obsidian:\/\/open\?vault=/, 'the hand-off must open the vault in Obsidian')
  assert.match(hostSrc, /export function ensureObsidianVault/, 'an unregistered vault must be registered, not silently fail')
  assert.match(hostSrc, /export function planObsidianOpen/, 'the registration decision must be a pure, assertable function')
  assert.match(hostSrc, /KB\.open/, 'the route must use the contract path, not a literal')
  const clientSrc = read('plugin/lib/client.js')
  assert.ok(clientSrc.includes('"open": "/kb/open"'), 'the built client must inline the open path from the contract')
  assert.match(clientSrc, /dmAskHostToOpen/, 'the client must ask the host first')
  assert.match(clientSrc, /dmShowInPanelFrame/, 'and still keep the in-panel fallback when nothing else works')
})

/* -------------------------------------------------- 5. the artifacts can ship */

test('every artifact can be committed and published (two independent loss channels)', () => {
  // Channel 1 — version control. `.gitignore` used to carry a bare `kb/`, which in
  // gitignore syntax matches a directory named `kb` at ANY depth, so it silently
  // swallowed `plugin/ui/kb/**` — the knowledge page. `git status` showed nothing,
  // and `git add -A` could not add it: the page would simply not exist in a clone.
  const gitPresent = spawnSync('git', ['--version'], { encoding: 'utf8' }).status === 0
  const page = spawnSync('git', ['check-ignore', '-v', 'plugin/ui/kb/index.html'], { cwd: ROOT, encoding: 'utf8' })
  if (gitPresent && page.error === undefined) {
    assert.equal(
      page.status,
      1,
      `plugin/ui/kb must not be gitignored (check-ignore matched: ${page.stdout.trim() || '(no output)'})`
    )
    const vault = spawnSync('git', ['check-ignore', '-v', 'kb/positioning.md'], { cwd: ROOT, encoding: 'utf8' })
    assert.equal(vault.status, 0, 'the top-level vault must STAY ignored — that is the reason the rule exists')
  }

  // Channel 2 — the publish list. `files` decides what a pack/clone of the package
  // carries; `ui/` missing meant the page route would answer `kb page not available`
  // while the panel still handed out its URL, and `README.md` was listed without
  // existing at all.
  const pkg = JSON.parse(read('plugin/package.json'))
  assert.ok(pkg.files.includes('ui'), 'files must include ui/ (the knowledge page ships with the plugin)')
  assert.ok(pkg.files.includes('lib'), 'files must include lib/')
  for (const entry of pkg.files) {
    assert.ok(existsSync(join(PLUGIN, entry)), `files lists ${entry}, which does not exist in plugin/`)
  }
})