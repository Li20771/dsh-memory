// Query grammar, matching, scoring, and the scope funnel.
//
// The query language is calibrated to Obsidian 1.13.7 core Search
// (`docs/superpowers/plans/2026-10-23-obsidian-re-delivery.md` §3):
//
//   space        AND          (binds TIGHTER than OR: `a b OR c` = `(a AND b) OR c`)
//   OR           OR           (uppercase only; lowercase `or` is a plain term)
//   -x           NOT
//   "..."        phrase       (\" escapes)
//   /.../        regex        (no flags; case sensitivity comes from match-case)
//   key:value    operator     (path file content line section block tag)
//   key:( ... )  scoped group
//   [prop:value] frontmatter property
//   prop>value   comparison   (also `<`)
//   match-case / ignore-case  switches for subsequent matching
//
// Matching is boolean (does this note match at all); ranking is separate, so a
// query that matches 400 notes still returns the best 8 by IDF + recency +
// salience. Deferred and documented at the bottom: `task:*`.
//
// @module dsh-memory/vault/query

import { lineRangeOf, locateSentences, makeCitation, revisionOf } from './cite.js'

// Obsidian's operators plus five of our own (`type` `scope` `status`
// `authority` `review`), because the layer model filters on frontmatter that a
// general-purpose vault does not have. The Obsidian set is unchanged.
const OPS = new Set([  'path',
  'file',
  'content',
  'line',
  'section',
  'block',
  'tag',
  'type',
  'scope',
  'status',
  'authority',
  'review'
])
const KEYWORDS = new Set(['OR', 'TRUE', 'FALSE', 'EMPTY'])
const CUT_CHARS = new Set(['[', ']', '(', ')', ':', '>', '<'])

/**
 * Tokenize for overlap scoring. Latin/number runs of length >= 2 become whole
 * tokens; CJK runs contribute unigrams and bigrams (no segmenter here, and
 * Chinese queries still have to work).
 * @param {string} text
 * @returns {Set<string>}
 */
export function tokenize(text) {
  const lower = String(text ?? '').toLowerCase()
  const tokens = new Set()
  for (const m of lower.matchAll(/[a-z0-9_]{2,}/g)) tokens.add(m[0])
  for (const m of lower.matchAll(/[\u3400-\u4dbf\u4e00-\u9fff]+/g)) {
    const run = m[0]
    for (let i = 0; i < run.length; i++) {
      tokens.add(run[i])
      if (i + 1 < run.length) tokens.add(run.slice(i, i + 2))
    }
  }
  return tokens
}

// ----------------------------------------------------------------- lexer

/**
 * Lex a query string.
 * @param {string} src
 * @returns {Array<{type:string,value?:string,op?:string}>}
 */
