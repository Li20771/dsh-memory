// Workspace resolution: cwd -> workspace root -> marker -> role/switch.
//
// The marker lives INSIDE the workspace (`.dsh/memory.json`), not in DSH config,
// because the requirement is portability: clone the workspace on another machine
// and its memory switch comes with it.
//
// Authority model, stated plainly: the marker is a cooperative control. Adding a
// session to `coordinators` grants coordinator rights; a session NOT in the list
// is always treated as a worker (fail closed). This stops mistakes and confusion,
// not a deliberate filesystem write — DSH has no server-side principal to bind to,
// so claiming more than that would be the same "authority collapse" the literature
// warns about (arXiv:2608.01679).
//
// @module dsh-memory/workspace

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'

export const MARKER_DIR = '.dsh'
export const MARKER_FILE = 'memory.json'

/** Absolute path of a workspace's marker file. */
export function markerPath(root) {
  return join(root, MARKER_DIR, MARKER_FILE)
}

/** Slug a name into a stable id, preserving non-Latin scripts. */
export function slugify(name) {
  return (
    String(name)
      .toLowerCase()
      // Keep letters/numbers of ANY script: an ASCII-only filter erased Chinese
      // titles entirely, collapsing every such note onto the same filename.
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/g, '') || 'workspace'
  )
}

/**
 * Read a workspace marker.
 * @param {string} root
 * @returns {Promise<object|null>} null when absent or malformed
 */
export async function readMarker(root) {
  try {
    const raw = await readFile(markerPath(root), 'utf8')
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed
  } catch {
    return null
  }
}

/**
 * Write (create or replace) a workspace marker.
 * @param {string} root
 * @param {object} marker
 */
export async function writeMarker(root, marker) {
  await mkdir(join(root, MARKER_DIR), { recursive: true })
  await writeFile(markerPath(root), `${JSON.stringify(marker, null, 2)}\n`, 'utf8')
}

/**
 * Merge a patch into a workspace marker (creating it if absent).
 * @param {string} root
 * @param {object} patch
 * @returns {Promise<object>} the merged marker
 */
export async function updateMarker(root, patch) {
  const existing = (await readMarker(root)) ?? { schema: 1 }
  const next = { ...existing, ...patch, schema: existing.schema ?? 1 }
  await writeMarker(root, next)
  return next
}

/** The "no workspace" result, so callers never branch on undefined. */
function none(depth = -1) {
  return {
    root: null,
    id: null,
    episode: null,
    enabled: false,
    mapAlwaysOn: true,
    marker: null,
    role: 'worker',
    depth
  }
}

/**
 * Walk up from `cwd` looking for the nearest workspace marker.
 *
 * @param {string} cwd
 * @param {{sessionId?:string|null, maxDepth?:number}} [options]
 * @returns {Promise<{
 *   root:string|null, id:string|null, episode:string|null,
 *   enabled:boolean, mapAlwaysOn:boolean, marker:object|null,
 *   role:'coordinator'|'worker', depth:number
 * }>}
 */
export async function resolveWorkspace(cwd, options = {}) {
  const { sessionId = null, maxDepth = 24 } = options
  if (typeof cwd !== 'string' || cwd.trim() === '') return none()
  let dir = resolve(cwd)
  for (let depth = 0; depth <= maxDepth; depth++) {
    const marker = await readMarker(dir)
    if (marker) {
      const coordinators = Array.isArray(marker.coordinators) ? marker.coordinators.map(String) : []
      const id =
        typeof marker.id === 'string' && marker.id.trim() !== ''
          ? marker.id.trim()
          : `ws_${slugify(basename(dir))}`
      return {
        root: dir,
        id,
        episode: typeof marker.episode === 'string' && marker.episode.trim() !== '' ? marker.episode.trim() : null,
        // L4 read-side authorization. Anything other than an explicit true keeps
        // episode memory out of the context.
        enabled: marker.enabled === true,
        mapAlwaysOn: marker.mapAlwaysOn !== false,
        marker,
        role: sessionId !== null && coordinators.includes(String(sessionId)) ? 'coordinator' : 'worker',
        depth
      }
    }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return none()
}

/**
 * Paths touched by one tool execution, for touch-driven refresh.
 *
 * Deliberately conservative: an unrecognized argument shape yields no paths and
 * the periodic full scan covers it. Guessing wrong here would either refresh too
 * much (defeating the optimization) or too little (serving stale memory).
 *
 * @param {{arguments?:object}} exec
 * @returns {string[]} absolute or relative paths, possibly empty
 */
export function touchedPaths(exec) {
  const args = exec?.arguments
  if (!args || typeof args !== 'object') return []
  const out = []
  for (const key of ['path', 'file_path', 'filePath', 'file', 'workdir', 'workingDirectory', 'cwd']) {
    const value = args[key]
    if (typeof value === 'string' && value.trim() !== '') out.push(value.trim())
  }
  return out
}
