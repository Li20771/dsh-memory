// client 半部 smoke：产物形态 + 契约字面量 + 纯逻辑行为 + 幂等重建。
//   node --test tools/client-smoke.mjs
//
// 本文件只读 `plugin/ui-contract.json`（单真源）与构建产物 `plugin/lib/client.js`，
// 通过注入一个假的 `window.__ModuleLoader__` 在 Node 里真正**执行**产物一次，
// 因此它同时证明「产物不含顶层 DOM 依赖」与「工厂返回的纯逻辑确实按契约工作」。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ARTIFACT = join(ROOT, 'plugin', 'lib', 'client.js')
const BUILD = join(ROOT, 'scripts', 'build-client.mjs')
const CONTRACT = join(ROOT, 'plugin', 'ui-contract.json')

const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex')

function runBuild(env) {
  return spawnSync(process.execPath, [BUILD], {
    cwd: ROOT,
    encoding: 'utf8',
    env: env === undefined ? process.env : { ...process.env, ...env },
  })
}

/** 构建一次并把产物读回来；构建失败就带着 stderr 断言失败（不是抛无关错误）。 */
async function buildAndRead(env) {
  const result = runBuild(env)
  assert.equal(
    result.status,
    0,
    `scripts/build-client.mjs 必须以 0 退出；stdout=${result.stdout}\nstderr=${result.stderr}`,
  )
  return readFile(ARTIFACT, 'utf8')
}

// React 桩：产物工厂顶部会 `require('react')`，这里只需要它不炸。
// 纯逻辑面不依赖 React 的任何行为，故桩可以极薄 —— 这是刻意的：
// 一旦纯逻辑开始依赖 React，这个桩就会让测试失败（而不是被 mock 掩盖）。
// `panelOpen` 用于把「面板打开」这一态喂进组件，从而真正跑一遍面板渲染分支。
function createReactStub(settings) {
  let stateIndex = 0;
  return {
    createElement: (type, props, ...children) => ({
      __reactElement: true,
      args: [type, props, ...children],
    }),
    Fragment: Symbol.for('react.fragment'),
    useCallback: (fn) => fn,
    useEffect: () => {},
    useMemo: (fn) => fn(),
    useRef: (value) => ({ current: value }),
    useState: (value) => {
      const index = stateIndex;
      stateIndex += 1;
      // dmEntryView 的 useState 顺序即契约：0=open 1=view 2=busy 3=pendingPath（见 05-button.js）。
      if (index === 0 && settings.panelOpen === true) return [true, () => {}];
      if (index === 1 && settings.view !== undefined) return [settings.view, () => {}];
      if (index === 3 && settings.pendingPath !== undefined) return [settings.pendingPath, () => {}];
      return [value, () => {}];
    },
    useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
  };
}

/**
 * 在 Node 里执行产物一次：登记 load 入口，再以桩 require 调用工厂。
 * 返回 { entry, exports, hooks } —— hooks 即产物的 `__dshMemory` 纯逻辑面。
 */
async function loadArtifact(options) {
  const settings = options && typeof options === 'object' ? options : {};
  const source = await readFile(ARTIFACT, 'utf8')
  const entries = []
  const fakeWindow = {
    __ModuleLoader__: {
      load(entry) {
        entries.push(entry)
        return entry
      },
    },
  }
  const fakeDocument = { documentElement: { lang: 'zh-CN' } }
  const fakeNavigator = { language: 'zh-CN' }
  const fakeFetch = async () => ({ ok: false, status: 0, json: async () => ({}) })
  const openedUrls = []
  fakeWindow.open = (url, target, features) => {
    openedUrls.push({ url, target, features })
    return null
  }

  const evaluate = new Function(
    'window',
    'document',
    'navigator',
    'fetch',
    `${source}\n//# sourceURL=dsh-memory-client-smoke.js`,
  )
  evaluate(fakeWindow, fakeDocument, fakeNavigator, fakeFetch)

  assert.equal(entries.length, 1, '产物必须登记恰好一个 __ModuleLoader__ 入口')
  const entry = entries[0]
  const reactStub = createReactStub(settings)
  const require = (specifier) => {
    if (specifier === 'react') return reactStub
    throw new Error(`smoke: 产物要求了未预期的平台模块 ${specifier}`)
  }
  const exported = entry.factory(require)
  assert.ok(exported && typeof exported === 'object', '工厂必须返回模块导出对象')
  assert.ok(exported.__dshMemory, '工厂必须在导出上暴露 __dshMemory 纯逻辑面')

  return { entry, exported, hooks: exported.__dshMemory, fakeWindow, fakeDocument, openedUrls }
}

/** 从真实注册点取回组件（而不是另留一个测试专用出口，免得测的不是产品路径）。 */
function registeredComponent(exported) {
  let component = null
  const ctx = {
    slots: {
      inject(_name, callback) {
        callback()
        return () => {}
      },
      register(_options, registered) {
        component = registered
        return () => {}
      },
    },
  }
  exported.apply(ctx)
  assert.equal(typeof component, 'function', 'shell.overlay 应注册到一个函数组件')
  return component
}

/**
 * 把 React 元素树展开成**真树**：函数组件就地调用展开（React 也是这么做的），
 * host 元素保留 props 与子节点，文本节点保真。
 * 断言因此落在「真实渲染输出」上，而不是桩的行为上。
 */
