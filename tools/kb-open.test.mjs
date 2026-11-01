// Behaviour tests for the knowledge-base entry: what `POST {prefix}/kb/open` actually does.
//   node --test tools/kb-open.test.mjs
//
// Before this file, `kb-open.js` had one source-level assertion ("the hand-off mentions
// obsidian://") and a manually-run live proof. Neither could catch a regression in the
// decision itself — which mode is chosen, which URI is fired, whether the user's
// Obsidian registry is touched, and what happens when it cannot be written.
//
// Everything here is offline and side-effect free:
//   · `obsidian.json` lives in a temp dir under the OS temp root, never the real one;
//   · the launcher is a recording stub, so no process is spawned and no browser or
//     Obsidian window can appear;
//   · the vault is a temp directory.
//
// SAFETY, learned the hard way: `openKnowledgeBase` defaults to the REAL
// `obsidianConfigPath()`, so a test that forgets to inject `ensureObsidianVault`
// writes to the user's actual Obsidian registry. That happened once during
// development and had to be restored from the automatic backup. `depsFor()` below
// is now the only way a test in this file may build dependencies, and it always
// binds `ensureObsidianVault` to a temp path.
//
// The invariants under test, in the order the route evaluates them:
//   1. vault missing            -> built-in page, error says why, registry untouched
//   2. Obsidian not installed   -> built-in page, error says why
//   3. vault registered already -> obsidian mode, no write, no backup
//   4. vault not yet registered -> obsidian mode, registers it, writes once, backs up once
//   5. second open              -> idempotent: no further write
//   6. registry unreadable      -> still fires the URI, reports the error, never throws
//   7. registry unwritable      -> still fires the URI, reports the error, never throws
//   8. register moves `open`    -> only the newly opened vault carries `open: true`
//   9. path shapes              -> per-platform config path, vault id, URI encoding

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rm, chmod } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, basename } from 'node:path'

import {
  obsidianConfigPath,
  vaultIdFor,
  obsidianUriFor,
  planObsidianOpen,
  ensureObsidianVault,
  openBuiltInPage,
  openKnowledgeBase,
} from '../plugin/lib/routes/kb-open.js'
import { KB } from '../plugin/lib/routes/contract.js'

// --------------------------------------------------------------------- helpers

/** The real registry path. No test may read or write this. */
const REAL_CONFIG = obsidianConfigPath()
const REAL_BACKUP = `${REAL_CONFIG}.dsh-memory.bak`

/**
 * Build the injectable dependencies for `openKnowledgeBase`, always bound to a
 * temp registry.
 *
 * This exists because the default parameter is the user's real config. Every
 * test goes through here so that omission is impossible, and it additionally
 * refuses to run if the path it was handed is the real one.
 */
function depsFor(configPath, { onUri, pageLauncher } = {}) {
  if (configPath === REAL_CONFIG) {
    throw new Error('refusing to run a test against the real Obsidian registry')
  }
  return {
    launchUri: (uri) => {
      if (typeof onUri === 'function') onUri(uri)
    },
    // The caller may pass its own recorder so it can assert the page launch.
    openBuiltInPage: (host) =>
      openBuiltInPage(host, { launch: (pageLauncher ?? recorder()).launch }),
    ensureObsidianVault: (vaultPath) => {
      if (configPath === REAL_CONFIG) {
        throw new Error('refusing to touch the real Obsidian registry')
      }
      return ensureObsidianVault(vaultPath, configPath)
    },
  }
}

/** A launcher that records instead of spawning. No process is ever created. */
function recorder() {
  const calls = []
  const launch = (command, args) => calls.push({ command, args })
  return { calls, launch }
}

async function tempRoot(t) {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-kb-open-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return dir
}

/** Create a vault directory plus an obsidian config path under the same temp root. */
async function fixture(t, { registry } = {}) {
  const root = await tempRoot(t)
  const vaultPath = join(root, 'kb')
  await mkdir(vaultPath, { recursive: true })
  const configPath = join(root, 'obsidian', 'obsidian.json')
  await mkdir(join(root, 'obsidian'), { recursive: true })
  if (registry !== undefined) {
    await writeFile(configPath, JSON.stringify(registry, null, 2), 'utf8')
  }
  return { root, vaultPath, configPath }
}

// ------------------------------------------------------- 1. vault does not exist

