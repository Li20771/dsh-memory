// Citations: verifiable pointers into a note.
//
// A citation has to answer three questions at once, and the NotebookLM
// reconstruction (§2.2) is clear that no single number can do it:
//
//   WHERE  — a character range in the note the human will open
//   WHAT   — which block/section identity, so a moved range is detectable
//   WHEN   — a revision hash, so an edited note makes the old citation STALE
//            instead of silently pointing at different words
//
// Two deliberate deviations from the reconstruction, both documented in the
// delivery report:
//
//   1. Ranges are ORIGINAL-BODY offsets, not canonical-stream offsets.
//      Canonical coordinates would require keeping a per-note offset map
//      resident (≈80 MB at 10k notes). Original offsets render directly and
//      compare directly; the canonical layer stays where it earns its keep —
//      passage sizing.
//   2. The rendered `ref` is Obsidian-compatible (`path#^blk`), because the vault
//      must stay openable in Obsidian. The revision is OUR sidecar field, never
//      baked into the link text — exactly as NotebookLM keeps `sourceId` and
//      `revisionId` as data while the visible marker is only `[n]`.
//
// @module dsh-memory/vault/cite

import { createHash } from 'node:crypto'

/** Revision of a note body: short, stable, changes on any edit. */
export function revisionOf(body) {
  return createHash('sha1').update(String(body ?? ''), 'utf8').digest('hex').slice(0, 12)
}

/**
 * Build a citation.
 * @param {{note:string, block?:string|null, heading?:string|null, revision:string,
 *          range?:{start:number,end:number}|null}} input
 * @returns {{note:string, block:string|null, heading:string|null, revision:string,
 *            range:{start:number,end:number}|null, ref:string}}
 */
export function makeCitation(input) {
  const note = String(input?.note ?? '')
  const block = input?.block ? String(input.block) : null
  const heading = !block && input?.heading ? String(input.heading) : null
  const range = input?.range && Number.isFinite(input.range.start) && Number.isFinite(input.range.end) ? { start: input.range.start, end: input.range.end } : null
  const ref = block ? `${note}#^${block}` : heading ? `${note}#${heading}` : note
  return { note, block, heading, revision: String(input?.revision ?? ''), range, ref }
}

/**
 * Parse a rendered reference back into its parts.
 * @param {string} ref
 */
export function parseCitation(ref) {
  const text = String(ref ?? '').trim()
  const hash = text.indexOf('#')
  if (hash < 0) return { note: text, block: null, heading: null }
  const note = text.slice(0, hash)
  const tail = text.slice(hash + 1)
  if (tail.startsWith('^')) return { note, block: tail.slice(1).toLowerCase() || null, heading: null }
  return { note, block: null, heading: tail || null }
}

/**
 * Check a citation against the vault as it is now.
 *
 * Four distinct outcomes, because "broken" hides the difference between a note
 * that was deleted, a note that was edited, and a block that moved away:
 *
 *   ok        — note exists, revision matches, block still present
 *   stale     — note exists but its revision changed (the range may now mean
 *               something else; a reader must re-check, not trust)
 *   missing   — the note is gone
 *   moved     — the note is unchanged but the cited block id is no longer there
 *
 * @param {import('./index.js').VaultIndex} index
 * @param {{note:string, block?:string|null, heading?:string|null, revision?:string, range?:object}} citation
 * @returns {{status:'ok'|'stale'|'missing'|'moved'|'unknown', revision:string|null,
 *            text:string|null, range:object|null, note:string}}
 */
