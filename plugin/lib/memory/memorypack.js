// MemoryPack v1: the only read surface a Fleet worker is supposed to hold.
//
// This module is a library API, not a tool. Its context factory is the trust
// boundary: a plain object assembled from model output is rejected. The host
// (Fleet/Curator) creates the context from a TrustedBinding and passes it here;
// workspace/episode/role/run are therefore never self-reported by a worker.
//
// The current frozen contract is `brief/contracts/MEMORYPACK_V1_1.md` v1.1.0.
// v1.0.0 remains historical and unmodified. This file mirrors the Workbench fake
// client's canonical JSON and hash definitions so the two sides agree byte-for-byte.
//
// @module dsh-memory/memory/memorypack

import { createHash } from 'node:crypto'

import { revisionOf } from '../vault/cite.js'
import { VaultIndex } from '../vault/index.js'
import {
  PACK_RUN_ID_PATTERN,
  PACK_SCOPE_ID_PATTERN,
  PACK_TASK_ID_PATTERN,
  normalizePackRelPath,
  normalizeRelPath
} from '../vault/paths.js'
import {
  ROLES,
  authorizeEntry,
  inAuthorizedSlice,
  isOwnWorkspacePath,
  makeAccess,
  reviewStateOf,
  scopeOf,
  statusOf,
  visibilityOf
} from './access.js'

export const MEMORYPACK_CONTRACT_VERSION = '1.1.0'

/**
 * Owner value for an explicit `user-global` entry that has no origin workspace.
 * v1.1.0 forbids inventing the requester's workspace_id as the owner.
 */
export const GLOBAL_WORKSPACE_ID = 'global'

export const MEMORYPACK_ERROR_CODES = Object.freeze([
  'memory-context-untrusted',
  'memory-scope-missing',
  'memory-scope-invalid',
  'memory-workspace-denied',
  'memory-episode-denied',
  'memory-role-denied',
  'memory-snapshot-mismatch',
  'memory-contract-version',
  'memory-internal-error'
])

const ROLE_SET = new Set(ROLES)
const LAYER_ORDER = Object.freeze({ L1: 1, L2: 2, L3: 3, L4: 4, KB: 5 })
const PACK_VISIBILITIES = new Set(['user-global', 'workspace-shared', 'episode-shared', 'run-private'])
const KB_TYPES = new Set(['project', 'research', 'finding', 'decision', 'question', 'log', 'artifact'])
const PACK_TYPES = new Set(['memory', 'knowledge', 'episode', 'map', 'reference'])

const AUTHORITY_MAP = Object.freeze({
  'human-approved': 'human-approved',
  'user-stated': 'human-approved',
  curator: 'curator',
  'agent-observed': 'agent-observed',
  measured: 'agent-observed',
  'tool-output': 'source-document',
  'source-document': 'source-document',
  inferred: 'agent-observed'
})

const TRUSTED_CONTEXT = Symbol('dsh-memory.memorypack.trusted-context')
const MAX_BODY = 65536
const MAX_SOURCE_REF = 512
const DEFAULT_SNAPSHOT_RUN = 'run_00000000000000000000000000000000'

export class MemoryPackError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'MemoryPackError'
    this.code = code
  }
}

// --------------------------------------------------------------- canonical JSON

function unsupported(value) {
  throw new TypeError(`canonical-json: unsupported value: ${typeof value}`)
}

/** Canonical JSON matching Workbench's `canonical-json.ts` exactly. */
export function canonicalJson(value) {
  if (value === null) return 'null'
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false'
    case 'string':
      return JSON.stringify(value)
    case 'number':
      if (!Number.isFinite(value)) unsupported(value)
      return JSON.stringify(value)
    case 'object':
      break
    default:
      unsupported(value)
  }
  if (Array.isArray(value)) {
    const parts = []
    for (const item of value) {
      if (item === undefined) unsupported(item)
      parts.push(canonicalJson(item))
    }
    return `[${parts.join(',')}]`
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) unsupported(value)
  const parts = []
  for (const key of Object.keys(value).sort()) {
    const item = value[key]
    if (item === undefined) unsupported(item)
    parts.push(`${JSON.stringify(key)}:${canonicalJson(item)}`)
  }
  return `{${parts.join(',')}}`
}

export function sha256Json(value) {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex')
}

export function deepFreeze(value, seen = new WeakSet()) {
  if (value === null || typeof value !== 'object') return value
  if (seen.has(value)) return value
  seen.add(value)
  for (const key of Object.keys(value)) deepFreeze(value[key], seen)
  return Object.freeze(value)
}