function renderTree(node) {
  if (node === null || node === undefined || node === false) return null
  if (typeof node === 'string' || typeof node === 'number') {
    return { kind: 'text', text: String(node), children: [] }
  }
  if (Array.isArray(node)) {
    return { kind: 'list', children: node.map(renderTree).filter(Boolean) }
  }
  if (typeof node !== 'object' || node.__reactElement !== true) return null
  const type = node.args[0]
  if (typeof type === 'function') return renderTree(type(node.args[1]))
  const props = node.args[1] && typeof node.args[1] === 'object' ? node.args[1] : {}
  const rendered = {
    kind: typeof type === 'symbol' ? 'fragment' : 'host',
    type,
    props,
    children: [],
  }
  for (const child of node.args.slice(2)) {
    const childNode = renderTree(child)
    if (childNode) rendered.children.push(childNode)
  }
  return rendered
}

/** 深度优先遍历（文档顺序）。 */
function walkTree(node, visit) {
  if (!node) return
  visit(node)
  for (const child of node.children) walkTree(child, visit)
}

/** 子树里的全部文本，按文档顺序拼接。 */
function subtreeText(node) {
  const parts = []
  walkTree(node, (current) => {
    if (current.kind === 'text') parts.push(current.text)
  })
  return parts.join(' ')
}

/** 收集命中谓词的节点（文档顺序）。 */
function collectNodes(node, predicate) {
  const found = []
  walkTree(node, (current) => {
    if (current.kind === 'host' && predicate(current.props, current)) found.push(current)
  })
  return found
}

/**
 * 渲染一次面板：走真实注册点 → 真实组件 → 真实展开。
 * 上下文经由**平台真实的主路径**（`useSessions`/`useWorkspaces` 选择器 hook）喂进去，
 * 于是它与产品代码里的投影逻辑（`contextFromSnapshots`）是同一份实现。
 * 被注入的只有 React 的状态容器：面板已打开 / payload 已就绪 / 待确认的路径。
 */
async function renderPanel(options) {
  const settings = options && typeof options === 'object' ? options : {}
  const snapshots = settings.snapshots || resolvedSnapshots('D:\\DSH记忆', 's1')
  const { exported, hooks, openedUrls } = await loadArtifact({
    panelOpen: true,
    view: {
      phase: 'ready',
      data: settings.data || null,
      refused: settings.refused || null,
      notice: null,
      error: null,
    },
    pendingPath: settings.pendingPath || null,
  })
  const component = registeredComponent(exported)
  const tree = renderTree(component({
    useSessions: (select) => select(snapshots.list),
    useWorkspaces: (select) => select(snapshots.workspaces),
  }))
  assert.ok(tree, '面板打开时必须渲染出内容')
  return { tree, hooks, openedUrls, exported, context: hooks.contextFromSnapshots(snapshots.list, snapshots.workspaces) }
}

/** 已解析的会话快照：当前会话由 `retainedBy.mainView > 0` 标出（与官方 UI 同判据）。 */
function resolvedSnapshots(cwd, session) {
  return {
    list: {
      phase: 'ready',
      ids: [session],
      byId: { [session]: { id: session, cwd, blank: false, retainedBy: { mainView: 1 } } },
    },
    workspaces: {
      phase: 'ready',
      items: [{ workspaceId: 'dsh-memory', path: cwd, title: 'dsh-memory', sessionIds: [session] }],
    },
  }
}

/** 未就绪的快照：任何服务都给不出答案 ⇒ 必须走「不猜」分支。 */
function unresolvedSnapshots() {
  return {
    list: { phase: 'pending', ids: [], byId: {} },
    workspaces: { phase: 'pending', items: [] },
  }
}

/** 契约 §3.1 的一份就绪 payload（形状逐字段照契约；内容为本仓真实值）。 */
function readyPayload(role, items) {
  return {
    vault: { root: 'D:\\DSH记忆\\kb' },
    workspace: {
      root: 'D:\\DSH记忆',
      id: 'dsh-memory',
      episode: '2026-10-27-a1b2c3',
      enabled: true,
      mapAlwaysOn: true,
      role,
      coordinators: [],
      state: 'active',
      lastActivity: '2026-10-27T10:00:00.000Z',
      stale: false,
      harvest: { covered: 0, total: 0, missing: [] },
    },
    layers: {
      l1: { path: 'positioning.md', title: '定位', present: true, body: '# 定位\n- 记住这一条', updated: 'x', revision: 'a1' },
      l2: { path: 'workspaces/dsh-memory.md', title: '工作区地图', present: true, body: '工作区正文', updated: 'x', revision: 'b2' },
      l4: { path: 'episodes/x.md', title: '工作区记忆', present: false, body: '', updated: null, revision: null },
    },
    l3: {
      halfLifeDays: 21,
      byState: { active: 1, decaying: 1, expired: 0, pinned: 1 },
      items: items || [
        { path: 'workflows/z.md', title: 'ZERO', state: 'decaying', score: 0.9, ageDays: 7, useCount: 2, pinned: false },
        { path: 'workflows/a.md', title: 'ALPHA', state: 'active', score: 0.1, ageDays: 1, useCount: 5, pinned: true },
      ],
    },
    knowledge: {
      notes: 24,
      tags: [{ tag: 'dsh', count: 5 }],
      linkHealth: { total: 31, resolved: 28, unresolved: [], ambiguous: [] },
      entryUrl: '/dsh-memory/kb/',
    },
    audit: { total: 3, stale: 1, broken: 0, gone: 0, examples: [] },
    diagnose: { lines: ['cwd: D:\\DSH记忆'] },
  }
}

