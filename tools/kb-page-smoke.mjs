#!/usr/bin/env node
/**
 * 知识库只读页（task-3 / build-contract §5 与 §6）的静态冒烟断言。
 *
 * 纯静态：只读 `plugin/ui/kb/**` 与 `plugin/ui-contract.json`，不启动 host、不起浏览器、
 * 不执行 app.js。断言"页面形态"这件事本身：
 *
 *   1. 零外链：没有 http(s)://、协议相对 `//host`、cdn、@import url()。
 *      离线（host 直出但断网）必须能打开。
 *   2. 三栏容器存在：kb-tree-pane / kb-main-pane / kb-backlinks-pane（左树 / 中正文 / 右关系）。
 *   3. 引用五态字面量齐全：ok / stale / missing / moved / unknown，
 *      且 unknown 是独立取值 —— 不许折叠成 missing（plugin/lib/vault/cite.js:80 的契约）。
 *   4. 页面里的路由字面量与 plugin/ui-contract.json 的值逐个一致（含前缀）。
 *   5. 三个文件存在，且 app.js 通过 `node --check`。
 *   6. **平台 token 强守卫**（Lead 裁定新增）：app.css / index.html / app.js 里出现的
 *      每一个 `--dsw-*` / `--ds-*` 变量名都必须在下面的 TOKEN_WHITELIST 里；违例逐个列出。
 *      清单里每个名字都是从 `@deepseek-ai/dsh-client-ui-theme` 的字节里核对过的。
 *      探到本机装了该包时，再反向核对一次清单本身（防止清单比平台旧）。
 *   7. 无硬编码色值：app.css 里没有 #hex / rgb() / hsl()（注释除外），
 *      降级块只用 CSS 系统色关键字。
 *   8. app.js 里 `$('id')` 引用的挂载点都在 index.html 里（或在 JS 里动态创建）。
 *
 * 用 node --test 跑：
 *   node --test tools/kb-page-smoke.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { homedir } from 'node:os'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')

const KB_DIR = join(REPO, 'plugin', 'ui', 'kb')
const INDEX = join(KB_DIR, 'index.html')
const CSS = join(KB_DIR, 'app.css')
const JS = join(KB_DIR, 'app.js')
const CONTRACT_FILE = join(REPO, 'plugin', 'ui-contract.json')

/* --------------------------------------------------------------------------
 * 平台 token 白名单
 *
 * 来源：本机安装的 @deepseek-ai/dsh-client-ui-theme（`lib/client.js` 的 403 个
 * `--dsw-*` 声明 + `--ds-transition-duration-*`）。这里只列本页会用到的名字，
 * 每一条都逐字核对存在；拼错名字 → 本测试失败，而不是静默落到兜底值
 * （app.css 里刻意不写任何 fallback 链）。
 * ------------------------------------------------------------------------ */
const TOKEN_WHITELIST = [
  // 语义色
  '--dsw-alias-bg-base',
  '--dsw-alias-bg-layer-1',
  '--dsw-alias-bg-layer-2',
  '--dsw-alias-border-l1',
  '--dsw-alias-border-l2',
  '--dsw-alias-border-l3',
  '--dsw-alias-interactive-bg-active',
  '--dsw-alias-interactive-bg-hover',
  '--dsw-alias-label-caption',
  '--dsw-alias-label-dimmed',
  '--dsw-alias-label-primary',
  '--dsw-alias-label-secondary',
  '--dsw-alias-label-tertiary',
  '--dsw-alias-link',
  '--dsw-alias-markdown-citation',
  '--dsw-alias-markdown-code-block',
  '--dsw-alias-markdown-inline-code',
  '--dsw-alias-markdown-tag',
  '--dsw-alias-scrollbar-bg-l1',
  '--dsw-alias-scrollbar-hover-l1',
  // 引用五态（本页的重点）
  '--dsw-alias-state-success-primary',
  '--dsw-alias-state-warn-primary',
  '--dsw-alias-state-error-primary',
  '--dsw-alias-state-business-primary',
  '--dsw-alias-state-idle-primary',
  // 焦点 / 圆角 / 字体
  '--dsw-focus-ring-color',
  '--dsw-focus-ring-width',
  '--dsw-radius-sm',
  '--dsw-radius-xl',
  '--dsw-radius-xs',
  '--dsw-font-family',
  '--dsw-font-markdown-base-font-size',
  '--dsw-font-markdown-base-line-height',
  '--dsw-font-markdown-code-font-family',
  '--dsw-font-markdown-code-font-size',
  '--dsw-font-markdown-h1-font-size',
  '--dsw-font-markdown-h2-font-size',
  '--dsw-font-markdown-h3-font-size',
  '--dsw-font-markdown-h4-font-size',
  '--dsw-font-markdown-small-font-size',
  '--dsw-font-markdown-table-font-size',
  '--dsw-font-s-14-font-size',
  '--dsw-font-xs-13-font-size',
  '--dsw-font-xxxs-11-font-size',
  '--dsw-specific-sidebar-fill',
  // 过渡（--ds- 前缀，同属主题包）
  '--ds-transition-duration-fast',
  '--ds-transition-duration-slow'
]

