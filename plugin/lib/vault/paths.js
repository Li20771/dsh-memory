// Vault path safety: repo-relative normalization and root containment.
//
// Every path that reaches the filesystem from a tool argument or from a note's
// frontmatter goes through here. The rules are deliberately strict: a path that
// is merely "normalizable" is not accepted, because `a/../b` is how a traversal
// test and a traversal bug look the same in a log. Rejecting it outright keeps
// the invariant checkable.
//
// Path traversal tests must only compute and assert containment. They must never
// write to the escape target.
//
// @module dsh-memory/vault/paths

import { realpath } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'

export class PathDenied extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'PathDenied'
    this.code = code
  }
}

const CONTROL = /[\u0000-\u001f\u007f]/

/** Windows drive/UNC forms, rejected on every platform so a vault stays portable. */
function looksAbsolute(value) {
  return (
    isAbsolute(value) ||
    /^[A-Za-z]:/.test(value) ||
    value.startsWith('\\\\') ||
    value.startsWith('//')
  )
}

/**
 * Normalize a repo-relative vault path to POSIX form.
 *
 * Rejects absolute paths, drive letters, UNC paths, NUL/control characters,
 * empty segments that resolve to nothing, `..`, `.` segments, and Windows
 * alternate-data-stream separators. Backslashes are treated as separators so a
 * Windows caller cannot smuggle a path past a forward-slash check.
 *
 * @param {unknown} input
 * @param {{allowEmpty?:boolean}} [options]
 * @returns {string}
 */
export function normalizeRelPath(input, options = {}) {
  if (typeof input !== 'string') {
    throw new PathDenied('path-not-string', '路径必须是字符串。')
  }
  const raw = input.trim()
  if (raw === '') {
    if (options.allowEmpty === true) return ''
    throw new PathDenied('path-empty', '路径不能为空。')
  }
  if (CONTROL.test(raw)) {
    throw new PathDenied('path-control-char', '路径包含控制字符。')
  }
  const slashed = raw.replace(/\\/g, '/')
  if (looksAbsolute(slashed)) {
    throw new PathDenied('path-absolute', '只接受 vault 相对路径，不接受绝对路径。')
  }
  const out = []
  for (const segment of slashed.split('/')) {
    if (segment === '') continue
    if (segment === '.' || segment === '..') {
      throw new PathDenied('path-traversal', '路径不得包含 . 或 .. 段。')
    }
    if (segment.includes(':')) {
      throw new PathDenied('path-ads', '路径段不得包含冒号（Windows 备用数据流）。')
    }
    out.push(segment)
  }
  if (out.length === 0) {
    if (options.allowEmpty === true) return ''
    throw new PathDenied('path-empty', '路径不能为空。')
  }
  return out.join('/')
}

/** Whether `abs` is inside `root` (or equal to it). */
export function isContained(root, abs) {
  const rootAbs = resolve(root)
  const target = resolve(abs)
  const rel = relative(rootAbs, target)
  if (rel === '') return true
  if (isAbsolute(rel)) return false
  const escaped = rel === '..' || rel.startsWith(`..${sep}`)
  if (process.platform === 'win32') {
    // path.relative already handles drives; the lowercase comparison covers the
    // case-insensitive filesystem without changing Linux semantics.
    return !escaped && !rel.toLowerCase().startsWith(`..${sep}`)
  }
  return !escaped
}

/**
 * Resolve a vault-relative path and prove it is contained by the vault root.
 *
 * For reads (`mustExist`) the target and every existing ancestor are checked
 * with `realpath`, so a symlink cannot point outside the vault. For writes the
 * nearest existing ancestor is checked; the final file may not exist yet.
 *
 * @param {string} vaultRoot
 * @param {string} rel
 * @param {{mustExist?:boolean}} [options]
 * @returns {Promise<{abs:string, rel:string, root:string}>}
 */
export async function resolveVaultPath(vaultRoot, rel, options = {}) {
  const normalized = normalizeRelPath(rel)
  const rootInput = String(vaultRoot ?? '').trim()
  if (rootInput === '') throw new PathDenied('vault-root-empty', 'vault root 未配置。')
  const root = resolve(rootInput)
  const abs = resolve(root, ...normalized.split('/'))
  if (!isContained(root, abs)) {
    throw new PathDenied('path-escape', '路径逃出 vault root。')
  }

  const realRoot = await realpath(root).catch(() => root)
  if (options.mustExist === true) {
    const real = await realpath(abs).catch(() => null)
    if (real === null) throw new PathDenied('path-not-found', '目标不存在。')
    if (!isContained(realRoot, real)) {
      throw new PathDenied('path-symlink-escape', '目标经符号链接逃出 vault root。')
    }
    return { abs: real, rel: normalized, root: realRoot }
  }

  // Walk to the nearest existing ancestor, but stop at the vault root. A
  // symlinked parent that escapes is rejected before a new file can be created
  // underneath it. If the root itself does not exist yet, lexical containment
  // above is the whole check — there is no real path inside it to follow.
  let probe = abs
  while (isContained(root, probe)) {
    let real = null
    try {
      real = await realpath(probe)
    } catch (error) {
      // Permission/IO errors are not proof of absence. Treating them as "missing"
      // would let an unreadable symlinked ancestor through, so fail closed.
      if (error?.code !== 'ENOENT') {
        throw new PathDenied('path-unresolvable', '无法解析路径祖先。')
      }
    }
    if (real !== null) {
      if (!isContained(realRoot, real)) {
        throw new PathDenied('path-symlink-escape', '父目录经符号链接逃出 vault root。')
      }
      break
    }
    const parent = dirname(probe)
    if (parent === probe) break
    probe = parent
  }
  return { abs, rel: normalized, root: realRoot }
}

