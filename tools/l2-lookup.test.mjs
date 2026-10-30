// L2 lookup must not depend on the note's filename matching the marker id.
//   node --test tools/l2-lookup.test.mjs
//
// This exact mismatch happened for real: the seeded maps were named
// `workspaces/securitylab.md` while the marker id was `ws_securitylab`, and L2
// silently vanished from the injected block. A missing map is invisible — nothing
// errors, the agent just stops knowing where anything is — so it needs a test.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import plugin from '../plugin/lib/index.js'
import { writeMarker } from '../plugin/lib/workspace.js'

function makeCtx() {
  const tools = []
  const hooks = new Map()
  return {
    tools,
    hooks,
    ctx: {
      systemPrompt: { section: () => () => {} },
      tools: { register: (t) => (tools.push(t), () => {}) },
      on: (event, handler) => {
        if (!hooks.has(event)) hooks.set(event, [])
        hooks.get(event).push(handler)
      },
      logger: { warn: (m) => console.log(`  [warn] ${m}`) }
    }
  }
}

async function blockFor({ notePath, markerId, markerEnabled = false }) {
  const base = await mkdtemp(join(tmpdir(), 'dsh-l2-'))
  try {
    const vaultRoot = join(base, 'kb')
    const workspace = join(base, 'Lab')
    const cwd = join(workspace, 'p1')
    const put = async (rel, body) => {
      const abs = join(vaultRoot, ...rel.split('/'))
      await mkdir(join(abs, '..'), { recursive: true })
      await writeFile(abs, body, 'utf8')
    }
    await put('positioning.md', '---\ntype: positioning\nvisibility: user-global\n---\n# 定位\n\n契约。\n')
    await put(notePath, `---\ntype: workspace\nscope: ${markerId}\nvisibility: workspace-shared\n---\n# 地图\n\n这条路通向资产仓。\n`)
    await mkdir(cwd, { recursive: true })
    await writeMarker(workspace, { schema: 1, enabled: markerEnabled, id: markerId })

    const harness = makeCtx()
    plugin.apply(harness.ctx, { vaultRoot, fullStatIntervalMs: 0 })
    const hook = harness.hooks.get('agent/pre-step')[0]
    const decision = {
      kind: 'continue',
      messages: [{ id: 'm1', role: 'user', content: [{ type: 'text', text: '开始一项研究' }], source: { kind: 'user' } }]
    }
    const out = await hook(
      { agent: { workingDirectory: cwd, session: { id: 's1' } }, messages: decision.messages, step: 1, signal: {} },
      async () => decision
    )
    return out.messages[out.messages.length - 1].content[0].text
  } finally {
    await rm(base, { recursive: true, force: true })
  }
}

test('L2 is injected when the note path matches the marker id (the canonical case)', async () => {
  const text = await blockFor({ notePath: 'workspaces/ws_a.md', markerId: 'ws_a' })
  assert.ok(text.includes('### L2 '), text.slice(0, 500))
  assert.ok(text.includes('这条路通向资产仓'), text.slice(0, 500))
})

test('L2 is still injected when the filename does NOT match the marker id', async () => {
  const text = await blockFor({ notePath: 'workspaces/human-name.md', markerId: 'ws_mismatch' })
  assert.ok(text.includes('### L2 '), `文件名与 id 不一致时 L2 也必须出现：${text.slice(0, 500)}`)
  assert.ok(text.includes('这条路通向资产仓'), text.slice(0, 500))
})

test('L2 appears even when the workspace memory switch is off', async () => {
  const text = await blockFor({ notePath: 'workspaces/ws_b.md', markerId: 'ws_b', markerEnabled: false })
  assert.ok(text.includes('### L2 '), 'L2 不受 L4 开关影响')
  assert.ok(text.includes('L4 关'), '开关关闭时 L4 必须明说，不是安静地少给')
})