export function lex(src) {
  const tokens = []
  const text = String(src ?? '')
  let i = 0
  const push = (token) => tokens.push(token)

  while (i < text.length) {
    const ch = text[i]
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i++
      continue
    }
    if (ch === '(' || ch === ')') {
      push({ type: ch })
      i++
      continue
    }
    if (ch === '"') {
      let out = ''
      i++
      while (i < text.length && text[i] !== '"') {
        if (text[i] === '\\' && text[i + 1] === '"') {
          out += '"'
          i += 2
          continue
        }
        out += text[i++]
      }
      i++
      push({ type: 'phrase', value: out })
      continue
    }
    if (ch === '/') {
      let out = ''
      i++
      while (i < text.length && text[i] !== '/') {
        if (text[i] === '\\' && text[i + 1] === '/') {
          out += '/'
          i += 2
          continue
        }
        out += text[i++]
      }
      i++
      push({ type: 'regex', value: out })
      continue
    }
    if (ch === '[') {
      let out = ''
      i++
      while (i < text.length && text[i] !== ']') out += text[i++]
      i++
      push({ type: 'prop', value: out })
      continue
    }
    if (ch === '-' && i + 1 < text.length && text[i + 1] !== ' ') {
      i++
      push({ type: 'NOT' })
      // The negated atom follows as its own token.
      continue
    }

    // Bare word: stops at whitespace or a structural character.
    let word = ''
    while (i < text.length && !/\s/.test(text[i]) && !CUT_CHARS.has(text[i])) word += text[i++]
    if (word === '') {
      i++
      continue
    }
    if (KEYWORDS.has(word)) {
      push({ type: word })
      continue
    }
    // `match-case` / `ignore-case` are flag operators written WITHOUT a colon,
    // so they must be recognized here or they degrade into literal search terms.
    if (word === 'match-case' || word === 'ignore-case') {
      push({ type: 'mode', value: word === 'match-case' })
      continue
    }
    if (text[i] === ':') {
      i++
      if (text[i] === '(') {
        push({ type: 'op', op: word.toLowerCase(), group: true })
        push({ type: '(' })
        i++
        continue
      }
      let value = ''
      while (i < text.length && !/\s/.test(text[i]) && text[i] !== ')') value += text[i++]
      const node = { type: 'op', op: word.toLowerCase(), value }
      // Allow /regex/ as an operator argument.
      if (value.startsWith('/') && value.endsWith('/') && value.length > 2) {
        node.regex = value.slice(1, -1)
        node.value = ''
      }
      push(node)
      continue
    }
    if (text[i] === '>' || text[i] === '<') {
      const cmp = text[i]
      i++
      let value = ''
      while (i < text.length && !/\s/.test(text[i])) value += text[i++]
      push({ type: 'cmp', op: word, cmp, value })
      continue
    }
    push({ type: 'text', value: word })
  }
  return tokens
}

// ---------------------------------------------------------------- parser

/**
 * Parse a query string into an AST.
 * @param {string} src
 * @returns {{type:string, node?:object, items?:object[]}}
 */
export function parseQuery(src) {
  const tokens = lex(src)
  let pos = 0
  const peek = () => tokens[pos]
  const next = () => tokens[pos++]

  function parseOr() {
    const items = [parseAnd()]
    while (peek() && peek().type === 'OR') {
      next()
      items.push(parseAnd())
    }
    return items.length === 1 ? items[0] : { type: 'or', items }
  }

  function parseAnd() {
    const items = []
    while (true) {
      const t = peek()
      if (!t || t.type === 'OR' || t.type === ')') break
      const node = parseUnary()
      if (node) items.push(node)
    }
    if (items.length === 0) return { type: 'all' }
    return items.length === 1 ? items[0] : { type: 'and', items }
  }

  function parseUnary() {
    const t = peek()
    if (t && t.type === 'NOT') {
      next()
      const inner = parseUnary()
      return inner ? { type: 'not', node: inner } : null
    }
    return parsePrimary()
  }

  function parsePrimary() {
    const t = next()
    if (!t) return null
    if (t.type === '(') {
      const inner = parseOr()
      if (peek() && peek().type === ')') next()
      return { type: 'group', node: inner }
    }
    if (t.type === 'TRUE' || t.type === 'FALSE' || t.type === 'EMPTY') {
      return { type: 'const', value: t.type === 'TRUE' }
    }
    if (t.type === 'text' || t.type === 'phrase' || t.type === 'regex' || t.type === 'prop') {
      return { type: t.type, value: t.value }
    }
    if (t.type === 'cmp') {
      return { type: 'cmp', op: t.op, cmp: t.cmp, value: t.value }
    }
    if (t.type === 'mode') {
      return { type: 'mode', value: t.value }
    }
    if (t.type === 'op') {
      // A known operator; `match-case` / `ignore-case` are mode switches.
      const name = t.op
      if (name === 'match-case' || name === 'ignore-case') {
        return { type: 'mode', value: name === 'match-case' }
      }
      if (OPS.has(name)) {
        if (t.group) {
          const inner = parseOr()
          if (peek() && peek().type === ')') next()
          return { type: 'scope', op: name, node: inner }
        }
        return { type: 'op', op: name, value: t.value, regex: t.regex }
      }
      // Unknown operator: Obsidian throws; we keep it as a literal term so a
      // typo degrades into a search instead of an exception.
      return { type: 'text', value: `${name}:${t.value ?? ''}` }
    }
    return null
  }

  const ast = parseOr()
  return ast
}