export function resolveCitation(index, citation) {
  const note = String(citation?.note ?? '')
  const entry = index.get(note)
  if (!entry) {
    return { status: 'missing', revision: null, text: null, range: null, note }
  }
  const revision = revisionOf(entry.parsed.body)
  const block = citation?.block ? String(citation.block).toLowerCase() : null
  if (block) {
    const present = (entry.parsed.blocks ?? []).some((b) => b.id && b.id.toLowerCase() === block)
    if (!present) return { status: 'moved', revision, text: null, range: null, note }
  }
  if (citation?.revision && citation.revision !== revision) {
    // Still return the current text so a caller can show what changed.
    const range = citation?.range ?? null
    const text = range ? entry.parsed.body.slice(range.start, range.end) : null
    return { status: 'stale', revision, text, range, note }
  }
  const range = citation?.range ?? null
  return {
    status: 'ok',
    revision,
    text: range ? entry.parsed.body.slice(range.start, range.end) : null,
    range,
    note
  }
}

/**
 * Split text into sentences, preserving offsets.
 * CJK terminators and Latin `.` before whitespace both end a sentence.
 * @param {string} text
 * @returns {Array<{start:number,end:number,text:string}>}
 */
export function splitSentences(text) {
  const src = String(text ?? '')
  const out = []
  let start = 0
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    let end = -1
    if ('。！？；!?;'.includes(ch)) end = i + 1
    else if (ch === '.' && (i + 1 === src.length || /\s/.test(src[i + 1]))) end = i + 1
    else if (ch === '\n') end = i
    if (end > start) {
      const raw = src.slice(start, end)
      if (raw.trim() !== '') out.push({ start, end, text: raw })
      start = end === i ? i + 1 : end
    }
  }
  if (start < src.length) {
    const raw = src.slice(start)
    if (raw.trim() !== '') out.push({ start, end: src.length, text: raw })
  }
  return out
}

/**
 * Extract hard anchors from a claim: the tokens that actually carry technical
 * evidence.
 *
 * This is the answer to "lexical matching misses paraphrases" that does not
 * require embeddings. Technical claims are usually supported by things that are
 * copied verbatim in the source — numbers with units, identifiers, paths, quoted
 * strings, error codes. Matching those is far sharper than matching words, and it
 * fails in the safe direction: if a number is absent, the sentence probably is not
 * the supporting one.
 *
 * @param {string} text
 * @returns {Set<string>} lowercased anchors
 */
