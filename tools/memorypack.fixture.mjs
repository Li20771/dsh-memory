// Cross-repo MemoryPack v1.1 synthetic fixture generator.
//
// Builds a tiny synthetic vault, produces a pack through the real offline
// producer, and writes the pack JSON to the path given as argv[2]. The file is
// consumed by the Workbench repository's cross-repo contract test.
//
// Offline only: no DSH, MCP, provider, network or real vault access.
//
//   node tools/memorypack.fixture.mjs tools/fixtures/memorypack.v1.2.dsh-memory.json

import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import { renderNote } from '../plugin/lib/index.js'
import { createMemoryPackContext, createMemoryPackService } from '../plugin/lib/memory/memorypack.js'

const DEFAULT_OUTPUT = 'tools/fixtures/memorypack.v1.2.dsh-memory.json'
const WORKSPACE_ID = 'ws_a'
const EPISODE_ID = 'ep_1'
const RUN_ID = 'run_11111111111111111111111111111111'
const NOW = '2026-10-30T00:00:00.000Z'

async function put(vaultRoot, rel, frontmatter, body) {
  const abs = join(vaultRoot, ...rel.split('/'))
  await mkdir(dirname(abs), { recursive: true })
  await writeFile(abs, renderNote(frontmatter, body), 'utf8')
}

async function buildVault(vaultRoot) {
  // Authorized approved episode record in the pack's workspace/episode.
  await put(
    vaultRoot,
    'workspaces/ws_a/memory/2026-10-30-episode.md',
    {
      type: 'memory',
      title: 'ws_a approved episode note',
      scope: 'ws_a/ep_1',
      visibility: 'episode-shared',
      review: { state: 'approved' },
      authority: 'agent-observed',
      created: '2026-10-30T00:00:00Z'
    },
    'APPROVED_WS_A_EPISODE_CANARY'
  )

  // Explicit user-global with no origin scope: owner must be the reserved
  // `global` value, never the requesting workspace.
  await put(
    vaultRoot,
    'memory/items/2026-10-30-user-global.md',
    {
      type: 'knowledge',
      title: 'explicit user-global note',
      visibility: 'user-global',
      review: { state: 'approved' },
      authority: 'human-approved',
      created: '2026-10-30T00:00:00Z'
    },
    'APPROVED_USER_GLOBAL_CANARY'
  )

  // Unicode NFC path that must survive into the pack unchanged.
  const unicodePath = 'workspaces/ws_a/memory/2026-10-30-结论.md'.normalize('NFC')
  await put(
    vaultRoot,
    unicodePath,
    {
      type: 'memory',
      title: 'unicode NFC path note',
      scope: 'ws_a',
      visibility: 'workspace-shared',
      review: { state: 'approved' },
      authority: 'curator',
      created: '2026-10-30T00:00:00Z'
    },
    'UNICODE_NFC_PATH_CANARY'
  )

  // Foreign workspace: must never appear in entries, sources or excluded counts.
  await put(
    vaultRoot,
    'workspaces/ws_b/memory/2026-10-30-foreign.md',
    {
      type: 'memory',
      title: 'foreign ws_b note',
      scope: 'ws_b',
      visibility: 'workspace-shared',
      review: { state: 'approved' },
      authority: 'agent-observed'
    },
    'WS_B_FOREIGN_CANARY'
  )

  // Authorized but excluded with a visible count.
  await put(
    vaultRoot,
    'workspaces/ws_a/memory/2026-10-30-pending.md',
    {
      type: 'memory',
      title: 'pending note',
      scope: 'ws_a',
      visibility: 'workspace-shared',
      review: { state: 'pending' },
      authority: 'agent-observed'
    },
    'PENDING_CANARY'
  )

  // Legacy record without explicit visibility: counted as unmarked, not emitted.
  await put(
    vaultRoot,
    'workspaces/ws_a/memory/2026-10-30-legacy-unmarked.md',
    {
      type: 'memory',
      title: 'unmarked legacy note',
      scope: 'ws_a',
      review: { state: 'approved' },
      authority: 'agent-observed'
    },
    'UNMARKED_LEGACY_CANARY'
  )
}

async function main() {
  const outputPath = resolve(process.argv[2] ?? DEFAULT_OUTPUT)
  const base = await mkdtemp(join(tmpdir(), 'dsh-pack-fixture-'))
  const vaultRoot = join(base, 'kb')
  try {
    await buildVault(vaultRoot)

    const context = createMemoryPackContext({
      workspace_id: WORKSPACE_ID,
      episode_id: EPISODE_ID,
      role: 'researcher',
      run_id: RUN_ID,
      task_id: 'analysis_a',
      purpose: 'cross-repo synthetic fixture',
      max_entries: 100
    })
    const service = createMemoryPackService({
      vaultRoot,
      workspace: { id: WORKSPACE_ID, episode: EPISODE_ID },
      now: () => NOW,
      refreshOnGet: false
    })
    await service.refresh()
    const pack = await service.getPack(context)

    await mkdir(dirname(outputPath), { recursive: true })
    await writeFile(outputPath, `${JSON.stringify(pack, null, 2)}\n`, 'utf8')
    console.log(`wrote ${outputPath}`)
    console.log(`snapshot_id   ${pack.snapshot_id}`)
    console.log(`snapshot_hash ${pack.snapshot_hash}`)
    console.log(`entries       ${pack.entries.length}`)
    console.log(`excluded      ${JSON.stringify(pack.excluded)}`)
    console.log(`cross_workspace ${pack.policy.cross_workspace}`)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