// ------------------------------------------------------------- evaluation

const asArray = (v) => (Array.isArray(v) ? v.map((x) => String(x).toLowerCase()) : v == null ? [] : [String(v).toLowerCase()])

/** Glob with `*` / `**`, matched against a posix path. */
function globToRegExp(glob) {
  let out = '^'
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i]
    if (ch === '*') {
      if (glob[i + 1] === '*') {
        out += '.*'
        i++
        if (glob[i + 1] === '/') i++
      } else out += '[^/]*'
    } else if ('\\^$.|?+()[]{}'.includes(ch)) out += `\\${ch}`
    else out += ch
  }
  return new RegExp(`${out}$`)
}

function makeDoc(fileId, entry) {
  const body = entry.parsed.body
  const fm = entry.parsed.frontmatter ?? {}
  return {
    id: fileId,
    path: fileId.toLowerCase(),
    file: fileId.toLowerCase().slice(fileId.lastIndexOf('/') + 1).replace(/\.md$/, ''),
    body,
    lower: body.toLowerCase(),
    tags: entry.parsed.tags.map((t) => t.toLowerCase()),
    headings: entry.parsed.headings ?? [],
    blocks: entry.parsed.blocks ?? [],
    fm
  }
}

function sectionTextFor(doc, matcher) {
  // `section:` and `block:` both test within a range; the difference is the
  // slicing unit: heading sections vs blocks (RE §10.1).
  for (const heading of doc.headings) {
    const slice = doc.body.slice(heading.start, heading.end)
    if (matcher(slice.toLowerCase())) return true
  }
  return false
}

function blockTextFor(doc, matcher) {
  for (const block of doc.blocks) {
    const slice = doc.body.slice(block.start, block.end)
    if (matcher(slice.toLowerCase())) return true
  }
  return false
}

/**
 * Evaluate an AST against one document.
 * @param {object} node
 * @param {object} doc
 * @param {{caseSensitive:boolean}} ctx
 * @returns {boolean}
 */