export function extractAnchors(text) {
  const src = String(text ?? '')
  const out = new Set()
  const push = (value) => {
    const v = value.trim().toLowerCase()
    if (v.length >= 1) out.add(v)
  }
  // Numbers, with an optional unit: 8, 0.86 MPa, 1416ms, 100%, 12 天
  for (const m of src.matchAll(/\d+(?:\.\d+)?\s*(?:MPa|kPa|Pa|ms|s|GB|MB|KB|%|kW|W|V|A|Hz|个|条|篇|次|天|小时|分钟|秒)?/gi)) push(m[0].replace(/\s+/g, ''))
  // Identifiers: ZX-9, dsh-memory, a.b.c, v1.2.3
  for (const m of src.matchAll(/\b[A-Za-z][A-Za-z0-9]*(?:[-_.][A-Za-z0-9]+)+\b/g)) push(m[0])
  // Inline code and quoted spans are usually exact excerpts.
  for (const m of src.matchAll(/`([^`\n]{1,80})`/g)) push(m[1])
  for (const m of src.matchAll(/"([^"\n]{1,80})"/g)) push(m[1])
  // File-ish tokens.
  for (const m of src.matchAll(/[\w./-]+\.(?:md|json|js|mjs|cjs|py|sh|yaml|yml|txt|log|pcap|apk|so|exe)\b/gi)) push(m[0])
  return out
}

/**
 * Rank the sentences inside a passage by how well they support a claim.
 *
 * Anchors dominate; word coverage breaks ties. The softmax-free weighting keeps
 * the score interpretable, which matters more here than a prettier ordering.
 *
 * @param {string} body - whole note body (sentence offsets are body offsets)
 * @param {{start:number,end:number}} passage
 * @param {string} claim
 * @param {{tokenize?:(text:string)=>Set<string>}} [deps]
 * @param {number} [limit]
 * @returns {Array<{start:number,end:number,text:string,score:number,anchorHits:string[]}>}
 */
export function locateSentences(body, passage, claim, deps = {}, limit = 3) {
  const tokenize = deps.tokenize
  if (typeof tokenize !== 'function') return []
  const sentences = splitSentences(String(body ?? ''))
  if (sentences.length === 0) return []

  const inRange = sentences.filter((s) => s.end > passage.start && s.start < passage.end)
  const pool = inRange.length > 0 ? inRange : sentences

  const anchors = extractAnchors(claim)
  const claimTokens = tokenize(claim)
  if (anchors.size === 0 && claimTokens.size === 0) return []

  const maxAnchorScore = anchors.size * 3
  const scored = []
  for (const sentence of pool) {
    // Anchors are whitespace-stripped when extracted ("0.86 MPa" -> "0.86mpa"),
    // so the haystack must be stripped the same way or the units never match.
    const haystack = sentence.text.toLowerCase().replace(/\s+/g, '')
    const anchorHits = []
    for (const anchor of anchors) if (haystack.includes(anchor)) anchorHits.push(anchor)
    const anchorScore = anchorHits.length * 3

    const tokens = tokenize(sentence.text)
    let termHit = 0
    for (const token of claimTokens) if (tokens.has(token)) termHit++
    const termScore = claimTokens.size > 0 ? termHit / claimTokens.size : 0

    // Anchors are worth 3x a term; normalise so scores stay comparable across claims.
    const denominator = Math.max(1, maxAnchorScore + 1)
    const score = (anchorScore + termScore) / denominator
    scored.push({ start: sentence.start, end: sentence.end, text: sentence.text, score, anchorHits })
  }

  scored.sort((a, b) => b.score - a.score || a.start - b.start)
  return scored.slice(0, Math.max(1, limit))
}

/**
 * Backwards-compatible single best sentence.
 * @returns {{start:number,end:number,text:string,score:number,anchorHits:string[]}|null}
 */
export function locateSentence(body, passage, claim, deps = {}) {
  const ranked = locateSentences(body, passage, claim, deps, 1)
  return ranked.length > 0 ? ranked[0] : null
}

/**
 * Convert a character range to 1-based line numbers.
 *
 * Why bother: a range is only useful if something can jump to it. Line numbers
 * work in every editor and terminal, so `path:12-15` is immediately navigable
 * even before any UI plugin exists.
 *
 * @param {string} body
 * @param {{start:number,end:number}} range
 * @returns {{startLine:number,endLine:number}}
 */
export function lineRangeOf(body, range) {
  const src = String(body ?? '')
  const start = Math.max(0, Math.min(src.length, range?.start ?? 0))
  const end = Math.max(start, Math.min(src.length, range?.end ?? start))
  let startLine = 1
  for (let i = 0; i < start; i++) if (src[i] === '\n') startLine++
  let endLine = startLine
  for (let i = start; i < end; i++) if (src[i] === '\n') endLine++
  return { startLine, endLine }
}

/**
 * Report link health for a vault: unresolved and ambiguous links are the two
 * ways a knowledge base quietly rots.
 *
 * @param {import('./index.js').VaultIndex} index
 * @returns {{unresolved:Array<{from:string,raw:string,target:string}>,
 *            ambiguous:Array<{from:string,raw:string,target:string,candidates:string[]}>,
 *            totalLinks:number, resolvedLinks:number}}
 */
export function linkHealth(index) {
  const unresolved = []
  const ambiguous = []
  let totalLinks = 0
  let resolvedLinks = 0
  for (const path of index.paths()) {
    for (const link of index.outlinksOf(path)) {
      totalLinks++
      if (link.resolution === 'file' || link.resolution === 'self') {
        resolvedLinks++
      } else if (link.resolution === 'ambiguous') {
        ambiguous.push({ from: path, raw: link.raw, target: link.target, candidates: link.candidates ?? [] })
      } else {
        unresolved.push({ from: path, raw: link.raw, target: link.target })
      }
    }
  }
  return { unresolved, ambiguous, totalLinks, resolvedLinks }
}
