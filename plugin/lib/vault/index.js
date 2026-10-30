// Vault index: files → parsed notes → links/backlinks/tags/blocks.
//
// Identity is the *repo-relative path* (forward slashes). Never an absolute
// path — that is the portability rule: a vault cloned to another machine or
// another drive keeps working because nothing stored refers to where it lives.
//
// Change detection is two-stage, because the cheap check must carry the common
// case: stat (mtimeMs, size) first, and only when that differs do we read the
// file and compare a content hash. A fresh git checkout touches every mtime
// without changing any byte, and re-parsing 10k unchanged notes for that would
// be pure waste.
//
// @module dsh-memory/vault/index

import { createHash } from 'node:crypto'
import { readdir, readFile, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, sep } from 'node:path'

import { parseNote } from './parse.js'
import { extractLinks, normalizeTarget, resolveAnchor, resolveTarget } from './links.js'

// `templates` is excluded by default: template notes carry placeholder
// frontmatter (`type: memory`, `scope: ws_yourworkspace`) and would otherwise be
// recalled and injected as if they were real content.
const DEFAULT_IGNORES = new Set(['node_modules', '.git', '.kb-index', '.trash', '.obsidian', '.dsh', 'templates'])
const READ_CONCURRENCY = 32

const toPosix = (p) => p.split(sep).join('/')
const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex')

/**
 * @typedef {object} FileEntry
 * @property {string} path      repo-relative, posix separators (the file id)
 * @property {string} abs       absolute path on this machine (never persisted)
 * @property {number} mtimeMs
 * @property {number} size
 * @property {string} sha
 * @property {ReturnType<typeof parseNote>} parsed
 * @property {Array<object>} outlinks resolved outgoing links
 */

export class VaultIndex {
  #root
  #ignores
  #files = new Map()
  #byPath = new Map()
  #byBasename = new Map()
  #backlinks = new Map()
  #forward = new Map()
  #tags = new Map()
  #warnings = []
  #lastStats = { files: 0, parsed: 0, reused: 0, ms: 0 }
  #version = 0

  /**
   * @param {string} root - vault root (absolute or relative to cwd).
   * @param {{ignore?: Iterable<string>, maxFileBytes?: number}} [options]
   */
  constructor(root, options = {}) {
    this.#root = root
    this.#ignores = new Set([...DEFAULT_IGNORES, ...(options.ignore ?? [])])
    this.maxFileBytes = options.maxFileBytes ?? 4 * 1024 * 1024
  }

  get root() {
    return this.#root
  }

  get warnings() {
    return this.#warnings
  }

