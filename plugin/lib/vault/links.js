// Link grammar and resolution semantics — THE SWAPPABLE MODULE.
//
// CALIBRATED against Obsidian 1.13.7 (`docs/superpowers/plans/2026-10-23-obsidian-re-delivery.md`).
// Every rule below cites the finding it implements; the three that differ from
// my first guess are marked CORRECTED.
//
// Contract consumed by index.js / query.js:
//
//   extractLinks(masked, baseOffset) -> LinkHit[]
//     LinkHit = { embed, raw, target, anchor, block, alias, start, end }
//
//   resolveTarget(target, lookup, fromPath) -> Resolution
//     Resolution = { kind:'self'|'file'|'ambiguous'|'unresolved', fileId?, candidates? }
//
//   resolveAnchor(parsed, anchor, block) -> { kind:'block'|'heading'|'none', start, end }
//
//   normalizeTarget(target) -> { path, base }
//
// @module dsh-memory/vault/links

/** Link forms Obsidian actually implements (RE §10.1). */
export const SUPPORTED_FORMS = Object.freeze([
  { form: '[[Note]]', meaning: 'whole file' },
  { form: '[[Note|alias]]', meaning: 'alias is display only' },
  { form: '[[Note#Heading]]', meaning: 'heading section range' },
  { form: '[[Note#^blk]]', meaning: 'block id range' },
  { form: '![[Note]]', meaning: 'embed; still an edge' },
  { form: '[[#Heading]]', meaning: 'self reference' }
])

const LINK_RE = /(!?)\[\[([^[\]\n]{1,512}?)\]\]/g

/**
 * Extract every link from a masked body.
 *
 * Split order is Obsidian's: `!` prefix, then the FIRST `|` (alias), then the
 * FIRST `#` (subpath) — RE §10.1 row 1.
 *
 * @param {string} masked - code-masked body (see parse.maskCode)
 * @param {number} [baseOffset=0]
 * @returns {Array<{embed:boolean,raw:string,target:string,anchor:string|null,block:string|null,alias:string|null,start:number,end:number}>}
 */
export function extractLinks(masked, baseOffset = 0) {
  const hits = []
  const text = String(masked ?? '')
  LINK_RE.lastIndex = 0
  let m
  while ((m = LINK_RE.exec(text)) !== null) {
    const raw = m[0]
    const inner = m[2]
    if (inner.trim() === '') continue

    // A link nested inside an unclosed `[[` is rejected wholesale by Obsidian
    // (`[[a[[b]]]]` yields nothing). A non-greedy match would happily return the
    // inner `[[b]]`, which is a link Obsidian never had.
    const before = text.slice(0, m.index)
    const opens = (before.match(/\[\[/g) ?? []).length
    const closes = (before.match(/\]\]/g) ?? []).length
    if (opens - closes > 0) continue

    let target = inner
    let alias = null
    const pipe = target.indexOf('|')
    if (pipe >= 0) {
      alias = target.slice(pipe + 1).trim() || null
      target = target.slice(0, pipe)
    }

    let anchor = null
    let block = null
    const hash = target.indexOf('#')
    if (hash >= 0) {
      const after = target.slice(hash + 1).trim()
      target = target.slice(0, hash).trim()
      if (after.startsWith('^')) block = after.slice(1).trim().toLowerCase()
      else if (after !== '') anchor = after
    }

    hits.push({
      embed: m[1] === '!',
      raw,
      target: target.trim(),
      anchor,
      block,
      alias,
      start: baseOffset + m.index,
      end: baseOffset + m.index + raw.length
    })
  }
  return hits
}

/**
 * Normalize a link target for matching.
 *
 * CORRECTED: backslashes are NOT converted to slashes. Obsidian leaves
 * `[[a\Index]]` unresolved (RE §10.1 "归一化（补细）"). My first version
 * rewrote `\` to `/`, which would have silently resolved links Obsidian
 * cannot. A leading `./` is dropped (that form does resolve), and `.md` is
 * optional. No NFC normalization here — Obsidian applies NFC on the write
 * path only, not during link resolution.
 *
 * @param {string} target
 * @returns {{path:string, base:string}}
 */
export function normalizeTarget(target) {
  let t = String(target ?? '').trim()
  while (t.startsWith('./')) t = t.slice(2)
  const lower = t.toLowerCase()
  const path = lower.endsWith('.md') ? lower.slice(0, -3) : lower
  const base = path.slice(path.lastIndexOf('/') + 1)
  return { path, base }
}

/** Directory portion of a posix path, '' at the root. */
function dirOf(filePath) {
  const at = filePath.lastIndexOf('/')
  return at < 0 ? '' : filePath.slice(0, at)
}

/** Resolve `name` against `fromDir`, collapsing `.`/`..`; null when it escapes the root. */
function joinPosix(fromDir, name) {
  const parts = (fromDir === '' ? [] : fromDir.split('/')).concat(name.split('/'))
  const out = []
  for (const part of parts) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      if (out.length === 0) return null
      out.pop()
      continue
    }
    out.push(part)
  }
  return out.join('/')
}