// ------------------------------------------------------------------- context

const CONTEXT_KEYS = new Set(['workspace_id', 'episode_id', 'role', 'run_id', 'task_id', 'purpose', 'max_entries'])

/**
 * Create the frozen, in-process trusted context object.
 *
 * This is intentionally the only way to obtain a context that `getPack` accepts.
 * A plain object assembled by a tool caller is rejected as untrusted, so a model
 * cannot supply `workspace_id`/`role`/`run_id` and be believed.
 */
export function createMemoryPackContext(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new MemoryPackError('memory-context-untrusted', 'memory pack context must be an object')
  }
  for (const key of Object.keys(input)) {
    if (!CONTEXT_KEYS.has(key)) {
      throw new MemoryPackError('memory-context-untrusted', 'memory pack context contains an untrusted field')
    }
  }
  const workspaceId = input.workspace_id
  const role = input.role
  const runId = input.run_id
  const taskId = input.task_id
  if (
    typeof workspaceId !== 'string' ||
    !PACK_SCOPE_ID_PATTERN.test(workspaceId) ||
    typeof role !== 'string' ||
    !ROLE_SET.has(role) ||
    typeof runId !== 'string' ||
    !PACK_RUN_ID_PATTERN.test(runId) ||
    typeof taskId !== 'string' ||
    !PACK_TASK_ID_PATTERN.test(taskId)
  ) {
    throw new MemoryPackError('memory-scope-missing', 'memory pack context is incomplete')
  }
  if (input.episode_id !== null && (typeof input.episode_id !== 'string' || !PACK_SCOPE_ID_PATTERN.test(input.episode_id))) {
    throw new MemoryPackError('memory-scope-invalid', 'episode_id is invalid')
  }
  if (typeof input.purpose !== 'string' || input.purpose.length < 1 || input.purpose.length > 256) {
    throw new MemoryPackError('memory-scope-invalid', 'purpose is invalid')
  }
  if (
    typeof input.max_entries !== 'number' ||
    !Number.isInteger(input.max_entries) ||
    input.max_entries < 1 ||
    input.max_entries > 100
  ) {
    throw new MemoryPackError('memory-scope-invalid', 'max_entries must be 1..100')
  }

  const context = {
    workspace_id: workspaceId,
    episode_id: input.episode_id,
    role,
    run_id: runId,
    task_id: taskId,
    purpose: input.purpose,
    max_entries: input.max_entries
  }
  Object.defineProperty(context, TRUSTED_CONTEXT, { value: true, enumerable: false })
  return Object.freeze(context)
}

export function isTrustedMemoryPackContext(context) {
  return Boolean(context && typeof context === 'object' && context[TRUSTED_CONTEXT] === true)
}

// ------------------------------------------------------------------- mapping

function layerOf(entry) {
  const fm = entry?.parsed?.frontmatter ?? {}
  const type = String(fm.type ?? '').toLowerCase()
  if (type === 'positioning') return 'L1'
  if (type === 'workspace') return 'L2'
  if (type === 'workflow') return 'L3'
  if (type === 'memory') return 'L4'
  if (KB_TYPES.has(type) || type === 'harvest') return 'KB'
  const explicit = String(fm.layer ?? '').toUpperCase()
  return Object.prototype.hasOwnProperty.call(LAYER_ORDER, explicit) ? explicit : 'KB'
}

function packTypeOf(entry) {
  const fm = entry?.parsed?.frontmatter ?? {}
  const type = String(fm.type ?? '').toLowerCase()
  if (type === 'positioning') return 'reference'
  if (type === 'workspace') return 'map'
  if (type === 'workflow') return 'knowledge'
  if (type === 'memory') return scopeOf(entry).episodeId ? 'episode' : 'memory'
  if (type === 'harvest') return 'reference'
  if (KB_TYPES.has(type)) return 'knowledge'
  const declared = String(fm.pack_type ?? '').toLowerCase()
  return PACK_TYPES.has(declared) ? declared : 'knowledge'
}

function authorityOf(entry) {
  const raw = String(entry?.parsed?.frontmatter?.authority ?? '').trim().toLowerCase()
  return AUTHORITY_MAP[raw] ?? 'agent-observed'
}

function titleOf(entry, path) {
  const title = entry?.parsed?.frontmatter?.title
  if (typeof title === 'string' && title.trim() !== '') return title.trim().slice(0, 512)
  const base = path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/i, '')
  return (base || 'untitled').slice(0, 512)
}

