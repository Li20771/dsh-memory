#!/usr/bin/env node
/**
 * Inspect a vault with the real indexer and print what the parser/query actually
 * see. Useful after editing notes by hand.
 *
 *   node tools/vault-check.mjs [vaultRoot] [query]
 */
import { resolve, join } from 'node:path'
import { VaultIndex } from '../plugin/lib/vault/index.js'
import { search } from '../plugin/lib/vault/query.js'

const vaultRoot = resolve(process.argv[2] ?? join(process.cwd(), 'kb'))
const query = process.argv[3] ?? ''

const index = new VaultIndex(vaultRoot)
const stats = await index.rebuild()

console.log(`vault      : ${vaultRoot}`)
console.log(`files      : ${stats.files}  parsed=${stats.parsed}  reused=${stats.reused}  ${stats.ms}ms`)

const byType = new Map()
for (const path of index.paths()) {
  const type = index.get(path).parsed.frontmatter?.type ?? '(none)'
  byType.set(type, (byType.get(type) ?? 0) + 1)
}
console.log(`types      : ${[...byType].map(([k, v]) => `${k}=${v}`).join('  ')}`)

let blocks = 0
let headings = 0
let links = 0
for (const path of index.paths()) {
  const entry = index.get(path)
  blocks += entry.parsed.blocks.length
  headings += entry.parsed.headings.length
  links += entry.outlinks.filter((l) => l.resolution === 'file').length
}
console.log(`blocks     : ${blocks}   headings: ${headings}   resolved links: ${links}`)

const broken = index.warnings
console.log(`warnings   : ${broken.length === 0 ? 'none' : `${broken.length}`}`)
for (const warning of broken.slice(0, 8)) console.log(`  - ${warning}`)

if (query !== '') {
  const result = search(index, query, { limit: 5 })
  console.log('')
  console.log(`query      : ${query}`)
  console.log(`scopes     : ${result.triedScopes.join(' > ')}${result.widened ? '  (widened)' : ''}`)
  if (result.hits.length === 0) console.log('hits       : (none)')
  for (const hit of result.hits) {
    console.log(`  ${hit.score}  ${hit.path}${hit.section ? ` > ${hit.section}` : ''}`)
    console.log(`         ${hit.passage.replace(/\s+/g, ' ').slice(0, 100)}`)
  }
}
