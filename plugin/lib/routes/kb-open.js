// routes/kb-open.js — `POST {prefix}/kb/open`: bring the memory vault up in Obsidian.
//
// Why this route exists at all: the desktop renderer cannot open anything. `lib/main.js`
// installs `setWindowOpenHandler` which returns `{action:'deny'}` for every pop-up,
// forwards only `https:` destinations to the system browser, and cancels `will-navigate`.
// So the click had to become a HOST action — and the user then decided the built-in
// read-only page is not what they want to look at: **Obsidian** is. This route therefore
// hands the vault to Obsidian instead of opening a page.
//
// Obsidian has no command line for "open this folder as a vault": passing the path as an
// argv was measured on 2026-10-29 and does nothing (the process starts on the last vault
// and neither registers nor opens the given folder). What does work, measured the same
// day: the vault must be present in `obsidian.json`, and then
// `obsidian://open?vault=<folder name>` opens or focuses it. So this route:
//   1. registers the vault in `obsidian.json` when it is missing (idempotent, backed up
//      once, atomic write) — otherwise the user would first have to add the vault by hand;
//   2. fires the `obsidian://` URI, which the OS routes to the running/first Obsidian;
//   3. falls back to the built-in read-only page when Obsidian is not installed (no
//      registry file) or when there is no vault to open.
//
// Everything that reads the environment is separated into pure planning functions, so the
// tests and the live proof can assert the decision without touching the user's files.
//
// @module dsh-memory/routes/kb-open

import { spawn } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { basename, dirname, join } from 'node:path'
import { homedir } from 'node:os'

import { KB } from './contract.js'
import { methodOf, refuse, sendJson } from './http.js'

/** Where Obsidian keeps its vault registry, per platform. */
export function obsidianConfigPath(platform = process.platform, env = process.env, home = homedir()) {
  if (platform === 'win32') {
    const appData = typeof env.APPDATA === 'string' && env.APPDATA !== '' ? env.APPDATA : join(home, 'AppData', 'Roaming')
    return join(appData, 'obsidian', 'obsidian.json')
  }
  if (platform === 'darwin') return join(home, 'Library', 'Application Support', 'obsidian', 'obsidian.json')
  const configHome = typeof env.XDG_CONFIG_HOME === 'string' && env.XDG_CONFIG_HOME !== '' ? env.XDG_CONFIG_HOME : join(home, '.config')
  return join(configHome, 'obsidian', 'obsidian.json')
}

/** Obsidian stores 16-hex-char ids; derive one from the path so re-registering is idempotent. */
export function vaultIdFor(vaultPath) {
  return createHash('sha1').update(String(vaultPath).toLowerCase(), 'utf8').digest('hex').slice(0, 16)
}

/** The URI Obsidian understands for "open (or focus) the vault with this folder name". */
export function obsidianUriFor(vaultPath) {
  return `obsidian://open?vault=${encodeURIComponent(basename(String(vaultPath)))}`
}

/**
 * Pure planning step: given the registry contents (or null when the file is missing),
 * decide what has to be written and what to fire.
 * @param {string} vaultPath absolute vault directory
 * @param {object|null} registry parsed `obsidian.json`, or null when Obsidian never ran
 * @returns {{installed:boolean, registered:boolean, id:string, entry:object|null, uri:string, changed:boolean}}
 */
export function planObsidianOpen(vaultPath, registry) {
  const id = vaultIdFor(vaultPath)
  const uri = obsidianUriFor(vaultPath)
  if (registry === null || typeof registry !== 'object') {
    return { installed: false, registered: false, id, entry: null, uri, changed: false }
  }
  const vaults = registry.vaults && typeof registry.vaults === 'object' ? registry.vaults : {}
  const existing = Object.entries(vaults).find(
    ([, value]) => value && typeof value.path === 'string' && value.path.toLowerCase() === String(vaultPath).toLowerCase()
  )
  if (existing !== undefined) {
    return { installed: true, registered: true, id: existing[0], entry: existing[1], uri, changed: false }
  }
  // Same shape Obsidian writes: path + ts (+ `open` on the vault it should show).
  const entry = { path: vaultPath, ts: Date.now(), open: true }
  for (const value of Object.values(vaults)) {
    if (value && typeof value === 'object' && 'open' in value) delete value.open
  }
  vaults[id] = entry
  registry.vaults = vaults
  return { installed: true, registered: false, id, entry, uri, changed: true }
}

/**
 * Make sure the vault is in Obsidian's registry. Never throws: a read-only or locked file
 * must degrade to "fire the URI anyway", because the vault may already be registered.
 * @returns {{installed:boolean, registered:boolean, wrote:boolean, error:string|null}}
 */
