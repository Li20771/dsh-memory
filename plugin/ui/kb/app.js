/* 记忆库知识库只读页 — 页面逻辑
 *
 * 硬约束（build-contract §5 + 任务 task-3）：
 *   1. 单页、零依赖、零构建、离线可开。本文件不 import 任何东西，不建 bundle。
 *   2. 所有数据只走契约 §3.3 的五个 GET 路由，同源相对 fetch。
 *      路径字面量全部来自 plugin/ui-contract.json —— 运行时取一次，
 *      取不到才退到下面的常量；常量与契约文件是否一致由
 *      tools/kb-page-smoke.mjs 断言（不一致即失败）。
 *   3. 只读：全文件没有任何 POST/PUT/PATCH/DELETE，也没有写笔记的入口。
 *   4. 引用五态：ok / stale / missing / moved / unknown。
 *      unknown 是独立取值（plugin/lib/vault/cite.js:80 的 resolveCitation 契约），
 *      **绝不折叠成 missing**。
 *
 * 浏览器侧无模块系统可用（index.html 用经典 <script src>），所以整页是一个 IIFE，
 * 内部命名空间齐全，不用顶层 import/export。
 */
;(function () {
  'use strict'

  /* ============================================================ 常量 */

  // 契约文件（同源相对）。禁外链：这里只有相对路径。
  var CONTRACT_PATH = 'ui-contract.json'

  // 契约值内联副本（必须与 plugin/ui-contract.json 一致；smoke 会断言）。
  var CONTRACT_FALLBACK = {
    prefix: '/dsh-memory',
    panel: { overview: '/panel/overview', workflow: '/panel/workflow' },
    kb: {
      page: '/kb/',
      open: '/kb/open',
      tree: '/kb/api/tree',
      note: '/kb/api/note',
      resolve: '/kb/api/resolve',
      search: '/kb/api/search'
    }
  }

  // 五态（顺序即徽标颜色的声明顺序，不要改）
  var CITE_STATES = ['ok', 'stale', 'missing', 'moved', 'unknown']

  var CITE_LABEL = {
    ok: '有效',
    stale: '版本已变',
    missing: '目标缺失',
    moved: '块已移动',
    unknown: '未知'
  }

  var CITE_EXPLAIN = {
    ok: '引用的笔记存在、版本哈希一致，命中的块仍在原位 —— 引用的字面就是当时的字面。',
    stale: '笔记还在，但正文版本哈希已经变了：这段区间现在可能指向别的话，必须重读，不能直接信。',
    missing: '目标笔记在 vault 里已经不存在了（路由返回 404）。这不是空笔记，是引用断了。',
    moved: '笔记没改，但被引用的块 id（#^blk）已经不在文里了 —— 内容多半被搬到别处或删掉了。'
  }

  var BADGE_STATE_TEXT = {
    ok: 'ok — 解析正常，版本与块都对得上',
    stale: 'stale — 笔记被改过，旧引用的字面可能已经不对',
    missing: 'missing — 目标笔记不存在（HTTP 404）',
    moved: 'moved — 笔记未变，但引用的块 id 消失了',
    unknown: 'unknown — 宿主无法判定（缺路径、路由未实现或返回异常）；这是独立状态，不当作 missing'
  }

  var TREE_HINT = {
    tag: '标签',
    note: '笔记',
    file: '文件',
    exact: '标题',
    verify: '校验',
    capture: '截图'
  }

  var SECTIONS = [
    { key: 'backlinks', title: '反向链接' },
    { key: 'outlinks', title: '出链' },
    { key: 'tags', title: '标签' },
    { key: 'citations', title: '引用审计' }
  ]

  /* ============================================================ 小工具 */

  function $(id) { return document.getElementById(id) }

  function el(tag, attrs, children) {
    var node = document.createElement(tag)
    if (attrs) {
      for (var k in attrs) {
        if (!Object.prototype.hasOwnProperty.call(attrs, k)) continue
        var v = attrs[k]
        if (v === null || v === undefined || v === false) continue
        if (k === 'class') node.className = String(v)
        else if (k === 'text') node.textContent = String(v)
        else node.setAttribute(k, String(v))
      }
    }
    if (children !== null && children !== undefined) {
      var list = Array.isArray(children) ? children : [children]
      for (var i = 0; i < list.length; i++) {
        var c = list[i]
        if (c === null || c === undefined || c === false) continue
        node.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c)
      }
    }
    return node
  }

  function clear(node) {
    if (!node) return node
    while (node.firstChild) node.removeChild(node.firstChild)
    return node
  }

  function num(v) {
    var n = Number(v)
    return isFinite(n) ? n : null
  }

  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)) }

  function lineLabel(line) { return line === null || line === undefined ? '' : ':' + line }

  function shortRev(rev) {
    var s = String(rev === null || rev === undefined ? '' : rev)
    return s ? s.slice(0, 12) : ''
  }

  function isDateLike(v) {
    return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)
  }

  function parseStatus() {
    var out = {}
    try {
      var search = (window.location && window.location.search) || ''
      var pairs = search.replace(/^\?/, '').split('&')
      for (var i = 0; i < pairs.length; i++) {
        if (pairs[i] === '') continue
        var eq = pairs[i].indexOf('=')
        var key = eq < 0 ? pairs[i] : pairs[i].slice(0, eq)
        var val = eq < 0 ? '' : pairs[i].slice(eq + 1)
        out[decodeURIComponent(key)] = decodeURIComponent(val.replace(/\+/g, ' '))
      }
    } catch (err) { /* URL 异常时按无参数处理 */ }
    return out
  }

  function hashOf() {
    var raw = String((window.location && window.location.hash) || '')
    if (raw.slice(0, 1) !== '#') return null
    var body = raw.slice(1)
    if (body === '' || body === '!' || body.slice(0, 1) === '!') return null
    return body
  }

  /* ============================================================ 路由 */

  var contract = CONTRACT_FALLBACK
  var PREFIX = CONTRACT_FALLBACK.prefix
  var routes = CONTRACT_FALLBACK.kb

  function loadContract() {
    return fetch(CONTRACT_PATH, { method: 'GET', headers: { Accept: 'application/json' } })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status)
        return res.json()
      })
      .then(function (doc) {
        if (!doc || typeof doc !== 'object' || !doc.kb || typeof doc.kb.tree !== 'string') {
          throw new Error('契约形状不对')
        }
        contract = doc
        PREFIX = String(doc.prefix || PREFIX)
        routes = doc.kb
        return doc
      })
  }

  function route(key) { return routes[key] }

  function withCwd(path, cwd) {
    if (!cwd) return path
    return path + (path.indexOf('?') < 0 ? '?' : '&') + 'cwd=' + encodeURIComponent(cwd)
  }

  /* ============================================================ 网络 */

  var cache = {}

  function fetchJSON(path, options) {
    if (!cache[path]) {
      cache[path] = fetch(path, options || { method: 'GET', headers: { Accept: 'application/json' } })
        .then(function (res) {
          if (res.status === 404) {
            var notFound = new Error('not found')
            notFound.status = 404
            notFound.path = path
            throw notFound
          }
          if (!res.ok) {
            var bad = new Error('HTTP ' + res.status)
            bad.status = res.status
            bad.path = path
            throw bad
          }
          return res.json()
        })
        .then(function (doc) {
          if (doc && doc.ok === false) {
            var refused = new Error(String(doc.error || 'host 返回 ok:false'))
            refused.status = 0
            refused.path = path
            refused.payload = doc
            throw refused
          }
          return doc
        })
        .catch(function (err) {
          delete cache[path]
          throw err
        })
    }
    return cache[path]
  }

  function apiTree(cwd) { return fetchJSON(withCwd(route('tree'), cwd)) }

  function apiNote(path, cwd) {
    return fetchJSON(withCwd(route('note') + '?path=' + encodeURIComponent(path), cwd))
  }

  function apiResolve(spec, revision, cwd) {
    var url = route('resolve') + '?cite=' + encodeURIComponent(spec)
    if (revision) url += '&revision=' + encodeURIComponent(revision)
    return fetchJSON(withCwd(url, cwd))
  }

  function apiSearch(query, limit, cwd) {
    var url = route('search') + '?q=' + encodeURIComponent(query) + '&limit=' + encodeURIComponent(limit || 20)
    return fetchJSON(withCwd(url, cwd))
  }

  /* ======================================================= 引用五态 */

  var stateCache = {}

  function normalizeState(res, spec) {
    var status = res && typeof res.status === 'string' ? res.status : 'unknown'
    if (CITE_STATES.indexOf(status) < 0) status = 'unknown'
    var reason = res && typeof res.reason === 'string' ? res.reason : ''
    if (status === 'unknown' && reason === '') {
      reason = res === null || res === undefined
        ? '宿主没有返回可判定的结果'
        : '宿主未给出原因（缺路径、路由未实现或返回形状异常）'
    }
    return {
      spec: String(spec),
      status: status,
      reason: reason,
      revision: res && res.revision ? String(res.revision) : null,
      target: res && res.target ? String(res.target) : null,
      range: res && res.range && num(res.range.start) !== null && num(res.range.end) !== null
        ? { start: num(res.range.start), end: num(res.range.end) }
        : null,
      text: res && typeof res.text === 'string' ? res.text : null
    }
  }

  function requestState(spec, revision) {
    var key = spec + '\u0000' + (revision || '')
    if (!stateCache[key]) {
      stateCache[key] = apiResolve(spec, revision, null).then(function (res) {
        return normalizeState(res, spec)
      }, function () {
        return normalizeState(null, spec)
      })
    }
    return stateCache[key]
  }

  function stateTooltip(spec, state) {
    var lines = [CITE_LABEL[state.status] + '（' + state.status + '）', String(spec)]
    if (state.target) lines.push('目标: ' + state.target)
    if (state.revision) lines.push('当前版本: ' + shortRev(state.revision))
    if (state.range) lines.push('区间: ' + state.range.start + '–' + state.range.end)
    lines.push('说明: ' + (CITE_EXPLAIN[state.status] || BADGE_STATE_TEXT[state.status] || ''))
    lines.push('host reason: ' + (state.reason || '（未给出）'))
    return lines.join('\n')
  }

  /* ==================================================== 正文行映射 */

  function buildLineMap(lines) {
    var charStarts = []
    var lineStarts = []
    var offset = 0
    for (var i = 0; i < lines.length; i++) {
      var text = lines[i]
      charStarts.push(offset)
      lineStarts.push(0)
      var from = 0
      for (;;) {
        var at = text.indexOf('\n', from)
        if (at < 0) break
        lineStarts.push(at + 1)
        from = at + 1
      }
      offset += text.length + 1
    }
    return { lines: lines, charStarts: charStarts, lineStarts: lineStarts }
  }

  function lineSpan(map, start, end) {
    var lo = clamp(num(start) || 0, 0, map.charStarts.length)
    var hi = clamp(num(end) === null ? lo : num(end), lo, map.charStarts.length)
    var a = 0
    while (a + 1 < map.lineStarts.length && map.lineStarts[a + 1] <= lo) a++
    var b = a
    while (b + 1 < map.lineStarts.length && map.lineStarts[b + 1] < hi) b++
    return { first: a + 1, last: b + 1, from: lo - map.lineStarts[a], to: hi - map.lineStarts[b] }
  }

  function isFullLine(map, span) {
    var first = map.lines[span.first - 1] || ''
    var last = map.lines[span.last - 1] || ''
    return span.from <= 0 && span.to >= last.length && (span.first !== span.last || first === last)
  }

  /* ==================================================== markdown-lite */

  var RE_WIKI = /\[\[([^\]]+?)\]\]/g

  function sliceInline(text) {
    var out = []
    RE_WIKI.lastIndex = 0
    var at = 0
    var m
    while ((m = RE_WIKI.exec(text)) !== null) {
      if (m.index > at) out.push({ kind: 'text', text: text.slice(at, m.index) })
      out.push({ kind: 'wiki', raw: m[0], spec: m[1] })
      at = m.index + m[0].length
    }
    if (at < text.length) out.push({ kind: 'text', text: text.slice(at) })
    if (out.length === 0) out.push({ kind: 'text', text: '' })
    return out
  }

  function wikiParts(spec) {
    var text = String(spec || '').trim()
    var head = text
    var block = null
    var heading = null
    var revision = null
    var at = text.lastIndexOf('@')
    if (at > 0 && !/\s/.test(text.slice(at + 1)) && /^[0-9a-fA-F]{6,}$/.test(text.slice(at + 1))) {
      revision = text.slice(at + 1)
      head = text.slice(0, at)
    }
    var hash = head.indexOf('#')
    if (hash < 0) return { target: head, block: null, heading: null, revision: revision }
    var tail = head.slice(hash + 1)
    head = head.slice(0, hash)
    if (tail.slice(0, 1) === '^') block = tail.slice(1).toLowerCase() || null
    else heading = tail || null
    return { target: head, block: block, heading: heading, revision: revision }
  }

  function renderWikiToken(raw, spec, ctx) {
    var parts = wikiParts(spec)
    var target = String(parts.target || '')
    var path = ctx.resolve(target)
    if (parts.block !== null && parts.block !== undefined) {
      ctx.addCitation({
        spec: String(spec),
        block: parts.block,
        heading: null,
        target: path || target,
        raw: raw
      })
    }
    var marks = ctx.inlineMarks || []
    for (var i = 0; i < marks.length; i++) {
      if (marks[i].path === view.currentPath && marks[i].phrase) {
        return el('span', { class: 'kb-md kb-wiki-hit' }, [renderInline(spec, marks[i].phrase)])
      }
    }
    var link = el('a', {
      class: path ? 'kb-link' : 'kb-link-broken',
      href: path ? '#' + encodeURI(path) : '#' + encodeURI(target)
    })
    link.appendChild(renderInline(spec, null))
    if (!path) link.appendChild(el('span', { class: 'kb-flag', 'data-flag': 'unresolved', text: '未解析' }))
    link.addEventListener('click', function (event) {
      event.preventDefault()
      ctx.onWiki(path, target, parts, raw)
    })
    return link
  }

  function renderCitationBadge(subject, hits) {
    var label = subject.target ? subject.target : subject.spec
    if (subject.block) label += '#^' + subject.block
    var button = el('button', {
      type: 'button',
      class: 'kb-cite',
      'data-status': 'unknown',
      'data-spec': subject.spec,
      'data-target': subject.target || '',
      'data-block': subject.block || '',
      'data-line': subject.line === null || subject.line === undefined ? '' : subject.line,
      'aria-label': '引用 ' + subject.spec + '，状态判定中',
      title: '引用 ' + subject.spec + '\n状态：判定中…'
    }, [
      el('span', { class: 'kb-cite-dot', 'aria-hidden': 'true' }),
      el('span', { class: 'kb-cite-label', text: '判定中' })
    ])
    if (hits) button.setAttribute('data-search-hit', hits)
    button.addEventListener('click', function (event) {
      event.preventDefault()
      jumpToCitation(button.dataset.spec, button.dataset.line === '' ? null : Number(button.dataset.line))
    })
    return button
  }

  function applyStateToBadge(button, state) {
    button.setAttribute('data-status', state.status)
    button.dataset.reason = state.reason || ''
    var label = button.querySelector('.kb-cite-label')
    if (label) label.textContent = CITE_LABEL[state.status] || state.status
    button.setAttribute('aria-label', '引用 ' + button.dataset.spec + '：' + (BADGE_STATE_TEXT[state.status] || state.status))
    button.title = stateTooltip(button.dataset.spec, state)
  }

  var pendingBadges = []

  function registerBadge(button, subject) {
    pendingBadges.push({ button: button, subject: subject })
  }

  function resolveBadges() {
    var queue = pendingBadges
    pendingBadges = []
    for (var i = 0; i < queue.length; i++) {
      (function (item) {
        requestState(item.subject.spec, item.subject.revision || null).then(function (state) {
          if (!item.button.isConnected) return
          applyStateToBadge(item.button, state)
        })
      })(queue[i])
    }
  }

  function renderInline(text, phrases) {
    var str = String(text === null || text === undefined ? '' : text)
    var html = ''
    var pending = []
    var re = /`([^`\n]+)`|\*\*([^*\n]+)\*\*|\*([^*\n]+)\*/g
    var at = 0
    var m
    while ((m = re.exec(str)) !== null) {
      if (m.index > at) html += escapeHTML(str.slice(at, m.index))
      var token
      if (m[1] !== undefined) token = '<code class="kb-inline-code">' + escapeHTML(m[1]) + '</code>'
      else if (m[2] !== undefined) token = '<strong>' + escapeHTML(m[2]) + '</strong>'
      else token = '<em>' + escapeHTML(m[3]) + '</em>'
      html += '\u0000' + pending.length + '\u0000'
      pending.push(token)
      at = m.index + m[0].length
    }
    if (at < str.length) html += escapeHTML(str.slice(at))
    var out = html
    for (var i = pending.length - 1; i >= 0; i--) {
      out = out.split('\u0000' + i + '\u0000').join(pending[i])
    }
    return markHTML(out, phrases)
  }

  function escapeHTML(text) {
    return String(text === null || text === undefined ? '' : text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
  }

  function splitMarksHTML(html, phrases) {
    var list = Array.isArray(phrases) ? phrases : (phrases ? [phrases] : [])
    var options = []
    for (var p = 0; p < list.length; p++) {
      var needle = escapeHTML(String(list[p] || ''))
      if (needle !== '' && options.indexOf(needle) < 0) options.push(needle)
    }
    var out = []
    for (var i = 0; i < options.length; i++) {
      var n = options[i]
      var head = html.toLowerCase()
      var low = n.toLowerCase()
      var at = 0
      var parts = []
      for (;;) {
        var idx = head.indexOf(low, at)
        if (idx < 0) break
        if (idx > at) parts.push(document.createTextNode(html.slice(at, idx)))
        var mark = el('mark', { class: 'kb-mark kb-mark-phrase' })
        mark.textContent = html.slice(idx, idx + n.length)
        parts.push(mark)
        at = idx + n.length
      }
      if (parts.length > 0) {
        if (at < html.length) parts.push(document.createTextNode(html.slice(at)))
        out = parts
        break
      }
    }
    if (out.length === 0) out = [document.createTextNode(html)]
    return out
  }

  function markHTML(html, phrases) {
    return { __html: html, phrases: Array.isArray(phrases) ? phrases : (phrases ? [phrases] : null) }
  }

  function appendHTML(parent, value) {
    if (value === null || value === undefined) return parent
    if (typeof value === 'string') {
      parent.appendChild(document.createTextNode(value))
      return parent
    }
    if (value.__html !== undefined) {
      var holder = el('span')
      holder.innerHTML = value.__html
      var marked = value.phrases ? splitMarksHTML(value.__html, value.phrases) : []
      if (marked.length > 0) {
        for (var m = 0; m < marked.length; m++) parent.appendChild(marked[m])
        return parent
      }
      while (holder.firstChild) parent.appendChild(holder.removeChild(holder.firstChild))
      return parent
    }
    parent.appendChild(value)
    return parent
  }

  /* ================================================ 渲染：笔记正文 */

  var view = {
    root: null,
    tree: null,
    notes: [],
    tags: [],
    scopes: [],
    layers: {},
    index: {},
    byPath: {},
    tagFilter: null,
    query: '',
    currentPath: null,
    currentNote: null,
    currentMap: null,
    currentCitations: [],
    lastJump: null,
    searchResult: null,
    loadToken: 0
  }

  function buildResolver(titles, paths) {
    function base(name) {
      var value = String(name || '').trim()
      var slash = Math.max(value.lastIndexOf('/'), value.lastIndexOf('\\'))
      var file = slash < 0 ? value : value.slice(slash + 1)
      return file.toLowerCase().replace(/\.md$/i, '')
    }
    return function resolve(name) {
      var wanted = String(name || '').trim()
      if (wanted === '') return null
      if (paths[wanted]) return wanted
      var slug = base(wanted)
      if (paths[slug + '.md']) return slug + '.md'
      var keys = Object.keys(paths)
      for (var i = 0; i < keys.length; i++) {
        if (base(keys[i]) === slug) return keys[i]
      }
      var titled = titles[slug]
      if (titled) return titled
      return null
    }
  }

  function noteLines(note) {
    var body = typeof note.body === 'string' ? note.body : ''
    return body.split('\n')
  }

  function renderNoteInto(host, note, options) {
    var opts = options || {}
    var lines = noteLines(note)
    var map = buildLineMap(lines)
    clear(host)
    var ctx = {
      lines: lines,
      titles: view.index,
      paths: view.paths || {},
      resolve: buildResolver(view.index, view.paths || {}),
      citations: [],
      marks: opts.marks || [],
      phrases: opts.phrases || null,
      inlineMarks: opts.marks || [],
      onWiki: opts.onWiki,
      addCitation: null,
      line: 0
    }
    ctx.addCitation = function (subject) {
      subject.line = ctx.line
      ctx.citations.push(subject)
    }
    var nodes = markdownToNodes(lines, map, ctx)
    var frag = document.createDocumentFragment()
    for (var i = 0; i < nodes.length; i++) frag.appendChild(nodes[i])
    host.appendChild(frag)
    view.currentMap = map
    view.currentCitations = ctx.citations
    return { map: map, citations: ctx.citations }
  }

  var RE_H2 = /^(#{1,6})\s+(.*)$/
  var RE_LIST = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/
  var RE_QUOTE = /^(>\s?).*$/

  function markdownToNodes(lines, map, ctx) {
    var out = []
    var i = 0
    while (i < lines.length) {
      var text = lines[i]
      var lineNo = i + 1
      ctx.line = lineNo

      if (/^\s*```/.test(text)) {
        var lang = text.replace(/^\s*```\s*/, '').trim()
        var from = i
        var buf = []
        i++
        while (i < lines.length && !/^\s*```/.test(lines[i])) { buf.push(lines[i]); i++ }
        if (i < lines.length) i++
        var code = el('pre', { class: 'kb-md-code', 'data-char': map.charStarts[from] })
        if (lang) code.appendChild(el('span', { class: 'kb-code-lang', text: lang + '\n' }))
        code.appendChild(document.createTextNode(buf.join('\n')))
        out.push(lineRow(from + 1, buf.length > 0 ? buf.length + 1 : 1, code, null, map))
        continue
      }

      var heading = RE_H2.exec(text)
      if (heading) {
        var level = heading[1].length
        var node = el('h' + Math.min(6, level), { class: 'kb-md kb-md-heading kb-md-heading-' + level })
        appendHTML(node, renderInline(heading[2], ctx.phrases))
        out.push(lineRow(lineNo, 1, node, null, map))
        i++
        continue
      }

      if (RE_QUOTE.test(text)) {
        var q = el('div', { class: 'kb-md kb-md-quote' })
        var depth = 1
        while (i < lines.length && RE_QUOTE.test(lines[i])) {
          var raw = lines[i].replace(/^>\s?/, '')
          if (raw !== '' || i === lineNo - 1) {
            appendHTML(q, renderInline(raw, ctx.phrases))
            if (i < lines.length - 1 && RE_QUOTE.test(lines[i + 1])) q.appendChild(el('br'))
          }
          var nextDepth = 1
          var m2 = /^(>+)/.exec(lines[i])
          if (m2) nextDepth = m2[1].length
          depth = Math.max(depth, nextDepth)
          i++
        }
        q.setAttribute('data-depth', String(Math.min(3, depth)))
        out.push(lineRow(lineNo, i - lineNo + 1, q, null, map))
        continue
      }

      if (RE_LIST.test(text)) {
        var list = buildList(lines, map, ctx, i)
        out.push(list.node)
        i = list.next
        continue
      }

      if (/^\s*\|.*\|\s*$/.test(text) && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
        var table = el('table', { class: 'kb-md-table' })
        var rows = []
        var head = splitRow(lines[i])
        rows.push(el('tr', null, head.map(function (cell) {
          var th = el('th', { class: 'kb-md' })
          appendHTML(th, renderInline(cell, ctx.phrases))
          return th
        })))
        i += 2
        while (i < lines.length && /^\s*\|/.test(lines[i])) {
          var cells = splitRow(lines[i])
          rows.push(el('tr', null, cells.map(function (cell) {
            var td = el('td', { class: 'kb-md' })
            appendHTML(td, renderInline(cell, ctx.phrases))
            return td
          })))
          i++
        }
        var tbody = el('tbody', null, rows)
        table.appendChild(tbody)
        out.push(lineRow(lineNo, i - lineNo, table, null, map))
        continue
      }

      var blockId = null
      var body = text
      var idm = /\s*\^([A-Za-z0-9_-]+)\s*$/.exec(text)
      if (idm) {
        blockId = idm[1].toLowerCase()
        body = text.slice(0, idm.index)
      }
      var p = el('div', { class: 'kb-md kb-md-p' })
      if (body.trim() === '') {
        p.appendChild(document.createTextNode('\u00a0'))
      } else {
        appendHTML(p, renderInline(body, ctx.phrases))
      }
      out.push(lineRow(lineNo, 1, p, blockId, map))
      i++
    }
    return out
  }

  function splitRow(text) {
    var inner = String(text).trim().replace(/^\|/, '').replace(/\|$/, '')
    return inner.split('|').map(function (cell) { return cell.trim() })
  }

  function buildList(lines, map, ctx, start) {
    var first = RE_LIST.exec(lines[start])
    var indent = first[1].length
    var type = /^\d/.test(first[2]) ? 'ol' : 'ul'
    var list = el(type === 'ol' ? 'ol' : 'ul', { class: 'kb-md-list', 'data-type': type })
    var i = start
    while (i < lines.length) {
      var m = RE_LIST.exec(lines[i])
      if (!m || m[1].length !== indent) break
      ctx.line = i + 1
      var itemText = m[3]
      var li = el('li')
      var inner = []
      var nested = null
      if (i + 1 < lines.length) {
        var next = RE_LIST.exec(lines[i + 1])
        if (next && next[1].length > indent) nested = i + 1
      }
      var blockId = null
      var im = /\s*\^([A-Za-z0-9_-]+)\s*$/.exec(itemText)
      if (im) { blockId = im[1].toLowerCase(); itemText = itemText.slice(0, im.index) }
      var span = el('div', { class: 'kb-md' })
      appendHTML(span, renderInline(itemText, ctx.phrases))
      var row = lineRow(i + 1, 1, span, blockId, map)
      row.className = row.className + ' kb-md-line'
      inner.push(row)
      if (nested !== null) {
        var child = buildList(lines, map, ctx, nested)
        inner.push(child.node)
        i = child.next
      } else {
        i++
      }
      for (var k = 0; k < inner.length; k++) li.appendChild(inner[k])
      list.appendChild(li)
    }
    return { node: list, next: i }
  }

  function lineRow(lineNo, lineCount, node, blockId, map) {
    var row = el('div', { class: 'kb-md-line', 'data-line': lineNo, 'data-char': map.charStarts[lineNo - 1] })
    if (lineCount > 1) row.setAttribute('data-line-count', String(lineCount))
    var gutter = el('span', { class: 'kb-gutter', title: '第 ' + lineNo + ' 行' })
    gutter.appendChild(el('button', {
      type: 'button',
      class: 'kb-line-link',
      'data-line': lineNo,
      'aria-label': '锚点：第 ' + lineNo + ' 行'
    }, [String(lineNo)]))
    row.appendChild(gutter)
    node.classList.add('kb-md')
    if (blockId) {
      row.setAttribute('data-block-id', blockId)
      row.id = 'kb-line-' + lineNo
    } else {
      row.id = 'kb-line-' + lineNo
    }
    row.appendChild(node)
    return row
  }

  /* ============================================ 渲染：左栏笔记树 */

  function visibleNotes() {
    var out = []
    for (var i = 0; i < view.notes.length; i++) {
      var note = view.notes[i]
      if (view.tagFilter) {
        var tags = note.tags || []
        if (tags.indexOf(view.tagFilter) < 0) continue
      }
      out.push(note)
    }
    return out
  }

  function renderTree() {
    var host = $('kb-tree-body')
    var tagHost = $('kb-tree-tags')
    if (!host) return
    var notes = visibleNotes()
    var list = clear(host)

    if (tagHost) {
      clear(tagHost)
      var all = el('button', {
        type: 'button', class: 'kb-tag-chip', 'data-tag': '',
        'aria-pressed': view.tagFilter ? 'false' : 'true', text: '全部'
      })
      all.addEventListener('click', function () { setTagFilter(null) })
      tagHost.appendChild(all)
      for (var t = 0; t < view.tags.length; t++) {
        (function (tag) {
          var chip = el('button', {
            type: 'button',
            class: 'kb-tag-chip',
            'data-tag': tag.tag,
            'aria-pressed': view.tagFilter === tag.tag ? 'true' : 'false',
            title: '只看带 #' + tag.tag + ' 的笔记（' + tag.count + '）'
          }, [el('span', { text: '#' + tag.tag }), el('span', { class: 'kb-tag-count', text: String(tag.count) })])
          chip.addEventListener('click', function () { setTagFilter(view.tagFilter === tag.tag ? null : tag.tag) })
          tagHost.appendChild(chip)
        })(view.tags[t])
      }
    }

    if (notes.length === 0) {
      list.appendChild(el('div', { class: 'kb-empty', text: view.notes.length === 0 ? 'vault 里没有可索引的笔记。' : '当前标签筛选下没有笔记。' }))
      updateCounts()
      return
    }

    var byScope = {}
    for (var i = 0; i < notes.length; i++) {
      var note = notes[i]
      var scope = String(note.scope || '(无 scope)')
      if (!byScope[scope]) byScope[scope] = {}
      var type = String(note.type || '(无 type)')
      if (!byScope[scope][type]) byScope[scope][type] = []
      byScope[scope][type].push(note)
    }

    var scopeKeys = Object.keys(byScope).sort()
    for (var s = 0; s < scopeKeys.length; s++) {
      var scopeKey = scopeKeys[s]
      var typeHost = el('div', { class: 'kb-tree-list kb-tree-scope' })
      var types = Object.keys(byScope[scopeKey]).sort()
      var scopeCount = 0
      for (var ty = 0; ty < types.length; ty++) {
        var typeKey = types[ty]
        var items = byScope[scopeKey][typeKey].slice().sort(function (a, b) {
          return String(a.path).localeCompare(String(b.path))
        })
        scopeCount += items.length
        var itemHost = el('div', { class: 'kb-tree-list kb-tree-type' })
        for (var n = 0; n < items.length; n++) itemHost.appendChild(noteLink(items[n]))
        typeHost.appendChild(el('details', { class: 'kb-group', open: 'true' }, [
          el('summary', null, [
            el('span', { class: 'kb-group-label', text: typeKey }),
            el('span', { class: 'kb-group-count', text: String(items.length) })
          ]),
          itemHost
        ]))
      }
      list.appendChild(el('details', { class: 'kb-group', open: 'true' }, [
        el('summary', null, [
          el('span', { class: 'kb-group-label', text: scopeKey }),
          el('span', { class: 'kb-group-count', text: String(scopeCount) })
        ]),
        typeHost
      ]))
    }
    updateCounts()
  }

  function noteLink(note) {
    var button = el('button', {
      type: 'button',
      class: 'kb-note-link',
      'data-path': note.path,
      'aria-current': note.path === view.currentPath ? 'true' : 'false',
      title: note.path + (note.updated ? '\n更新: ' + note.updated : '')
    }, [
      el('span', { class: 'kb-note-link-title', text: String(note.title || note.path) }),
      el('span', { class: 'kb-note-link-path', text: String(note.path) })
    ])
    button.addEventListener('click', function () { openNote(note.path) })
    return button
  }

  function setTagFilter(tag) {
    view.tagFilter = tag
    renderTree()
  }

  function updateCounts() {
    var count = $('kb-tree-count')
    if (count) {
      count.textContent = String(visibleNotes().length) + ' / ' + String(view.notes.length) + ' 篇'
    }
    var treeCount = $('kb-tree-stats')
    if (treeCount) {
      treeCount.textContent = '索引 ' + view.notes.length + ' 篇 · 标签 ' + view.tags.length + ' 个 · vault ' + (view.vaultRoot || '未确定')
    }
  }

  /* =============================================== 渲染：中栏笔记 */

  function renderMissingNote(path, message) {
    var host = $('kb-note-body')
    clear(host)
    var box = el('div', { class: 'kb-missing-note', role: 'alert' }, [
      el('h3', { text: 'missing — 笔记不存在' }),
      el('p', null, [
        document.createTextNode('路由 '),
        el('code', { text: route('note') }),
        document.createTextNode(' 对 '),
        el('code', { text: path }),
        document.createTextNode(' 返回 ' + (message || '404 note not found') + '。')
      ]),
      el('p', { text: '这是一条断引用/坏链接，不是空笔记：本页不会把它渲染成空的正文，以免把"内容丢了"伪装成"这条本来就没内容"。' }),
      el('p', { class: 'kb-raw', text: '提示：先在本页右栏的「引用审计」里看这条引用是 missing 还是 stale —— 两者处置不同。' })
    ])
    host.appendChild(box)
    var title = $('kb-main-title')
    if (title) title.textContent = path
    var meta = $('kb-note-meta')
    if (meta) {
      clear(meta)
      meta.appendChild(el('span', { class: 'kb-cite-code', 'data-status': 'missing', text: 'missing' }))
    }
  }

  function renderNoteHead(note) {
    var title = $('kb-main-title')
    var path = $('kb-note-path')
    var meta = $('kb-note-meta')
    if (title) title.textContent = String(note.title || note.path || '(无标题)')
    if (path) {
      path.textContent = String(note.path || '') +
        (note.lines ? '  ·  ' + note.lines + ' 行' : '') +
        (note.revision ? '  ·  rev ' + shortRev(note.revision) : '')
    }
    if (!meta) return
    clear(meta)
    var fm = note.frontmatter || {}
    var chips = []
    if (fm.type) chips.push('type:' + fm.type)
    if (fm.scope) chips.push('scope:' + fm.scope)
    if (fm.status) chips.push('status:' + fm.status)
    if (fm.authority) chips.push('authority:' + fm.authority)
    if (fm.review && fm.review.state) chips.push('review:' + fm.review.state)
    if (note.updated || fm.updated) chips.push('updated:' + String(fm.updated || note.updated).slice(0, 10))
    for (var i = 0; i < chips.length; i++) meta.appendChild(el('span', { class: 'kb-count', text: chips[i] }))
    var tags = note.tags || fm.tags || []
    for (var t = 0; t < tags.length; t++) {
      var tagButton = el('button', {
        type: 'button', class: 'kb-tag-chip', 'data-tag': tags[t], title: '筛选 #' + tags[t]
      }, [el('span', { text: '#' + tags[t] })])
      tagButton.addEventListener('click', function (event) { setTagFilter(event.currentTarget.dataset.tag) })
      meta.appendChild(tagButton)
    }
    var audits = (note.citations || []).filter(function (c) { return c && c.spec })
    if (audits.length > 0) {
      meta.appendChild(el('span', { class: 'kb-count', text: '引用 ' + audits.length + ' 处' }))
    }
  }

  function noteFromResponse(res, path) {
    var note = res && typeof res === 'object' ? res : {}
    note.path = String(note.path || path)
    return note
  }

  function discoverCitations(note) {
    var out = []
    var seen = {}
    function push(spec, block, line) {
      var key = String(spec)
      if (seen[key]) { seen[key].lines.push(line); return }
      var parts = wikiParts(spec)
      var item = {
        spec: key,
        block: block !== null && block !== undefined ? block : parts.block,
        target: parts.target,
        line: line,
        lines: [line]
      }
      seen[key] = item
      out.push(item)
    }
    var listed = note.citations
    if (Array.isArray(listed)) {
      for (var i = 0; i < listed.length; i++) {
        var c = listed[i]
        if (!c) continue
        if (typeof c.spec === 'string' && c.spec !== '') {
          var line = num(c.line) === null ? null : num(c.line)
          push(c.spec, c.block, line)
        } else if (typeof c.target === 'string' || typeof c.note === 'string') {
          var spec = String(c.target || c.note)
          if (c.block) spec += '#^' + c.block
          push(spec, c.block, num(c.line) === null ? null : num(c.line))
        }
      }
    }
    return out
  }

  function currentAudits(citations) {
    var listed = view.currentNote && Array.isArray(view.currentNote.citations) ? view.currentNote.citations : []
    var out = []
    for (var i = 0; i < listed.length; i++) {
      var c = listed[i]
      if (!c || typeof c.spec !== 'string' || c.spec === '') continue
      var parts = wikiParts(c.spec)
      out.push({
        spec: c.spec,
        block: c.block !== null && c.block !== undefined ? c.block : parts.block,
        target: parts.target,
        line: num(c.line),
        hostStatus: typeof c.status === 'string' ? c.status : null,
        hostReason: typeof c.reason === 'string' ? c.reason : ''
      })
    }
    if (out.length > 0) return out
    var merged = {}
    for (var k = 0; k < citations.length; k++) {
      var item = citations[k]
      if (!merged[item.spec]) {
        merged[item.spec] = {
          spec: item.spec,
          block: item.block,
          target: item.target,
          line: item.line,
          hostStatus: null,
          hostReason: ''
        }
      }
    }
    return Object.keys(merged).map(function (key) { return merged[key] })
  }

  function renderNote(note, options) {
    var opts = options || {}
    var host = $('kb-note-body')
    if (!host) return
    renderNoteHead(note)
    var result = renderNoteInto(host, note, opts)
    applyJumpHighlight(opts.jump || view.lastJump)
    resolveBadges()
    renderSide(note, result.citations)
  }

  function openNote(path, options) {
    var opts = options || {}
    var token = ++view.loadToken
    view.currentPath = path
    try { window.localStorage.setItem('dsh-memory.kb.last', path) } catch (err) { /* 隐私模式忽略 */ }
    var noteHost = $('kb-note-body')
    if (noteHost) {
      clear(noteHost)
      noteHost.appendChild(el('div', { class: 'kb-empty kb-loading', text: '加载 ' + path + ' …' }))
    }
    var title = $('kb-main-title')
    if (title) title.textContent = path
    highlightTreeSelection()
    return apiNote(path, opts.cwd || null).then(function (res) {
      if (token !== view.loadToken) return
      var note = noteFromResponse(res, path)
      view.currentNote = note
      view.lastJump = opts.jump || null
      renderNote(note, opts)
    }, function (err) {
      if (token !== view.loadToken) return
      view.currentNote = null
      view.currentCitations = []
      renderMissingNote(path, err && err.status === 404 ? '404 note not found' : String((err && err.message) || err))
      renderSideMissing(path, err)
      resolveBadges()
    })
  }

  function highlightTreeSelection() {
    var links = document.querySelectorAll('.kb-note-link')
    for (var i = 0; i < links.length; i++) {
      var link = links[i]
      link.setAttribute('aria-current', link.dataset.path === view.currentPath ? 'true' : 'false')
    }
  }

  /* ======================================== 引用定位与区间高亮 */

  function setActiveJump(jump) {
    view.lastJump = jump
    applyJumpHighlight(jump)
  }

  function applyJumpHighlight(jump) {
    var host = $('kb-note-body')
    if (!host) return
    var oldMarks = host.querySelectorAll('.kb-line-hl, .kb-flash, .kb-mark')
    for (var i = 0; i < oldMarks.length; i++) {
      var node = oldMarks[i]
      node.classList.remove('kb-line-hl')
      node.classList.remove('kb-flash')
      if (node.classList.contains('kb-mark')) {
        var parent = node.parentNode
        while (node.firstChild) parent.insertBefore(node.firstChild, node)
        parent.removeChild(node)
      }
    }
    if (!jump || !view.currentMap) return
    var target = jump.path && jump.path !== view.currentPath ? null : jump
    if (!target) return
    var rows = highlightRange(host, view.currentMap, target.range, target.text)
    if (rows.length === 0 && target.block) rows = highlightBlock(host, target.block)
    if (rows.length === 0 && target.line) {
      var row = host.querySelector('.kb-md-line[data-line="' + target.line + '"]')
      if (row) rows = [row]
    }
    if (rows.length === 0) return
    for (var r = 0; r < rows.length; r++) rows[r].classList.add('kb-flash')
    rows[0].scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' })
  }

  function highlightRange(host, map, range, phrase) {
    if (!range) return []
    var span = lineSpan(map, range.start, range.end)
    var rows = []
    if (isFullLine(map, span) || span.first === span.last) {
      for (var line = span.first; line <= span.last; line++) {
        var row = host.querySelector('.kb-md-line[data-line="' + line + '"]')
        if (!row) continue
        rows.push(row)
        if (span.first === span.last) {
          var holder = row.querySelector('.kb-md')
          if (holder) {
            var text = map.lines[line - 1].slice(span.from, span.to)
            if (text.trim() !== '') {
              var marked = applyTextMark(holder, text)
              if (marked) continue
            }
          }
        }
        row.classList.add('kb-line-hl')
      }
      return rows
    }
    for (var l = span.first; l <= span.last; l++) {
      var node = host.querySelector('.kb-md-line[data-line="' + l + '"]')
      if (!node) continue
      rows.push(node)
      node.classList.add('kb-line-hl')
    }
    if (phrase && rows.length > 0) {
      var firstHolder = rows[0].querySelector('.kb-md')
      if (firstHolder) applyTextMark(firstHolder, phrase)
    }
    return rows
  }

  function applyTextMark(holder, needle) {
    var text = String(needle || '')
    if (text.trim() === '') return false
    var walker = document.createTreeWalker(holder, NodeFilter.SHOW_TEXT, null)
    var node
    while ((node = walker.nextNode()) !== null) {
      var idx = node.nodeValue.toLowerCase().indexOf(text.toLowerCase())
      if (idx < 0) continue
      var after = node.splitText(idx)
      after.nodeValue = after.nodeValue.slice(text.length)
      var mark = el('mark', { class: 'kb-mark' })
      mark.textContent = text
      after.parentNode.insertBefore(mark, after)
      return true
    }
    return false
  }

  function highlightBlock(host, blockId) {
    var rows = host.querySelectorAll('.kb-md-line[data-block-id="' + String(blockId).toLowerCase() + '"]')
    var out = []
    for (var i = 0; i < rows.length; i++) {
      rows[i].classList.add('kb-line-hl')
      out.push(rows[i])
    }
    return out
  }

  function jumpToCitation(spec, line) {
    var parts = wikiParts(spec)
    var path = resolvePath(parts.target)
    var range = null
    var text = null
    if (line !== null && line !== undefined && view.currentPath === path && view.currentMap) {
      var row = view.currentMap.lines[line - 1]
      if (typeof row === 'string') {
        var from = view.currentMap.lineStarts[line - 1] - (view.currentMap.charStarts[line - 1])
        range = { start: from, end: from + row.length }
        text = row
      }
    }
    return requestState(spec, null).then(function (state) {
      var useRange = range
      var useText = text
      if (!useRange && state.range) { useRange = state.range; useText = null }
      var jump = {
        spec: spec,
        path: path,
        block: parts.block || null,
        line: line === null || line === undefined ? null : Number(line),
        range: useRange,
        text: useText,
        status: state.status,
        reason: state.reason
      }
      setActiveJump(jump)
      if (path && path !== view.currentPath) {
        openNote(path, { jump: jump })
      } else if (path) {
        applyJumpHighlight(jump)
      }
    }, function () {
      setActiveJump({ spec: spec, path: path, block: parts.block || null, line: line, status: 'unknown' })
      if (path && path !== view.currentPath) openNote(path, { jump: { spec: spec, path: path, block: parts.block || null, line: line, status: 'unknown' } })
    })
  }

  function resolvePath(name) {
    var wanted = String(name || '').trim()
    if (wanted === '') return null
    var paths = view.paths || {}
    if (paths[wanted]) return wanted
    var base = wanted.toLowerCase().replace(/\.md$/i, '')
    if (paths[base + '.md']) return base + '.md'
    var keys = Object.keys(paths)
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i]
      if (key.toLowerCase().replace(/\.md$/i, '').replace(/^.*\//, '') === base) return key
    }
    return null
  }

  /* ============================================ 渲染：右栏关系 */

  function sectionShell(key, title, count) {
    var box = el('section', { class: 'kb-section', 'data-section': key })
    box.appendChild(el('h3', { class: 'kb-section-title' }, [
      el('span', { text: title }),
      el('span', { class: 'kb-section-count', text: String(count) })
    ]))
    return box
  }

  function emptyRow(text) {
    return el('div', { class: 'kb-empty-row kb-empty', text: text })
  }

  function renderSide(note, renderedCitations) {
    var host = $('kb-side-body')
    if (!host) return
    clear(host)

    var backlinks = Array.isArray(note.backlinks) ? note.backlinks : []
    var box = sectionShell('backlinks', '反向链接', backlinks.length)
    if (backlinks.length === 0) box.appendChild(emptyRow('没有其他笔记链接到本篇。'))
    for (var b = 0; b < backlinks.length; b++) {
      var back = backlinks[b]
      var from = String(back.from || '')
      var row = el('button', {
        type: 'button',
        class: 'kb-rel',
        'data-path': from,
        title: '跳到 ' + from + ' 并高亮引用处'
      }, [
        el('span', { class: 'kb-rel-top' }, [
          el('span', { class: 'kb-rel-path', text: from || '(未知来源)' }),
          el('span', { class: 'kb-raw', text: String(back.raw || '') }),
          el('span', { class: 'kb-count', text: back.kind === 'mention' ? '提及' : (back.kind || '链接') })
        ])
      ])
      row.addEventListener('click', function (event) { jumpToBacklink(event.currentTarget.dataset.path, back) })
      box.appendChild(row)
    }
    host.appendChild(box)

    var outlinks = Array.isArray(note.outlinks) ? note.outlinks : []
    var outBox = sectionShell('outlinks', '出链', outlinks.length)
    if (outlinks.length === 0) outBox.appendChild(emptyRow('本篇没有出链。'))
    for (var o = 0; o < outlinks.length; o++) {
      (function (out) {
        var target = String(out.target || '')
        var state = out.resolved ? '已解析' : (out.kind === 'ambiguous' ? '多解' : '未解析')
        var path = resolvePath(target)
        var row = el('button', {
          type: 'button',
          class: 'kb-rel',
          'data-path': path || '',
          disabled: !path,
          title: path ? '打开 ' + path : '未解析：' + target
        }, [
          el('span', { class: 'kb-rel-top' }, [
            el('span', { class: 'kb-rel-path', text: target || String(out.raw || '') }),
            el('span', { class: 'kb-raw', text: String(out.raw || '') }),
            el('span', { class: 'kb-count', text: state + (out.kind ? ' · ' + out.kind : '') })
          ])
        ])
        if (path) row.addEventListener('click', function () { openNote(path) })
        outBox.appendChild(row)
      })(outlinks[o])
    }
    host.appendChild(outBox)

    var tags = Array.isArray(note.tags) ? note.tags : []
    var tagBox = sectionShell('tags', '标签', tags.length)
    if (tags.length === 0) tagBox.appendChild(emptyRow('本篇没有标签。'))
    for (var t = 0; t < tags.length; t++) {
      (function (tag) {
        var button = el('button', { type: 'button', class: 'kb-tag-chip', 'data-tag': tag, title: '筛选 #' + tag }, ['#' + tag])
        button.addEventListener('click', function () { setTagFilter(tag) })
        tagBox.appendChild(button)
      })(tags[t])
    }
    host.appendChild(tagBox)

    var audits = currentAudits(renderedCitations)
    var auditBox = sectionShell('citations', '引用审计', audits.length)
    var legend = el('div', { class: 'kb-legend' })
    for (var s = 0; s < CITE_STATES.length; s++) {
      var stateKey = CITE_STATES[s]
      var badge = el('span', {
        class: 'kb-cite',
        'data-status': stateKey,
        title: BADGE_STATE_TEXT[stateKey] + '\n' + (CITE_EXPLAIN[stateKey] || ''),
        role: 'note'
      }, [
        el('span', { class: 'kb-cite-dot', 'aria-hidden': 'true' }),
        el('span', { class: 'kb-cite-label', text: CITE_LABEL[stateKey] })
      ])
      legend.appendChild(badge)
    }
    auditBox.appendChild(legend)
    if (audits.length === 0) auditBox.appendChild(emptyRow('本篇没有引用（形如 [[目标笔记#^块]]）。'))
    for (var a = 0; a < audits.length; a++) {
      (function (audit) {
        var row = el('button', {
          type: 'button',
          class: 'kb-cite-row',
          'data-spec': audit.spec,
          'data-status': 'unknown',
          title: '点击定位并高亮：' + audit.spec
        }, [
          el('span', { class: 'kb-cite-top' }, [
            el('span', { class: 'kb-cite-dot', 'aria-hidden': 'true' }),
            el('span', { class: 'kb-cite-label', text: '判定中' }),
            el('span', { class: 'kb-cite-path', text: audit.target || audit.spec }),
            audit.line === null || audit.line === undefined ? null : el('span', { class: 'kb-count', text: '第 ' + audit.line + ' 行' })
          ]),
          el('span', { class: 'kb-raw', text: audit.spec })
        ])
        row.addEventListener('click', function () { jumpToCitation(audit.spec, audit.line) })
        requestState(audit.spec, null).then(function (state) {
          if (!row.isConnected) return
          row.setAttribute('data-status', state.status)
          row.title = stateTooltip(audit.spec, state)
          var label = row.querySelector('.kb-cite-label')
          if (label) label.textContent = CITE_LABEL[state.status] || state.status
          var sub = el('span', { class: 'kb-cite-sub', text: state.reason || '' })
          if (state.reason) row.appendChild(sub)
        })
        auditBox.appendChild(row)
      })(audits[a])
    }
    host.appendChild(auditBox)
  }

  function renderSideMissing(path, err) {
    var host = $('kb-side-body')
    if (!host) return
    clear(host)
    var box = sectionShell('missing', '关系与引用', 0)
    box.appendChild(el('div', { class: 'kb-empty-row kb-empty' }, [
      el('p', { class: 'kb-empty-title', text: '笔记不存在，无法列出关系。' }),
      el('p', null, [
        document.createTextNode('请求 '),
        el('code', { text: path }),
        document.createTextNode(' 得到 ' + String((err && err.status) || '') + ' ' + String((err && err.message) || ''))
      ])
    ]))
    host.appendChild(box)
  }

  function jumpToBacklink(fromPath, back) {
    var target = resolvePath(fromPath)
    if (!target) return
    var spec = String(back && back.raw ? back.raw : '').replace(/^\[\[/, '').replace(/\]\]$/, '')
    var parts = wikiParts(spec)
    var jump = {
      spec: spec,
      path: target,
      block: parts.block || null,
      line: num(back && back.line) === null ? null : num(back.line),
      range: null,
      text: null,
      status: null
    }
    if (target === view.currentPath) {
      setActiveJump(jump)
      return
    }
    openNote(target, { jump: jump })
  }

  /* ================================================ 搜索（句子级） */

  var searchTimer = null

  function onSearchInput(value) {
    view.query = value
    if (searchTimer) window.clearTimeout(searchTimer)
    searchTimer = window.setTimeout(function () { runSearch(view.query) }, 220)
  }

  function runSearch(query) {
    var host = $('kb-tree-body')
    var stats = $('kb-search-stats')
    if (!host) return
    var text = String(query || '').trim()
    if (text === '') {
      view.searchResult = null
      if (stats) stats.textContent = '未搜索'
      renderTree()
      return
    }
    clear(host)
    host.appendChild(el('div', { class: 'kb-empty kb-loading', text: '搜索中…' }))
    apiSearch(text, 20, null).then(function (res) {
      if (String(view.query).trim() !== text) return
      view.searchResult = res
      renderSearch(res, text)
    }, function (err) {
      if (String(view.query).trim() !== text) return
      view.searchResult = null
      clear(host)
      host.appendChild(el('div', { class: 'kb-empty' }, [
        el('p', { class: 'kb-empty-title', text: '搜索失败' }),
        el('p', { text: route('search') + ' → ' + String((err && err.message) || err) })
      ]))
      if (stats) stats.textContent = '搜索失败'
    })
  }

  function renderSearch(res, query) {
    var host = $('kb-tree-body')
    var stats = $('kb-search-stats')
    var hits = res && Array.isArray(res.hits) ? res.hits : []
    if (stats) {
      stats.textContent = '命中 ' + hits.length + ' 句' + (res && res.widened ? ' · 已语义扩展' : '')
    }
    clear(host)
    if (hits.length === 0) {
      host.appendChild(el('div', { class: 'kb-empty', text: '没有命中：' + query }))
      var notes = res && Array.isArray(res.notes) ? res.notes : []
      for (var n = 0; n < notes.length; n++) host.appendChild(el('div', { class: 'kb-empty', text: String(notes[n]) }))
      return
    }
    for (var i = 0; i < hits.length; i++) {
      (function (hit) {
        var path = String(hit.path || '')
        var sentence = hit.sentence && typeof hit.sentence === 'object' ? hit.sentence : null
        var lines = hit.sentenceLines && num(hit.sentenceLines.start) !== null ? hit.sentenceLines : null
        var range = hit.range && num(hit.range.start) !== null ? hit.range : null
        var phrase = sentence && typeof sentence.text === 'string' ? sentence.text : null
        var button = el('button', {
          type: 'button',
          class: 'kb-hit',
          'data-path': path,
          title: '打开 ' + path + (lines ? ' 并高亮第 ' + lines.start + (lines.end !== lines.start ? '–' + lines.end : '') + ' 行' : '')
        }, [
          el('span', { class: 'kb-hit-title', text: path }),
          el('span', { class: 'kb-hit-line' }, [
            lines
              ? el('span', {
                  class: 'kb-hit-line-num',
                  text: '第 ' + lines.start + (lines.end !== lines.start ? '–' + lines.end : '') + ' 行'
                })
              : el('span', { class: 'kb-count', text: range ? '字符区间 ' + range.start + '–' + range.end : '无行号' }),
            hit.section ? el('span', { class: 'kb-section-name', text: ' · ' + String(hit.section) }) : null,
            num(hit.score) === null ? null : el('span', { class: 'kb-count', text: ' · score ' + hit.score })
          ]),
          el('span', { class: 'kb-hit-passage', text: String(hit.passage || sentence && sentence.text || '') })
        ])
        button.addEventListener('click', function () {
          var jump = {
            spec: hit.cite || null,
            path: path,
            block: hit.citation && hit.citation.block ? String(hit.citation.block).toLowerCase() : null,
            line: lines ? lines.start : null,
            range: sentence && sentence.range ? sentence.range : range,
            text: phrase,
            phrases: phrase ? [phrase] : null,
            status: null
          }
          setActiveJump(jump)
          if (path === view.currentPath) { applyJumpHighlight(jump); return }
          openNote(path, { jump: jump, phrases: jump.phrases })
        })
        host.appendChild(button)
      })(hits[i])
    }
  }

  /* ========================================================= 键盘 */

  function onKeydown(event) {
    var active = document.activeElement
    var list = document.querySelectorAll('.kb-note-link')
    var index = -1
    for (var i = 0; i < list.length; i++) if (list[i] === active) index = i
    if (event.key === 'j' || event.key === 'J') {
      if (index >= 0 && index + 1 < list.length) { list[index + 1].focus(); event.preventDefault() }
      return
    }
    if (event.key === 'k' || event.key === 'K') {
      if (index > 0) { list[index - 1].focus(); event.preventDefault() }
      return
    }
    if (event.key === 'f' || event.key === 'F') {
      var input = $('kb-search-input')
      if (input) { input.focus(); input.select(); event.preventDefault() }
      return
    }
    if (event.key === 'Escape') {
      var field = $('kb-search-input')
      if (field && document.activeElement === field) {
        field.value = ''
        view.query = ''
        view.searchResult = null
        renderTree()
      }
    }
  }

  /* ========================================================= 启动 */

  function contractChip(doc) {
    var chip = $('kb-contract-chip')
    if (!chip) return
    var same = JSON.stringify(doc.kb) === JSON.stringify(CONTRACT_FALLBACK.kb) && doc.prefix === CONTRACT_FALLBACK.prefix
    chip.setAttribute('data-state', same ? 'ok' : 'mismatch')
    chip.textContent = same
      ? '契约一致 ' + doc.prefix + doc.kb.page
      : '契约与页面内联常量不一致！'
    chip.title = same
      ? 'UI 路由字面量已与 plugin/ui-contract.json 对账'
      : '页面内联常量与 plugin/ui-contract.json 不一致（以文件为准，页面上报此偏差）'
  }

  function globalError(message) {
    var host = $('kb-global-error')
    if (!host) return
    host.hidden = false
    host.textContent = message
  }

  /* ====================================== 平台主题变量探测与显式降级 */

  var THEME = { probe: '--dsw-alias-bg-base', present: null, value: '', mode: 'unknown' }

  function probeTheme() {
    var value = ''
    try {
      value = String(window.getComputedStyle(document.documentElement).getPropertyValue(THEME.probe) || '').trim()
    } catch (err) {
      value = ''
    }
    THEME.value = value
    THEME.present = value !== ''
    THEME.mode = THEME.present ? 'platform' : 'absent'
    document.documentElement.setAttribute('data-kb-theme', THEME.mode)
    var chip = $('kb-theme-chip')
    if (chip) {
      chip.hidden = THEME.present
      chip.setAttribute('data-state', THEME.mode)
      chip.title = THEME.present
        ? '平台主题变量已注入（' + THEME.probe + '）：深浅色完全跟随平台。'
        : '读不到 ' + THEME.probe + '：DSH 的主题变量是注入在应用文档上的，不跨文档。\n' +
          '已切到 app.css 的显式降级块：系统色关键字 + 边框线型区分引用五态（不是隐藏 fallback）。'
    }
    return THEME
  }

  function buildIndex(notes) {
    var byTitle = {}
    var byPath = {}
    for (var i = 0; i < notes.length; i++) {
      var note = notes[i]
      var path = String(note.path || '')
      if (path === '') continue
      byPath[path] = note
      var title = String(note.title || path).trim().toLowerCase()
      if (title !== '' && !byTitle[title]) byTitle[title] = path
      var slug = path.toLowerCase().replace(/\.md$/, '').replace(/^.*\//, '')
      if (slug !== '' && !byTitle[slug]) byTitle[slug] = path
    }
    view.index = byTitle
    view.paths = byPath
    view.byPath = byPath
  }

  function initialPath() {
    var params = parseStatus()
    if (params.path) return String(params.path)
    var hash = hashOf()
    if (hash) return hash
    try {
      var stored = window.localStorage.getItem('dsh-memory.kb.last')
      if (stored && view.paths[stored]) return stored
    } catch (err) { /* 忽略 */ }
    var notes = visibleNotes()
    for (var i = 0; i < notes.length; i++) {
      var path = String(notes[i].path || '')
      if (view.layers && String(path) === String(view.layers.l1 || '')) return path
    }
    return notes.length > 0 ? String(notes[0].path || '') : null
  }

  function boot() {
    view.root = $('kb-app')
    probeTheme()
    loadContract().then(function (doc) {
      contractChip(doc)
    }, function (err) {
      var chip = $('kb-contract-chip')
      if (chip) {
        chip.setAttribute('data-state', 'mismatch')
        chip.textContent = '契约文件取不到'
        chip.title = CONTRACT_PATH + ' → ' + String((err && err.message) || err) + '；已改用页面内联常量（字面量一致）'
      }
    }).then(function () {
      var params = parseStatus()
      var cwd = params.cwd || null
      return apiTree(cwd).then(function (res) {
        view.tree = res
        view.notes = Array.isArray(res.notes) ? res.notes : []
        view.tags = Array.isArray(res.tags) ? res.tags : []
        view.scopes = Array.isArray(res.scopes) ? res.scopes : []
        view.layers = res.layers && typeof res.layers === 'object' ? res.layers : {}
        view.vaultRoot = res.vault && res.vault.root ? String(res.vault.root) : ''
        var vault = $('kb-vault')
        if (vault) vault.textContent = view.vaultRoot || '(未知 vault)'
        buildIndex(view.notes)
        var leftPane = $('kb-tree-pane')
        if (leftPane && !$('kb-tree-tags')) {
          var tagBar = el('div', { class: 'kb-tagbar', id: 'kb-tree-tags', role: 'group', 'aria-label': '标签筛选' })
          leftPane.insertBefore(tagBar, $('kb-tree-body'))
        }
        renderTree()
        var first = initialPath()
        if (first) openNote(first)
        else if ($('kb-main-empty')) $('kb-main-empty').textContent = 'vault 里还没有笔记。'
      })
    }).catch(function (err) {
      globalError('知识库索引加载失败：' + route('tree') + ' → ' + String((err && err.message) || err))
      var host = $('kb-tree-body')
      if (host) {
        clear(host)
        host.appendChild(el('div', { class: 'kb-empty' }, [
          el('p', { class: 'kb-empty-title', text: '读不到笔记索引' }),
          el('p', { text: 'GET ' + route('tree') + ' 失败：' + String((err && err.message) || err) }),
          el('p', { text: '可能原因：host 路由未注册（webServer 不可用），或本文件被单独打开（file:// 下同源相对 fetch 读不到 JSON）。' })
        ]))
      }
    })
  }

  function wire() {
    var input = $('kb-search-input')
    if (input) input.addEventListener('input', function (event) { onSearchInput(event.target.value) })
    document.addEventListener('keydown', onKeydown)
    window.addEventListener('hashchange', function () {
      var hash = hashOf()
      if (hash && hash !== view.currentPath) openNote(hash)
    })
    document.addEventListener('click', function (event) {
      var line = event.target && event.target.closest ? event.target.closest('.kb-line-link') : null
      if (!line) return
      event.preventDefault()
      var lineNo = Number(line.dataset.line)
      var row = $('kb-note-body') && $('kb-note-body').querySelector('.kb-md-line[data-line="' + lineNo + '"]')
      if (row) row.scrollIntoView({ block: 'center', behavior: 'smooth' })
    })
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { wire(); boot() })
  } else {
    wire()
    boot()
  }

  // 便于 smoke / 调试引入：只暴露只读事实，不改变行为。
  window.dshMemoryKbPage = {
    contract: CONTRACT_FALLBACK,
    contractPath: CONTRACT_PATH,
    states: CITE_STATES.slice(),
    labels: CITE_LABEL,
    badgeStateText: BADGE_STATE_TEXT,
    theme: THEME,
    routes: routes
  }
})()