// MemoryPack v1 contract tests (offline, synthetic fixtures only).
//   node --test tools/memorypack.test.mjs
//
// These tests exercise the real vault reader against the frozen
// brief/contracts/MEMORYPACK_V1.md shape. They do not connect to Workbench,
// DSH, a model or any provider.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { renderNote } from '../plugin/lib/index.js'
import { normalizePackRelPath } from '../plugin/lib/vault/paths.js'
import {
  MEMORYPACK_CONTRACT_VERSION,
  MemoryPackError,
  assertMemoryPackContractVersion,
  canonicalJson,
  createMemoryPackContext,
  createMemoryPackService,
  sha256Json
} from '../plugin/lib/memory/memorypack.js'

const WS_A_CANARY = 'WS_A_APPROVED_CANARY'
const WS_A_SHARED = 'WS_A_SHARED_CANARY'
const WS_A_RUN = 'WS_A_RUN_PRIVATE_CANARY'
const WS_B_CANARY = 'WS_B_FOREIGN_CANARY'
const GLOBAL_CANARY = 'GLOBAL_CANARY'
const KB_CANARY = 'KB_APPROVED_CANARY'
const PENDING_CANARY = 'PENDING_CANARY'
const REJECTED_CANARY = 'REJECTED_CANARY'
const SUPERSEDED_CANARY = 'SUPERSEDED_CANARY'
const RESTRICTED_CANARY = 'RESTRICTED_CANARY'
const OTHER_EPISODE_CANARY = 'OTHER_EPISODE_CANARY'

async function put(vaultRoot, rel, frontmatter, body) {
  const abs = join(vaultRoot, ...rel.split('/'))
  await mkdir(join(abs, '..'), { recursive: true })
  await writeFile(abs, renderNote(frontmatter, body), 'utf8')
}

