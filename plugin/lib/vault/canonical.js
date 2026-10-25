// Canonical text: a flattened character stream plus an offset map back to the
// original markdown.
//
// WHY THIS EXISTS (from the NotebookLM reconstruction, §7.2):
// a citation range has to point into ONE coordinate system. If block ranges are
// original-file offsets, they include `#`, `**` and paragraph newlines, so a
// range captured from one representation silently misses the other. NotebookLM
// solves this by flattening every source into a canonical stream and indexing
// ranges against THAT. We do the same and keep a map so rendering can still
// highlight the original markdown.
//
// Flattening rules, matching the observed server behaviour:
//   `## Heading`        -> drop the `#` run, keep the text
//   fenced-code fences  -> dropped; the code body is kept
//   inline backticks    -> dropped, content kept
//   `**bold**` / `__x__`-> markers dropped, text kept
//   any newline run     -> a single space
//
// The map is the whole point: `toOriginal(map, start, end)` recovers the exact
// byte range in the file the human will open.
//
// @module dsh-memory/vault/canonical

/**
 * Apply one regex pass while maintaining a character-level index map.
 * @param {string} text
 * @param {number[]} map - map[i] = original index of text[i]
 * @param {RegExp} re - must be global
 * @param {string} replacement - '' to drop, or a short literal to inject
 * @returns {{text:string, map:number[]}}
 */
function pass(text, map, re, replacement) {
  const chars = []
  const out = []
  let last = 0
  re.lastIndex = 0
  let m
  while ((m = re.exec(text)) !== null) {
    for (let k = last; k < m.index; k++) {
      chars.push(text[k])
      out.push(map[k])
    }
    if (replacement !== '') {
      for (const ch of replacement) {
        chars.push(ch)
        out.push(map[m.index])
      }
    }
    last = m.index + m[0].length
    if (m[0].length === 0) re.lastIndex++
  }
  for (let k = last; k < text.length; k++) {
    chars.push(text[k])
    out.push(map[k])
  }
  return { text: chars.join(''), map: out }
}

/**
 * Build the canonical stream for a markdown body.
 * @param {string} body
 * @returns {{text:string, map:number[]}}
 */
export function buildCanonical(body) {
  const src = String(body ?? '')
  let state = { text: src, map: Array.from({ length: src.length }, (_, i) => i) }
  // Heading markers, then fence lines, then emphasis/code markers, then breaks.
  state = pass(state.text, state.map, /^[ \t]*#{1,6}[ \t]+/gm, '')
  state = pass(state.text, state.map, /^[ \t]*(?:`{3,}|~{3,})[^\n]*$/gm, '')
  state = pass(state.text, state.map, /`/g, '')
  state = pass(state.text, state.map, /\*\*|__/g, '')
  state = pass(state.text, state.map, /[\r\n]+/g, ' ')
  return state
}

/**
 * Map a canonical range back to an original-body range.
 * @param {number[]} map
 * @param {number} start - canonical start (inclusive)
 * @param {number} end - canonical end (exclusive)
 * @returns {{start:number, end:number}}
 */
export function toOriginal(map, start, end) {
  if (!Array.isArray(map) || map.length === 0) return { start: 0, end: 0 }
  const s = Math.max(0, Math.min(map.length - 1, start))
  const e = Math.max(s + 1, Math.min(map.length, end))
  const from = map[s]
  const to = map[e - 1] + 1
  return { start: from, end: Math.max(from + 1, to) }
}

/**
 * Split canonical text into passages of about `target` characters on paragraph
 * boundaries, with zero overlap and no tail merging.
 *
 * Calibrated to the observed server behaviour: ~900 characters, cut at
 * paragraph/heading boundaries, adjacent passages share no text, and a short
 * trailing passage stays its own passage (47- and 42-character tails were both
 * kept independent).
 *
 * @param {string} canonical
 * @param {{target?:number}} [options]
 * @returns {Array<{start:number,end:number,text:string}>}
 */
export function segmentPassages(canonical, options = {}) {
  const target = options.target ?? 900
  const text = String(canonical ?? '')
  const passages = []
  // Paragraph boundaries in the canonical stream are the spaces that replaced
  // newline runs; without that information, fall back to fixed-size windows.
  let start = 0
  while (start < text.length) {
    let end = Math.min(text.length, start + target)
    if (end < text.length) {
      // Prefer the last sentence end, then any space, before the hard cut.
      const window = text.slice(start, end)
      const sentence = Math.max(window.lastIndexOf('。'), window.lastIndexOf('. '), window.lastIndexOf('；'))
      const space = window.lastIndexOf(' ')
      const cut = sentence > target * 0.5 ? sentence + 1 : space > target * 0.5 ? space + 1 : window.length
      end = start + cut
    }
    passages.push({ start, end, text: text.slice(start, end) })
    start = end
  }
  return passages
}
