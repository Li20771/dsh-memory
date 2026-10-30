// Read authorization for the memory vault.
//
// One function decides whether a caller may read one note, and every read path
// uses it BEFORE retrieval, ranking, top-k, citation lookup or diagnostics. The
// ordering matters: filtering after top-k lets a foreign record consume a slot;
// filtering after IDF lets it influence the ranking of records the caller can
// see. Both are leaks even when the foreign text never appears.
//
// The caller's identity comes from the host-bound workspace/session (and an
// optional trusted `binding` supplied by the host/Fleet), never from a tool
// argument. `allScopes` and `scope` cannot widen it.
//
// @module dsh-memory/memory/access

import { normalizeRelPath, normalizeScope, safeScopeId } from '../vault/paths.js'

export const VISIBILITIES = ['user-global', 'workspace-shared', 'episode-shared', 'run-private', 'restricted']

export const ROLES = ['orchestrator', 'researcher', 'vehicle_analyst', 'challenger', 'evidence_verifier', 'lab_runner']

const VISIBILITY_SET = new Set(VISIBILITIES)
const ROLE_SET = new Set(ROLES)
const INACTIVE_STATUSES = new Set(['retracted', 'superseded', 'rejected', 'deleted'])

/** Notes that govern the vault itself and carry no claim to review. */
export const GOVERNANCE_TYPES = new Set(['positioning', 'workspace'])

/**
 * Frontmatter `visibility`, or `unmarked`.
 *
 * v1.1.0 deliberately does NOT infer visibility from note type. A legacy note
 * without an explicit `visibility` field is `unmarked`: it may be surfaced by the
 * read-only migration inventory, but it does not enter worker recall/MemoryPack
 * until the Curator assigns a visibility.
 */
export function visibilityOf(entry) {
  const fm = entry?.parsed?.frontmatter ?? {}
  const explicit = String(fm.visibility ?? '').trim().toLowerCase()
  if (explicit !== '') return VISIBILITY_SET.has(explicit) ? explicit : 'invalid'
  return 'unmarked'
}

function validId(value) {
  if (value === null || value === undefined) return null
  try {
    return safeScopeId(value)
  } catch {
    return null
  }
}

/** Scope identifiers attached to a note (validated, or null). */
export function scopeOf(entry) {
  const fm = entry?.parsed?.frontmatter ?? {}
  const rawScope = fm.scope
  const scope = normalizeScope(rawScope)
  const rawEpisode = fm.episode
  const episode = scope?.episodeId ?? validId(rawEpisode)
  const invalid =
    (rawScope !== undefined && rawScope !== null && String(rawScope).trim() !== '' && scope === null) ||
    (rawEpisode !== undefined && rawEpisode !== null && String(rawEpisode).trim() !== '' && episode === null)
  return {
    workspaceId: scope?.workspaceId ?? null,
    episodeId: episode ?? null,
    raw: scope?.raw ?? null,
    invalid
  }
}

/**
 * Review state, normalized.
 *
 * A missing review field is legacy, not an explicit `pending`: the pre-Fleet
 * vault has whole layers (L1/L2/L3/KB) that predate review. Treating them all as
 * pending would silently amputate those layers for workers. Episode memory (L4)
 * is new enough that a missing review is fail-closed pending.
 */
export function reviewStateOf(entry) {
  const fm = entry?.parsed?.frontmatter ?? {}
  const review = fm.review
  const type = String(fm.type ?? '').toLowerCase()
  if (review === undefined || review === null || review === '') {
    return type === 'memory' ? 'pending' : 'approved'
  }
  const state = typeof review === 'object' ? review.state : review
  const normalized = String(state ?? '').trim().toLowerCase()
  if (normalized !== '') return normalized
  return type === 'memory' ? 'pending' : 'approved'
}

export function statusOf(entry) {
  return String(entry?.parsed?.frontmatter?.status ?? 'active').trim().toLowerCase() || 'active'
}