async function fixture() {
  const base = await mkdtemp(join(tmpdir(), 'dsh-pack-'))
  const vaultRoot = join(base, 'kb')

  await put(vaultRoot, 'positioning.md', { type: 'positioning', title: 'L1', visibility: 'user-global' }, '定位')
  await put(
    vaultRoot,
    'workspaces/ws_a.md',
    { type: 'workspace', scope: 'ws_a', title: 'ws_a map', visibility: 'workspace-shared' },
    'map'
  )
  await put(
    vaultRoot,
    'workspaces/ws_a/memory/2026-10-30-ep.md',
    {
      type: 'memory',
      scope: 'ws_a/ep_1',
      visibility: 'episode-shared',
      review: { state: 'approved' },
      authority: 'agent-observed',
      created: '2026-10-30T00:00:00Z'
    },
    WS_A_CANARY
  )
  await put(
    vaultRoot,
    'workspaces/ws_a/memory/shared.md',
    {
      type: 'memory',
      scope: 'ws_a',
      visibility: 'workspace-shared',
      review: { state: 'approved' },
      authority: 'curator'
    },
    WS_A_SHARED
  )
  await put(
    vaultRoot,
    'workspaces/ws_a/memory/run-private.md',
    {
      type: 'memory',
      scope: 'ws_a/ep_1',
      visibility: 'run-private',
      run_id: 'run_11111111111111111111111111111111',
      review: { state: 'approved' },
      authority: 'agent-observed'
    },
    WS_A_RUN
  )
  await put(
    vaultRoot,
    'workspaces/ws_a/memory/pending.md',
    { type: 'memory', scope: 'ws_a', visibility: 'workspace-shared', review: { state: 'pending' } },
    PENDING_CANARY
  )
  await put(
    vaultRoot,
    'workspaces/ws_a/memory/rejected.md',
    { type: 'memory', scope: 'ws_a', visibility: 'workspace-shared', review: { state: 'rejected' } },
    REJECTED_CANARY
  )
  await put(
    vaultRoot,
    'workspaces/ws_a/memory/superseded.md',
    { type: 'memory', scope: 'ws_a', visibility: 'workspace-shared', status: 'superseded', review: { state: 'approved' } },
    SUPERSEDED_CANARY
  )
  await put(
    vaultRoot,
    'workspaces/ws_a/memory/restricted.md',
    { type: 'memory', scope: 'ws_a', visibility: 'restricted', review: { state: 'approved' } },
    RESTRICTED_CANARY
  )
  await put(
    vaultRoot,
    'workspaces/ws_a/memory/other-episode.md',
    {
      type: 'memory',
      scope: 'ws_a/ep_2',
      visibility: 'episode-shared',
      review: { state: 'approved' },
      authority: 'agent-observed'
    },
    OTHER_EPISODE_CANARY
  )
  await put(
    vaultRoot,
    'workspaces/ws_a/memory/bad-scope.md',
    { type: 'memory', scope: '../ws_b', visibility: 'workspace-shared', review: { state: 'approved' } },
    'BAD_SCOPE_CANARY'
  )
  await put(
    vaultRoot,
    'workspaces/ws_b/memory/foreign.md',
    { type: 'memory', scope: 'ws_b', visibility: 'workspace-shared', review: { state: 'approved' } },
    WS_B_CANARY
  )
  await put(
    vaultRoot,
    'global/user-global.md',
    { type: 'knowledge', scope: 'ws_b', visibility: 'user-global', review: { state: 'approved' }, authority: 'human-approved' },
    GLOBAL_CANARY
  )
  await put(
    vaultRoot,
    'projects/p1/findings/approved.md',
    { type: 'finding', review: { state: 'approved' }, title: 'approved finding', visibility: 'user-global' },
    KB_CANARY
  )
  await put(
    vaultRoot,
    'projects/p1/findings/pending.md',
    { type: 'finding', review: { state: 'pending' }, title: 'pending finding', visibility: 'user-global' },
    'KB_PENDING_CANARY'
  )
  await put(
    vaultRoot,
    'projects/p1/findings/结论.md',
    { type: 'finding', review: { state: 'approved' }, title: 'unicode path', visibility: 'user-global' },
    'UNICODE_PATH_CANARY'
  )
  await put(
    vaultRoot,
    'workflows/wf.md',
    { type: 'workflow', title: 'workflow', visibility: 'user-global' },
    'WORKFLOW_CANARY'
  )
  // Legacy records without explicit visibility: visible only in the migration
  // inventory, never in a worker pack.
  await put(
    vaultRoot,
    'workspaces/ws_a/memory/legacy-unmarked.md',
    { type: 'memory', scope: 'ws_a', review: { state: 'approved' } },
    'UNMARKED_SCOPED_CANARY'
  )
  await put(
    vaultRoot,
    'legacy/unmarked-kb.md',
    { type: 'finding', review: { state: 'approved' }, title: 'legacy unmarked KB' },
    'UNMARKED_UNSCOPED_CANARY'
  )
  await put(
    vaultRoot,
    'workspaces/ws_a/memory/sources.md',
    {
      type: 'memory',
      scope: 'ws_a',
      visibility: 'workspace-shared',
      review: { state: 'approved' },
      sources: [
        'workspaces/ws_b/memory/foreign.md',
        'workspaces/ws_a/memory/shared.md',
        'projects/p1/findings/approved.md'
      ]
    },
    'SOURCES_CANARY'
  )

  return { base, vaultRoot }
}

function context(overrides = {}) {
  return createMemoryPackContext({
    workspace_id: 'ws_a',
    episode_id: 'ep_1',
    role: 'researcher',
    run_id: 'run_11111111111111111111111111111111',
    task_id: 'analysis_a',
    purpose: 'offline contract test',
    max_entries: 100,
    ...overrides
  })
}

async function serviceFor(vaultRoot, options = {}) {
  const service = createMemoryPackService({
    vaultRoot,
    workspace: { id: 'ws_a', episode: 'ep_1' },
    now: () => '2026-10-30T00:00:00.000Z',
    refreshOnGet: false,
    ...options
  })
  await service.refresh()
  return service
}

