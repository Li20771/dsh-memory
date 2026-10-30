// Path containment / canonicalization tests.
//   node --test tools/path-containment.test.mjs
//
// Traversal cases only compute and assert containment. They never write to the
// escape target; the only writes in this file are an isolated vault fixture and
// a symlink inside that fixture used to prove realpath containment.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm, access, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  PathDenied,
  isContained,
  normalizePackRelPath,
  normalizeRelPath,
  normalizeScope,
  resolveVaultPath,
  safeScopeId
} from '../plugin/lib/vault/paths.js'
import plugin from '../plugin/lib/index.js'
import { writeMarker } from '../plugin/lib/workspace.js'

test('normalizeRelPath rejects absolute, traversal, drive, UNC, NUL and ADS forms', () => {
  for (const bad of [
    '../escape.md',
    'a/../../escape.md',
    '/etc/passwd',
    'C:\\Windows\\win.ini',
    'C:/Windows/win.ini',
    '\\\\server\\share\\x.md',
    '//server/share/x.md',
    'a\u0000b.md',
    'a/b:c.md',
    './a.md',
    'a/./b.md',
    'a/../b.md',
    ''
  ]) {
    assert.throws(() => normalizeRelPath(bad), PathDenied, `should reject ${JSON.stringify(bad)}`)
  }
  assert.equal(normalizeRelPath('a\\b\\c.md'), 'a/b/c.md')
  assert.equal(normalizeRelPath('a//b//c.md'), 'a/b/c.md')
  assert.equal(normalizeRelPath('projects/结论.md'), 'projects/结论.md')
})

test('normalizePackRelPath accepts NFC Unicode and rejects traversal/unsafe forms', () => {
  assert.equal(normalizePackRelPath('projects/p1/findings/结论.md'), 'projects/p1/findings/结论.md')
  const nfd = 'projects/p1/findings/cafe' + '́' + '.md'
  assert.equal(normalizePackRelPath(nfd), nfd.normalize('NFC'))
  assert.notEqual(normalizePackRelPath(nfd), nfd)

  for (const bad of [
    '../escape.md',
    'a/../../escape.md',
    '/etc/passwd',
    'C:/Windows/win.ini',
    '\\\\server\\share\\x.md',
    'a//b.md',
    'a/./b.md',
    'a/',
    'a\\b.md',
    'a:b.md',
    'a\u0000b.md',
    ''
  ]) {
    assert.throws(() => normalizePackRelPath(bad), PathDenied, `should reject ${JSON.stringify(bad)}`)
  }
})

test('isContained is lexical and rejects siblings / parent paths', () => {
  const root = resolve(tmpdir(), 'vault-root')
  assert.equal(isContained(root, root), true)
  assert.equal(isContained(root, join(root, 'a', 'b.md')), true)
  assert.equal(isContained(root, join(root, '..', 'escape.md')), false)
  assert.equal(isContained(root, resolve(root, '..', 'sibling', 'x.md')), false)
  assert.equal(isContained(join(root, 'a'), join(root, 'ab', 'x.md')), false)
})

test('safeScopeId and normalizeScope reject path-shaped scope ids', () => {
  for (const bad of ['', '..', '.', 'a/b', 'a\\b', 'a:b', 'a\u0000b', '-a', '.a', 'a.']) {
    assert.throws(() => safeScopeId(bad), PathDenied, `should reject ${JSON.stringify(bad)}`)
  }
  assert.equal(safeScopeId('ws_a'), 'ws_a')
  assert.equal(safeScopeId('ws-A.1'), 'ws-A.1')

  assert.equal(normalizeScope('ws_a/ep_1').raw, 'ws_a/ep_1')
  assert.equal(normalizeScope('ws_a').episodeId, null)
  for (const bad of ['../ws', 'ws/../ep', 'ws/ep/extra', 'ws/', '/ws', 'ws\\ep']) {
    assert.equal(normalizeScope(bad), null, `should reject ${JSON.stringify(bad)}`)
  }
})

