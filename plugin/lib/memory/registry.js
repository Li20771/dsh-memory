// Workspace registry observation: detect when a workspace is deleted in the GUI.
//
// The desktop app persists its workspace list at `<DSH_HOME>/storages/workspace.json`
// with this shape (verified on the installed build):
//
//   { unit:{name:'workspace',version:2},
//     global:{ initialized, workspaceIds:[uuid...], archivedSessionIds, pinnedSessionIds },
//     tables:{ workspaces: { '<uuid>': { path, title, sessionIds, createdAt, updatedAt } } } }
//
// So deletion is observable host-side: a uuid that was in `tables.workspaces` and is
// no longer there has been removed from the list. No client bundle needed.
//
// ⚠ The removed entry's `path` is gone from the file by the time we look, so we keep
// our own snapshot (in `.kb-index/`, gitignored — absolute paths must never enter the
// vault, or the repo stops being portable).
//
// What this module does NOT do is decide anything. Detection and decision are kept
// apart so the policy (harvest-complete-or-defer) stays readable in one place.
//
// @module dsh-memory/memory/registry

import { readFile, writeFile, mkdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/** DSH home directory, honouring the same env var the host uses. */
export function dshHome() {
  const env = process.env.DSH_HOME
  return env && String(env).trim() !== '' ? String(env).trim() : join(homedir(), '.dsh')
}

/** Path of the host's workspace registry. */
export function registryPath(home = dshHome()) {
  return join(home, 'storages', 'workspace.json')
}

/** Path of our own snapshot of that registry (machine-local, never committed). */
export function snapshotPath(vaultRoot) {
  return join(vaultRoot, '.kb-index', 'workspaces.json')
}

/**
 * Read the host registry.
 * @returns {Promise<{mtimeMs:number, entries:Map<string,{path:string,title:string|null}>}|null>}
 *   null when the file is absent or unparseable — a broken registry must not stop
 *   memory from working.
 */
export async function readRegistry(path = registryPath()) {
  try {
    const info = await stat(path)
    const raw = await readFile(path, 'utf8')
    const parsed = JSON.parse(raw)
    const table = parsed?.tables?.workspaces
    const entries = new Map()
    if (table && typeof table === 'object') {
      for (const [id, value] of Object.entries(table)) {
        if (!value || typeof value !== 'object') continue
        if (typeof value.path !== 'string' || value.path.trim() === '') continue
        entries.set(String(id), { path: value.path, title: typeof value.title === 'string' ? value.title : null })
      }
    }
    return { mtimeMs: info.mtimeMs, entries }
  } catch {
    return null
  }
}

/**
 * Read our snapshot.
 * @returns {Promise<{version:number, at:string|null, mtimeMs:number|null,
 *   workspaces:Record<string,{path:string, title:string|null, scope:string|null}>,
 *   pending:Array<{id:string, scope:string, path:string, missing:number, at:string}>}>}
 */
export async function readSnapshot(vaultRoot) {
  const empty = { version: 1, at: null, mtimeMs: null, workspaces: {}, pending: [] }
  try {
    const raw = await readFile(snapshotPath(vaultRoot), 'utf8')
    const parsed = JSON.parse(raw)
    return {
      version: Number(parsed?.version ?? 1),
      at: typeof parsed?.at === 'string' ? parsed.at : null,
      mtimeMs: Number.isFinite(parsed?.mtimeMs) ? parsed.mtimeMs : null,
      workspaces: parsed?.workspaces && typeof parsed.workspaces === 'object' ? parsed.workspaces : {},
      pending: Array.isArray(parsed?.pending) ? parsed.pending : []
    }
  } catch {
    return empty
  }
}

/** Write our snapshot atomically enough for our own use. */
export async function writeSnapshot(vaultRoot, snapshot) {
  const path = snapshotPath(vaultRoot)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify({ version: 1, ...snapshot }, null, 2)}\n`, 'utf8')
}

/**
 * Compare a previous snapshot with the current registry.
 * @param {{workspaces:Record<string,{path:string,title:string|null}>}} previous
 * @param {Map<string,{path:string,title:string|null}>} current
 * @returns {{added:Array<{id:string,path:string}>, removed:Array<{id:string,path:string|null,title:string|null}>}}
 */
export function diffRegistry(previous, current) {
  const stats = { added: [], removed: [] }
  const before = previous?.workspaces ?? {}
  for (const [id, entry] of current) {
    if (!before[id]) stats.added.push({ id, path: entry.path })
  }
  for (const [id, entry] of Object.entries(before)) {
    if (!current.has(id)) stats.removed.push({ id, path: entry.path ?? null, title: entry.title ?? null })
  }
  return stats
}