/** Run id attached to a note (run-private records). */
export function runIdOf(entry) {
  const fm = entry?.parsed?.frontmatter ?? {}
  const value = fm.run_id ?? fm.runId ?? fm.origin?.run
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * Bind one session to an access context.
 *
 * `workspace` is the marker-resolved workspace (legacy/trusted host state).
 * `binding` is a host/Fleet TrustedBinding. It is optional, but when present it
 * is authoritative: a marker coordinator list cannot upgrade a worker binding,
 * and a workspace/episode mismatch fails closed.
 *
 * @param {{workspace?: object|null, binding?: object|null}} input
 */
export function makeAccess(input = {}) {
  const workspace = input.workspace ?? null
  const rawBinding = input.binding && typeof input.binding === 'object' && !Array.isArray(input.binding) ? input.binding : null

  let bindingInvalid = rawBinding !== null && (rawBinding.trusted === false || rawBinding.__untrusted === true)
  const bindingWorkspace = rawBinding
    ? String(rawBinding.workspaceId ?? rawBinding.workspace_id ?? '').trim() || null
    : null
  const bindingEpisodeRaw = rawBinding ? rawBinding.episodeId ?? rawBinding.episode_id : null
  const bindingEpisode = bindingEpisodeRaw === null || bindingEpisodeRaw === undefined ? null : String(bindingEpisodeRaw).trim() || null
  const bindingRun = rawBinding ? String(rawBinding.runId ?? rawBinding.run_id ?? '').trim() || null : null
  const bindingSession = rawBinding ? String(rawBinding.sessionId ?? rawBinding.session_id ?? '').trim() || null : null
  const bindingRoleRaw = rawBinding ? String(rawBinding.role ?? '').trim().toLowerCase() : ''
  const bindingRole = bindingRoleRaw === '' ? null : bindingRoleRaw

  if (rawBinding) {
    if (bindingWorkspace === null) bindingInvalid = true
    if (bindingRole !== null && !ROLE_SET.has(bindingRole)) bindingInvalid = true
    if (bindingWorkspace !== null) {
      try {
        safeScopeId(bindingWorkspace)
      } catch {
        bindingInvalid = true
      }
    }
    if (bindingEpisode !== null) {
      try {
        safeScopeId(bindingEpisode)
      } catch {
        bindingInvalid = true
      }
    }
  }

  const workspaceId = bindingWorkspace ?? (workspace?.id ?? null)
  const workspaceEpisode = workspace?.episode ?? null
  if (workspaceId !== null) {
    try {
      safeScopeId(workspaceId)
    } catch {
      bindingInvalid = true
    }
  }
  const episodeId = bindingEpisode ?? workspaceEpisode
  const workspaceMismatch =
    bindingWorkspace !== null && workspace?.id !== null && workspace?.id !== undefined && bindingWorkspace !== workspace.id
  const episodeMismatch = bindingEpisode !== null && workspaceEpisode !== null && bindingEpisode !== workspaceEpisode
  const bindingMismatch = bindingInvalid || workspaceMismatch || episodeMismatch

  // A binding cannot upgrade a worker to coordinator: coordinator status comes
  // from the binding role (or, without a binding, from the workspace marker).
  const role = bindingRole ?? (workspace?.role === 'coordinator' ? 'orchestrator' : 'worker')
  const isCoordinator = bindingRole !== null ? bindingRole === 'orchestrator' : workspace?.role === 'coordinator'

  return Object.freeze({
    workspaceId: workspaceId ?? null,
    episodeId: episodeId ?? null,
    runId: bindingRun,
    sessionId: bindingSession ?? (typeof input.sessionId === 'string' ? input.sessionId.trim() || null : null),
    role,
    isCoordinator,
    bindingWorkspaceId: bindingWorkspace,
    bindingEpisodeId: bindingEpisode,
    bindingMismatch,
    bindingInvalid,
    workspaceRoot: workspace?.root ?? null,
    workspace
  })
}

/**
 * Read a host/Fleet binding from trusted execution context only.
 *
 * Tool arguments are never inspected: a model cannot set these properties on the
 * `exec` object it is given. The names below are host integration points; a
 * worker cannot self-report identity through them.
 */
export function hostBindingOf(exec) {
  const candidates = [
    exec?.hostContext?.memoryBinding,
    exec?.hostContext?.fleetBinding,
    exec?.hostContext?.binding,
    exec?.agent?.hostContext?.memoryBinding,
    exec?.agent?.hostContext?.fleetBinding,
    exec?.agent?.hostContext?.binding,
    exec?.agent?.fleetContext,
    exec?.fleetContext
  ]
  for (const candidate of candidates) {
    if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) return candidate
  }
  return null
}