test('pack includes only the authorized slice, and excludes foreign records without counting them', async () => {
  const { base, vaultRoot } = await fixture()
  try {
    const service = await serviceFor(vaultRoot)
    const pack = await service.getPack(context())
    const bodies = pack.entries.map((entry) => entry.body)
    const hasBody = (canary) => bodies.some((body) => body.includes(canary))

    assert.equal(pack.contract_version, '1.1.0')
    assert.equal(pack.contract_version, MEMORYPACK_CONTRACT_VERSION)
    assert.equal(pack.read_only, true)
    assert.equal(pack.policy.authorized_before_retrieval, true)
    assert.equal(pack.scope.workspace_id, 'ws_a')
    assert.equal(pack.scope.episode_id, 'ep_1')
    assert.equal(pack.role, 'researcher')
    assert.equal(pack.run_id, 'run_11111111111111111111111111111111')
    assert.match(pack.snapshot_id, /^mp_[a-f0-9]{32}$/)
    assert.match(pack.snapshot_hash, /^[a-f0-9]{64}$/)
    assert.equal(pack.snapshot_id, `mp_${pack.snapshot_hash.slice(0, 32)}`)

    assert.ok(hasBody(WS_A_CANARY), 'ws_a episode canary')
    assert.ok(hasBody(WS_A_SHARED), 'ws_a shared canary')
    assert.ok(hasBody(WS_A_RUN), 'run-private canary for the same run')
    assert.ok(hasBody(GLOBAL_CANARY), 'explicit user-global canary')
    assert.ok(hasBody(KB_CANARY), 'approved explicit user-global KB canary')
    const kbEntry = pack.entries.find((entry) => entry.body.includes(KB_CANARY))
    assert.equal(kbEntry.visibility, 'user-global')
    assert.equal(kbEntry.workspace_id, 'global')
    assert.ok(hasBody('WORKFLOW_CANARY'), 'explicit user-global workflow')
    assert.ok(hasBody('UNICODE_PATH_CANARY'), 'Unicode path must enter the pack')
    const unicodeEntry = pack.entries.find((entry) => entry.body.includes('UNICODE_PATH_CANARY'))
    assert.equal(unicodeEntry.path, 'projects/p1/findings/结论.md')
    assert.equal(unicodeEntry.path, unicodeEntry.path.normalize('NFC'))
    assert.ok(!hasBody(WS_B_CANARY), 'foreign workspace must not appear')
    assert.ok(!hasBody(OTHER_EPISODE_CANARY), 'other episode must not appear')
    assert.ok(!hasBody(PENDING_CANARY), 'pending must not appear')
    assert.ok(!hasBody(REJECTED_CANARY), 'rejected must not appear')
    assert.ok(!hasBody(SUPERSEDED_CANARY), 'superseded must not appear')
    assert.ok(!hasBody(RESTRICTED_CANARY), 'restricted must not appear')
    assert.ok(!hasBody('BAD_SCOPE_CANARY'), 'invalid scope must be dropped')
    assert.ok(!hasBody('UNMARKED_SCOPED_CANARY'), 'unmarked legacy record must not appear')
    assert.ok(!hasBody('UNMARKED_UNSCOPED_CANARY'), 'unscoped legacy record must not appear')

    // Counts are within the authorized ws_a slice: one L4 pending + one KB
    // pending, one rejected, one superseded, one restricted, one same-scope
    // unmarked. Foreign ws_b and unscoped legacy records are not counted.
    assert.deepEqual(pack.excluded, {
      pending: 2,
      rejected: 1,
      superseded: 1,
      restricted: 1,
      unmarked: 1,
      path_invalid: 0,
      entry_invalid: 0
    })
    assert.equal(pack.policy.cross_workspace, true, 'unscoped explicit user-global entries use the global sentinel')
    const positioning = pack.entries.find((entry) => entry.path === 'positioning.md')
    assert.equal(positioning.workspace_id, 'global', 'never substitute the requester workspace as owner')
    assert.equal(
      pack.policy.cross_workspace,
      pack.entries.some(
        (entry) => entry.visibility === 'user-global' && entry.workspace_id !== pack.scope.workspace_id
      ),
      'cross_workspace must match the actual entries'
    )

    for (const entry of pack.entries) {
      assert.equal(entry.review_state, 'approved')
      assert.equal(entry.sha256, sha256Json({ path: entry.path, revision: entry.revision, body: entry.body }))
      assert.match(entry.entry_id, /^mem_[A-Za-z0-9_-]{8,96}$/)
      assert.match(entry.revision, /^[a-f0-9]{12}$/)
      assert.match(entry.workspace_id, /^[a-z][a-z0-9_-]{1,63}$/)
      assert.ok(['L1', 'L2', 'L3', 'L4', 'KB'].includes(entry.layer))
      assert.ok(['memory', 'knowledge', 'episode', 'map', 'reference'].includes(entry.type))
    }

    // Every emitted path is a canonical NFC pack path, including Unicode names.
    assert.ok(pack.entries.some((entry) => entry.path.includes('结论')))
    assert.ok(pack.entries.every((entry) => normalizePackRelPath(entry.path) === entry.path))
    assert.ok(Object.isFrozen(pack))
    assert.ok(Object.isFrozen(pack.entries))
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('sources into a foreign workspace are omitted from the pack entry', async () => {
  const { base, vaultRoot } = await fixture()
  try {
    const service = await serviceFor(vaultRoot)
    const pack = await service.getPack(context())
    const entry = pack.entries.find((item) => item.body.includes('SOURCES_CANARY'))
    assert.ok(entry, 'sources canary present')
    const refs = entry.sources.map((source) => source.ref)
    assert.ok(refs.includes('workspaces/ws_a/memory/shared.md'))
    assert.ok(refs.includes('projects/p1/findings/approved.md'))
    assert.ok(!refs.includes('workspaces/ws_b/memory/foreign.md'), 'foreign source path must be omitted')
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('snapshot hash is deterministic and changes when authorized content changes', async () => {
  const { base, vaultRoot } = await fixture()
  try {
    const serviceA = await serviceFor(vaultRoot)
    const serviceB = await serviceFor(vaultRoot, { now: () => '2026-11-01T12:00:00.000Z' })
    const first = await serviceA.getPack(context())
    const second = await serviceB.getPack(context())
    assert.equal(first.snapshot_hash, second.snapshot_hash, 'generated_at is not in the hash')
    assert.equal(first.snapshot_id, second.snapshot_id)

    await put(
      vaultRoot,
      'workspaces/ws_a/memory/shared.md',
      {
        type: 'memory',
        scope: 'ws_a',
        visibility: 'workspace-shared',
        review: { state: 'approved' },
        authority: 'curator'
      },
      `${WS_A_SHARED} v2`
    )
    const changedService = await serviceFor(vaultRoot)
    const changed = await changedService.getPack(context())
    assert.notEqual(changed.snapshot_hash, first.snapshot_hash)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('max_entries truncates after authorization; foreign records cannot take a slot', async () => {
  const { base, vaultRoot } = await fixture()
  try {
    const service = await serviceFor(vaultRoot)
    const pack = await service.getPack(context({ max_entries: 1 }))
    assert.equal(pack.entries.length, 1)
    // Layer order selects L1 first; that is deterministic and never the foreign note.
    assert.equal(pack.entries[0].layer, 'L1')
    assert.equal(pack.entries[0].workspace_id, 'global')
    assert.notEqual(pack.entries[0].body, WS_B_CANARY)
    assert.deepEqual(pack.excluded, {
      pending: 2,
      rejected: 1,
      superseded: 1,
      restricted: 1,
      unmarked: 1,
      path_invalid: 0,
      entry_invalid: 0
    })
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('untrusted or malformed context fails closed', async () => {
  const { base, vaultRoot } = await fixture()
  try {
    const service = await serviceFor(vaultRoot)

    await assert.rejects(
      () => service.getPack({ workspace_id: 'ws_a', role: 'researcher' }),
      (error) => error instanceof MemoryPackError && error.code === 'memory-context-untrusted'
    )
    assert.throws(
      () => createMemoryPackContext({ workspace_id: 'ws_a', role: 'researcher' }),
      (error) => error instanceof MemoryPackError && error.code === 'memory-scope-missing'
    )
    assert.throws(
      () => context({ max_entries: 0 }),
      (error) => error instanceof MemoryPackError && error.code === 'memory-scope-invalid'
    )
    assert.throws(
      () => context({ episode_id: '../escape' }),
      (error) => error instanceof MemoryPackError && error.code === 'memory-scope-invalid'
    )
    assert.throws(
      () => context({ role: 'root' }),
      (error) => error instanceof MemoryPackError && error.code === 'memory-scope-missing'
    )
    await assert.rejects(
      () => service.getPack(context({ workspace_id: 'ws_missing' })),
      (error) => error instanceof MemoryPackError && error.code === 'memory-workspace-denied'
    )
    const unregistered = await serviceFor(vaultRoot, { workspaces: [] })
    await assert.rejects(
      () => unregistered.getPack(context()),
      (error) => error instanceof MemoryPackError && error.code === 'memory-workspace-denied'
    )
    const roleDenied = await serviceFor(vaultRoot, {
      workspace: { id: 'ws_a', episode: 'ep_1', allowedRoles: ['challenger'] }
    })
    await assert.rejects(
      () => roleDenied.getPack(context()),
      (error) => error instanceof MemoryPackError && error.code === 'memory-role-denied'
    )
    await assert.rejects(
      () => service.getPack(context({ episode_id: 'ep_2' })),
      (error) => error instanceof MemoryPackError && error.code === 'memory-episode-denied'
    )
    await assert.rejects(
      () => service.getPack(context(), { expectedSnapshotHash: '0'.repeat(64) }),
      (error) => error instanceof MemoryPackError && error.code === 'memory-snapshot-mismatch'
    )

    const noWrites = service
    assert.equal(noWrites.write, undefined)
    assert.equal(noWrites.update, undefined)
    assert.equal(noWrites.delete, undefined)
    assert.equal(noWrites.purge, undefined)
    assert.equal(noWrites.revise, undefined)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('createPackRef is stable and read-only', async () => {
  const { base, vaultRoot } = await fixture()
  try {
    const service = await serviceFor(vaultRoot)
    const first = await service.createPackRef('ws_a', 'ep_1', 'researcher')
    const second = await service.createPackRef('ws_a', 'ep_1', 'researcher')
    assert.deepEqual(first, second)
    assert.match(first.snapshot_id, /^mp_[a-f0-9]{32}$/)
    assert.match(first.snapshot_hash, /^[a-f0-9]{64}$/)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('invalid paths and oversized entries have explicit excluded reasons; NFD is normalized to NFC', async () => {
  const frontmatter = (extra = {}) => ({
    type: 'memory',
    scope: 'ws_a',
    visibility: 'workspace-shared',
    review: { state: 'approved' },
    ...extra
  })
  const make = (path, body, extra = {}) => ({
    path,
    parsed: { frontmatter: frontmatter(extra), body }
  })
  const nfdPath = 'workspaces/ws_a/memory/cafe' + '́' + '.md'
  const nfcPath = nfdPath.normalize('NFC')
  const entries = new Map([
    ['workspaces/ws_a/memory/ok.md', make('workspaces/ws_a/memory/ok.md', 'OK')],
    ['../escape.md', make('../escape.md', 'BAD_PATH')],
    [nfdPath, make(nfdPath, 'NFD')],
    ['workspaces/ws_a/memory/big.md', make('workspaces/ws_a/memory/big.md', 'x'.repeat(65537))],
    ['workspaces/ws_a/memory/unmarked.md', make('workspaces/ws_a/memory/unmarked.md', 'UNMARKED', { visibility: undefined })]
  ])
  const fakeIndex = {
    version: 1,
    paths: () => [...entries.keys()],
    get: (path) => entries.get(path),
    refresh: async () => {},
    rebuild: async () => {}
  }
  const service = createMemoryPackService({
    vaultRoot: 'fake-vault',
    index: fakeIndex,
    workspace: { id: 'ws_a', episode: 'ep_1' },
    now: () => '2026-10-30T00:00:00.000Z',
    refreshOnGet: false
  })
  const pack = await service.getPack(context())
  assert.deepEqual(
    pack.entries.map((entry) => entry.path).sort(),
    ['workspaces/ws_a/memory/café.md'.normalize('NFC'), 'workspaces/ws_a/memory/ok.md'].sort()
  )
  assert.equal(pack.entries.some((entry) => entry.body === 'BAD_PATH'), false)
  assert.equal(pack.entries.some((entry) => entry.body === 'UNMARKED'), false)
  assert.equal(pack.excluded.path_invalid, 1)
  assert.equal(pack.excluded.entry_invalid, 1)
  assert.equal(pack.excluded.unmarked, 1)
  assert.equal(pack.policy.cross_workspace, false)
})

test('canonical JSON matches the Workbench definition', () => {
  assert.equal(canonicalJson({ b: 1, a: [true, null, 'x'] }), '{"a":[true,null,"x"],"b":1}')
  assert.equal(sha256Json({ a: 1 }), sha256Json({ a: 1 }))
  assert.notEqual(sha256Json({ a: 1 }), sha256Json({ a: 2 }))
})

test('a mismatched contract version is rejected', () => {
  assert.throws(
    () => assertMemoryPackContractVersion({ contract_version: '2.0.0', source: { contract_version: '2.0.0' } }),
    (error) => error instanceof MemoryPackError && error.code === 'memory-contract-version'
  )
})