function packSources(entry, access, index) {
  const specs = entry?.parsed?.frontmatter?.sources
  if (!Array.isArray(specs)) return []
  const out = []
  for (const raw of specs.slice(0, 50)) {
    const text = String(raw ?? '').trim()
    if (text === '') continue
    const at = text.lastIndexOf('@')
    const ref = at > 0 ? text.slice(0, at) : text
    let revision = at > 0 ? text.slice(at + 1) : ''
    const hash = ref.indexOf('#')
    const noteRaw = hash >= 0 ? ref.slice(0, hash) : ref
    let lookupNote
    let packNote
    try {
      lookupNote = normalizeRelPath(noteRaw)
      packNote = normalizePackRelPath(noteRaw)
    } catch {
      continue
    }
    if (ref.length > MAX_SOURCE_REF) continue
    // The filesystem key may be NFD while the pack identifier is NFC.
    const target = index.get(lookupNote) ?? index.get(packNote)
    if (target) {
      const decision = authorizeEntry(target, access, { includePending: false, allowUnmarked: false })
      if (!decision.allowed) continue
      if (revision === '') revision = revisionOf(target.parsed.body)
    } else if (packNote.startsWith('workspaces/') && !isOwnWorkspacePath(packNote, access)) {
      // A source path into another workspace is omitted even when the target is
      // missing: the path itself is the disclosure.
      continue
    }
    const suffix = hash >= 0 ? ref.slice(hash) : ''
    const source = { ref: `${packNote}${suffix}` }
    if (revision !== '') source.revision = revision.slice(0, 128)
    source.kind = packNote.toLowerCase().endsWith('.md') ? 'memory' : 'file'
    out.push(source)
  }
  return out
}

function countExcluded(decision, entry, excluded) {
  const review = reviewStateOf(entry)
  const status = statusOf(entry)
  if (decision.code === 'restricted' || review === 'restricted') {
    excluded.restricted++
    return
  }
  if (decision.code === 'visibility-unmarked') {
    excluded.unmarked++
    return
  }
  if (decision.code === 'review-not-approved') {
    excluded.pending++
    return
  }
  if (decision.code === 'review-rejected' || review === 'rejected' || status === 'rejected') {
    excluded.rejected++
    return
  }
  if (status === 'superseded') {
    excluded.superseded++
    return
  }
  if (status === 'retracted' || status === 'deleted') {
    // The frozen contract has no `retracted` bucket; an invalidated record is
    // reported as rejected rather than silently uncounted.
    excluded.rejected++
    return
  }
  // scope-missing / visibility-invalid / no-workspace: dropped, never counted.
  if (decision.code !== 'scope-missing' && decision.code !== 'visibility-invalid' && decision.code !== 'no-workspace') {
    excluded.rejected++
  }
}

function buildEntry(path, entry, access, index) {
  const visibility = visibilityOf(entry)
  if (!PACK_VISIBILITIES.has(visibility)) return { ok: false, reason: 'entry_invalid' }
  let normalizedPath
  try {
    normalizedPath = normalizePackRelPath(path)
  } catch {
    return { ok: false, reason: 'path_invalid' }
  }
  const scope = scopeOf(entry)
  const body = entry.parsed.body
  if (body.length > MAX_BODY) return { ok: false, reason: 'entry_invalid' }
  // Never invent the requester's workspace_id as the owner of an unscoped
  // user-global record. `global` is the explicit v1.1.0 sentinel.
  const workspaceId = scope.workspaceId ?? (visibility === 'user-global' ? GLOBAL_WORKSPACE_ID : null)
  if (workspaceId === null || !PACK_SCOPE_ID_PATTERN.test(workspaceId)) {
    return { ok: false, reason: 'entry_invalid' }
  }
  const episodeId = scope.episodeId
  if (episodeId !== null && !PACK_SCOPE_ID_PATTERN.test(episodeId)) {
    return { ok: false, reason: 'entry_invalid' }
  }
  const revision = revisionOf(body)
  const entryId = `mem_${sha256Json({ path: normalizedPath, revision }).slice(0, 32)}`
  return {
    ok: true,
    entry: {
      entry_id: entryId,
      path: normalizedPath,
      layer: layerOf(entry),
      type: packTypeOf(entry),
      title: titleOf(entry, normalizedPath),
      visibility,
      workspace_id: workspaceId,
      episode_id: episodeId,
      authority: authorityOf(entry),
      review_state: 'approved',
      revision,
      body,
      sources: packSources(entry, access, index),
      sha256: sha256Json({ path: normalizedPath, revision, body })
    }
  }
}