function evaluate(node, doc, ctx) {
  if (!node) return true
  switch (node.type) {
    case 'all':
      return true
    case 'const':
      return node.value
    case 'and':
      return node.items.every((item) => evaluate(item, doc, ctx))
    case 'or':
      return node.items.some((item) => evaluate(item, doc, ctx))
    case 'not':
      return !evaluate(node.node, doc, ctx)
    case 'group':
      return evaluate(node.node, doc, ctx)
    case 'mode':
      ctx.caseSensitive = node.value
      return true
    case 'text': {
      const needle = ctx.caseSensitive ? node.value : String(node.value).toLowerCase()
      const hay = ctx.caseSensitive ? doc.body : doc.lower
      if (hay.includes(needle)) return true
      // CJK/word-overlap fallback. `tokenize` lowercases internally, so it must
      // NOT run under match-case — otherwise `match-case cpa` would match "CPA"
      // through this back door and silently ignore the flag.
      if (ctx.caseSensitive) return false
      const tokens = tokenize(node.value)
      if (tokens.size === 0) return false
      const hayTokens = tokenize(doc.body)
      return [...tokens].every((t) => hayTokens.has(t))
    }
    case 'phrase': {
      const needle = ctx.caseSensitive ? node.value : String(node.value).toLowerCase()
      return (ctx.caseSensitive ? doc.body : doc.lower).includes(needle)
    }
    case 'regex': {
      let re
      try {
        re = new RegExp(node.value, ctx.caseSensitive ? '' : 'i')
      } catch {
        return false
      }
      return re.test(doc.body)
    }
    case 'prop': {
      const at = node.value.indexOf(':')
      const key = (at < 0 ? node.value : node.value.slice(0, at)).trim().toLowerCase()
      const want = at < 0 ? '' : node.value.slice(at + 1).trim().toLowerCase()
      const values = asArray(doc.fm[key]).concat(
        Object.entries(doc.fm)
          .filter(([k]) => k.toLowerCase() === key)
          .flatMap(([, v]) => asArray(v))
      )
      if (want === '') return values.length > 0
      return values.some((v) => v === want || v.includes(want))
    }
    case 'cmp': {
      const values = asArray(doc.fm[node.op] ?? Object.entries(doc.fm).find(([k]) => k.toLowerCase() === node.op.toLowerCase())?.[1])
      if (values.length === 0) return false
      const target = Number(node.value)
      return values.some((v) => {
        const n = Number(v)
        if (Number.isFinite(n) && Number.isFinite(target)) return node.cmp === '>' ? n > target : n < target
        return node.cmp === '>' ? v > node.value.toLowerCase() : v < node.value.toLowerCase()
      })
    }
    case 'op': {
      const value = String(node.value ?? '')
      const lowerValue = value.toLowerCase()
      switch (node.op) {
        case 'path':
          if (node.regex) {
            try {
              return new RegExp(node.regex, ctx.caseSensitive ? '' : 'i').test(doc.id)
            } catch {
              return false
            }
          }
          return lowerValue.includes('*') ? globToRegExp(lowerValue).test(doc.path) : doc.path.includes(lowerValue)
        case 'file':
          return doc.file.includes(lowerValue)
        case 'content':
          return (ctx.caseSensitive ? doc.body : doc.lower).includes(lowerValue)
        case 'line':
          return doc.body.split('\n').some((line) => (ctx.caseSensitive ? line : line.toLowerCase()).includes(lowerValue))
        case 'tag':
          return doc.tags.some((t) => t === lowerValue || t.startsWith(`${lowerValue}/`))
        case 'section':
          return sectionTextFor(doc, (slice) => slice.includes(lowerValue))
        case 'block':
          return blockTextFor(doc, (slice) => slice.includes(lowerValue))
        case 'type': {
          return String(doc.fm.type ?? '').toLowerCase() === lowerValue
        }
        case 'scope': {
          const scope = String(doc.fm.scope ?? '').toLowerCase()
          return scope === lowerValue || scope.startsWith(`${lowerValue}/`)
        }
        case 'status': {
          return String(doc.fm.status ?? '').toLowerCase() === lowerValue
        }
        case 'authority': {
          return String(doc.fm.authority ?? '').toLowerCase() === lowerValue
        }
        case 'review': {
          const state = doc.fm.review && typeof doc.fm.review === 'object' ? doc.fm.review.state : doc.fm.review
          return String(state ?? '').toLowerCase() === lowerValue
        }
        default:
          return false
      }
    }
    case 'scope': {
      const nested = (slice) => evaluate(node.node, { ...doc, body: slice, lower: slice.toLowerCase() }, { ...ctx })
      if (node.op === 'section') return sectionTextFor(doc, (slice) => nested(slice))
      if (node.op === 'block') return blockTextFor(doc, (slice) => nested(slice))
      return evaluate(node.node, doc, ctx)
    }
    default:
      return true
  }
}

// ---------------------------------------------------------------- corpus

/** Per-index cache of tokenization + document frequency, keyed on version. */
const indexCache = new WeakMap()

function getCorpus(index) {
  const version = index.version ?? 0
  const cached = indexCache.get(index)
  if (cached && cached.version === version) return cached

  const entries = index.paths().map((p) => [p, index.get(p)]).filter(([, e]) => e)
  const df = new Map()
  const entryTokens = new Map()
  const docs = new Map()
  for (const [path, entry] of entries) {
    const tokens = tokenize(`${entry.parsed.body}\n${entry.parsed.tags.join(' ')}`)
    entryTokens.set(path, tokens)
    docs.set(path, makeDoc(path, entry))
    for (const token of tokens) df.set(token, (df.get(token) || 0) + 1)
  }
  const corpus = { version, entries, df, entryTokens, docs, total: entries.length || 1 }
  indexCache.set(index, corpus)
  return corpus
}