test('a missing vault falls back to the built-in page and does not touch the registry', async (t) => {
  const { root, configPath } = await fixture(t, { registry: { vaults: {} } })
  const launcher = recorder()
  const before = await readFile(configPath, 'utf8')

  const result = openKnowledgeBase(
    { vaultPath: join(root, 'does-not-exist'), host: '127.0.0.1:7777' },
    depsFor(configPath, {
      onUri: () => assert.fail('must not fire an obsidian:// URI'),
      pageLauncher: launcher,
    })
  )

  assert.equal(result.mode, 'browser')
  assert.equal(result.uri, null)
  assert.equal(result.error, 'vault path does not exist')
  assert.equal(result.registered, false)
  assert.equal(result.wrote, false)
  assert.ok(result.url.includes(basename(KB.page)), result.url)
  assert.equal(launcher.calls.length, 1, 'exactly one launch, for the page')

  assert.equal(await readFile(configPath, 'utf8'), before, 'registry must be untouched')
  assert.equal(existsSync(`${configPath}.dsh-memory.bak`), false, 'no backup for a no-op')
})

// ----------------------------------------------------- 2. Obsidian is not installed

test('Obsidian not installed falls back to the built-in page and says so', async (t) => {
  const { vaultPath, configPath } = await fixture(t) // no registry file at all
  const launcher = recorder()

  const result = openKnowledgeBase(
    { vaultPath, host: '127.0.0.1:7777' },
    depsFor(configPath, {
      onUri: () => assert.fail('must not fire an obsidian:// URI'),
      pageLauncher: launcher,
    })
  )

  assert.equal(result.mode, 'browser')
  assert.equal(result.uri, null)
  assert.equal(result.error, 'obsidian not installed')
  assert.equal(result.registered, false)
  assert.equal(launcher.calls.length, 1)
})

// ------------------------------------------------------- 3. already registered

test('an already-registered vault opens in Obsidian without writing or backing up', async (t) => {
  const { vaultPath, configPath } = await fixture(t)
  const id = vaultIdFor(vaultPath)
  await writeFile(
    configPath,
    JSON.stringify({ vaults: { [id]: { path: vaultPath, ts: 1 } } }, null, 2),
    'utf8'
  )
  const before = await readFile(configPath, 'utf8')
  const fired = []
  const launcher = recorder()

  const result = openKnowledgeBase(
    { vaultPath },
    depsFor(configPath, { onUri: (uri) => fired.push(uri) })
  )

  assert.equal(result.mode, 'obsidian')
  assert.equal(result.uri, obsidianUriFor(vaultPath))
  assert.equal(result.registered, true)
  assert.equal(result.wrote, false)
  assert.equal(result.error, null)
  assert.deepEqual(fired, [obsidianUriFor(vaultPath)], 'the URI is fired exactly once')
  assert.equal(launcher.calls.length, 0, 'the built-in page must not be opened')

  assert.equal(await readFile(configPath, 'utf8'), before, 'registry must be untouched')
  assert.equal(existsSync(`${configPath}.dsh-memory.bak`), false)
})

// ----------------------------------------------------- 4. registers on first open

test('a first open registers the vault, writes once and leaves one backup', async (t) => {
  const { vaultPath, configPath } = await fixture(t, {
    registry: { vaults: { other: { path: '/somewhere/else', ts: 1 } } },
  })
  const original = await readFile(configPath, 'utf8')
  const fired = []

  const result = openKnowledgeBase(
    { vaultPath },
    depsFor(configPath, { onUri: (uri) => fired.push(uri) })
  )

  assert.equal(result.mode, 'obsidian')
  assert.equal(result.registered, true)
  assert.equal(result.wrote, true)
  assert.equal(result.error, null)
  assert.deepEqual(fired, [obsidianUriFor(vaultPath)])

  const written = JSON.parse(await readFile(configPath, 'utf8'))
  const entry = Object.values(written.vaults).find(
    (v) => typeof v?.path === 'string' && v.path.toLowerCase() === vaultPath.toLowerCase()
  )
  assert.ok(entry, 'the vault is now in the registry')
  assert.equal(entry.open, true, 'the opened vault carries open:true')
  assert.equal(typeof entry.ts, 'number')

  assert.ok(
    written.vaults.other,
    'an unrelated existing vault must survive re-registration'
  )

  assert.equal(
    await readFile(`${configPath}.dsh-memory.bak`, 'utf8'),
    original,
    'the backup holds the pre-write contents'
  )
})

