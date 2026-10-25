#!/usr/bin/env node
/**
 * Turn episode memory (L4) on or off for one workspace.
 *
 *   node tools/enable-workspace.mjs <dir> --id ws_x --episode ep_y [--coordinator sess_z]
 *   node tools/enable-workspace.mjs <dir> --disable
 *
 * Writes `<dir>/.dsh/memory.json`. This is deliberately a manual, explicit act:
 * the switch lives in the workspace (so it travels with the repo) and nobody but
 * you should flip it. The plugin only honours `enabled === true`; anything else
 * fails closed.
 */
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { readMarker, writeMarker, markerPath } from '../plugin/lib/workspace.js'

const args = process.argv.slice(2)
const dir = args.find((a) => !a.startsWith('--'))
if (!dir) {
  console.error('usage: node tools/enable-workspace.mjs <dir> [--id ws_x] [--episode ep_y] [--coordinator sess_z] [--disable]')
  process.exit(1)
}
const flag = (name) => {
  const at = args.indexOf(`--${name}`)
  return at >= 0 && args[at + 1] && !args[at + 1].startsWith('--') ? args[at + 1] : undefined
}

const root = resolve(dir)
const existing = (await readMarker(root)) ?? { schema: 1 }
const disable = args.includes('--disable')

const next = {
  ...existing,
  schema: 1,
  id: flag('id') ?? existing.id ?? `ws_${root.split(/[\\/]/).pop().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-')}`,
  enabled: !disable,
  updated: new Date().toISOString()
}
const episode = flag('episode') ?? existing.episode
if (episode) next.episode = episode
const coordinator = flag('coordinator')
if (coordinator) {
  const list = new Set(Array.isArray(existing.coordinators) ? existing.coordinators.map(String) : [])
  list.add(coordinator)
  next.coordinators = [...list]
}
if (next.coordinators === undefined) next.coordinators = []

await writeMarker(root, next)

console.log(`${disable ? '已关闭' : '已打开'}: ${root}`)
console.log(`marker: ${markerPath(root)}`)
console.log(JSON.stringify(next, null, 2))
console.log('')
console.log('重启 DSH 后生效（marker 在进程内缓存，切换需重载工作区）。')
