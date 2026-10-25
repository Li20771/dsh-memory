// Markdown + YAML-frontmatter parsing for the DSH memory vault.
//
// Two rules govern everything here:
//   1. Every offset returned points into the ORIGINAL text, because a citation
//      (`[[note#^blk]]`) has to resolve to an exact character range in the file
//      the human will open. Frontmatter is skipped by offset, never by re-slicing.
//   2. Code is masked, not removed. Fenced and inline code is replaced with
//      spaces of identical length before any link/tag/block scan, so `[[x]]`
//      inside a fence is inert while every offset stays valid.
//
// @module dsh-memory/vault/parse

/** Recognized YAML constructs. Anything outside this subset is kept as a raw string. */
const KEY_RE = /^([ \t]*)((?:[A-Za-z0-9_.-]+)|(?:"(?:[^"\\]|\\.)*")|(?:'(?:[^']|'')*'))[ \t]*:(?:[ \t]+(.*))?$/
const ITEM_RE = /^([ \t]*)[-*+][ \t]+(.*)$/
// Block detection needs ordered lists too (`1. item`). Kept separate from ITEM_RE
// because that one also parses YAML sequences, where `1.` is not a bullet.
const LIST_ITEM_RE = /^([ \t]*)(?:[-*+]|\d{1,9}[.)])[ \t]+(.*)$/
// `[ \t\r]*$` rather than `[ \t]*$`: on a CRLF file each line keeps its `\r`, and
// without allowing it every block id at end-of-line silently failed to parse.
const BLOCK_ID_RE = /(?:^|[ \t])\^([A-Za-z0-9-]+)[ \t\r]*$/
const HEADING_RE = /^(#{1,6})[ \t]+(.*?)[ \t]*#*[ \t]*$/
const FENCE_RE = /^[ \t]*(`{3,}|~{3,})/
const INLINE_CODE_RE = /`[^`\n]*`/g

const indentOf = (line) => line.length - line.trimStart().length
const isBlank = (line) => line.trim() === ''
const isComment = (line) => line.trim().startsWith('#') && !/^#{1,6}[ \t]/.test(line.trim())

/**
 * Split a comma-separated inline list without breaking on commas inside quotes
 * or nested brackets.
 * @param {string} inner
 * @returns {string[]}
 */
function splitTopLevel(inner) {
  const parts = []
  let depth = 0
  let quote = ''
  let current = ''
  for (const ch of inner) {
    if (quote) {
      current += ch
      if (ch === quote) quote = ''
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      current += ch
      continue
    }
    if (ch === '[' || ch === '{') depth++
    if (ch === ']' || ch === '}') depth--
    if (ch === ',' && depth === 0) {
      parts.push(current)
      current = ''
      continue
    }
    current += ch
  }
  if (current.trim() !== '') parts.push(current)
  return parts
}

/**
 * Interpret one scalar token.
 * @param {string} raw
 * @returns {string|number|boolean|null}
 */
function parseScalar(raw) {
  const s = String(raw ?? '').trim()
  if (s === '') return null
  if (s === 'null' || s === '~') return null
  if (s === 'true') return true
  if (s === 'false') return false
  if (/^-?\d+$/.test(s)) return Number(s)
  if (/^-?(?:\d+\.\d*|\d*\.\d+)$/.test(s)) return Number(s)
  if (s.startsWith('[') && s.endsWith(']')) {
    const inner = s.slice(1, -1).trim()
    if (inner === '') return []
    return splitTopLevel(inner).map((part) => parseScalar(part))
  }
  if (s.startsWith('{') && s.endsWith('}')) {
    const inner = s.slice(1, -1).trim()
    const out = {}
    if (inner === '') return out
    for (const part of splitTopLevel(inner)) {
      const idx = part.indexOf(':')
      if (idx < 0) continue
      const k = part.slice(0, idx).trim().replace(/^["']|["']$/g, '')
      out[k] = parseScalar(part.slice(idx + 1))
    }
    return out
  }
  if ((s.startsWith('"') && s.endsWith('"') && s.length >= 2) || (s.startsWith("'") && s.endsWith("'") && s.length >= 2)) {
    return s.slice(1, -1)
  }
  return s
}

/** Skip blanks and comments from `i`. */
function nextSignificant(lines, i) {
  let j = i
  while (j < lines.length && (isBlank(lines[j]) || isComment(lines[j]))) j++
  return j
}

/** Parse a `- item` sequence whose dashes sit at exactly `indent`. */
function parseSeq(lines, i, indent, warnings) {
  const out = []
  let j = i
  while (true) {
    j = nextSignificant(lines, j)
    if (j >= lines.length) break
    const line = lines[j]
    if (indentOf(line) !== indent) break
    const item = ITEM_RE.exec(line)
    if (!item) break

    // Column where an item's content begins: the whole `- ` prefix width.
    const contentCol = item[0].length - item[2].length
    const rest = item[2]

    if (!KEY_RE.test(rest)) {
      out.push(parseScalar(rest))
      j++
      continue
    }

    // `- key: value` opens a mapping item; further keys align at contentCol.
    const obj = {}
    const first = KEY_RE.exec(rest)
    const firstKey = first[2].replace(/^["']|["']$/g, '')
    let cursor
    if (first[3] !== undefined && first[3].trim() !== '') {
      obj[firstKey] = parseScalar(first[3])
      cursor = j + 1
    } else {
      const [nested, next] = parseBlock(lines, j + 1, contentCol + 1, warnings)
      obj[firstKey] = nested
      cursor = next
    }
    while (true) {
      const k = nextSignificant(lines, cursor)
      if (k >= lines.length) {
        cursor = k
        break
      }
      const sibling = lines[k]
      if (indentOf(sibling) !== contentCol) {
        cursor = k
        break
      }
      const m = KEY_RE.exec(sibling)
      if (!m) {
        cursor = k
        break
      }
      const key = m[2].replace(/^["']|["']$/g, '')
      if (m[3] !== undefined && m[3].trim() !== '') {
        obj[key] = parseScalar(m[3])
        cursor = k + 1
      } else {
        const [nested, next] = parseBlock(lines, k + 1, contentCol + 1, warnings)
        obj[key] = nested
        cursor = next
      }
    }
    out.push(obj)
    j = cursor
  }
  return [out, j]
}

/** Parse a `key:` mapping whose keys sit at exactly `indent`. */
function parseMap(lines, i, indent, warnings) {
  const out = {}
  let j = i
  while (j < lines.length) {
    j = nextSignificant(lines, j)
    if (j >= lines.length) break
    const line = lines[j]
    if (indentOf(line) !== indent) break
    const m = KEY_RE.exec(line)
    if (!m) {
      warnings.push(`frontmatter: ignored unparseable line ${j + 1}: ${line.trim().slice(0, 60)}`)
      j++
      continue
    }
    const key = m[2].replace(/^["']|["']$/g, '')
    const inline = m[3]
    if (inline !== undefined && inline.trim() !== '') {
      out[key] = parseScalar(inline)
      j++
      continue
    }
    // Empty value: a nested block, or null.
    const k = nextSignificant(lines, j + 1)
    if (k < lines.length && indentOf(lines[k]) > indent) {
      const [nested, next] = parseBlock(lines, k, indentOf(lines[k]), warnings)
      out[key] = nested
      j = next
    } else {
      out[key] = null
      j++
    }
  }
  return [out, j]
}

/** Decide whether the block at `i` is a sequence or a mapping, then parse it. */
function parseBlock(lines, i, indent, warnings) {
  const j = nextSignificant(lines, i)
  if (j >= lines.length || indentOf(lines[j]) < indent) return [null, i]
  const actual = indentOf(lines[j])
  if (ITEM_RE.test(lines[j])) return parseSeq(lines, j, actual, warnings)
  return parseMap(lines, j, actual, warnings)
}

/**
 * Replace fenced and inline code with spaces, preserving length and newlines.
 * @param {string} text
 * @returns {string} same-length mask
 */
export function maskCode(text) {
  const lines = String(text).split('\n')
  let inFence = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (FENCE_RE.test(line)) {
      inFence = !inFence
      lines[i] = ' '.repeat(line.length)
      continue
    }
    if (inFence) {
      lines[i] = ' '.repeat(line.length)
      continue
    }
    // Indented code block: four spaces or a tab. A tab-indented LIST ITEM is not
    // code (nested bullets look exactly like that), so list lines are exempt —
    // masking them would erase block ids on nested items.
    const indent = line.length - line.trimStart().length
    const indentedCode = /^(?: {4}|\t)/.test(line) && line.trim() !== '' && !LIST_ITEM_RE.test(line)
    if (indentedCode && indent >= 1) {
      lines[i] = ' '.repeat(line.length)
      continue
    }
    lines[i] = line.replace(INLINE_CODE_RE, (s) => ' '.repeat(s.length))
  }
  return lines.join('\n')
}

/**
 * Parse the YAML frontmatter block, if any.
 * @param {string} text
 * @returns {{value: object|null, bodyOffset: number, warnings: string[]}}
 */
function takeFrontmatter(text) {
  const warnings = []
  if (!text.startsWith('---')) return { value: null, bodyOffset: 0, warnings }
  // A frontmatter fence must be followed by a newline.
  const firstBreak = text.indexOf('\n')
  if (firstBreak < 0 || text.slice(0, firstBreak).trim() !== '---') {
    return { value: null, bodyOffset: 0, warnings }
  }
  const close = /\n---[ \t]*(?:\r?\n|$)/.exec(text.slice(firstBreak))
  if (!close) {
    warnings.push('frontmatter: opening --- without a closing ---; treated as body text')
    return { value: null, bodyOffset: 0, warnings }
  }
  const blockStart = firstBreak + 1
  const blockEnd = firstBreak + close.index
  const bodyOffset = firstBreak + close.index + close[0].length
  const lines = text.slice(blockStart, blockEnd).split('\n')
  const [value] = parseBlock(lines, 0, 0, warnings)
  return { value: value && typeof value === 'object' ? value : {}, bodyOffset, warnings }
}

/**
 * Compute the line-start offsets of `text`.
 * @param {string} text
 * @returns {number[]}
 */
function lineStarts(text) {
  const starts = [0]
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1)
  return starts
}

/**
 * Parse one note.
 *
 * Returned `blocks` and `headings` carry absolute character offsets into `text`,
 * so a citation range can be rendered/highlighted directly.
 *
 * @param {string} text - full file contents.
 * @param {{autoBlockIds?: boolean}} [options]
 * @returns {{
 *   frontmatter: object|null,
 *   body: string,
 *   bodyOffset: number,
 *   masked: string,
 *   headings: Array<{level:number,text:string,start:number,end:number}>,
 *   blocks: Array<{id:string|null,kind:string,start:number,end:number,text:string}>,
 *   tags: string[],
 *   warnings: string[]
 * }}
 */
export function parseNote(text, options = {}) {
  const source = String(text ?? '')
  const warnings = []
  const { value: frontmatter, bodyOffset, warnings: fmWarnings } = takeFrontmatter(source)
  warnings.push(...fmWarnings)

  const body = source.slice(bodyOffset)
  const masked = maskCode(body)
  const starts = lineStarts(body)
  const lines = body.split('\n')

  const lineEnd = (i) => (i + 1 < starts.length ? starts[i + 1] - 1 : body.length)

  // ---- headings -----------------------------------------------------------
  const headings = []
  for (let i = 0; i < lines.length; i++) {
    if (isBlank(masked.slice(starts[i], lineEnd(i)).trimEnd()) && lines[i].trim() === '') continue
    const m = HEADING_RE.exec(lines[i])
    if (!m) continue
    if (masked.slice(starts[i], starts[i] + m[1].length) !== lines[i].slice(0, m[1].length)) continue
    headings.push({ level: m[1].length, text: m[2].trim(), start: starts[i], end: body.length })
  }
  // Each heading's range ends at the next heading of the same or higher level.
  for (let i = 0; i < headings.length; i++) {
    for (let j = i + 1; j < headings.length; j++) {
      if (headings[j].level <= headings[i].level) {
        headings[i].end = headings[j].start
        break
      }
    }
  }

  // ---- block ids ----------------------------------------------------------
  // Calibrated to Obsidian 1.13.7 (RE §10.1):
  //   - ids are `[A-Za-z0-9-]+`, compared case-insensitively
  //   - a standalone `^id` line labels the block ABOVE it and is NOT part of
  //     that block's range
  //   - block kinds are paragraph / heading / blockquote / table / list-item
  const blocks = []
  const seenIds = new Set()

  const isHeadingAt = (i) => HEADING_RE.test(lines[i])
  const isQuoteAt = (i) => /^[ \t]*>/.test(lines[i])
  const isTableAt = (i) => /^[ \t]*\|/.test(lines[i])
  const isItemAt = (i) => LIST_ITEM_RE.test(lines[i])

  /** Expand the logical block containing line `anchor`. */
  const expand = (anchor) => {
    if (isHeadingAt(anchor)) return { first: anchor, last: anchor, kind: 'heading' }
    if (isQuoteAt(anchor)) {
      let first = anchor
      let last = anchor
      while (first > 0 && isQuoteAt(first - 1)) first--
      while (last + 1 < lines.length && isQuoteAt(last + 1)) last++
      return { first, last, kind: 'blockquote' }
    }
    if (isTableAt(anchor)) {
      let first = anchor
      let last = anchor
      while (first > 0 && isTableAt(first - 1)) first--
      while (last + 1 < lines.length && isTableAt(last + 1)) last++
      return { first, last, kind: 'table' }
    }
    if (isItemAt(anchor)) {
      const base = indentOf(lines[anchor])
      let last = anchor
      while (last + 1 < lines.length) {
        const nxt = lines[last + 1]
        if (isBlank(nxt) || isHeadingAt(last + 1)) break
        const item = LIST_ITEM_RE.exec(nxt)
        if (item && indentOf(nxt) <= base) break
        last++
      }
      return { first: anchor, last, kind: 'list-item' }
    }
    let first = anchor
    let last = anchor
    while (first > 0) {
      const prev = first - 1
      if (isBlank(lines[prev]) || isHeadingAt(prev) || isItemAt(prev) || isQuoteAt(prev) || isTableAt(prev)) break
      first--
    }
    while (last + 1 < lines.length) {
      const nxt = last + 1
      if (isBlank(lines[nxt]) || isHeadingAt(nxt) || isItemAt(nxt) || isQuoteAt(nxt) || isTableAt(nxt)) break
      last++
    }
    return { first, last, kind: 'paragraph' }
  }

  for (let i = 0; i < lines.length; i++) {
    const lineMasked = masked.slice(starts[i], lineEnd(i))
    const m = BLOCK_ID_RE.exec(lineMasked)
    if (!m) continue
    // Obsidian keeps the id as written and only lowercases the cache KEY. Keeping
    // the original matters because the id is rendered back into links.
    const id = m[1]
    const key = id.toLowerCase()
    if (seenIds.has(key)) {
      warnings.push(`block id "${id}" declared more than once; the first one wins`)
      continue
    }

    const standalone = /^[ \t]*\^[A-Za-z0-9-]+[ \t\r]*$/.test(lineMasked)
    let anchor = i
    if (standalone) {
      let p = i - 1
      while (p >= 0 && isBlank(lines[p])) p--
      if (p < 0) {
        warnings.push(`block id "${id}" on line ${i + 1} has no preceding block`)
        continue
      }
      anchor = p
    }

    seenIds.add(key)
    const { first, last, kind } = expand(anchor)
    const start = starts[first]
    const end = lineEnd(last)
    blocks.push({ id, kind, start, end, text: body.slice(start, end).trimEnd() })
  }

  // ---- tags ---------------------------------------------------------------
  const tags = new Set()
  const fmTags = frontmatter?.tags
  if (Array.isArray(fmTags)) for (const t of fmTags) if (typeof t === 'string') tags.add(t.replace(/^#/, ''))
  else if (typeof fmTags === 'string' && fmTags.trim() !== '') tags.add(fmTags.trim().replace(/^#/, ''))
  // Inline tags: #a/b — requires a boundary before the '#' so URL fragments and
  // headings are not captured.
  const TAG_RE = /(?:^|[\s(（,，;；:：])#([\p{L}\p{N}_/-]+)/gu
  for (const m of masked.matchAll(TAG_RE)) {
    const tag = m[1].replace(/\/+$/, '')
    if (tag.length === 0) continue
    tags.add(tag)
  }

  return {
    frontmatter: frontmatter && Object.keys(frontmatter).length > 0 ? frontmatter : null,
    body,
    bodyOffset,
    masked,
    headings,
    blocks,
    tags: [...tags],
    warnings
  }
}

export const __internals = { parseScalar, splitTopLevel, takeFrontmatter }
