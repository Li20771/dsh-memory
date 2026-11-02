#!/usr/bin/env node
// Read-only MemoryPack service over newline-delimited JSON-RPC on stdio.
//
// This is a deployment boundary: the Workbench/Fleet host spawns it with a
// trusted vault root and workspace registry, then requests immutable packs by
// a trusted context. The service never writes the vault and never accepts
// identity from a model or tool argument.
//
// Protocol: docs/MEMORYPACK_SERVICE_V1.md (dsh-memory repo)
// Version:  1.0.0
//
// Requests:
//   initialize {}
//   getPack {workspace_id, episode_id, role, run_id, task_id, purpose, max_entries}
//   createPackRef {workspace_id, episode_id, role}
//   shutdown {}
//
// Responses are JSON-RPC 2.0. Domain refusals use result {ok:false,error}.
// stdout carries protocol frames only; diagnostics go to stderr.

import { createInterface } from 'node:readline'

import {
  MemoryPackError,
  createMemoryPackContext,
  createMemoryPackService
} from '../plugin/lib/memory/memorypack.js'

const SERVICE_NAME = 'dsh-memory-memorypack'
const SERVICE_VERSION = '1.0.0'
const ROLES = new Set([
  'orchestrator',
  'researcher',
  'vehicle_analyst',
  'challenger',
  'evidence_verifier',
  'lab_runner'
])

function fail(message) {
  process.stderr.write(`dsh-memory memorypack service: ${message}\n`)
  process.exit(2)
}

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (!arg.startsWith('--')) fail(`unexpected argument: ${arg}`)
    const key = arg.slice(2)
    const value = argv[i + 1]
    if (value === undefined || value.startsWith('--')) fail(`missing value for --${key}`)
    out[key] = value
    i += 1
  }
  return out
}

const args = parseArgs(process.argv.slice(2))
const vaultRoot = String(args['vault-root'] ?? '').trim()
if (vaultRoot === '') fail('--vault-root is required')
const workspaceId = String(args.workspace ?? '').trim()
if (workspaceId === '') fail('--workspace is required')
const episodeId = args.episode === undefined ? null : String(args.episode).trim() || null
const workspaces = String(args.workspaces ?? workspaceId)
  .split(',')
  .map((value) => value.trim())
  .filter((value) => value !== '')
const allowedRoles = String(args.roles ?? [...ROLES].join(','))
  .split(',')
  .map((value) => value.trim())
  .filter((value) => ROLES.has(value))
if (allowedRoles.length === 0) fail('--roles must contain at least one known role')

let service
try {
  service = createMemoryPackService({
    vaultRoot,
    workspace: {
      id: workspaceId,
      episode: episodeId,
      registered: true,
      disabled: false,
      allowedRoles
    },
    workspaces
  })
} catch (error) {
  fail(error instanceof MemoryPackError ? error.code : 'service initialization failed')
}

function reply(id, result) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`)
}

function replyError(id, code, message) {
  process.stdout.write(
    `${JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } })}\n`
  )
}

async function handle(message) {
  if (message === null || typeof message !== 'object' || Array.isArray(message)) {
    replyError(null, -32600, 'invalid request')
    return
  }
  const id = message.id ?? null
  const method = message.method
  if (message.jsonrpc !== '2.0' || typeof method !== 'string') {
    replyError(id, -32600, 'invalid request')
    return
  }
  if (method === 'initialize') {
    reply(id, {
      ok: true,
      contract_version: SERVICE_VERSION,
      service: SERVICE_NAME
    })
    return
  }
  if (method === 'getPack') {
    const params = message.params
    if (params === null || typeof params !== 'object' || Array.isArray(params)) {
      reply(id, { ok: false, error: { code: 'memory-scope-invalid', message: 'invalid params' } })
      return
    }
    try {
      const context = createMemoryPackContext({
        workspace_id: params.workspace_id,
        episode_id: params.episode_id ?? null,
        role: params.role,
        run_id: params.run_id,
        task_id: params.task_id,
        purpose: params.purpose,
        max_entries: params.max_entries
      })
      const pack = await service.getPack(context)
      reply(id, { ok: true, pack })
    } catch (error) {
      const code = error instanceof MemoryPackError ? error.code : 'memory-internal-error'
      reply(id, { ok: false, error: { code, message: 'memory pack request failed' } })
    }
    return
  }
  if (method === 'createPackRef') {
    const params = message.params
    if (params === null || typeof params !== 'object' || Array.isArray(params)) {
      reply(id, { ok: false, error: { code: 'memory-scope-invalid', message: 'invalid params' } })
      return
    }
    try {
      const ref = await service.createPackRef(
        params.workspace_id,
        params.episode_id ?? null,
        params.role
      )
      reply(id, { ok: true, ref })
    } catch (error) {
      const code = error instanceof MemoryPackError ? error.code : 'memory-internal-error'
      reply(id, { ok: false, error: { code, message: 'memory pack request failed' } })
    }
    return
  }
  if (method === 'shutdown') {
    reply(id, { ok: true })
    process.exitCode = 0
    process.stdin.pause()
    setImmediate(() => process.exit(0))
    return
  }
  replyError(id, -32601, 'method not found')
}

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity })
lines.on('line', (line) => {
  if (line.trim() === '') return
  let message
  try {
    message = JSON.parse(line)
  } catch {
    replyError(null, -32700, 'parse error')
    return
  }
  void handle(message).catch(() => {
    replyError(message?.id ?? null, -32603, 'internal error')
  })
})