  get stats() {
    return { ...this.#lastStats, files: this.#files.size }
  }

  /** Monotonic mutation counter; consumers cache derived data against it. */
  get version() {
    return this.#version
  }

  /** All file ids (repo-relative posix paths). */
  paths() {
    return [...this.#files.keys()]
  }

  /** One parsed entry, or undefined. */
  get(fileId) {
    return this.#files.get(fileId)
  }

  /**
   * Walk the vault for markdown files.
   * @returns {Promise<string[]>} repo-relative posix paths
   */
  async #walk() {
    const out = []
    const stack = ['']
    while (stack.length > 0) {
      const rel = stack.pop()
      const abs = rel === '' ? this.#root : join(this.#root, rel)
      let entries
      try {
        entries = await readdir(abs, { withFileTypes: true })
      } catch {
        continue
      }
      for (const entry of entries) {
        const childRel = rel === '' ? entry.name : `${rel}/${entry.name}`
        if (entry.isDirectory()) {
          if (this.#ignores.has(entry.name)) continue
          if (entry.name.startsWith('.')) continue
          stack.push(childRel)
        } else if (entry.isFile()) {
          if (!entry.name.toLowerCase().endsWith('.md')) continue
          // A README at the VAULT ROOT is repository documentation, not memory: it has
          // no type, no scope, and recalling "这里放什么" as if it were a research note
          // is noise. Project-level `projects/<slug>/README.md` is real content (typed
          // `project`) and stays indexed.
          if (rel === '' && entry.name.toLowerCase() === 'readme.md') continue
          out.push(childRel)
        }
      }
    }
    return out.sort()
  }

  /** Read + parse one file into an entry, or null when unreadable/oversized. */
  async #load(rel, meta) {
    const abs = join(this.#root, ...rel.split('/'))
    let text
    try {
      const info = meta ?? (await stat(abs))
      if (info.size > this.maxFileBytes) {
        this.#warnings.push(`${rel}: skipped, ${info.size} bytes exceeds maxFileBytes`)
        return null
      }
      text = await readFile(abs, 'utf8')
    } catch (error) {
      this.#warnings.push(`${rel}: unreadable (${error?.code ?? error?.message ?? error})`)
      return null
    }
    const parsed = parseNote(text)
    for (const w of parsed.warnings) this.#warnings.push(`${rel}: ${w}`)
    const info = meta ?? (await stat(abs))
    return {
      path: rel,
      abs,
      mtimeMs: info.mtimeMs,
      size: info.size,
      sha: sha256(text),
      parsed,
      outlinks: []
    }
  }

  /** Recompute every derived map from the current file set. */
  #derive() {
    this.#version++
    this.#byPath = new Map()
    this.#byBasename = new Map()
    this.#backlinks = new Map()
    this.#forward = new Map()
    this.#tags = new Map()

    for (const [path, entry] of this.#files) {
      const norm = normalizeTarget(path)
      this.#byPath.set(norm.path, path)
      // Also index the filename without any directory, which is how [[Note]] reads.
      const list = this.#byBasename.get(norm.base) ?? []
      if (!list.includes(path)) list.push(path)
      this.#byBasename.set(norm.base, list)
      for (const tag of entry.parsed.tags) {
        const set = this.#tags.get(tag) ?? new Set()
        set.add(path)
        this.#tags.set(tag, set)
      }
    }

    const lookup = {
      selfId: '',
      byPath: (p) => {
        const norm = normalizeTarget(p)
        return this.#byPath.get(norm.path)
      },
      byBasename: (n) => this.#byBasename.get(normalizeTarget(n).base) ?? [],
      // Suffix match: does any file path end with this whole normalized name?
      bySuffix: (name) => {
        const wanted = normalizeTarget(name).path
        if (wanted === '') return []
        const out = []
        for (const [key, id] of this.#byPath) {
          if (key === wanted || key.endsWith(`/${wanted}`)) out.push(id)
        }
        return out
      }
    }

    for (const [path, entry] of this.#files) {
      const bodyStart = entry.parsed.bodyOffset
      const links = extractLinks(entry.parsed.masked, bodyStart)
      const resolved = []
      for (const link of links) {
        lookup.selfId = path
        const target = resolveTarget(link.target, lookup, path)
        const record = { ...link, resolution: target.kind }
        if (target.kind === 'self') {
          record.fileId = path
          const range = resolveAnchor(entry.parsed, link.anchor, link.block)
          record.range = range
        } else if (target.kind === 'file') {
          record.fileId = target.fileId
          const dest = this.#files.get(target.fileId)
          const range = resolveAnchor(dest?.parsed, link.anchor, link.block)
          record.range = range
          const back = this.#backlinks.get(target.fileId) ?? new Set()
          back.add(path)
          this.#backlinks.set(target.fileId, back)
        } else if (target.kind === 'ambiguous') {
          record.candidates = target.candidates
        }
        resolved.push(record)
      }
      entry.outlinks = resolved
      this.#forward.set(path, resolved)
    }
  }

  /**
   * Full rebuild.
   * @returns {Promise<{files:number,parsed:number,reused:number,ms:number}>}
   */
  async rebuild() {
    const started = Date.now()
    this.#warnings = []
    const paths = await this.#walk()
    const next = new Map()
    let parsed = 0
    let reused = 0

    // Bounded-concurrency load: sequential 10k reads is seconds of wall clock;
    // unbounded fan-out exhausts file handles.
    let cursor = 0
    const workers = Array.from({ length: Math.min(READ_CONCURRENCY, paths.length || 1) }, async () => {
      while (true) {
        const i = cursor++
        if (i >= paths.length) return
        const rel = paths[i]
        const previous = this.#files.get(rel)
        let info
        try {
          info = await stat(join(this.#root, ...rel.split('/')))
        } catch {
          continue
        }
        if (previous && previous.mtimeMs === info.mtimeMs && previous.size === info.size) {
          next.set(rel, previous)
          reused++
          continue
        }
        const entry = await this.#load(rel, info)
        if (entry) {
          next.set(rel, entry)
          parsed++
        }
      }
    })
    await Promise.all(workers)

    this.#files = next
    this.#derive()
    const ms = Date.now() - started
    this.#lastStats = { files: paths.length, parsed, reused, ms }
    return this.#lastStats
  }

  /**
   * Incremental refresh: only changed/new files are read and parsed, only
   * vanished files are dropped.
   * @returns {Promise<{files:number,parsed:number,reused:number,added:string[],changed:string[],removed:string[],ms:number}>}
   */
  async refresh() {
    const started = Date.now()
    this.#warnings = []
    const paths = await this.#walk()
    const present = new Set(paths)
    const added = []
    const changed = []
    const removed = []
    let parsed = 0
    let reused = 0

    for (const previousPath of [...this.#files.keys()]) {
      if (!present.has(previousPath)) {
        this.#files.delete(previousPath)
        removed.push(previousPath)
      }
    }

    let cursor = 0
    const workers = Array.from({ length: Math.min(READ_CONCURRENCY, paths.length || 1) }, async () => {
      while (true) {
        const i = cursor++
        if (i >= paths.length) return
        const rel = paths[i]
        const previous = this.#files.get(rel)
        let info
        try {
          info = await stat(join(this.#root, ...rel.split('/')))
        } catch {
          continue
        }
        if (previous && previous.mtimeMs === info.mtimeMs && previous.size === info.size) {
          reused++
          continue
        }
        const entry = await this.#load(rel, info)
        if (!entry) continue
        // Same bytes, different mtime (git checkout): keep the old parse.
        if (previous && previous.sha === entry.sha) {
          previous.mtimeMs = entry.mtimeMs
          reused++
          continue
        }
        this.#files.set(rel, entry)
        ;(previous ? changed : added).push(rel)
        parsed++
      }
    })
    await Promise.all(workers)

    this.#derive()
    const ms = Date.now() - started
    this.#lastStats = { files: paths.length, parsed, reused, ms }
    return { files: paths.length, parsed, reused, added, changed, removed, ms }
  }

  /**
   * Refresh only the given paths (absolute or vault-relative).
   *
   * This is the touch-driven path: the agent tells us which files its tools
   * touched, so a normal turn re-stats a handful of files instead of walking the
   * whole tree. A full `refresh()` remains the periodic safety net.
   *
   * @param {string[]} paths
   * @returns {Promise<{parsed:string[],removed:string[],reused:string[],ms:number}>}
   */
  async refreshFiles(paths) {
    const started = Date.now()
    const parsed = []
    const removed = []
    const reused = []
    const seen = new Set()
    for (const input of paths ?? []) {
      if (typeof input !== 'string' || input.trim() === '') continue
      const abs = isAbsolute(input) ? input : join(this.#root, input)
      const rel = toPosix(relative(this.#root, abs))
      if (rel.startsWith('..') || seen.has(rel)) continue
      seen.add(rel)
      if (!rel.toLowerCase().endsWith('.md')) continue

      const previous = this.#files.get(rel)
      let info
      try {
        info = await stat(abs)
      } catch {
        if (previous) {
          this.#files.delete(rel)
          removed.push(rel)
        }
        continue
      }
      if (previous && previous.mtimeMs === info.mtimeMs && previous.size === info.size) {
        reused.push(rel)
        continue
      }
      const entry = await this.#load(rel, info)
      if (!entry) continue
      if (previous && previous.sha === entry.sha) {
        previous.mtimeMs = entry.mtimeMs
        reused.push(rel)
        continue
      }
      this.#files.set(rel, entry)
      parsed.push(rel)
    }
    if (parsed.length > 0 || removed.length > 0) this.#derive()
    return { parsed, removed, reused, ms: Date.now() - started }
  }

  /** Files linking to `fileId`. */
  backlinksOf(fileId) {
    return [...(this.#backlinks.get(fileId) ?? [])].sort()
  }

  /** Resolved outgoing links of one file. */
  outlinksOf(fileId) {
    return this.#forward.get(fileId) ?? []
  }

  /**
   * Mention a note's names in another note without linking it.
   * O(n) per call by design: scanning every body on every refresh would be the
   * expensive version of a feature nobody needs in a hot path.
   * @param {string} fileId
   * @returns {Promise<Array<{path:string,start:number,end:number,text:string}>>}
   */
  async unlinkedMentionsOf(fileId) {
    const entry = this.#files.get(fileId)
    if (!entry) return []
    const names = new Set()
    const norm = normalizeTarget(fileId)
    names.add(norm.base.replace(/[-_]/g, ' '))
    names.add(norm.base)
    const title = entry.parsed.frontmatter?.title
    if (typeof title === 'string') names.add(title.toLowerCase())
    const aliases = entry.parsed.frontmatter?.aliases
    if (Array.isArray(aliases)) for (const a of aliases) if (typeof a === 'string') names.add(a.toLowerCase())

    const linkedFrom = new Set(this.backlinksOf(fileId))
    const hits = []
    for (const [path, other] of this.#files) {
      if (path === fileId || linkedFrom.has(path)) continue
      const haystack = other.parsed.masked.toLowerCase()
      for (const name of names) {
        if (name.length < 3) continue
        let from = 0
        while (true) {
          const at = haystack.indexOf(name, from)
          if (at < 0) break
          hits.push({
            path,
            start: other.parsed.bodyOffset + at,
            end: other.parsed.bodyOffset + at + name.length,
            text: other.parsed.body.slice(at, at + name.length)
          })
          from = at + name.length
          if (hits.length > 500) return hits
        }
      }
    }
    return hits
  }

  /** Tag → file ids. */
  tagsIndex() {
    const out = {}
    for (const [tag, set] of this.#tags) out[tag] = [...set].sort()
    return out
  }

  /** Blocks of one file (id'd blocks only). */
  blocksIn(fileId) {
    return this.#files.get(fileId)?.parsed.blocks ?? []
  }

  /**
   * Most recent notes of one `type` in one scope.
   *
   * Episode memory needs this: "what has this project been doing" is a valid
   * question even when nothing matches the current wording, and returning
   * nothing there would make cross-session continuity invisible.
   *
   * `authorize` is applied BEFORE sorting/slicing. A foreign record must not
   * consume one of the `limit` slots even when it is simply "recent".
   *
   * @param {string} type
   * @param {string} scope
   * @param {number} [limit]
   * @param {((path:string, entry:object)=>boolean)|null} [authorize]
   * @returns {Array<{path:string, created:string, entry:object}>}
   */
  recentByTypeScope(type, scope, limit = 3, authorize = null) {
    const wantType = String(type ?? '').toLowerCase()
    const wantScope = String(scope ?? '').toLowerCase()
    const out = []
    for (const [path, entry] of this.#files) {
      const fm = entry.parsed.frontmatter ?? {}
      if (String(fm.type ?? '').toLowerCase() !== wantType) continue
      const s = String(fm.scope ?? '').toLowerCase()
      if (wantScope !== '' && s !== wantScope && !s.startsWith(`${wantScope}/`)) continue
      if (typeof authorize === 'function' && !authorize(path, entry)) continue
      out.push({ path, created: String(fm.created ?? ''), entry })
    }
    out.sort((a, b) => b.created.localeCompare(a.created) || a.path.localeCompare(b.path))
    return out.slice(0, Math.max(1, limit))
  }

  /**
   * Render a citation target to `path#^block` / `path#Heading` / `path`.
   * @param {string} fileId
   * @param {{kind:string,start:number,end:number}} [range]
   */
  cite(fileId, range) {
    if (!range || range.kind === 'none') return fileId
    const entry = this.#files.get(fileId)
    if (!entry) return fileId
    if (range.kind === 'block') {
      const block = entry.parsed.blocks.find((b) => b.start === range.start)
      return block?.id ? `${fileId}#^${block.id}` : fileId
    }
    const heading = entry.parsed.headings.find((h) => h.start === range.start)
    return heading ? `${fileId}#${heading.text}` : fileId
  }
}