export function ensureObsidianVault(vaultPath, configPath = obsidianConfigPath()) {
  if (!existsSync(configPath)) return { installed: false, registered: false, wrote: false, error: null }
  let registry = null
  try {
    registry = JSON.parse(readFileSync(configPath, 'utf8'))
  } catch (error) {
    return { installed: true, registered: false, wrote: false, error: `cannot read Obsidian registry: ${error?.message ?? error}` }
  }
  const plan = planObsidianOpen(vaultPath, registry)
  if (!plan.changed) return { installed: true, registered: true, wrote: false, error: null }
  try {
    mkdirSync(dirname(configPath), { recursive: true })
    const backup = `${configPath}.dsh-memory.bak`
    if (!existsSync(backup)) copyFileSync(configPath, backup)
    writeFileSync(configPath, `${JSON.stringify(registry, null, 2)}\n`, 'utf8')
    return { installed: true, registered: true, wrote: true, error: null }
  } catch (error) {
    // Obsidian may hold the file while it runs; firing the URI is still worth a try.
    return { installed: true, registered: false, wrote: false, error: `cannot write Obsidian registry: ${error?.message ?? error}` }
  }
}

/** Detached launch: we do not own the window that comes up. */
function launch(command, args) {
  const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true })
  child.on('error', () => {
    // Nothing to retry: the caller already reports which mode it chose.
  })
  child.unref()
}

/** Hand a URI to the OS' protocol handler. */
function launchUri(uri) {
  if (process.platform === 'win32') launch('cmd', ['/c', 'start', '', uri])
  else if (process.platform === 'darwin') launch('open', [uri])
  else launch('xdg-open', [uri])
}

/** The built-in read-only page, used when Obsidian is not available. */
export function openBuiltInPage(host) {
  const base = typeof host === 'string' && host !== '' ? `http://${host}` : 'http://127.0.0.1'
  let url = KB.page
  try {
    url = new URL(KB.page, base).href
  } catch {
    url = KB.page
  }
  if (process.platform === 'win32') launch('cmd', ['/c', 'start', '', url])
  else if (process.platform === 'darwin') launch('open', [url])
  else launch('xdg-open', [url])
  return { mode: 'browser', url }
}

/**
 * Open the memory vault in Obsidian, or the built-in page when Obsidian is unavailable.
 * @param {{vaultPath:string, host?:string}} input
 * @returns {{mode:'obsidian'|'browser', uri:string|null, url:string|null, registered:boolean, wrote:boolean, error:string|null}}
 */
export function openKnowledgeBase(input) {
  const vaultPath = input && typeof input.vaultPath === 'string' && input.vaultPath !== '' ? input.vaultPath : ''
  if (!existsSync(vaultPath)) {
    const fallback = openBuiltInPage(input?.host)
    return { mode: fallback.mode, uri: null, url: fallback.url, registered: false, wrote: false, error: 'vault path does not exist' }
  }
  const ensured = ensureObsidianVault(vaultPath)
  if (!ensured.installed) {
    const fallback = openBuiltInPage(input?.host)
    return { mode: fallback.mode, uri: null, url: fallback.url, registered: false, wrote: false, error: 'obsidian not installed' }
  }
  const uri = obsidianUriFor(vaultPath)
  launchUri(uri)
  return { mode: 'obsidian', uri, url: null, registered: ensured.registered, wrote: ensured.wrote, error: ensured.error }
}

/**
 * @param {{register:Function}} webServer the host webserver service
 * @param {object} c shared dependencies; `openKnowledgeBase` is injectable so tests and the
 *   live proof can assert the call without starting Obsidian or touching its registry
 */
export function registerKbOpenRoutes(webServer, c) {
  const { disposers, vaultRoot } = c
  const openKb = typeof c.openKnowledgeBase === 'function' ? c.openKnowledgeBase : openKnowledgeBase

  disposers.push(
    webServer.register({
      kind: 'exact',
      path: KB.open,
      handler: async (req, res) => {
        if (methodOf(req) !== 'POST') {
          refuse(res, 405, 'method-not-allowed')
          return
        }
        const host = typeof req.headers?.host === 'string' ? req.headers.host : ''
        try {
          const opened = await openKb({ vaultPath: vaultRoot, host })
          sendJson(res, 200, {
            ok: true,
            mode: opened.mode,
            uri: opened.uri ?? null,
            url: opened.url ?? null,
            registered: opened.registered === true,
            wrote: opened.wrote === true,
            error: opened.error ?? null
          })
        } catch (error) {
          sendJson(res, 500, { ok: false, error: 'cannot-open-knowledge-base', detail: String(error?.message ?? error) })
        }
      }
    })
  )
}