/**
 * Resolve a link target to a file.
 *
 * CALIBRATED precedence (RE §10.1):
 *   a bare name with no slash:  unique basename -> same-directory -> suffix
 *                               (same-directory group first, then shortest path)
 *   a path with a slash:        exact path -> relative to the source -> suffix
 *   multiple survivors:         ambiguous, candidates sorted by path length
 *
 * `aliases` deliberately play no part: Obsidian does not resolve `[[alias]]`
 * to its note at all — it becomes unresolved (RE §10.1 "aliases 处理（修正）").
 *
 * @param {string} target
 * @param {{byPath:(p:string)=>string|undefined,
 *          byBasename:(b:string)=>string[],
 *          bySuffix:(n:string)=>string[]}} lookup
 * @param {string} [fromPath] - the linking file's id, for relative resolution
 * @returns {{kind:'self'|'file'|'ambiguous'|'unresolved',fileId?:string,candidates?:string[]}}
 */
export function resolveTarget(target, lookup, fromPath = '') {
  const raw = String(target ?? '').trim()
  if (raw === '') return { kind: 'self' }
  const norm = normalizeTarget(raw)
  const hasSlash = norm.path.includes('/')

  if (!hasSlash) {
    const sameName = lookup.byBasename(norm.base) ?? []
    if (sameName.length === 1) return { kind: 'file', fileId: sameName[0] }
    if (sameName.length > 1) {
      // Same-directory candidate wins; otherwise the shortest path.
      const fromDir = dirOf(fromPath)
      const here = sameName.filter((id) => dirOf(id) === fromDir)
      if (here.length === 1) return { kind: 'file', fileId: here[0] }
      const pool = here.length > 1 ? here : sameName
      if (pool.length === 1) return { kind: 'file', fileId: pool[0] }
      const sorted = [...pool].sort((a, b) => a.length - b.length || a.localeCompare(b))
      return { kind: 'ambiguous', candidates: sorted }
    }
  } else {
    const exact = lookup.byPath(norm.path)
    if (exact !== undefined) return { kind: 'file', fileId: exact }

    const relative = joinPosix(dirOf(fromPath), norm.path)
    if (relative !== null) {
      const hit = lookup.byPath(relative)
      if (hit !== undefined) return { kind: 'file', fileId: hit }
    }
  }

  const suffix = lookup.bySuffix(norm.path) ?? []
  if (suffix.length === 1) return { kind: 'file', fileId: suffix[0] }
  if (suffix.length > 1) {
    const sorted = [...suffix].sort((a, b) => a.length - b.length || a.localeCompare(b))
    return { kind: 'ambiguous', candidates: sorted }
  }

  const byBase = lookup.byBasename(norm.base) ?? []
  if (byBase.length === 1) return { kind: 'file', fileId: byBase[0] }
  if (byBase.length > 1) {
    const sorted = [...byBase].sort((a, b) => a.length - b.length || a.localeCompare(b))
    return { kind: 'ambiguous', candidates: sorted }
  }
  return { kind: 'unresolved' }
}

/**
 * Resolve `#anchor` inside an already-parsed file.
 *
 * Block ids compare case-insensitively (`blocks[id.toLowerCase()]`, RE §10.1).
 *
 * @param {{blocks:Array<{id:string|null,start:number,end:number}>,
 *          headings:Array<{text:string,start:number,end:number}>}} parsed
 * @param {string|null} anchor - heading text
 * @param {string|null} block - block id (already lowercased by extractLinks)
 */
/**
 * Normalize heading text the way Obsidian does before matching a `#subpath`.
 *
 * Calibrated to the RE fixture (`Headings.md`), not to full Obsidian parity:
 * `## With | pipe` must answer `#With pipe`, and `## With ^ caret` must answer
 * `#With caret`. Table-delimiter and block-id sigils are stripped to spaces, then
 * whitespace is collapsed. Anything beyond the observed cases is a guess, and the
 * conformance suite is what keeps the guess honest.
 *
 * @param {string} text
 * @returns {string}
 */
export function normalizeHeading(text) {
  return String(text ?? '')
    .replace(/[#|^:()[\]{}`%*_~]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

export function resolveAnchor(parsed, anchor, block) {
  if (block) {
    const wanted = String(block).toLowerCase()
    const hit = (parsed?.blocks ?? []).find((b) => b.id && b.id.toLowerCase() === wanted)
    return hit ? { kind: 'block', start: hit.start, end: hit.end } : { kind: 'none', start: 0, end: 0 }
  }
  if (anchor) {
    const wanted = normalizeHeading(anchor)
    // First match wins: duplicate headings resolve to the earliest one, which is
    // what Obsidian does.
    const hit = (parsed?.headings ?? []).find((h) => normalizeHeading(h.text) === wanted)
    return hit ? { kind: 'heading', start: hit.start, end: hit.end } : { kind: 'none', start: 0, end: 0 }
  }
  return { kind: 'none', start: 0, end: 0 }
}