function sortForSnapshot(entries) {
  return [...entries].sort((left, right) => {
    if (left.path < right.path) return -1
    if (left.path > right.path) return 1
    return left.revision.localeCompare(right.revision)
  })
}

function sortForSelection(entries) {
  return [...entries].sort(
    (left, right) =>
      (LAYER_ORDER[left.layer] ?? 99) - (LAYER_ORDER[right.layer] ?? 99) || left.path.localeCompare(right.path)
  )
}

// -------------------------------------------------------------------- service

/**
 * @param {{
 *   vaultRoot: string,
 *   index?: import('../vault/index.js').VaultIndex,
 *   workspace?: {id?:string|null, episode?:string|null, registered?:boolean, disabled?:boolean, allowedRoles?:string[]}|null,
 *   workspaces?: Iterable<string>|Map<string,object>|null,
 *   now?: ()=>string,
 *   refreshOnGet?: boolean
 * }} options
 */
export function createMemoryPackService(options = {}) {
  const vaultRoot = typeof options.vaultRoot === 'string' ? options.vaultRoot.trim() : ''
  if (vaultRoot === '') throw new MemoryPackError('memory-scope-missing', 'vaultRoot is required')
  const index = options.index ?? new VaultIndex(vaultRoot)
  const ownsIndex = options.index === undefined
  const now = typeof options.now === 'function' ? options.now : () => new Date().toISOString()
  const refreshOnGet = options.refreshOnGet !== false
  const workspace = options.workspace && typeof options.workspace === 'object' ? options.workspace : null
  const workspaces = options.workspaces ?? null
  let ready = null

  async function ensureIndex() {
    if (ownsIndex) {
      if (ready === null) {
        ready = index.rebuild()
        await ready
      } else if (refreshOnGet) {
        await index.refresh()
      }
    } else if (refreshOnGet) {
      await index.refresh()
    }
  }

  function workspaceRegistered(workspaceId) {
    if (!workspaces) return true
    if (workspaces instanceof Map) {
      if (!workspaces.has(workspaceId)) return false
      const value = workspaces.get(workspaceId)
      if (value && typeof value === 'object') return value.enabled !== false && value.disabled !== true
      return true
    }
    if (typeof workspaces.has === 'function') return workspaces.has(workspaceId)
    if (!Array.isArray(workspaces) && typeof workspaces[Symbol.iterator] !== 'function') {
      if (!Object.prototype.hasOwnProperty.call(workspaces, workspaceId)) return false
      const value = workspaces[workspaceId]
      if (value && typeof value === 'object') return value.enabled !== false && value.disabled !== true
      return true
    }
    for (const item of workspaces) {
      if (typeof item === 'string' && item === workspaceId) return true
      if (item && typeof item === 'object' && item.id === workspaceId) {
        return item.enabled !== false && item.disabled !== true
      }
    }
    return false
  }

  function validateContext(context) {
    if (!isTrustedMemoryPackContext(context)) {
      throw new MemoryPackError('memory-context-untrusted', 'memory pack context was not created by the trusted host factory')
    }
    if (!workspaceRegistered(context.workspace_id)) {
      throw new MemoryPackError('memory-workspace-denied', 'workspace is not registered or is disabled')
    }
    if (workspace) {
      if (workspace.registered === false || workspace.disabled === true) {
        throw new MemoryPackError('memory-workspace-denied', 'workspace is not registered or is disabled')
      }
      if (typeof workspace.id === 'string' && workspace.id !== context.workspace_id) {
        throw new MemoryPackError('memory-workspace-denied', 'workspace does not match the service binding')
      }
      if (
        typeof workspace.episode === 'string' &&
        workspace.episode !== '' &&
        context.episode_id !== null &&
        workspace.episode !== context.episode_id
      ) {
        throw new MemoryPackError('memory-episode-denied', 'episode does not match the service binding')
      }
      if (Array.isArray(workspace.allowedRoles) && !workspace.allowedRoles.includes(context.role)) {
        throw new MemoryPackError('memory-role-denied', 'role is not allowed in this workspace')
      }
    }
  }

  async function getPack(context, getOptions = {}) {
    validateContext(context)
    try {
      await ensureIndex()

      const accessWorkspace = {
        id: context.workspace_id,
        episode: context.episode_id,
        role: context.role === 'orchestrator' ? 'coordinator' : 'worker'
      }
      const access = makeAccess({
        workspace: accessWorkspace,
        binding: {
          workspaceId: context.workspace_id,
          episodeId: context.episode_id,
          role: context.role,
          runId: context.run_id
        }
      })

      const excluded = {
        pending: 0,
        rejected: 0,
        superseded: 0,
        restricted: 0,
        unmarked: 0,
        path_invalid: 0,
        entry_invalid: 0
      }
      const included = []
      for (const path of index.paths()) {
        const entry = index.get(path)
        if (!entry) continue
        const decision = authorizeEntry(entry, access, { includePending: false, allowUnmarked: false })
        if (!decision.allowed) {
          if (inAuthorizedSlice(entry, access)) countExcluded(decision, entry, excluded)
          continue
        }
        const built = buildEntry(path, entry, access, index)
        if (built.ok) included.push(built.entry)
        else excluded[built.reason]++
      }

      const selected = sortForSelection(included).slice(0, context.max_entries)
      const scope = { workspace_id: context.workspace_id, episode_id: context.episode_id }
      const snapshotHash = sha256Json({
        contract_version: MEMORYPACK_CONTRACT_VERSION,
        scope,
        role: context.role,
        entries: sortForSnapshot(selected)
      })
      if (
        typeof getOptions.expectedSnapshotHash === 'string' &&
        getOptions.expectedSnapshotHash !== '' &&
        getOptions.expectedSnapshotHash !== snapshotHash
      ) {
        throw new MemoryPackError('memory-snapshot-mismatch', 'snapshot hash does not match the requested snapshot')
      }
      const snapshotId = `mp_${snapshotHash.slice(0, 32)}`
      const pack = {
        contract_version: MEMORYPACK_CONTRACT_VERSION,
        snapshot_id: snapshotId,
        snapshot_hash: snapshotHash,
        generated_at: now(),
        read_only: true,
        scope,
        role: context.role,
        run_id: context.run_id,
        entries: selected,
        excluded,
        source: { vault: 'dsh-memory', contract_version: MEMORYPACK_CONTRACT_VERSION },
        policy: {
          authorized_before_retrieval: true,
          cross_workspace: selected.some(
            (entry) => entry.visibility === 'user-global' && entry.workspace_id !== context.workspace_id
          )
        }
      }
      return deepFreeze(pack)
    } catch (error) {
      if (error instanceof MemoryPackError) throw error
      // Never let an unexpected error (which may contain a filesystem path) cross
      // the pack boundary.
      throw new MemoryPackError('memory-internal-error', 'memory pack generation failed')
    }
  }

  async function createPackRef(workspaceId, episodeId, role) {
    if (typeof workspaceId !== 'string' || !PACK_SCOPE_ID_PATTERN.test(workspaceId) || !ROLE_SET.has(role)) {
      throw new MemoryPackError('memory-scope-invalid', 'pack reference arguments are invalid')
    }
    if (episodeId !== null && (typeof episodeId !== 'string' || !PACK_SCOPE_ID_PATTERN.test(episodeId))) {
      throw new MemoryPackError('memory-scope-invalid', 'episode_id is invalid')
    }
    const context = createMemoryPackContext({
      workspace_id: workspaceId,
      episode_id: episodeId,
      role,
      run_id: DEFAULT_SNAPSHOT_RUN,
      task_id: 'main',
      purpose: 'phase-snapshot-ref',
      max_entries: 100
    })
    const pack = await getPack(context)
    return {
      snapshot_id: pack.snapshot_id,
      snapshot_hash: pack.snapshot_hash,
      workspace_id: workspaceId,
      episode_id: episodeId
    }
  }

  return {
    getPack,
    createPackRef,
    refresh: async () => {
      if (ownsIndex) {
        if (ready === null) {
          ready = index.rebuild()
          await ready
        } else {
          await index.refresh()
        }
      } else {
        await index.refresh()
      }
    },
    get index() {
      return index
    }
  }
}

/** Reject a pack whose contract version is not the frozen one. */
export function assertMemoryPackContractVersion(pack) {
  if (
    !pack ||
    pack.contract_version !== MEMORYPACK_CONTRACT_VERSION ||
    pack.source?.contract_version !== MEMORYPACK_CONTRACT_VERSION
  ) {
    throw new MemoryPackError('memory-contract-version', 'memory pack contract version mismatch')
  }
}