// ------------------------------------------------------------------ search

/**
 * Search the vault.
 *
 * @param {import('./index.js').VaultIndex} index
 * @param {string} raw
 * @param {{limit?:number,
 *          scopes?:Array<{name:string,test:(fileId:string,entry:object)=>boolean}>,
 *          minScore?:number,
 *          halfLifeDays?:number,
 *          now?:number}} [options]
 * @returns {{hits:Array<object>,triedScopes:string[],widened:boolean,notes:string[]}}
 */
export function search(index, raw, options = {}) {
  const { limit = 8, scopes = [], minScore = 0.001, halfLifeDays = 90, now = Date.now(), candidateBoost = null } = options
  const ast = parseQuery(raw)
  const notes = []
  const { entries, df, entryTokens, docs, total } = getCorpus(index)

  // IDF weights from the query's own terms, so ranking is query-aware while
  // matching stays boolean.
  const queryTokens = new Set()
  const walk = (node) => {
    if (!node) return
    if (node.type === 'text' || node.type === 'phrase' || node.type === 'op') {
      const v = node.value
      if (typeof v === 'string') for (const t of tokenize(v)) queryTokens.add(t)
    }
    for (const key of ['items', 'node']) {
      const child = node[key]
      if (Array.isArray(child)) child.forEach(walk)
      else if (child) walk(child)
    }
  }
  walk(ast)

  const weights = new Map()
  let queryWeight = 0
  for (const token of queryTokens) {
    const seen = df.get(token) || 0
    if (seen === 0) continue
    const idf = Math.log(1 + total / seen)
    weights.set(token, idf)
    queryWeight += idf
  }

  const halfLifeMs = Math.max(1, halfLifeDays) * 86_400_000
  const evaluateScope = (scopeTest) => {
    const out = []
    for (const [path, entry] of entries) {
      if (scopeTest && !scopeTest(path, entry)) continue
      const doc = docs.get(path)
      // A boosted candidate is TRUSTED: the caller already applied its own hard
      // filters (scope, type) when it built the boost set, so we skip the boolean
      // AST for it and let it rank on the lexical score alone. That is what keeps
      // semantic recall from smuggling in a note outside the requested layer.
      const boosted = candidateBoost !== null && candidateBoost.has(path)
      if (!boosted && !evaluate(ast, doc, { caseSensitive: false })) continue

      const tokens = entryTokens.get(path)
      let hit = 0
      for (const [token, weight] of weights) if (tokens.has(token)) hit += weight
      let coverage = queryWeight > 0 ? hit / queryWeight : 1
      // Give a zero-overlap semantic candidate a floor so it survives ranking
      // instead of being dropped as "no evidence" — but keep it low, so genuine
      // lexical hits still outrank it.
      if (boosted && coverage < 0.12) coverage = 0.12
      const created = Date.parse(entry.parsed.frontmatter?.created ?? '')
      const age = Number.isFinite(created) ? now - created : halfLifeMs
      const recency = Math.exp(-Math.max(0, age) / halfLifeMs)
      const salienceRaw = Number(entry.parsed.frontmatter?.salience)
      const salience = Number.isFinite(salienceRaw) ? (Math.min(5, Math.max(1, salienceRaw)) - 1) / 4 : 0.5
      const review = String(entry.parsed.frontmatter?.review?.state ?? '').toLowerCase()
      const reviewWeight = review === 'pending' ? 0.75 : 1
      const score = (0.7 * coverage + 0.18 * recency + 0.12 * salience) * reviewWeight
      if (score < minScore) continue
      out.push({ path, entry, doc, score, coverage, review })
    }
    out.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
    return out
  }

  // Funnel: narrowest scope first; widen only when a scope yields nothing.
  const ladder = scopes.length > 0 ? scopes : [{ name: 'all', test: null }]
  const triedScopes = []
  let widened = false
  let hits = []
  for (const scope of ladder) {
    triedScopes.push(scope.name)
    hits = evaluateScope(scope.test)
    if (hits.length > 0) {
      if (triedScopes.length > 1) widened = true
      break
    }
  }
  if (widened) notes.push(`结果来自扩大的作用域：${triedScopes.join(' → ')}`)

  const trimmed = hits.slice(0, limit).map((hit) => {
    const passage = bestPassage(hit.doc, weights)
    const containing = hit.doc.headings
      .filter((h) => h.start <= passage.start)
      .sort((a, b) => b.start - a.start)[0]
    // Which id'd block contains the passage? A block id is a stronger anchor than
    // a heading, so it wins when both apply.
    const block = (hit.doc.blocks ?? []).find((b) => b.start <= passage.start && passage.start < b.end)
    const revision = revisionOf(hit.doc.body)
    const citation = makeCitation({
      note: hit.path,
      block: block?.id ?? null,
      heading: containing?.text ?? null,
      revision,
      range: { start: passage.start, end: passage.end }
    })
    // Sentence-level precision, which the reconstruction could not copy: the
    // passage is the ceiling over there, here we add one more layer. Anchor-first
    // scoring keeps it sharp for technical text (numbers, identifiers, paths).
    const sentenceCandidates = locateSentences(
      hit.doc.body,
      { start: passage.start, end: passage.end },
      raw,
      { tokenize },
      3
    ).map((candidate) => ({
      text: candidate.text.trim().slice(0, 240),
      range: { start: candidate.start, end: candidate.end },
      score: Number(candidate.score.toFixed(2)),
      anchors: candidate.anchorHits.slice(0, 4)
    }))
    const sentence = sentenceCandidates[0] ?? null
    const lines = lineRangeOf(hit.doc.body, { start: passage.start, end: passage.end })
    const sentenceLines = sentence ? lineRangeOf(hit.doc.body, sentence.range) : null
    return {
      path: hit.path,
      score: Number(hit.score.toFixed(4)),
      coverage: Number(hit.coverage.toFixed(4)),
      review: hit.review || null,
      cite: citation.ref,
      revision,
      citation,
      lines,
      sentence,
      sentenceCandidates,
      sentenceLines,
      section: containing?.text ?? null,
      passage: passage.text.trim().slice(0, 400),
      range: { start: passage.start, end: passage.end }
    }
  })

  if (trimmed.length === 0) notes.push('没有匹配的笔记')
  return { hits: trimmed, triedScopes, widened, notes }
}