test('resolveVaultPath rejects a lexical escape without touching the target', async () => {
  const base = await mkdtemp(join(tmpdir(), 'dsh-path-'))
  const root = join(base, 'vault')
  await mkdir(root, { recursive: true })
  const escapeTarget = join(base, 'escape.md')
  try {
    await assert.rejects(
      () => resolveVaultPath(root, '../escape.md', { mustExist: false }),
      (error) => error instanceof PathDenied && ['path-traversal', 'path-escape'].includes(error.code)
    )
    await assert.rejects(
      () => resolveVaultPath(root, join(base, 'escape.md'), { mustExist: false }),
      (error) => error instanceof PathDenied && error.code === 'path-absolute'
    )
    await assert.rejects(access(escapeTarget), 'the traversal target must never be written')
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('resolveVaultPath keeps a normal in-root path and reports its canonical form', async () => {
  const base = await mkdtemp(join(tmpdir(), 'dsh-path-ok-'))
  const root = join(base, 'vault')
  await mkdir(join(root, 'workspaces', 'ws_a', 'memory'), { recursive: true })
  const rel = 'workspaces/ws_a/memory/2026-10-30-note.md'
  try {
    const resolved = await resolveVaultPath(root, rel, { mustExist: false })
    assert.equal(resolved.rel, rel)
    assert.equal(isContained(root, resolved.abs), true)
    assert.equal(resolved.abs, join(root, ...rel.split('/')))
    // Computing a path is not creating it.
    await assert.rejects(access(resolved.abs))
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('resolveVaultPath rejects a symlinked ancestor that escapes the vault', async (t) => {
  const base = await mkdtemp(join(tmpdir(), 'dsh-path-link-'))
  const root = join(base, 'vault')
  await mkdir(root, { recursive: true })
  try {
    try {
      await symlink(tmpdir(), join(root, 'linkdir'), 'junction')
    } catch {
      t.skip('symlink/junction creation is not permitted on this host')
      return
    }
    await assert.rejects(
      () => resolveVaultPath(root, 'linkdir', { mustExist: true }),
      (error) => error instanceof PathDenied && error.code === 'path-symlink-escape'
    )
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('resolveVaultPath rejects a file symlink that escapes the vault', async (t) => {
  const base = await mkdtemp(join(tmpdir(), 'dsh-path-filelink-'))
  const root = join(base, 'vault')
  await mkdir(root, { recursive: true })
  const outsideFile = fileURLToPath(import.meta.url)
  try {
    try {
      await symlink(outsideFile, join(root, 'link.md'), 'file')
    } catch {
      t.skip('file symlink creation is not permitted on this host')
      return
    }
    await assert.rejects(
      () => resolveVaultPath(root, 'link.md', { mustExist: true }),
      (error) => error instanceof PathDenied && error.code === 'path-symlink-escape'
    )
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

// --------------------------------------------------------------- tool paths

function makeCtx() {
  const tools = []
  return {
    tools,
    ctx: {
      systemPrompt: { section: () => () => {} },
      tools: { register: (tool) => (tools.push(tool), () => {}) },
      on: () => {},
      logger: { warn: () => {} }
    }
  }
}

async function mounted() {
  const base = await mkdtemp(join(tmpdir(), 'dsh-path-tools-'))
  const vaultRoot = join(base, 'kb')
  const workspace = join(base, 'Lab')
  const cwd = join(workspace, 'p1')
  await mkdir(join(vaultRoot, 'workflows'), { recursive: true })
  await mkdir(cwd, { recursive: true })
  await writeFile(join(vaultRoot, 'positioning.md'), '---\ntype: positioning\nvisibility: user-global\n---\n# L1\n\n契约\n', 'utf8')
  await writeMarker(workspace, { schema: 1, enabled: true, id: 'ws_a', episode: 'ep_1', coordinators: ['sess_coord'] })
  const harness = makeCtx()
  plugin.apply(harness.ctx, { vaultRoot, fullStatIntervalMs: 0 })
  return { base, vaultRoot, cwd, byName: new Map(harness.tools.map((t) => [t.name, t])) }
}

const coord = (cwd) => ({ agent: { workingDirectory: cwd, session: { id: 'sess_coord' } } })
const worker = (cwd) => ({ agent: { workingDirectory: cwd, session: { id: 'sess_worker' } } })

test('tool entry points reject traversal paths without writing the escape target', async () => {
  const { base, vaultRoot, cwd, byName } = await mounted()
  const escapeTarget = join(base, 'escape.md')
  try {
    const write = await byName.get('memory_write').execute(
      { type: 'workflow', title: 'safe', body: 'x', supersedes: '../../escape.md' },
      coord(cwd)
    )
    assert.ok(write.includes('拒绝'), write)

    const revise = await byName.get('memory_revise').execute({ path: '../../escape.md', body: 'x' }, coord(cwd))
    assert.ok(revise.includes('拒绝'), revise)

    const forget = await byName.get('memory_forget').execute({ path: '../../escape.md' }, coord(cwd))
    assert.ok(forget.includes('拒绝'), forget)

    const verify = await byName.get('memory_search').execute({ verify: '../../escape.md' }, worker(cwd))
    assert.ok(verify.includes('不可用'), verify)

    const scope = await byName.get('memory_search').execute({ query: 'x', scope: '../ws_b' }, worker(cwd))
    assert.ok(scope.includes('拒绝'), scope)

    const seeded = await byName.get('memory_write').execute(
      { type: 'memory', title: 'record', body: 'x', authority: 'agent-observed' },
      coord(cwd)
    )
    const record = seeded.match(/workspaces\/ws_a\/memory\/[^\s]+\.md/)[0]
    const harvest = await byName.get('memory_harvest').execute(
      { action: 'record', path: record, disposition: 'harvested', target: '../../escape.md' },
      coord(cwd)
    )
    assert.ok(harvest.includes('拒绝'), harvest)

    await assert.rejects(access(escapeTarget), 'the escape target must never be written')
    await assert.rejects(access(join(vaultRoot, '..', 'escape.md')))
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})