// CSS 系统色关键字：降级块只许用这些（随 color-scheme 适配深浅色，且不是硬编码色值）
const SYSTEM_COLOR_KEYWORDS = [
  'Canvas', 'CanvasText', 'GrayText', 'ButtonFace', 'ButtonText', 'ButtonBorder',
  'LinkText', 'VisitedText', 'ActiveText', 'Field', 'FieldText',
  'Highlight', 'HighlightText', 'Mark', 'MarkText', 'AccentColor', 'AccentColorText'
]

const STATE_KEYS = ['ok', 'stale', 'missing', 'moved', 'unknown']

/* ---------------------------------------------------------------- 读取 */

function readText(path) {
  assert.ok(existsSync(path), `缺文件：${path}`)
  return readFileSync(path, 'utf8')
}

function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/([^:"'`\\])\/\/[^\n]*/g, '$1')
}

const html = readText(INDEX)
const css = readText(CSS)
const js = readText(JS)
const contract = JSON.parse(readText(CONTRACT_FILE))

const SOURCES = [
  ['plugin/ui/kb/index.html', html],
  ['plugin/ui/kb/app.css', css],
  ['plugin/ui/kb/app.js', js]
]

function tokenViolations(text, label) {
  const clean = stripComments(text)
  const found = clean.match(/--(?:dsw|ds)-[a-z0-9-]+/g) || []
  const bad = []
  for (const name of found) {
    if (!TOKEN_WHITELIST.includes(name) && !bad.includes(name)) bad.push(name)
  }
  return bad.map((name) => `${label}: ${name}`)
}

/* ---------------------------------------------------------------- 1. 零外链 */

test('零外链：三个产物里没有 http(s):// 或协议相对外链', () => {
  for (const [name, text] of SOURCES) {
    const clean = stripComments(text)
    assert.equal((clean.match(/https?:\/\//g) || []).length, 0, `${name} 出现 http(s):// 外链`)
    assert.equal((clean.match(/url\(\s*['"]?\/\//g) || []).length, 0, `${name} 出现协议相对 url(//…)`)
    assert.equal((clean.match(/\bcdn\b/i) || []).length, 0, `${name} 命中 cdn`)
  }
})

test('零外链：index.html 没有指向外部的 script/link/iframe/@import', () => {
  const tags = html.match(/<(script|link|iframe)\b[^>]*>/gi) || []
  assert.ok(tags.length > 0, 'index.html 至少要有同目录的 script 与 link')
  for (const tag of tags) {
    const ref = tag.match(/\b(?:src|href)\s*=\s*["']([^"']+)["']/i)
    if (!ref) continue
    const value = ref[1]
    assert.ok(!/^https?:/i.test(value), `${tag} 指向外部：${value}`)
    assert.ok(!value.startsWith('//'), `${tag} 是协议相对外链：${value}`)
    assert.ok(!value.includes('cdn'), `${tag} 命中 cdn：${value}`)
  }
  assert.equal((html.match(/@import/gi) || []).length, 0, 'index.html 不应有 @import')
  assert.equal((html.match(/(?:src|href)\s*=\s*["']\s*(?:https?:)?\/\//gi) || []).length, 0, '存在外链引用')
})

test('零外链：只有注释里允许出现一次规范链接（https://）', () => {
  const count = (html.match(/https:\/\//g) || []).length
  assert.ok(count <= 1, `index.html 出现 ${count} 次 https://（只允许注释里的 1 次）`)
})

test('零外链：index.html 只相对引用同目录的 app.css 与 app.js', () => {
  assert.match(html, /<link[^>]+href=["']app\.css["']/, 'index.html 必须以相对路径引用 app.css')
  assert.match(html, /<script[^>]+src=["']app\.js["']/, 'index.html 必须以相对路径引用 app.js')
  assert.equal((html.match(/\bimport\s+["']/g) || []).length, 0, 'index.html 不应有模块 import')
})

/* -------------------------------------------------------------- 2. 三栏容器 */

test('三栏容器存在（左树 / 中正文 / 右关系），且都在同一个三栏网格里', () => {
  const panes = [
    ['kb-tree-pane', 'kb-left', '左栏笔记树'],
    ['kb-main-pane', 'kb-center', '中栏正文'],
    ['kb-backlinks-pane', 'kb-right', '右栏反向链接/出链/标签/引用']
  ]
  for (const [id, cls, label] of panes) {
    assert.match(html, new RegExp(`id="${id}"`), `缺容器 ${id}（${label}）`)
    assert.match(html, new RegExp(`class="[^"]*${cls}[^"]*"`), `${id} 缺 ${cls} 类`)
  }
  assert.match(html, /id="kb-cols"/, '缺三栏网格容器 kb-cols')
  assert.match(css, /\.kb-cols\s*\{[^}]*grid-template-columns\s*:\s*minmax\(220px[^;]*minmax\(240px/s,
    'app.css 必须把三栏声明成三列网格（左/中/右）')
})

test('三栏各有自己的挂载点，正文每行可锚定（data-line / id=kb-line-N）', () => {
  for (const id of ['kb-tree-body', 'kb-tree-tags', 'kb-note-body', 'kb-note-path', 'kb-note-meta', 'kb-side-body']) {
    assert.match(html, new RegExp(`id="${id}"`), `缺挂载点 ${id}`)
  }
  assert.match(js, /'.kb-md-line\[data-line="'/, 'app.js 必须支持按行号定位（引用定位的基础）')
  assert.match(js, /'kb-line-'/, 'app.js 必须给每行可锚定的 id（kb-line-N）')
  // 判据是"每行把自己的行号写进 data-line"，不是引号风格 —— 单双引号都算过。
  assert.match(js, /(['"])data-line\1\s*:\s*lineNo/, '每一行必须把自己的行号写进 data-line')
})

/* ---------------------------------------------------------- 3. 引用五态 */

test('引用五态字面量齐全：ok / stale / missing / moved / unknown', () => {
  assert.match(js, /var\s+CITE_STATES\s*=\s*\['ok',\s*'stale',\s*'missing',\s*'moved',\s*'unknown'\]/,
    'CITE_STATES 必须是这五个取值，且顺序不回退')
  for (const state of STATE_KEYS) {
    assert.ok(js.includes(`'${state}'`) || js.includes(`"${state}"`), `app.js 缺少状态取值 '${state}'`)
    assert.match(js, new RegExp(`(?:\\b${state}:\\s*'|'${state}':\\s*')`), `app.js 缺少状态 ${state} 的中文文案`)
    assert.match(css, new RegExp(`\\.kb-cite\\[data-status="${state}"\\]`), `app.css 缺少 ${state} 徽标样式`)
  }
  assert.match(css, /\[data-status="unknown"\]/, 'app.css 缺少 unknown 态的颜色规则（必须独立于 missing）')
})

test('引用五态：unknown 不许折叠成 missing', () => {
  assert.doesNotMatch(js, /unknown['"]?\s*:\s*['"]missing/, 'unknown 被映射成 missing')
  assert.doesNotMatch(js, /status\s*===\s*['"]unknown['"]\s*\?\s*['"]missing['"]/, 'unknown 被三元折叠成 missing')
  assert.match(js, /status\s*=\s*'unknown'/, 'app.js 必须把非契约取值归一成 unknown（fail-closed）')
  assert.match(js, /CITE_STATES\.indexOf\(status\)\s*<\s*0/, 'app.js 必须用五态白名单校验 host 返回值')
  assert.match(js, /unknown:\s*'未知'/, 'unknown 必须有独立中文文案「未知」')
  assert.match(js, /unknown:\s*'[^']*HTTP 404|unknown:\s*'[^']*宿主/, 'unknown 必须有独立悬停解释，不能复用 missing 的文案')
  assert.match(js, /已解析|命中/, '五态之外的引用状态（未解析/多解）必须与五态区分显示')
})

test('引用五态：徽标带颜色 + 中文文案 + 悬停解释（含 host reason）', () => {
  for (const text of ['有效', '版本已变', '目标缺失', '块已移动']) {
    assert.ok(js.includes(text), `缺中文文案：${text}`)
  }
  assert.match(js, /host reason/, '悬停解释必须带出 host 返回的 reason')
  assert.match(js, /stateTooltip/, '必须有统一的悬停解释构造器')
  assert.match(js, /aria-label/, '徽标必须有可读的 aria-label')
  assert.match(js, /var\s+pendingBadges/, '徽标状态必须逐条异步回填（先渲染、后判定）')
})

/* ------------------------------------------------ 4. 路由字面量一致性 */

test('页面里的路由字面量与 plugin/ui-contract.json 逐个一致', () => {
  assert.equal(typeof contract.prefix, 'string', 'ui-contract.json 缺 prefix')
  assert.equal(typeof contract.kb, 'object', 'ui-contract.json 缺 kb')
  assert.equal(Object.keys(contract.kb).length, 6, '契约应覆盖 kb 的全部路由：page/open/tree/note/resolve/search')

  const expected = {
    prefix: contract.prefix,
    page: contract.kb.page,
    open: contract.kb.open,
    tree: contract.kb.tree,
    note: contract.kb.note,
    resolve: contract.kb.resolve,
    search: contract.kb.search
  }

  assert.ok(js.includes(`'${expected.prefix}'`), `app.js 的内联 prefix 与契约不一致：期望 ${expected.prefix}`)
  assert.match(js, new RegExp(`prefix:\\s*'${expected.prefix.replace(/[/\\]/g, (c) => '\\' + c)}'`),
    `app.js 的 CONTRACT_FALLBACK.prefix 必须是 '${expected.prefix}'`)
  for (const key of ['page', 'open', 'tree', 'note', 'resolve', 'search']) {
    assert.ok(js.includes(`'${expected[key]}'`), `app.js 缺少契约字面量 ${key}=${expected[key]}`)
  }

  // 单真源：页面必须相对读取契约文件本身（不允许只有内联副本）
  assert.match(js, /var\s+CONTRACT_PATH\s*=\s*'ui-contract\.json'/, 'app.js 必须相对读取 ui-contract.json')
  assert.match(js, /loadContract/, 'app.js 必须实现 loadContract()')
  assert.match(js, /fetch\(CONTRACT_PATH/, 'app.js 必须 fetch 契约文件本身')
  assert.match(js, /contractChip/, 'app.js 必须把契约对账结果展示出来')

  // index.html 的对照清单必须覆盖全部契约路径（防止注释清单烂掉）
  for (const value of Object.values(expected)) {
    assert.ok(html.includes(value), `index.html 的路由对照清单缺 ${value}`)
  }
})

test('页面只用 GET，且不存在任何写操作', () => {
  assert.equal((js.match(/method\s*:\s*['"](?:POST|PUT|PATCH|DELETE)['"]/g) || []).length, 0, 'app.js 不允许写方法')
  assert.match(js, /options\s*\|\|\s*\{\s*method:\s*'GET'/, 'fetchJSON 默认必须是 GET')
  assert.equal((js.match(/memory_workflow|upsert|writeFile|postNote|saveNote|pin\(|forget\(/gi) || []).length, 0,
    '页面里不应出现任何写入入口')
  const fetches = (js.match(/\bfetch\(/g) || []).length
  const known = (js.match(/fetch\(path|fetch\(CONTRACT_PATH/g) || []).length
  assert.equal(fetches, known, '不允许 fetch 契约之外的地址')
  assert.match(html, /只读/, 'index.html 必须显式声明只读')
})

/* -------------------------------------------------- 5. 平台 token 强守卫 */

test('平台 token 强守卫：app.css / index.html / app.js 里用到的每个 --dsw-* / --ds-* 都在白名单里', () => {
  const violations = []
  for (const [label, text] of SOURCES) violations.push(...tokenViolations(text, label))
  assert.deepEqual(violations, [],
    `以下 token 不在白名单（拼错 = 样式会静默失效）：\n  ${violations.join('\n  ')}`)
  assert.ok(TOKEN_WHITELIST.length >= 40, '白名单不该退化成一个短列表')
})

test('平台 token 强守卫：不用 fallback 兜底链（拼错必须可见）', () => {
  const cleanCss = stripComments(css)
  const chain = cleanCss.match(/var\(--dsw-[^)]*var\(/g) || []
  assert.deepEqual(chain, [], `app.css 出现嵌套兜底链，会把拼错的 token 藏起来：\n  ${chain.join('\n  ')}`)
  const fallbackOnPlatformToken = cleanCss.match(/var\(--(?:dsw|ds)-[a-z0-9-]+\s*,/g) || []
  assert.deepEqual(fallbackOnPlatformToken, [],
    `平台 token 不允许带 fallback 参数：\n  ${fallbackOnPlatformToken.join('\n  ')}`)
})

test('平台 token 强守卫：白名单本身与本机主题包核对（装了才核对）', () => {
  const candidates = [
    join(homedir(), 'AppData', 'Local', 'Programs', 'DeepSeek Harness', 'resources', 'app', 'dsh',
      'node_modules', '@deepseek-ai', 'dsh-client-ui-theme'),
    join(homedir(), 'AppData', 'Roaming', 'DeepSeek Harness', 'resources', 'app', 'dsh',
      'node_modules', '@deepseek-ai', 'dsh-client-ui-theme')
  ]
  const pkg = candidates.find((dir) => existsSync(dir))
  if (!pkg) {
    // 便携环境（如 CI / 另一台机器）没有该包：跳过反向核对，但必须显式说明。
    console.log('[kb-page-smoke] 本机没有 @deepseek-ai/dsh-client-ui-theme，跳过白名单反向核对（正向守卫仍然生效）')
    return
  }
  const libDir = existsSync(join(pkg, 'lib')) ? join(pkg, 'lib') : pkg
  const bytes = readdirSync(libDir)
    .filter((name) => name.endsWith('.js'))
    .map((name) => readFileSync(join(libDir, name), 'utf8'))
    .join('\n')
  const missing = TOKEN_WHITELIST.filter((name) => !bytes.includes(name))
  assert.deepEqual(missing, [],
    `白名单里这些 token 在主题包里不存在（平台改过名？）：\n  ${missing.join('\n  ')}`)
  console.log(`[kb-page-smoke] 已用本机主题包反向核对 ${TOKEN_WHITELIST.length} 个 token：全部存在`)
})

/* -------------------------------------------------- 6. 无硬编码色值 */

test('无硬编码色值：app.css 注释之外没有 #hex / rgb() / hsl()', () => {
  const cleanCss = stripComments(css)
  assert.equal((cleanCss.match(/#[0-9a-fA-F]{3,8}\b/g) || []).length, 0, 'app.css 出现硬编码 #hex 色值')
  assert.equal((cleanCss.match(/\brgba?\(/g) || []).length, 0, 'app.css 出现硬编码 rgb()/rgba() 色值')
  assert.equal((cleanCss.match(/\bhsla?\(/g) || []).length, 0, 'app.css 出现硬编码 hsl()/hsla() 色值')
  assert.match(css, /var\(--dsw-alias-bg-base\)/, 'app.css 必须直接引用平台 CSS 变量')
  assert.match(css, /var\(--dsw-alias-border-l1\)/, 'app.css 必须引用平台边框变量')
  assert.match(css, /color-scheme:\s*light dark/, '必须声明 color-scheme 以便跟随深浅色')
})

test('降级块：平台变量缺席时只用系统色关键字（不是隐藏 fallback）', () => {
  const at = css.indexOf('[data-kb-theme="absent"]')
  assert.ok(at > 0, 'app.css 必须给出平台变量缺席时的显式降级块')
  const block = css.slice(at)
  assert.match(block, /--kb-state-unknown:\s*GrayText/, '降级块必须仍把 unknown 与其它态区分开')
  assert.match(block, /\.kb-cite\[data-status="ok"\]/, '降级块必须逐态给出线型区分（颜色不可用也不能全一样）')
  assert.match(block, /\.kb-cite\[data-status="missing"\]/, '降级块缺 missing 的线型区分')
  const keywords = block.match(/\b[A-Z][A-Za-z]+\b/g) || []
  const bad = [...new Set(keywords)].filter((word) => !SYSTEM_COLOR_KEYWORDS.includes(word))
  assert.deepEqual(bad, [], `降级块里出现非系统色关键字的取色：\n  ${bad.join('\n  ')}`)
  assert.match(js, /data-kb-theme/, 'app.js 必须探测并打上 data-kb-theme 标记')
  assert.match(js, /getPropertyValue\(THEME\.probe\)/, 'app.js 必须真读平台变量来判断主题是否注入')
  assert.match(html, /id="kb-theme-chip"/, '降级状态必须在界面上明示，不能偷偷降级')
})

/* -------------------------------------------------- 7. 文件与 JS 解析 */

test('三个文件存在且 app.js 能被 node --check 解析', () => {
  for (const path of [INDEX, CSS, JS]) {
    assert.ok(existsSync(path), `缺文件：${path}`)
    assert.ok(readFileSync(path, 'utf8').length > 0, `空文件：${path}`)
  }
  const out = execFileSync(process.execPath, ['--check', JS], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  assert.equal(String(out).trim(), '', 'node --check 不应有输出')
})

test('index.html 结构自洽：三栏 + 只读 + 无内联事件处理器 + 显式 missing 态', () => {
  assert.match(html, /<html\s+lang="zh-CN"/, 'index.html 应是 lang=zh-CN')
  assert.match(html, /<meta\s+charset="utf-8">/, '缺 charset，中文会乱码')
  assert.match(html, /id="kb-global-error"/, '缺全局错误态容器')
  assert.match(html, /id="kb-tree-tags"/, '缺标签筛选挂载点')
  assert.match(js, /kb-missing-note/, '404 必须渲染成显式 missing 态，不许伪装成空笔记')
  assert.match(js, /笔记不存在/, 'missing 笔记必须有明确文案')
  assert.equal((html.match(/\son[a-z]+\s*=\s*"/gi) || []).length, 0, 'index.html 不允许内联事件处理器')
})

test('零依赖 / 零构建：app.js 没有顶层 import/export，页面没有打包步骤', () => {
  assert.equal((js.match(/^\s*import\s/gm) || []).length, 0, 'app.js 不应有顶层 import（浏览器经典脚本）')
  assert.equal((js.match(/^\s*export\s/gm) || []).length, 0, 'app.js 不应有顶层 export')
  assert.equal((html.match(/\btype=["']module["']/gi) || []).length, 0, 'index.html 不应使用 ES module 入口')
  assert.match(js, /\(function\s*\(\)\s*\{/, 'app.js 应是自执行函数，避免全局污染')
})

test('app.js 里 $("id") 的挂载点都在 index.html 里（或在 JS 里动态创建）', () => {
  const ids = [...new Set((js.match(/\$\('([a-z0-9-]+)'\)/g) || []).map((m) => m.slice(3, -2)))]
  assert.ok(ids.length >= 8, `应至少有 8 个挂载点，实际 ${ids.length}`)
  const missing = ids.filter((id) => !html.includes(`id="${id}"`) && !js.includes(`id: '${id}'`))
  assert.deepEqual(missing, [], `这些 id 在 html 与 js 里都找不到：${missing.join(', ')}`)
})

test('总览：host 直出的字节就是本目录文件（无需打包）', () => {
  assert.equal(dirname(INDEX), KB_DIR, 'index.html 必须与 app.css / app.js 同目录，供 /kb/ 直出')
  const refs = html.match(/\b(?:src|href)\s*=\s*["']([^"']+)["']/gi) || []
  assert.ok(refs.length >= 2, 'index.html 至少要有两个同目录相对引用')
  assert.ok(!existsSync(join(REPO, 'scripts', 'build-kb.mjs')), '本页不该有任何打包步骤')
})