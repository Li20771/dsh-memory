// Note-file helpers shared by the plugin entry and the policy layer.
//
// Kept separate from `vault/` (parsing/indexing) and from `memory/` (policy) so
// that "how a note is written back to disk" has exactly one implementation:
// re-render frontmatter + the body we already parsed. That loses the original
// frontmatter's comments and key order, which is the deliberate trade — the
// alternative is a round-tripping YAML editor, and our frontmatter is ours.
//
// @module dsh-memory/memory/frontmatter

import { readFile, writeFile } from 'node:fs/promises'
import { parseNote } from '../vault/parse.js'

/** Render a scalar for the YAML subset the parser reads back. */
export function yamlValue(value) {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'boolean' || typeof value === 'number') return String(value)
  const s = String(value)
  if (s !== '' && /^[A-Za-z0-9_./+:-]+$/.test(s) && !s.startsWith('-')) return s
  return JSON.stringify(s)
}

/** Serialize frontmatter + body into a note file. */
export function renderNote(frontmatter, body) {
  const lines = ['---']
  for (const [key, value] of Object.entries(frontmatter)) {
    if (value === undefined) continue
    if (Array.isArray(value)) lines.push(`${key}: [${value.map(yamlValue).join(', ')}]`)
    else if (value && typeof value === 'object') {
      lines.push(`${key}:`)
      for (const [k, v] of Object.entries(value)) lines.push(`  ${k}: ${yamlValue(v)}`)
    } else lines.push(`${key}: ${yamlValue(value)}`)
  }
  lines.push('---', '', String(body ?? '').trim(), '')
  return lines.join('\n')
}

/**
 * Read a note, let `mutate` change its frontmatter, and write it back.
 *
 * @param {string} absPath
 * @param {(frontmatter:object, parsed:object) => void} mutate
 * @returns {Promise<object>} the new frontmatter
 */
export async function rewriteNote(absPath, mutate) {
  const raw = await readFile(absPath, 'utf8')
  const parsed = parseNote(raw)
  const frontmatter = { ...(parsed.frontmatter ?? {}) }
  mutate(frontmatter, parsed)
  await writeFile(absPath, renderNote(frontmatter, parsed.body), 'utf8')
  return frontmatter
}