// --------------------------------------------------------------- 5. idempotency

test('opening twice writes only once and keeps the original backup', async (t) => {
  const { vaultPath, configPath } = await fixture(t, { registry: { vaults: {} } })
  const original = await readFile(configPath, 'utf8')

  const deps = depsFor(configPath)
  const first = openKnowledgeBase({ vaultPath }, deps)
  assert.equal(first.wrote, true)
  const afterFirst = await readFile(configPath, 'utf8')

  const second = openKnowledgeBase({ vaultPath }, deps)
  assert.equal(second.mode, 'obsidian')
  assert.equal(second.wrote, false, 'the second open must not write again')

  assert.equal(await readFile(configPath, 'utf8'), afterFirst, 'registry stable across opens')
  assert.equal(
    await readFile(`${configPath}.dsh-memory.bak`, 'utf8'),
    original,
    'the backup still holds the very first contents, not a re-written copy'
  )
})

// --------------------------------------------------- 6. registry cannot be read

test('an unreadable registry still fires the URI and reports the error instead of throwing', async (t) => {
  const { vaultPath, configPath } = await fixture(t)
  await writeFile(configPath, '{ this is not json', 'utf8')
  const fired = []

  const result = openKnowledgeBase(
    { vaultPath },
    depsFor(configPath, { onUri: (uri) => fired.push(uri) })
  )

  assert.equal(result.mode, 'obsidian', 'the vault may still be registered, so try')
  assert.equal(result.registered, false)
  assert.equal(result.wrote, false)
  assert.match(result.error, /cannot read Obsidian registry/)
  assert.deepEqual(fired, [obsidianUriFor(vaultPath)], 'the URI is still fired')

  assert.equal(
    await readFile(configPath, 'utf8'),
    '{ this is not json',
    'a corrupt registry must not be overwritten'
  )
})

// ------------------------------------------------- 7. registry cannot be written

test('a read-only registry still fires the URI and reports the error', async (t) => {
  const { vaultPath, configPath } = await fixture(t, { registry: { vaults: {} } })
  const before = await readFile(configPath, 'utf8')

  // Make the file read-only. Windows honours this for writes on a plain file.
  await chmod(configPath, 0o444)

  const fired = []
  const result = openKnowledgeBase(
    { vaultPath },
    depsFor(configPath, { onUri: (uri) => fired.push(uri) })
  )

  await chmod(configPath, 0o644).catch(() => {})

  assert.equal(result.mode, 'obsidian', 'still attempt the URI rather than failing outright')
  assert.deepEqual(fired, [obsidianUriFor(vaultPath)], 'the URI is still fired')

  if (result.wrote) {
    // Some filesystems (or a container running as root) ignore the mode bits. The
    // assertion that matters in that case is that the call still behaved sanely.
    assert.equal(result.error, null)
  } else {
    assert.equal(result.registered, false)
    assert.match(result.error, /cannot write Obsidian registry/)
    assert.equal(
      await readFile(configPath, 'utf8'),
      before,
      'a failed write must leave the registry intact'
    )
  }
})

// ------------------------------------------------- 8. only one vault carries open

test('registering a new vault clears open on every other vault', () => {
  const registry = {
    vaults: {
      aaaa: { path: '/vaults/first', ts: 1, open: true },
      bbbb: { path: '/vaults/second', ts: 2, open: true },
      cccc: { path: '/vaults/third', ts: 3 },
    },
  }
  const plan = planObsidianOpen('/vaults/brand-new', registry)

  assert.equal(plan.changed, true)
  assert.equal(plan.installed, true)
  assert.equal(plan.registered, false)
  assert.equal(plan.entry.open, true, 'the new entry is the one Obsidian should show')

  assert.equal('open' in registry.vaults.aaaa, false, 'stale open flags are cleared')
  assert.equal('open' in registry.vaults.bbbb, false)
  assert.equal('open' in registry.vaults.cccc, false)
  assert.equal(registry.vaults.aaaa.path, '/vaults/first', 'other vaults are preserved')
})

test('an existing vault is matched case-insensitively and never duplicated', () => {
  const vaultPath = '/Vaults/MyVault'
  const id = vaultIdFor(vaultPath)
  const registry = { vaults: { [id]: { path: '/vaults/myvault', ts: 9 } } }

  const plan = planObsidianOpen(vaultPath, registry)

  assert.equal(plan.changed, false)
  assert.equal(plan.registered, true)
  assert.equal(plan.id, id)
  assert.equal(Object.keys(registry.vaults).length, 1, 'no duplicate entry is added')
})

