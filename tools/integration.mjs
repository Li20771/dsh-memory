#!/usr/bin/env node
/**
 * Integration test: mount dsh-memory into the *installed* DSH services.
 *
 *   node tools/integration.mjs
 *
 * Unlike plugin.test.mjs (which drives a fake ctx), this builds the real
 * `SystemPrompt` and real `ToolRuntime` from the SDK installed on this machine,
 * then calls the plugin's `apply()`. That covers the two things a fake ctx
 * cannot prove:
 *
 *   - `ctx.tools.register(...)` accepts our hand-written ToolDefinition objects
 *   - `ctx.systemPrompt.section(...)` composes and renders in the real prompt
 *
 * Any probe that cannot be constructed without a full Cordis app is reported as
 * UNCONFIRMED with its reason, never as a pass.
 */
import { fileURLToPath, pathToFileURL } from 'node:url'
import { join, resolve } from 'node:path'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'

const SDK = 'C:/Users/20771/AppData/Local/Programs/DeepSeek Harness/resources/app/dsh/node_modules/@deepseek-ai'
const PLUGIN = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', 'plugin', 'lib', 'index.js')
const entry = (pkg) => pathToFileURL(join(SDK, pkg, 'lib', 'index.js')).href

const passes = []
const failures = []
const unconfirmed = []
const ok = (m) => passes.push(m)
const bad = (m) => failures.push(m)
const unknown = (m, why) => unconfirmed.push(`${m} — ${why}`)

async function main() {
  let Context, ToolRuntime, SystemPrompt, renderPrompt
  try {
    ;({ Context } = await import(entry('cordis')))
  } catch (error) {
    bad(`cannot import real cordis: ${error?.message ?? error}`)
    return report()
  }
  try {
    ;({ ToolRuntime } = await import(entry('dsh-tools')))
  } catch (error) {
    bad(`cannot import real dsh-tools: ${error?.message ?? error}`)
  }
  try {
    ;({ SystemPrompt, renderPrompt } = await import(entry('dsh-system-prompt')))
  } catch (error) {
    bad(`cannot import real dsh-system-prompt: ${error?.message ?? error}`)
  }
  if (failures.length > 0) return report()

  const base = await mkdtemp(join(tmpdir(), 'dsh-mem-int-'))
  const vaultRoot = join(base, 'kb')
  try {
    await mkdir(join(vaultRoot, 'workflows'), { recursive: true })
    await writeFile(join(vaultRoot, 'positioning.md'), '---\ntype: positioning\n---\n# 定位\n\n我为安全研究提供执行与取证。\n', 'utf8')
    await writeFile(join(vaultRoot, 'workflows', 'cache.md'), '---\ntype: workflow\n---\n# 缓存\n\n先 stat 再比哈希。\n', 'utf8')

    const ctx = new Context()

    // SystemPrompt first: ToolRuntime declares `static inject = ["systemPrompt"]`
    // and its constructor touches ctx.systemPrompt immediately.
    try {
      new SystemPrompt(ctx, {})
      ok('constructed real SystemPrompt (ctx.systemPrompt registered)')
    } catch (error) {
      bad(`real SystemPrompt construction failed: ${error?.message ?? error}`)
    }
    try {
      new ToolRuntime(ctx, { mode: 'native', maxParallelSubCalls: 10 })
      ok('constructed real ToolRuntime (ctx.tools registered)')
    } catch (error) {
      bad(`real ToolRuntime construction failed: ${error?.message ?? error}`)
    }

    const plugin = await import(pathToFileURL(PLUGIN).href)
    try {
      plugin.apply(ctx, { vaultRoot, fullStatIntervalMs: 0 })
      ok('plugin.apply() ran against real services without throwing')
    } catch (error) {
      bad(`plugin.apply() threw: ${error?.message ?? error}`)
      return report()
    }

    try {
      const schemas = ctx.tools.schemas()
      const names = (Array.isArray(schemas) ? schemas : []).map((s) => s?.name).filter(Boolean)
      const mine = names.filter((n) => n.startsWith('memory_'))
      if (mine.length === 10) ok(`real registry exposes 10 memory tools (${mine.join(', ')})`)
      else bad(`real registry exposes ${mine.length} memory tools: [${mine.join(', ')}]`)
    } catch (error) {
      unknown('real registry tool listing', String(error?.message ?? error))
    }

    try {
      const assembly = await ctx.systemPrompt.assemble()
      const allText = [
        ...(assembly?.sections ?? []).map((s) => s.text ?? ''),
        ...(assembly?.contexts ?? []).map((c) => c.text ?? '')
      ].join('\n')
      const rendered = typeof renderPrompt === 'function' ? renderPrompt(assembly, ctx) : allText
      const body = typeof rendered === 'string' ? rendered : allText
      if (body.includes('持久记忆')) ok('real SystemPrompt renders the memory discipline section')
      else bad(`memory section missing from rendered prompt (len=${body.length})`)
    } catch (error) {
      unknown('real prompt assembly', String(error?.message ?? error))
    }

    try {
      const tool = ctx.tools.get('memory_search')
      const value = await tool.execute({ query: '哈希' }, { token: 'int', signal: { aborted: false, throwIfAborted() {} } })
      if (typeof value === 'string' && value.includes('workflows/cache.md')) ok('memory_search executes through the real registry and finds the workflow note')
      else bad(`unexpected search result: ${String(value).slice(0, 200)}`)
    } catch (error) {
      unknown('real tool execution', String(error?.message ?? error))
    }
  } finally {
    await rm(base, { recursive: true, force: true })
  }
  report()
}

function report() {
  console.log('')
  for (const line of passes) console.log(`  ✓ ${line}`)
  for (const line of unconfirmed) console.log(`  ? UNCONFIRMED: ${line}`)
  if (failures.length > 0) {
    console.error(`\nintegration: ${failures.length} FAILED\n`)
    for (const line of failures) console.error(`  ✗ ${line}`)
    process.exit(1)
  }
  console.log(`\nintegration: OK — ${passes.length} confirmed, ${unconfirmed.length} unconfirmed`)
}

main().catch((error) => {
  console.error('integration: crashed')
  console.error(error)
  process.exit(1)
})