/** Pick the paragraph with the most query-token weight. */
function bestPassage(doc, weights) {
  const body = doc.body
  const starts = [0]
  for (let i = 0; i < body.length; i++) if (body[i] === '\n') starts.push(i + 1)
  const paragraphs = []
  let current = null
  for (let i = 0; i < starts.length; i++) {
    const from = starts[i]
    const to = i + 1 < starts.length ? starts[i + 1] - 1 : body.length
    if (body.slice(from, to).trim() === '') {
      if (current) {
        paragraphs.push(current)
        current = null
      }
      continue
    }
    if (!current) current = { start: from, end: to, text: body.slice(from, to) }
    else {
      current.end = to
      current.text = body.slice(current.start, to)
    }
  }
  if (current) paragraphs.push(current)
  if (paragraphs.length === 0) return { start: 0, end: body.length, text: '' }
  if (!weights || weights.size === 0) return paragraphs[0]
  let best = paragraphs[0]
  let bestScore = -1
  for (const paragraph of paragraphs) {
    const tokens = tokenize(paragraph.text)
    let score = 0
    for (const [token, weight] of weights) if (tokens.has(token)) score += weight
    if (score > bestScore) {
      bestScore = score
      best = paragraph
    }
  }
  return best
}

// Deferred, documented rather than half-implemented:
//   task: / task-todo / task-done — checkbox-state operators. They need a
//   task model (open/closed, due dates) that this vault layer does not have
//   yet; adding a wrong version would be worse than the honest gap.