/** Stable key for per-access corpus caching. */
export function accessKey(access) {
  return [
    access?.workspaceId ?? '',
    access?.episodeId ?? '',
    access?.runId ?? '',
    access?.sessionId ?? '',
    access?.role ?? '',
    access?.isCoordinator ? 'coordinator' : 'worker',
    access?.bindingMismatch ? 'mismatch' : 'ok'
  ].join('|')
}

/** Corpus cache key including the policy switches that change the visible set. */
export function corpusKeyFor(access, options = {}) {
  return `${accessKey(access)}|pending:${options.includePending === true ? 1 : 0}|unmarked:${options.allowUnmarked === true ? 1 : 0}`
}

/**
 * Whether a note is in the caller's authorized scope slice for counting purposes.
 *
 * This is deliberately narrower than "exists in the vault": foreign records must
 * not contribute to `excluded` counts, diagnostics or statistics. A missing or
 * invalid scope is dropped and never counted.
 */
export function inAuthorizedSlice(entry, access) {
  const visibility = visibilityOf(entry)
  const scope = scopeOf(entry)
  if (visibility === 'invalid') return false
  if (visibility === 'user-global') return true
  if (visibility === 'workspace-shared' || visibility === 'episode-shared' || visibility === 'restricted') {
    if (!scope.workspaceId || scope.workspaceId !== access?.workspaceId) return false
    if (visibility === 'episode-shared') {
      return scope.episodeId !== null && scope.episodeId === access?.episodeId
    }
    return true
  }
  if (visibility === 'run-private') {
    if (!access?.runId) return false
    if (runIdOf(entry) !== access.runId) return false
    return !scope.workspaceId || scope.workspaceId === access?.workspaceId
  }
  if (visibility === 'unmarked') {
    // Unscoped legacy records are not counted in worker packs; same-workspace
    // scoped records are counted as `unmarked` so the omission is visible.
    if (scope.invalid) return false
    return scope.workspaceId !== null && scope.workspaceId === access?.workspaceId
  }
  return false
}

/**
 * Decide whether one note is readable.
 *
 * `includePending`, `allowInactive` and `allowUnmarked` are trusted policy
 * switches a coordinator tool may pass; workers never get them. MemoryPack
 * generation never passes `allowUnmarked`.
 *
 * @param {object} entry
 * @param {ReturnType<typeof makeAccess>} access
 * @param {{includePending?:boolean, allowInactive?:boolean, allowUnmarked?:boolean}} [options]
 * @returns {{allowed:boolean, code:string, visibility:string, reason:string}}
 */