// ------------------------------------------------------------------ 产物形态

test('build: 产物与 ui-contract.json 的字面量一致（三边对账的 client 边）', async () => {
  const contract = JSON.parse(await readFile(CONTRACT, 'utf8'))
  const source = await buildAndRead()

  assert.match(source, /window\.__ModuleLoader__\.load\(/)
  assert.match(source, /id:\s*'dsh-memory'/, 'id 必须与 package.json name 逐字相同')
  assert.ok(
    source.includes(JSON.stringify(contract.prefix)),
    `产物必须内联 ui-contract.json 的 prefix 字面量 ${JSON.stringify(contract.prefix)}`,
  )
  for (const route of [contract.panel.overview, contract.panel.workflow, contract.kb.page]) {
    assert.ok(
      source.includes(JSON.stringify(route)),
      `产物必须内联 ui-contract.json 的路由字面量 ${JSON.stringify(route)}`,
    )
  }
})

test('build: 只注册 shell.overlay 的 dsh-memory-button，绝不碰 shell.leading', async () => {
  const source = await buildAndRead()

  assert.ok(source.includes("'shell.overlay'"), '必须注册进 shell.overlay')
  assert.ok(source.includes("'dsh-memory-button'"), 'id 必须是自己的 dsh-memory-button')
  assert.ok(source.includes('order: 40'), 'order 必须为 40')
  assert.ok(!source.includes('shell.leading'), '禁止注册 shell.leading（single 型会顶掉官方控件）')
})

test('build: 产物是浏览器模块，没有 import/export 语句残留', async () => {
  const source = await buildAndRead()

  const moduleSyntax = source
    .split('\n')
    .map((line, index) => ({ line, index: index + 1 }))
    .filter(({ line }) => /^\s*(?:import|export)[\s{*]/.test(line))

  assert.deepEqual(
    moduleSyntax.map(({ index, line }) => `${index}: ${line.trim()}`),
    [],
    '产物必须是单文件工厂（内联模块不得用 ES 模块语法）',
  )
})

test('build: 面板样式只引用平台变量，没有硬编码色值', async () => {
  const source = await buildAndRead()

  assert.equal(
    /#[0-9a-fA-F]{3,8}\b/.test(source),
    false,
    '禁止硬编码 hex 色值（深色主题会炸）',
  )
  assert.equal(/\brgba?\s*\(/.test(source), false, '禁止硬编码 rgb()/rgba() 色值')
  assert.ok(source.includes('--dsw-alias-bg-base'), '面板背景必须引用平台变量')
  assert.ok(source.includes('--ds-transition-duration-slow'), '过渡必须引用平台变量')
})

test('build: 落位与可达性的关键机制都在产物里', async () => {
  const source = await buildAndRead()

  assert.ok(source.includes('data-windows-menu'), 'P0 必须探测 preload 的 [data-windows-menu]')
  assert.ok(source.includes('[role=menubar]'), 'P0 必须量 menubar 的右边界')
  assert.ok(source.includes('--dsh-windows-menu-start'), 'P1 必须用 CSS 变量兜底')
  assert.ok(source.includes('--dsh-memory-menu-width'), 'P1 必须带自己的宽度变量')
  assert.ok(source.includes('--dsh-frame-leading-clearance'), 'P2 必须用 leading clearance 兜底')
  assert.ok(source.includes('ResizeObserver'), '语言切换/侧栏收起都要重排')
  assert.ok(source.includes('MutationObserver'), 'menubar 文本变化要重排')
  // 侧栏折叠是"纯水平位移 + 尺寸不变"：必须另听**属性翻转**，否则按钮停在旧 x 压在官方「编辑」上。
  // 这里锁住三条，任何一条被删掉都会让这个缺陷复活：
  assert.match(source, /attributeFilter:\s*LAYOUT_ATTRIBUTES/, '布局属性翻转必须单独听（attributeFilter）')
  assert.ok(source.includes('data-sidebar-collapsed'), '侧栏折叠属性必须在被听的名单里')
  assert.match(source, /bumpPlacement\(/, '属性翻转后要按帧重测，覆盖布局过渡')
  assert.ok(source.includes('-webkit-app-region: no-drag'), '标题栏行里必须可点')
  assert.ok(source.includes('aria-expanded'), '按钮必须暴露展开态')
})

test('build: 幂等 —— 同一输入连跑两次，产物逐字节相同', async () => {
  const first = await buildAndRead()
  const second = await buildAndRead()

  assert.equal(sha256(second), sha256(first), '两次构建必须产生同一字节序列')
})

test('build: 幂等与进程时区无关（构建期不得读时钟/环境）', async () => {
  const first = await buildAndRead({ TZ: 'Asia/Shanghai' })
  const second = await buildAndRead({ TZ: 'UTC' })

  assert.equal(sha256(second), sha256(first), '构建结果不得随时区变化')
})

// ------------------------------------------------------------------ 纯逻辑行为

test('api: URL 由 ui-contract.json 拼出，cwd/session 为空时省略查询参数', async () => {
  const { hooks } = await loadArtifact()

  assert.equal(hooks.apiUrl('overview', {}), '/dsh-memory/panel/overview')
  assert.equal(
    hooks.apiUrl('overview', { cwd: 'D:\\DSH记忆', session: 's-1' }),
    `/dsh-memory/panel/overview?cwd=${encodeURIComponent('D:\\DSH记忆')}&session=s-1`,
  )
  assert.equal(
    hooks.apiUrl('workflow', { cwd: '', session: null, reason: undefined }),
    '/dsh-memory/panel/workflow',
    '空串/null/undefined 一律不出现在查询串里',
  )
  assert.equal(hooks.apiUrl('kbPage', {}), '/dsh-memory/kb/')
})

test('api: workflow 请求体只带契约 §3.2 允许的键，且保留契约原名', async () => {
  const { hooks } = await loadArtifact()

  assert.deepEqual(
    hooks.workflowBody({ action: 'pin', path: 'workflows/x.md', cwd: 'D:\\DSH记忆', session: 's-1' }),
    { action: 'pin', path: 'workflows/x.md', cwd: 'D:\\DSH记忆', session: 's-1' },
  )
  assert.deepEqual(
    hooks.workflowBody({ action: 'forget', path: 'workflows/x.md', extra: 'nope' }),
    { action: 'forget', path: 'workflows/x.md' },
    '未定义的会话上下文必须被省略，未知键必须被丢弃',
  )
})

test('api: L3 列表按 score 升序（最该忘的在最前），并保持稳定', async () => {
  const { hooks } = await loadArtifact()

  const sorted = hooks.sortL3([
    { path: 'b.md', score: 0.9 },
    { path: 'a.md', score: 0.1 },
    { path: 'c.md', score: 0.1 },
  ])

  assert.deepEqual(
    sorted.map((item) => item.path),
    ['a.md', 'c.md', 'b.md'],
    '按 score 升序；同分保留输入顺序（稳定排序）',
  )
})

test('api: 角色门与固定门在点击前就置灰，并给出原因', async () => {
  const { hooks } = await loadArtifact()

  const worker = hooks.actGate({ role: 'worker', pinned: false, action: 'pin' })
  assert.equal(worker.allowed, false, '非协调会话不得 pin')
  assert.ok(worker.reason.length > 0, '必须给出可显示的原因，而不是让用户白点一次')

  assert.equal(hooks.actGate({ role: 'coordinator', pinned: false, action: 'pin' }).allowed, true)
  assert.equal(hooks.actGate({ role: 'coordinator', pinned: false, action: 'unpin' }).allowed, true)

  const forgetPinned = hooks.actGate({ role: 'coordinator', pinned: true, action: 'forget' })
  assert.equal(forgetPinned.allowed, false, '已固定的工作流必须先解固（与 host 的 memory_workflow 同一套判定）')
  assert.ok(forgetPinned.reason.length > 0)

  assert.equal(hooks.actGate({ role: 'coordinator', pinned: false, action: 'forget' }).allowed, true)
})

test('api: host 的 refused 文案原样上桌，不被折叠成通用错误', async () => {
  const { hooks } = await loadArtifact()

  const refused = '拒绝：只有协调会话可以固定/解固工作流。'
  const view = hooks.workflowOutcome({
    ok: true,
    changed: false,
    refused,
    message: '已拒绝',
    l3: { byState: { pinned: 1 }, items: [] },
  })

  assert.equal(view.refused, refused, 'refused 必须逐字保留 host 的原文')
  assert.equal(view.changed, false)
  assert.equal(view.ok, true)
  assert.equal(view.hasRefused, true)

  const plain = hooks.workflowOutcome({ ok: true, changed: true, refused: null, message: '', l3: null })
  assert.equal(plain.refused, null)
  assert.equal(plain.hasRefused, false)
  assert.equal(hooks.workflowOutcome(null).ok, false, '坏响应不得当成成功')
})

test('api: forget 的二次确认文案点明可捞回（.trash/ 与 git 历史）', async () => {
  const { hooks } = await loadArtifact()

  for (const lang of ['zh-CN', 'en-US']) {
    const text = hooks.forgetConfirm(lang)
    assert.ok(text.includes('.trash/'), `${lang}: 必须点明移入 .trash/`)
    assert.ok(text.toLowerCase().includes('git'), `${lang}: 必须点明 git 历史仍可找回`)
  }
})

test('api: 会话上下文取不到就不猜 —— 省略参数并在 UI 上明示', async () => {
  const { hooks } = await loadArtifact()

  const missing = hooks.contextState({ cwd: null, session: null, source: 'none' })
  assert.equal(missing.resolved, false)
  assert.equal(missing.params.cwd, undefined)
  assert.equal(missing.params.session, undefined)
  assert.ok(missing.note.includes('未能确定当前会话目录'), '取不到时必须明示按 Host 默认目录解析')

  const known = hooks.contextState({ cwd: 'D:\\DSH记忆', session: 's-1', source: 'hooks' })
  assert.equal(known.resolved, true)
  assert.equal(known.note, null)
  assert.deepEqual(known.params, { cwd: 'D:\\DSH记忆', session: 's-1' })
})

test('api: 会话身份从 sessions.list 快照里按 mainView 占用挑「当前会话」', async () => {
  const { hooks } = await loadArtifact()

  const snapshot = {
    phase: 'ready',
    ids: ['a', 'b'],
    byId: {
      a: { id: 'a', cwd: 'D:\\other', blank: false, retainedBy: { mainView: 0 } },
      b: { id: 'b', cwd: 'D:\\DSH记忆', blank: true, retainedBy: { mainView: 2 } },
    },
  }

  assert.deepEqual(hooks.currentFromSessionList(snapshot), { session: 'b', cwd: 'D:\\DSH记忆' })
  assert.deepEqual(hooks.currentFromSessionList(null), { session: null, cwd: null })
  assert.deepEqual(
    hooks.currentFromSessionList({ phase: 'pending', byId: {} }),
    { session: null, cwd: null },
    '未就绪的快照不得当作答案',
  )
})

test('placement: 三级降级各自算出契约 §4.2 的位置', async () => {
  const { hooks } = await loadArtifact()

  const p0 = hooks.resolvePlacement({
    menuFound: true,
    shadowReadable: true,
    menubarRect: { right: 128, top: 0, height: 40 },
    cssStart: 48,
    cssLeadingClearance: 0,
    titlebarHeight: 40,
    menuWidth: 96,
  })
  assert.equal(p0.level, 'P0')
  assert.equal(p0.left, 136, 'menubar 右边界 + 8px')
  assert.equal(p0.top, 20, '对齐 menubar 垂直中心')
  assert.equal(p0.transform, 'translateY(-50%)')

  const p1 = hooks.resolvePlacement({
    menuFound: true,
    shadowReadable: false,
    menubarRect: null,
    cssStart: null,
    cssLeadingClearance: null,
    titlebarHeight: null,
    menuWidth: null,
  })
  assert.equal(p1.level, 'P1')
  assert.equal(p1.left, 48 + 96, 'CSS 变量兜底：menu-start(48) + 自宽(96)')
  assert.equal(p1.top, 20, '标题栏高度缺省 40 ⇒ 中心 20')

  const p2 = hooks.resolvePlacement({
    menuFound: false,
    shadowReadable: false,
    menubarRect: null,
    cssStart: null,
    cssLeadingClearance: 0,
    titlebarHeight: 0,
    menuWidth: null,
  })
  assert.equal(p2.level, 'P2')
  assert.equal(p2.left, 12, 'max(leading-clearance 0, 12)')
  assert.ok(p2.top >= 0 && p2.top < 40, 'P2 的 top 必须留在视口内')

  const p2clear = hooks.resolvePlacement({
    menuFound: false,
    shadowReadable: false,
    menubarRect: null,
    cssStart: null,
    cssLeadingClearance: 84,
    titlebarHeight: 40,
    menuWidth: null,
  })
  assert.equal(p2clear.left, 84, 'P2 必须让位给已知的 leading clearance')
})

test('placement: 测量缺失一律降级，不抛也不猜成 0', async () => {
  const { hooks } = await loadArtifact()

  const degraded = hooks.resolvePlacement({
    menuFound: true,
    shadowReadable: true,
    menubarRect: { right: 0, top: 0, height: 40 },
    cssStart: 48,
    cssLeadingClearance: 0,
    titlebarHeight: 40,
    menuWidth: 96,
  })
  assert.equal(degraded.level, 'P1', '测到 0 宽（未挂载）必须降级，而不是贴到屏幕最左')

  const broken = hooks.resolvePlacement(null)
  assert.equal(broken.level, 'P2')
  assert.equal(typeof broken.left, 'number')
})

test('i18n: label thunk 跟随活动语言（documentElement.lang）', async () => {
  const { hooks } = await loadArtifact()

  assert.equal(hooks.labelFromLang('zh-CN'), '记忆')
  assert.equal(hooks.labelFromLang('en-US'), 'Memory')
  assert.equal(hooks.copyFromLang('zh-CN').title, '记忆')
  assert.equal(hooks.copyFromLang('en-US').title, 'Memory')
  assert.equal(hooks.labelFromLang('fr-FR'), 'Memory', '未知语言回落到英文而不是崩')
})

test('view: 面板四段固定顺序且只有只读 + L3 动作', async () => {
  const { hooks } = await loadArtifact()

  assert.deepEqual(hooks.sectionOrder(), ['l1', 'l2', 'l4', 'l3', 'knowledge'])
  assert.equal(hooks.hasWriteSurface(), false, '面板里不得存在编辑/新建/修改入口')
})

test('view: 加载/空/错误/缺参数四态各有明确文案', async () => {
  const { hooks } = await loadArtifact()

  for (const state of ['loading', 'error', 'empty', 'unresolved']) {
    const text = hooks.stateCopy(state, 'zh-CN')
    assert.equal(typeof text, 'string')
    assert.ok(text.length > 0, `${state} 态必须有文案（不许 spinner-only）`)
  }
  assert.ok(hooks.stateCopy('loading', 'zh-CN') !== hooks.stateCopy('error', 'zh-CN'))
  assert.equal(hooks.stateCopy('nosuchstate', 'zh-CN'), null)
})

test('view: markdown-lite 原样保留正文，面板没有 HTML 注入面', async () => {
  const { hooks } = await loadArtifact()

  const blocks = hooks.markdownLite('# 标题\n- 项 <script>alert(1)</script>\n`code` **粗**')
  const rendered = JSON.stringify(blocks)

  assert.ok(rendered.includes('标题'), '标题必须被识别成块')
  assert.ok(
    rendered.includes('<script>alert(1)</script>'),
    '正文必须逐字保留 —— 安全边界在渲染侧（React 文本节点），不在模型侧改写用户内容',
  )
  assert.ok(blocks.length >= 1)

  const source = await readFile(ARTIFACT, 'utf8')
  assert.equal(
    /dangerouslySetInnerHTML|\.innerHTML|outerHTML|insertAdjacentHTML/.test(source),
    false,
    '面板不得存在任何 HTML sink，否则上面那条「逐字保留」就成了漏洞',
  )

  assert.deepEqual(hooks.markdownLite(''), [], '空正文不产生块')
  assert.deepEqual(hooks.markdownLite(null), [])
})

test('tokens: 产物里出现的每个 --dsw-*/--dsh-* 变量都在平台许可名单内', async () => {
  // 权威清单来自 Lead 从 @deepseek-ai/dsh-client-ui-theme/lib/client.js 提取的令牌表。
  // 拼错一个名字 = 颜色语义静默全丢（配上多级兜底还会把拼错藏起来），故必须逐字断言。
  const ALLOWED = [
    // 底 / 层
    '--dsw-alias-bg-base', '--dsw-alias-bg-layer-1', '--dsw-alias-bg-layer-2', '--dsw-alias-bg-layer-3',
    '--dsw-alias-bg-overlay', '--dsw-alias-bg-skeleton',
    '--dsw-alias-bg-mask-1', '--dsw-alias-bg-mask-2', '--dsw-alias-bg-mask-3', '--dsw-specific-sidebar-fill',
    // 玻璃浮层材质：主题包 body 里定义（浅 #f8f9fa94 / 深 #43454a73，blur(40px) saturate(150%)），
    // 平台自己的浮层就是这一对。面板用它们做"和侧栏一样的玻璃"，不再用会被壁纸透穿的 bg-base。
    '--dsw-menu-surface-fill', '--dsw-menu-backdrop-filter',
    // 边框
    '--dsw-alias-border-l1', '--dsw-alias-border-l2', '--dsw-alias-border-l3', '--dsw-alias-border-l4',
    '--dsw-alias-border-inverted',
    // 文字
    '--dsw-alias-label-primary', '--dsw-alias-label-secondary', '--dsw-alias-label-tertiary',
    '--dsw-alias-label-caption', '--dsw-alias-label-dimmed',
    // 链接 / 强调
    '--dsw-alias-link', '--dsw-alias-brand-primary', '--dsw-alias-state-business-primary',
    // 交互
    '--dsw-alias-interactive-bg-hover', '--dsw-alias-interactive-bg-active', '--dsw-alias-interactive-bg-hover-accent',
    // 状态
    '--dsw-alias-state-success-primary', '--dsw-alias-state-warn-primary',
    '--dsw-alias-state-error-primary', '--dsw-alias-state-idle-primary',
    // 圆角 / 阴影
    '--dsw-radius-xs', '--dsw-radius-sm', '--dsw-radius-md', '--dsw-radius-lg', '--dsw-radius-xl', '--dsw-radius-panel',
    '--dsw-shadow-lv1', '--dsw-shadow-lv2', '--dsw-shadow-lv3',
    // 字体
    '--dsw-font-family', '--dsw-font-markdown-base', '--dsw-font-markdown-code-font-family',
    // 焦点
    '--dsw-focus-ring-color', '--dsw-focus-ring-width',
    // 框架几何（Windows 标题栏 / 浮层）
    '--dsh-windows-titlebar-height', '--dsh-windows-menu-start',
    '--dsh-frame-top-clearance', '--dsh-frame-overlay-top', '--dsh-frame-leading-clearance',
    // 插件自有（契约 §4.2 P1 指定的一枚自宽变量，不是平台令牌）
    '--dsh-memory-menu-width',
  ]

  const source = await buildAndRead()
  const used = new Set()
  for (const match of source.matchAll(/--ds[wh]-[a-zA-Z0-9-]+/g)) used.add(match[0])

  const offenders = [...used].filter((name) => !ALLOWED.includes(name))
  assert.deepEqual(offenders, [], `产物使用了平台不存在的变量：${offenders.join(', ')}`)
  assert.ok(used.size >= 8, `应当确实引用了平台变量，实测仅 ${used.size} 个`)
})

test('tokens: 没有多级兜底链（var(--x, var(--y, z)) 会把拼错藏起来）', async () => {
  const source = await buildAndRead()
  assert.equal(
    /var\([^)]*var\(/.test(source),
    false,
    '禁止嵌套 var() 兜底：单层 var(--real-token)，或单层兜到 currentColor/transparent',
  )
})

test('api: hooks 路汇总 cwd —— 会话 cwd 缺失时用所属工作区 path 补，仍缺失则未解析', async () => {
  const { hooks } = await loadArtifact()

  const list = {
    phase: 'ready',
    byId: { s1: { id: 's1', cwd: '', blank: true, retainedBy: { mainView: 1 } } },
  }
  const workspaces = {
    phase: 'ready',
    items: [{ workspaceId: 'w1', path: 'D:\\DSH记忆', sessionIds: ['s1'] }],
  }

  const merged = hooks.contextFromSnapshots(list, workspaces)
  assert.equal(merged.resolved, true)
  assert.deepEqual(merged.params, { cwd: 'D:\\DSH记忆', session: 's1' })

  const unresolved = hooks.contextFromSnapshots(list, { phase: 'ready', items: [] })
  assert.equal(unresolved.resolved, false)
  assert.deepEqual(
    unresolved.params,
    { session: 's1' },
    '只省略**未知的** cwd；session 是取到的，必须照发（让 Host 能按会话反查工作区）',
  )
  assert.equal(unresolved.source, 'none')

  // service 路：拿不到服务时也必须不猜，而不是抛
  const viaServices = hooks.contextFromServices({ get: () => undefined })
  assert.equal(viaServices.resolved, false)
  assert.equal(viaServices.source, 'none')
})

test('apply: 真调一次 apply()，只在 shell.overlay 注册一枚条目，选项逐字段与契约一致', async () => {
  const { exported, fakeDocument } = await loadArtifact()

  assert.deepEqual(exported.inject, ['slots'], 'inject 只声明 slots')

  const calls = []
  const ctx = {
    slots: {
      inject(name, callback) {
        calls.push({ name })
        calls[calls.length - 1].dispose = callback()
        return () => {}
      },
      register(options, component) {
        const current = calls[calls.length - 1]
        current.options = options
        current.component = component
        return () => {}
      },
    },
  }

  exported.apply(ctx)

  assert.equal(calls.length, 1, '只许注册一枚条目')
  assert.equal(calls[0].name, 'shell.overlay')
  assert.equal(calls[0].options.name, 'shell.overlay')
  assert.equal(calls[0].options.id, 'dsh-memory-button')
  assert.equal(calls[0].options.order, 40)

  // label 必须是 thunk，且**每次投影现读**语言 —— 这里改假 document 的语言再读一次。
  assert.equal(typeof calls[0].options.label, 'function', 'label 必须是 thunk 而不是字符串')
  assert.equal(calls[0].options.label(), '记忆')
  fakeDocument.documentElement.lang = 'en-US'
  assert.equal(calls[0].options.label(), 'Memory', '语言切换后必须自动跟随，无需重注册座位')
  fakeDocument.documentElement.lang = 'zh-CN'

  // 组件必须是可被 React 调用的函数；缺席 hooks 时走 service 路（不调 hook，故这里安全）。
  assert.equal(typeof calls[0].component, 'function')
  const element = calls[0].component({})
  assert.equal(element && element.__reactElement, true)
  assert.equal(typeof element.args[0], 'function', '入口应分派到一个组件（无 hooks ⇒ service 路）')
})

test('apply: 没有 slots 服务的宿主上安静跳过，不抛', async () => {
  const { exported } = await loadArtifact()
  assert.equal(exported.apply(undefined), undefined)
  assert.equal(exported.apply({}), undefined)
  assert.equal(exported.apply({ slots: {} }), undefined)
})

test('view: markdown-lite 行内片段拆出代码/强调/双链，但不改写正文', async () => {
  const { hooks } = await loadArtifact()

  const spans = hooks.inlineSpans('前 `code` 中 **粗** 后 [[note]] 尾')
  assert.deepEqual(
    spans.map((span) => span.kind),
    ['text', 'code', 'text', 'strong', 'text', 'wikilink', 'text'],
  )
  assert.equal(spans[1].text, 'code')
  assert.equal(spans[3].text, '粗')
  assert.equal(spans[5].text, 'note')
  assert.equal(
    spans.map((span) => span.text).join(''),
    '前 code 中 粗 后 note 尾',
    '标记本身被剥掉，正文内容一字不改',
  )

  assert.deepEqual(hooks.inlineSpans(''), [], '空正文不产生片段（与 markdownLite 同口径）')
  assert.deepEqual(hooks.inlineSpans(null), [])
  assert.deepEqual(
    hooks.inlineSpans('未闭合 ` code'),
    [{ kind: 'text', text: '未闭合 ` code' }],
    '未闭合的标记不得吃掉后续正文',
  )
})

// --------------------------------------------------------- 渲染层（真实组件，真展开）

test('render: 面板按 L1/L2/L4/L3/知识库 固定顺序渲染，并摆出 host 回的 workspace 与诊断行', async () => {
  const { tree, hooks } = await renderPanel({ data: readyPayload('coordinator') })

  const sections = collectNodes(tree, (props) => props['data-dsh-memory-section'] !== undefined)
    .map((node) => node.props['data-dsh-memory-section'])
  assert.deepEqual(sections, hooks.sectionOrder(), '渲染顺序必须逐字等于契约的四段顺序')

  const text = subtreeText(tree)
  assert.ok(text.includes('D:\\DSH记忆'), '必须显示 host 回的 workspace.root 供对账')
  assert.ok(text.includes('dsh-memory'), '必须显示 host 回的 workspace.id')
  assert.ok(text.includes('cwd: D:\\DSH记忆'), 'diagnose 行必须上桌（不许静默丢掉 host 给的诊断）')
  assert.ok(text.includes('记住这一条'), 'L1 的 markdown 正文必须真的渲染出内容')
  assert.ok(text.includes('文件不存在。'), 'present:false 的层必须显示 missing 文案，不许伪装成「空」')
})

test('render: L3 行按 score 升序（最该忘的在最前）', async () => {
  const { tree } = await renderPanel({ data: readyPayload('coordinator') })

  const l3 = collectNodes(tree, (props) => props['data-dsh-memory-section'] === 'l3')[0]
  assert.ok(l3, 'L3 段必须渲染')

  const rows = collectNodes(l3, (props) => props['data-dsh-memory-row'] !== undefined)
  assert.equal(rows.length, 2)
  assert.ok(subtreeText(rows[0]).includes('ALPHA'), `第一行应是 score 最小的 ALPHA：${subtreeText(rows[0])}`)
  assert.ok(subtreeText(rows[1]).includes('ZERO'), '第二行应是 score 更大的 ZERO')
})

test('render: worker 会话下 L3 两枚动作都置灰并带原因；coordinator 下可点', async () => {
  const actionKinds = ['pin', 'unpin', 'forget']

  const worker = await renderPanel({ data: readyPayload('worker') })
  const workerActions = collectNodes(worker.tree, (props) => actionKinds.includes(props['data-dsh-memory-action-kind']))
  assert.equal(workerActions.length, 4, '两行 × 两枚动作')
  for (const node of workerActions) {
    assert.equal(
      node.props.disabled,
      true,
      `${node.props['data-dsh-memory-action-kind']} 在 worker 会话下必须置灰`,
    )
    assert.ok(
      typeof node.props.title === 'string' && node.props.title.length > 0,
      '置灰必须同时给出原因，不让用户白点一次',
    )
  }

  const coordinator = await renderPanel({ data: readyPayload('coordinator') })
  const coordinatorActions = collectNodes(coordinator.tree, (props) => actionKinds.includes(props['data-dsh-memory-action-kind']))
  const kinds = coordinatorActions.map((node) => node.props['data-dsh-memory-action-kind'])
  assert.ok(kinds.includes('pin'), '未固定的条目必须给出「永久保留」')
  assert.ok(kinds.includes('unpin'), '已固定的条目必须给出**可逆**的解固，而不是再 pin 一次')

  // 协调会话下**不是**全亮：已固定条目的 forget 仍必须被挡（契约 §3.2：forget 遇 pinned 拒绝）。
  const rows = collectNodes(coordinator.tree, (props) => props['data-dsh-memory-row'] !== undefined)
  const actionsOf = (row) => collectNodes(row, (props) => actionKinds.includes(props['data-dsh-memory-action-kind']))
  const pinnedRow = rows.find((row) => subtreeText(row).includes('ALPHA'))
  const looseRow = rows.find((row) => subtreeText(row).includes('ZERO'))
  assert.ok(pinnedRow && looseRow, '两行都必须渲染出来')

  const blocked = actionsOf(pinnedRow).filter((node) => node.props.disabled === true)
  assert.equal(blocked.length, 1, '已固定条目只该挡掉 forget')
  assert.equal(blocked[0].props['data-dsh-memory-action-kind'], 'forget')
  assert.ok(
    blocked[0].props.title.includes('解固'),
    `被挡的 forget 必须说明「先解固」：${blocked[0].props.title}`,
  )
  assert.equal(
    actionsOf(looseRow).filter((node) => node.props.disabled === true).length,
    0,
    '未固定条目的两枚动作都必须可点',
  )
})

test('render: forget 二次确认点明可捞回；refused 原样上桌；知识库入口走 _blank + noopener', async () => {
  const pending = await renderPanel({ data: readyPayload('coordinator'), pendingPath: 'workflows/a.md' })

  const confirm = collectNodes(pending.tree, (props) => props['data-dsh-memory-confirm'] !== undefined)
  assert.equal(confirm.length, 1, '只有被点中的那一行进入确认态')
  const confirmText = subtreeText(confirm[0])
  assert.ok(confirmText.includes('.trash/'), '确认框必须点明会移入 .trash/')
  assert.ok(confirmText.toLowerCase().includes('git'), '确认框必须点明 git 历史仍可找回')

  const refusedText = '拒绝：只有协调会话可以固定/解固工作流。'
  const refused = await renderPanel({ data: readyPayload('coordinator'), refused: refusedText })
  assert.ok(subtreeText(refused.tree).includes(refusedText), 'host 的 refused 必须逐字上桌，不许折叠成通用错误')

  const kb = collectNodes(pending.tree, (props) => props['data-dsh-memory-action-kind'] === 'kb-enter')
  assert.equal(kb.length, 1)
  assert.equal(kb[0].props.disabled, false)
  // 入口现在是异步的（先问 Host 能否交给系统应用打开），所以等它落定再断言。
  await kb[0].props.onClick()
  assert.deepEqual(
    pending.openedUrls,
    [{ url: '/dsh-memory/kb/', target: '_blank', features: 'noopener' }],
    '入口必须 new tab + noopener，且 URL 来自 host 回的 entryUrl',
  )
})

test('render: 上下文未解析时明示「按 Host 默认目录解析」，解析得到时不出这句', async () => {
  const unresolved = await renderPanel({ data: readyPayload('worker'), snapshots: unresolvedSnapshots() })

  assert.equal(unresolved.context.resolved, false)
  assert.deepEqual(unresolved.context.params, {}, '未知的 cwd/session 都必须省略，不许猜')
  const text = subtreeText(unresolved.tree)
  assert.ok(text.includes('未能确定当前会话目录'), '取不到上下文必须明示，不许静默按默认目录干活')
  assert.ok(text.includes('D:\\DSH记忆'), '明示的同时仍要摆出 host 回的 workspace.root 供对账')

  const resolved = await renderPanel({ data: readyPayload('worker') })
  assert.equal(
    subtreeText(resolved.tree).includes('未能确定当前会话目录'),
    false,
    '上下文解析得到时不得出现这句提示（否则是把两态搅在一起）',
  )
})