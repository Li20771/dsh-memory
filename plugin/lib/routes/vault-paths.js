// vault-paths.js — "is this caller-supplied path inside the vault?" in one place.
//
// The contract (build-contract §3) says every path parameter must stay inside
// `vaultRoot`, and an escape is a 400 — not a 404, not a silent empty note. Three
// distinct escapes have to be closed, and each has its own reason:
//
//   1. `..` and friends — `projects/../../x.md` reaches out lexically. Rejected
//      by normalizing components ourselves instead of trusting `path.resolve`
//      (which would happily return a path outside, leaving every caller to
//      re-check it).
//   2. Absolute paths — `/etc/passwd`, `C:\Windows\win.ini`, `\\server\share`.
//      A note id in this vault is ALWAYS repo-relative, so an absolute path is
//      never a valid id, whatever it points at.
//   3. Symlinks — a link INSIDE the vault that points outside passes both checks
//      above. `realpath` of the deepest existing ancestor is what closes it.
//
// Backslashes are unified to `/` before normalizing: on Windows `..\..\x` is the
// traversal a caller actually types, and treating it as one flat component would
// have let it through.
//
// @module dsh-memory/routes/vault-paths

import { realpath } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'

/** The contract's literal refusal reason. */
export const OUTSIDE_VAULT = 'path outside vault'

/** `{ ok:false, error:'bad-request' }` — a missing or unusable parameter. */
const BAD = { ok: false, error: 'bad-request' }
const OUTSIDE = { ok: false, error: OUTSIDE_VAULT }

const realOrNull = async (path) => {
  try {
    return await realpath(path)
  } catch {
    return null
  }
}

/** Whether `target` is `root` itself or below it, comparing resolved paths. */
function isInside(root, target) {
  const rel = relative(root, target)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/**
 * Normalize a caller-supplied note id to a repo-relative posix path.
 * @returns {{ok:true, rel:string} | {ok:false, error:string}}
 */
export function normalizeVaultPath(raw) {
  if (typeof raw !== 'string') return BAD
  const text = raw.trim()
  if (text === '') return BAD
  if (text.includes('\u0000')) return OUTSIDE
  const unified = text.replace(/\\/g, '/')
  // Absolute in any of its three shapes is never a note id.
  if (unified.startsWith('/')) return OUTSIDE
  if (/^[A-Za-z]:/.test(unified)) return OUTSIDE
  const parts = []
  for (const segment of unified.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      if (parts.length === 0) return OUTSIDE
      parts.pop()
      continue
    }
    parts.push(segment)
  }
  if (parts.length === 0) return BAD
  return { ok: true, rel: parts.join('/') }
}

/**
 * Normalize AND prove containment on disk (symlink-aware).
 * @returns {Promise<{ok:true, rel:string, abs:string} | {ok:false, error:string}>}
 */
export async function resolveVaultPath(vaultRoot, raw) {
  const normalized = normalizeVaultPath(raw)
  if (!normalized.ok) return normalized
  const rootAbs = resolve(vaultRoot)
  const abs = join(rootAbs, ...normalized.rel.split('/'))
  if (!isInside(rootAbs, abs)) return OUTSIDE

  // `abs` may not exist (that is a 404, decided by the caller). Containment is
  // therefore checked against the deepest ancestor that does exist.
  let probe = abs
  for (let depth = 0; depth < 64; depth++) {
    const real = await realOrNull(probe)
    if (real !== null) {
      const rootReal = (await realOrNull(rootAbs)) ?? rootAbs
      if (!isInside(rootReal, real)) return OUTSIDE
      break
    }
    const parent = dirname(probe)
    if (parent === probe) break
    probe = parent
  }
  return { ok: true, rel: normalized.rel, abs }
}