export function authorizeEntry(entry, access, options = {}) {
  const visibility = visibilityOf(entry)
  const scope = scopeOf(entry)
  const deny = (code, reason) => ({ allowed: false, code, visibility, reason })
  const allow = (code = 'allowed') => ({ allowed: true, code, visibility, reason: '' })

  if (!entry || !entry.parsed) return deny('no-entry', '记录不可解析。')
  if (!access) return deny('no-access', '没有可信访问上下文。')
  if (access.bindingMismatch) return deny('binding-mismatch', 'host 绑定与当前工作区不一致。')
  if (visibility === 'invalid') return deny('visibility-invalid', 'visibility 非法。')
  if (!access.workspaceId && visibility !== 'user-global') {
    return deny('no-workspace', '当前会话没有可信工作区。')
  }

  if (visibility === 'restricted' || reviewStateOf(entry) === 'restricted') {
    return deny('restricted', 'restricted 记录不进入普通读取。')
  }
  if (INACTIVE_STATUSES.has(statusOf(entry))) {
    // Ordinary recall/pack never sees inactive records. A coordinator doing
    // management (supersede conflict detection, forget/review) may explicitly
    // ask for them; a worker never can.
    if (!(access.isCoordinator && options.allowInactive === true)) {
      return deny('status-inactive', '记录已失效。')
    }
  }

  if (visibility === 'user-global') {
    // user-global is the only cross-workspace visibility. Review still applies.
    // A malformed scope on a global record is still fail-closed.
    if (scope.invalid) return deny('scope-invalid', 'scope 非法。')
  } else if (visibility === 'workspace-shared') {
    if (scope.invalid) return deny('scope-invalid', 'scope 非法。')
    if (scope.workspaceId === null) return deny('scope-missing', 'scope 缺失或非法。')
    if (scope.workspaceId !== access.workspaceId) return deny('workspace-foreign', '记录属于其他工作区。')
  } else if (visibility === 'episode-shared') {
    if (scope.invalid) return deny('scope-invalid', 'scope 非法。')
    if (scope.workspaceId === null) return deny('scope-missing', 'scope 缺失或非法。')
    if (scope.workspaceId !== access.workspaceId) return deny('workspace-foreign', '记录属于其他工作区。')
    if (scope.episodeId === null || access.episodeId === null || scope.episodeId !== access.episodeId) {
      return deny('episode-foreign', '记录属于其他 episode 或缺少 episode。')
    }
  } else if (visibility === 'run-private') {
    if (scope.invalid) return deny('scope-invalid', 'scope 非法。')
    if (access.runId === null) return deny('run-missing', '当前会话没有可信 run。')
    const noteRun = runIdOf(entry)
    if (noteRun === '' || noteRun !== access.runId) return deny('run-private', '记录只属于另一个 run。')
    if (scope.workspaceId !== null && scope.workspaceId !== access.workspaceId) {
      return deny('workspace-foreign', '记录属于其他工作区。')
    }
  } else if (visibility === 'unmarked') {
    if (scope.invalid) return deny('scope-invalid', 'scope 非法。')
    if (scope.workspaceId !== null && scope.workspaceId !== access.workspaceId) {
      return deny('workspace-foreign', '记录属于其他工作区。')
    }
    if (scope.episodeId !== null && scope.episodeId !== access.episodeId) {
      return deny('episode-foreign', '记录属于其他 episode。')
    }
    if (!(access.isCoordinator && options.allowUnmarked === true)) {
      return deny('visibility-unmarked', '旧记录没有显式 visibility，迁移前不进入普通读取。')
    }
  } else {
    return deny('visibility-invalid', 'visibility 非法。')
  }

  // Review gating. Positioning/workspace maps are governance notes; they carry no
  // claim to approve, and the legacy vault has no review field on them.
  const type = String(entry.parsed.frontmatter?.type ?? '').toLowerCase()
  if (!GOVERNANCE_TYPES.has(type)) {
    const review = reviewStateOf(entry)
    if (review === 'rejected') return deny('review-rejected', '记录已被拒绝。')
    if (review !== 'approved') {
      if (!(access.isCoordinator && options.includePending === true)) {
        return deny('review-not-approved', '记录尚未批准，普通 recall 不返回。')
      }
    }
  }

  return allow()
}