// --------------------------------------------------------- 9. pure path helpers

test('the Obsidian registry path follows each platform', () => {
  assert.equal(
    obsidianConfigPath('win32', { APPDATA: 'C:\\Users\\x\\AppData\\Roaming' }, 'C:\\Users\\x'),
    join('C:\\Users\\x\\AppData\\Roaming', 'obsidian', 'obsidian.json')
  )
  assert.equal(
    obsidianConfigPath('win32', {}, 'C:\\Users\\x'),
    join('C:\\Users\\x', 'AppData', 'Roaming', 'obsidian', 'obsidian.json'),
    'APPDATA unset falls back under the home directory'
  )
  assert.equal(
    obsidianConfigPath('darwin', {}, '/Users/x'),
    join('/Users/x', 'Library', 'Application Support', 'obsidian', 'obsidian.json')
  )
  assert.equal(
    obsidianConfigPath('linux', { XDG_CONFIG_HOME: '/home/x/.cfg' }, '/home/x'),
    join('/home/x/.cfg', 'obsidian', 'obsidian.json')
  )
  assert.equal(
    obsidianConfigPath('linux', {}, '/home/x'),
    join('/home/x', '.config', 'obsidian', 'obsidian.json')
  )
})

test('the vault id is stable, 16 hex chars, and case-insensitive', () => {
  const a = vaultIdFor('/Vaults/MyVault')
  const b = vaultIdFor('/vaults/myvault')
  assert.match(a, /^[0-9a-f]{16}$/)
  assert.equal(a, b, 'case differences must not produce a second registration')
})

test('the URI opens by folder name and percent-encodes it', () => {
  assert.equal(obsidianUriFor('/vaults/kb'), 'obsidian://open?vault=kb')
  assert.equal(
    obsidianUriFor('/vaults/我的 笔记'),
    `obsidian://open?vault=${encodeURIComponent('我的 笔记')}`,
    'a non-ASCII folder name with a space must be encoded'
  )
  assert.ok(
    !obsidianUriFor('/vaults/我的 笔记').includes(' '),
    'no raw space may leak into the URI'
  )
})

// ------------------------------------------------ the built-in page URL shape

test('the built-in page resolves against the request host and launches once', () => {
  const launcher = recorder()
  const result = openBuiltInPage('127.0.0.1:8899', { launch: launcher.launch })

  assert.equal(result.mode, 'browser')
  assert.ok(
    result.url.startsWith('http://127.0.0.1:8899'),
    `absolute page URL expected, got ${result.url}`
  )
  assert.equal(launcher.calls.length, 1)
})

test('a missing host still yields an absolute page URL', () => {
  const launcher = recorder()
  const result = openBuiltInPage(undefined, { launch: launcher.launch })
  assert.ok(result.url.startsWith('http://'), result.url)
  assert.equal(launcher.calls.length, 1)
})

// ------------------------------------------------- real-registry safety guard

test('the real Obsidian registry is never touched by this file', async (t) => {
  // Read the real registry (if any) at the start and end of a representative
  // open, and assert it is unchanged. This is the regression test for the
  // incident where a missing injection wrote twelve temp vaults into the
  // developer's actual obsidian.json.
  const realExists = existsSync(REAL_CONFIG)
  const before = realExists ? await readFile(REAL_CONFIG, 'utf8') : null
  const backupBefore = existsSync(REAL_BACKUP)

  const { vaultPath, configPath } = await fixture(t, { registry: { vaults: {} } })
  assert.notEqual(configPath, REAL_CONFIG, 'the fixture must not point at the real registry')

  openKnowledgeBase({ vaultPath }, depsFor(configPath, { onUri: () => {} }))

  const after = existsSync(REAL_CONFIG) ? await readFile(REAL_CONFIG, 'utf8') : null
  assert.equal(after, before, 'the real obsidian.json must be byte-identical before and after')
  assert.equal(
    existsSync(REAL_BACKUP),
    backupBefore,
    'this file must not create or remove a backup next to the real registry'
  )
})

test('depsFor refuses the real registry path', () => {
  assert.throws(
    () => depsFor(REAL_CONFIG),
    /refusing to run a test against the real Obsidian registry/,
    'the helper must fail loudly rather than silently write the real file'
  )
})
