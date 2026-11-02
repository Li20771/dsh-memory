// Offline tests for the read-only MemoryPack stdio service.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createInterface } from 'node:readline'

const SERVICE = fileURLToPath(new URL('./memorypack-service.mjs', import.meta.url))

async function makeVault() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-memory-service-'))
  await mkdir(join(root, 'workspaces', 'ws_a', 'memory'), { recursive: true })
  await writeFile(
    join(root, 'workspaces', 'ws_a', 'memory', 'shared.md'),
    `---
type: memory
visibility: workspace-shared
scope: ws_a
authority: agent-observed
review: approved
---
SERVICE_SHARED_CANARY
`
  )
  await writeFile(
    join(root, 'workspaces', 'ws_a', 'memory', 'episode.md'),
    `---
type: memory
visibility: episode-shared
scope: ws_a/ep_1
authority: curator
review: approved
---
SERVICE_EPISODE_CANARY
`
  )
  return root
}

function startService(vaultRoot) {
  const child = spawn(
    process.execPath,
    [
      SERVICE,
      '--vault-root',
      vaultRoot,
      '--workspace',
      'ws_a',
      '--episode',
      'ep_1',
      '--workspaces',
      'ws_a',
      '--roles',
      'researcher,challenger,evidence_verifier'
    ],
    { stdio: ['pipe', 'pipe', 'pipe'] }
  )
  const pending = new Map()
  const lines = createInterface({ input: child.stdout })
  lines.on('line', (line) => {
    const message = JSON.parse(line)
    const resolve = pending.get(message.id)
    if (resolve) {
      pending.delete(message.id)
      resolve(message)
    }
  })
  let nextId = 1
  const request = (method, params = {}) => {
    const id = nextId
    nextId += 1
    return new Promise((resolve, reject) => {
      pending.set(id, resolve)
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error(`service request timed out: ${method}`))
      }, 15000)
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
      const original = pending.get(id)
      pending.set(id, (message) => {
        clearTimeout(timer)
        original(message)
      })
    })
  }
  return { child, request, lines }
}

test('memorypack service initializes and serves a read-only pack', async () => {
  const vault = await makeVault()
  const { child, request, lines } = startService(vault)
  try {
    const init = await request('initialize')
    assert.equal(init.result.ok, true)
    assert.equal(init.result.service, 'dsh-memory-memorypack')
    assert.equal(init.result.contract_version, '1.0.0')

    const packMessage = await request('getPack', {
      workspace_id: 'ws_a',
      episode_id: 'ep_1',
      role: 'researcher',
      run_id: 'run_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      task_id: 'analysis_a',
      purpose: 'service test',
      max_entries: 100
    })
    assert.equal(packMessage.result.ok, true)
    const pack = packMessage.result.pack
    assert.equal(pack.contract_version, '1.1.0')
    assert.equal(pack.read_only, true)
    assert.equal(pack.entries.length, 2)
    assert.ok(pack.entries.some((entry) => entry.body.trim() === 'SERVICE_SHARED_CANARY'))
    assert.ok(pack.entries.some((entry) => entry.body.trim() === 'SERVICE_EPISODE_CANARY'))

    const refMessage = await request('createPackRef', {
      workspace_id: 'ws_a',
      episode_id: 'ep_1',
      role: 'researcher'
    })
    assert.equal(refMessage.result.ok, true)
    assert.equal(refMessage.result.ref.snapshot_id, pack.snapshot_id)
    assert.equal(refMessage.result.ref.snapshot_hash, pack.snapshot_hash)

    const shutdown = await request('shutdown')
    assert.equal(shutdown.result.ok, true)
  } finally {
    lines.close()
    child.stdin.end()
    child.kill()
  }
})

test('memorypack service refuses invalid contexts and unknown methods', async () => {
  const vault = await makeVault()
  const { child, request, lines } = startService(vault)
  try {
    const badRole = await request('getPack', {
      workspace_id: 'ws_a',
      episode_id: 'ep_1',
      role: 'admin',
      run_id: 'run_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      task_id: 'analysis_a',
      purpose: 'service test',
      max_entries: 10
    })
    assert.equal(badRole.result.ok, false)
    assert.equal(badRole.result.error.code, 'memory-scope-missing')

    const missingParams = await request('getPack', {})
    assert.equal(missingParams.result.ok, false)

    const unknown = await request('writePack', {})
    assert.equal(unknown.error.code, -32601)
  } finally {
    lines.close()
    child.stdin.end()
    child.kill()
  }
})