/** Validate a workspace/episode identifier used as one path segment. */
export function safeScopeId(value) {
  const s = String(value ?? '').trim()
  // No `:`: on Windows it separates an alternate data stream, and a scope id is
  // used as a path segment. Legacy ids may use upper case; new Fleet ids are
  // lower-case (the pack contract is stricter and validated separately).
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(s)) {
    throw new PathDenied('scope-invalid', 'scope id 非法。')
  }
  if (s.includes('..') || s.endsWith('.')) {
    throw new PathDenied('scope-invalid', 'scope id 非法。')
  }
  return s
}

/** Contract-level workspace/episode id (MemoryPack v1). */
export const PACK_SCOPE_ID_PATTERN = /^[a-z][a-z0-9_-]{1,63}$/

/** Contract-level run id (MemoryPack v1 / Fleet binding). */
export const PACK_RUN_ID_PATTERN = /^run_[A-Za-z0-9_-]{8,96}$/

/** Contract-level task id (Fleet registry). */
export const PACK_TASK_ID_PATTERN = /^[a-z][a-z0-9_]{1,63}$/

/** Maximum MemoryPack path length, matching the v1.1.0 schema. */
export const PACK_PATH_MAX = 512

/**
 * Normalize a MemoryPack v1.1.0 path.
 *
 * The pack path is a canonical identifier, not a filesystem path: NFC Unicode,
 * POSIX `/` separators, no absolute/drive/UNC forms, no `.`/`..`/empty segments,
 * no backslash, no ADS colon and no control characters. Containment and symlink
 * resolution are performed separately against the vault root.
 *
 * @param {unknown} input
 * @returns {string} NFC-normalized repo-relative POSIX path
 */
export function normalizePackRelPath(input) {
  if (typeof input !== 'string') {
    throw new PathDenied('pack-path-not-string', 'MemoryPack 路径必须是字符串。')
  }
  if (input === '') throw new PathDenied('pack-path-empty', 'MemoryPack 路径不能为空。')
  if (input.length > PACK_PATH_MAX) throw new PathDenied('pack-path-too-long', 'MemoryPack 路径过长。')
  if (CONTROL.test(input)) throw new PathDenied('pack-path-control-char', 'MemoryPack 路径包含控制字符。')
  if (input.includes('\\')) throw new PathDenied('pack-path-backslash', 'MemoryPack 路径必须使用 / 分隔。')
  if (input.startsWith('/') || /^[A-Za-z]:/.test(input)) {
    throw new PathDenied('pack-path-absolute', 'MemoryPack 路径必须是 vault 相对路径。')
  }
  const normalized = input.normalize('NFC')
  if (normalized.length > PACK_PATH_MAX) throw new PathDenied('pack-path-too-long', 'MemoryPack 路径过长。')
  const segments = normalized.split('/')
  for (const segment of segments) {
    if (segment === '' || segment === '.' || segment === '..') {
      throw new PathDenied('pack-path-segment', 'MemoryPack 路径不得包含空、. 或 .. 段。')
    }
    if (segment.includes(':')) {
      throw new PathDenied('pack-path-ads', 'MemoryPack 路径段不得包含冒号（Windows ADS）。')
    }
  }
  return segments.join('/')
}

/**
 * Parse `ws` or `ws/episode` into validated identifiers.
 * @param {unknown} value
 * @returns {{workspaceId:string, episodeId:string|null, raw:string}|null}
 */
export function normalizeScope(value) {
  if (typeof value !== 'string') return null
  const raw = value.trim()
  if (raw === '') return null
  const parts = raw.split('/')
  if (parts.length > 2) return null
  try {
    const workspaceId = safeScopeId(parts[0])
    const episodeId = parts.length === 2 ? safeScopeId(parts[1]) : null
    return { workspaceId, episodeId, raw: episodeId ? `${workspaceId}/${episodeId}` : workspaceId }
  } catch {
    return null
  }
}