/** All readable entries, computed before any retrieval or ranking. */
export function visibleEntries(index, access, options = {}) {
  const entries = []
  const excluded = { pending: 0, rejected: 0, superseded: 0, restricted: 0, unmarked: 0, unauthorized: 0 }
  for (const path of index.paths()) {
    const entry = index.get(path)
    if (!entry) continue
    const decision = authorizeEntry(entry, access, options)
    if (decision.allowed) {
      entries.push([path, entry])
      continue
    }
    if (!inAuthorizedSlice(entry, access)) continue
    if (decision.code === 'review-not-approved') {
      if (reviewStateOf(entry) === 'rejected') excluded.rejected++
      else excluded.pending++
    } else if (decision.code === 'review-rejected') {
      excluded.rejected++
    } else if (decision.code === 'restricted') {
      excluded.restricted++
    } else if (decision.code === 'status-inactive') {
      if (statusOf(entry) === 'superseded') excluded.superseded++
      else excluded.rejected++
    } else if (decision.code === 'visibility-unmarked') {
      excluded.unmarked++
    } else {
      excluded.unauthorized++
    }
  }
  return { entries, excluded }
}

/**
 * Authorize a citation by path before resolving it.
 *
 * Foreign, missing and unauthorized paths all return `unavailable`, so a caller
 * cannot distinguish "does not exist" from "exists but is not yours". A missing
 * path inside the caller's own workspace namespace may still report `missing`,
 * because that namespace is already known to the caller.
 */
export function authorizeCitation(index, citation, access, options = {}) {
  const raw = String(citation?.note ?? '').trim()
  if (raw === '') {
    return { status: 'unavailable', entry: null, path: null, decision: { allowed: false, code: 'citation-empty' } }
  }
  let note
  try {
    note = normalizeRelPath(raw)
  } catch {
    return { status: 'unavailable', entry: null, path: null, decision: { allowed: false, code: 'citation-invalid' } }
  }
  let entry
  try {
    entry = index.get(note)
  } catch {
    entry = undefined
  }
  if (!entry) {
    // A missing path outside the `workspaces/` namespace (KB, L3, L1) is safe to
    // report as missing: the caller already named it, and it is not a foreign
    // workspace record. Only `workspaces/<other>/...` must stay indistinguishable
    // from unauthorized.
    const foreignNamespace = note.startsWith('workspaces/') && !isOwnWorkspacePath(note, access)
    return {
      status: foreignNamespace ? 'unavailable' : 'missing',
      entry: null,
      path: note,
      decision: { allowed: false, code: 'missing' }
    }
  }
  const decision = authorizeEntry(entry, access, options)
  if (!decision.allowed) return { status: 'unavailable', entry: null, path: note, decision }
  return { status: 'authorized', entry, path: note, decision }
}

/** Authorize a direct path lookup (management tools, not search). */
export function authorizePath(index, raw, access, options = {}) {
  let note
  try {
    note = normalizeRelPath(raw)
  } catch {
    return { status: 'invalid', entry: null, decision: { allowed: false, code: 'path-invalid' }, path: null }
  }
  const entry = index.get(note)
  if (!entry) {
    const foreignNamespace = note.startsWith('workspaces/') && !isOwnWorkspacePath(note, access)
    return {
      status: foreignNamespace ? 'unavailable' : 'missing',
      entry: null,
      decision: { allowed: false, code: 'missing' },
      path: note
    }
  }
  const decision = authorizeEntry(entry, access, options)
  if (!decision.allowed) return { status: 'unavailable', entry: null, decision, path: note }
  return { status: 'authorized', entry, decision, path: note }
}

/** Whether a path is inside the caller's own workspace namespace. */
export function isOwnWorkspacePath(notePath, access) {
  if (!access?.workspaceId) return false
  const raw = String(notePath ?? '')
  try {
    safeScopeId(access.workspaceId)
  } catch {
    return false
  }
  return raw.startsWith(`workspaces/${access.workspaceId}/`) || raw === `workspaces/${access.workspaceId}.md`
}

/** Map a plugin access role to the frozen MemoryPack role enum, or null. */
export function packRoleOf(access) {
  if (access?.role && ROLE_SET.has(access.role)) return access.role
  if (access?.isCoordinator) return 'orchestrator'
  return null
}
