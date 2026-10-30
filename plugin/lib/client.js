// ─────────────────────────────────────────────────────────────────────────────
// dsh-memory · client 半边（浏览器模块）
//
// 本文件是**构建产物**：由 scripts/build-client.mjs 从下面这些源内联而成，勿手改。
//   重建：node scripts/build-client.mjs   （纯 Node 内置、零依赖、幂等：同输入同字节）
//
// 内联顺序即求值顺序（同一工厂作用域；顶层读后置模块会撞 TDZ）：
//   · plugin/client/00-i18n.js —— 词表与「跟随语言」的取值口径
//   · plugin/client/01-api.js —— Host 数据面：URL / 请求体 / 结果归一
//   · plugin/client/02-model.js —— 纯模型：三级落位判定与面板视图模型
//   · plugin/client/03-dom.js —— DOM 接触面：量、贴、观察、样式令牌
//   · plugin/client/04-panel.js —— 面板视图（只读 + L3 动作）
//   · plugin/client/05-button.js —— shell.overlay 条目：按钮 + 数据流
//   · plugin/client/06-apply.js —— 注册接缝
//
// 单真源：plugin/ui-contract.json（前缀 / 路由）在下面被内联为 DM_UI_CONTRACT。
// 注册面：只在 shell.overlay 注册 id=dsh-memory-button / order=40 一枚条目。
// ─────────────────────────────────────────────────────────────────────────────
window.__ModuleLoader__.load({
	id: 'dsh-memory',
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

		// 平台自带的平台模块（工厂参数 provided by __ModuleLoader__）。
		const React = require('react');

		// ── 构建期注入：plugin/ui-contract.json（前缀与路由的**唯一真源**，运行时不许再拼字面量）──
		const DM_UI_CONTRACT = {
		  "prefix": "/dsh-memory",
		  "panel": {
		    "overview": "/panel/overview",
		    "workflow": "/panel/workflow"
		  },
		  "kb": {
		    "page": "/kb/",
		    "open": "/kb/open",
		    "tree": "/kb/api/tree",
		    "note": "/kb/api/note",
		    "resolve": "/kb/api/resolve",
		    "search": "/kb/api/search"
		  }
		};

		// ── 内联模块：plugin/client/00-i18n.js —— 词表与「跟随语言」的取值口径（构建期注入；勿手改本段）──
/**
 * client/00-i18n.js — 词表与「跟随语言」的取值口径（唯一实现）。
 *
 * 为什么语言必须**每次读取时现取**：`shell.overlay` 的 `label` 是 thunk 契约
 * （平台文档 registerOptions.label：「A thunk is re-read on every projection, so
 * localized text follows the active locale without re-registering」），
 * 而 DSH 把当前语言写在 `document.documentElement.lang`
 * （证据：`@deepseek-ai/dsh-client-locale/lib/client.js:1175`
 *  `if (document.documentElement.lang !== language) document.documentElement.lang = language;`）。
 * 所以：**任何一处缓存语言 = 切换语言后 UI 停在旧语言**。本文件因此不留语言缓存，
 * 只留词表；取值一律走 `dmLabel()` / `dmCopy()`。
 *
 * 契约：零依赖；顶层只许声明（内联后本模块排在最前，读正文会撞 TDZ）。
 */

/** 支持的语言域。未识别语种回落英文（不是抛错，也不是回落到中文）。 */
const DM_LANGS = ['zh', 'en'];

/** 中文词表。键名是稳定标识，改文案不改键。 */
const DM_COPY_ZH = {
  label: '记忆',
  title: '记忆',
  openPanel: '打开记忆面板',
  closePanel: '关闭记忆面板',
  closeAction: '关闭',
  refusedLabel: 'Host 拒绝',
  contextUnresolved: '未能确定当前会话目录，按 Host 默认目录解析',
  contextSourceHooks: '会话上下文来自 client runtime 的 hook',
  contextSourceServices: '会话上下文来自 client runtime 的 service',
  contextSourceNone: '未能读到任何会话服务',
  workspaceLine: '工作区',
  roleCoordinator: '协调会话',
  roleWorker: '工作会话',
  gateUnknownAction: '未知动作，已阻止。',
  gateWorker: '只有协调会话可以固定、解固或删除工作流。',
  gatePinnedForget: '已固定的工作流必须先解固，才能彻底删除。',
  actionPin: '永久保留',
  actionUnpin: '解固（可逆）',
  actionForget: '彻底删除',
  confirmTitle: '确认彻底删除？',
  confirmBody: '该条会被移入 .trash/，之后仍可捞回；git 历史里也仍能找回。',
  confirmYes: '确认删除',
  confirmNo: '取消',
  kbSection: '知识库',
  kbEnter: '进入知识库',
  kbNotes: '笔记',
  kbTags: '标签',
  kbLinks: '链接健康',
  kbEntryMissing: 'Host 未返回知识库入口地址。',
  kbFrameTitle: '知识库',
  kbFrameHint: '宿主禁止弹出新窗口，已在面板内打开（同一份只读页）。',
  kbFrameClose: '关闭',
  l3Section: 'L3 工作流',
  l3StateCounts: '按状态',
  l3Empty: '还没有工作流条目。',
  l3Score: '衰减分',
  l3Age: '天数',
  l3Uses: '用过',
  stateLoading: '正在读取记忆状态…',
  stateError: '读取失败：未能从 Host 取到面板数据。',
  stateEmpty: '这一层还没有内容。',
  stateUnresolved: '未能确定当前会话目录，已按 Host 默认目录解析。',
  stateMissing: '文件不存在。',
  collapsed: '展开',
  expanded: '收起',
  auditLine: '引用审计',
  diagnoseLine: '诊断',
  okLabel: '已受理',
  changedLabel: '已变更',
  unchangedLabel: '未变更',
};

/** 英文词表（同键）。 */
const DM_COPY_EN = {
  label: 'Memory',
  title: 'Memory',
  openPanel: 'Open the memory panel',
  closePanel: 'Close the memory panel',
  closeAction: 'Close',
  refusedLabel: 'Host refused',
  contextUnresolved: 'The current session directory could not be determined; the Host default directory is used.',
  contextSourceHooks: 'Session context came from a client-runtime hook',
  contextSourceServices: 'Session context came from a client-runtime service',
  contextSourceNone: 'No session service was readable',
  workspaceLine: 'Workspace',
  roleCoordinator: 'coordinator',
  roleWorker: 'worker',
  gateUnknownAction: 'Unknown action; blocked.',
  gateWorker: 'Only a coordinator session may pin, unpin, or forget a workflow.',
  gatePinnedForget: 'A pinned workflow must be unpinned before it can be forgotten.',
  actionPin: 'Pin',
  actionUnpin: 'Unpin (reversible)',
  actionForget: 'Forget',
  confirmTitle: 'Forget permanently?',
  confirmBody: 'The note moves into .trash/ and can still be recovered; git history keeps it as well.',
  confirmYes: 'Forget it',
  confirmNo: 'Cancel',
  kbSection: 'Knowledge base',
  kbEnter: 'Open the knowledge base',
  kbNotes: 'Notes',
  kbTags: 'Tags',
  kbLinks: 'Link health',
  kbEntryMissing: 'The Host returned no knowledge-base entry URL.',
  kbFrameTitle: 'Knowledge base',
  kbFrameHint: 'The host blocks new windows, so the page opened inside the panel (same read-only page).',
  kbFrameClose: 'Close',
  l3Section: 'L3 workflows',
  l3StateCounts: 'By state',
  l3Empty: 'No workflow entries yet.',
  l3Score: 'decay score',
  l3Age: 'days',
  l3Uses: 'uses',
  stateLoading: 'Reading memory state…',
  stateError: 'Read failed: the panel payload could not be fetched from the Host.',
  stateEmpty: 'This layer has no content yet.',
  stateUnresolved: 'The current session directory could not be determined; the Host default directory is used.',
  stateMissing: 'File not found.',
  collapsed: 'Expand',
  expanded: 'Collapse',
  auditLine: 'Citation audit',
  diagnoseLine: 'Diagnostics',
  okLabel: 'accepted',
  changedLabel: 'changed',
  unchangedLabel: 'unchanged',
};

/** 把任意 BCP-47 标签归一到受支持的语言域；未知语种回落英文。 */
function dmLanguageOf(lang) {
  const raw = typeof lang === 'string' ? lang.toLowerCase() : '';
  for (const code of DM_LANGS) if (raw.startsWith(code)) return code;
  return 'en';
}

/** 取活动语言。每次调用都现取 —— 平台用 `documentElement.lang` 表达当前语言。 */
function dmActiveLang() {
  if (typeof document !== 'undefined' && document && document.documentElement &&
      typeof document.documentElement.lang === 'string' && document.documentElement.lang) {
    return document.documentElement.lang;
  }
  if (typeof navigator !== 'undefined' && navigator && typeof navigator.language === 'string') {
    return navigator.language;
  }
  return 'zh-CN';
}

/** 指定语言域的词表。 */
function dmCopyFromLang(lang) {
  return dmLanguageOf(lang) === 'zh' ? DM_COPY_ZH : DM_COPY_EN;
}

/** 指定语言的词条。未知键返回键名本身（不返回 undefined 让 UI 渲染出空洞）。 */
function dmCopyFor(lang, key) {
  const table = dmCopyFromLang(lang);
  const value = table[key];
  return typeof value === 'string' ? value : key;
}

/** 活动语言下的词条 —— `label` thunk 与全部 UI 文案都走这里。 */
function dmCopy(key) {
  return dmCopyFor(dmActiveLang(), key);
}

/** `shell.overlay` 的 label thunk：每次投影时求值，因此跟随语言切换。 */
function dmLabel(key) {
  return dmCopy(key === undefined ? 'label' : key);
}

/** 指定语言下的 label（供测试与对账；生产路径用 `dmLabel()`）。 */
function dmLabelFromLang(lang) {
  return dmCopyFor(lang, 'label');
}

/**
 * `forget` 的二次确认全文（破坏性动作）。契约 §4.3 要求文案必须点明两件事：
 * 移入 `.trash/` **可捞回**，且 **git 历史**里仍能找回 —— 二者都写在词表里，由本函数合并。
 */
function dmForgetConfirm(lang) {
  const table = dmCopyFromLang(lang === undefined ? dmActiveLang() : lang);
  return `${table.confirmTitle} ${table.confirmBody}`;
}

		// ── 内联模块：plugin/client/01-api.js —— Host 数据面：URL / 请求体 / 结果归一（构建期注入；勿手改本段）──
/**
 * client/01-api.js — Host 面板数据面：URL / 请求体 / 结果归一（唯一实现）。
 *
 * 前缀与路由**不得硬编码**：构建期把 `plugin/ui-contract.json`（单真源）内联成
 * 本工厂作用域里的 `DM_UI_CONTRACT` 常量，本文件只做「前缀 + 路由 + 查询串」的拼接。
 * 于是三边（routes / build / 测试）对账的是同一份字面量。
 *
 * 契约要点（build-contract.md §3.1/§3.2）：
 *   · 读：   GET  {prefix}/panel/overview?cwd=&session=   同源相对 fetch
 *   · 写：   POST {prefix}/panel/workflow                 cwd/session 走**请求体**，不走查询串
 *   · 响应： 恒定 HTTP 200（除越界/坏 JSON 的 400）；`ok` = 受理，`changed` = vault 真变了，
 *           `refused` = 治理层拒绝原因（**必须原样上桌**，不许折叠成通用错误）。
 *
 * 契约：零依赖；顶层只许声明（`DM_UI_CONTRACT` 由构建期 prelude 先于本模块求值）。
 */

/** 路由键 → 契约里的相对路由。缺键就是契约漂移，宁可显式抛也不静默兜底。 */
const DM_ROUTES = {
  overview: DM_UI_CONTRACT.panel.overview,
  workflow: DM_UI_CONTRACT.panel.workflow,
  kbPage: DM_UI_CONTRACT.kb.page,
  kbOpen: DM_UI_CONTRACT.kb.open,
  kbTree: DM_UI_CONTRACT.kb.tree,
  kbNote: DM_UI_CONTRACT.kb.note,
  kbResolve: DM_UI_CONTRACT.kb.resolve,
  kbSearch: DM_UI_CONTRACT.kb.search,
};

/** 查询串里允许出现的键及其**固定顺序**（顺序固定 ⇒ URL 可对账、可缓存）。 */
const DM_QUERY_KEYS = ['cwd', 'session', 'reason'];

/** `panel/workflow` 请求体允许出现的键（契约 §3.2 之外的多余键一律丢弃）。 */
const DM_WORKFLOW_KEYS = ['action', 'path', 'cwd', 'session', 'reason'];

/** 把值收敛成「可放进查询串的字符串」；非字符串/空串一律视为「未提供」。 */
function dmQueryValue(value) {
  if (typeof value === 'string') return value === '' ? null : value;
  if (typeof value === 'number' && isFinite(value)) return String(value);
  return null;
}

/** 只保留非空参数，按固定顺序编码。 */
function dmQueryString(params) {
  const source = params && typeof params === 'object' ? params : {};
  const parts = [];
  for (const key of DM_QUERY_KEYS) {
    const value = dmQueryValue(source[key]);
    if (value !== null) parts.push(`${key}=${encodeURIComponent(value)}`);
  }
  return parts.join('&');
}

/** 路由键 → 同源相对 URL。`params` 为空则不带 `?`。 */
function dmApiUrl(routeKey, params) {
  const route = DM_ROUTES[routeKey];
  if (typeof route !== 'string') {
    throw new Error(`dsh-memory client: unknown route key ${String(routeKey)}`);
  }
  const query = dmQueryString(params);
  return DM_UI_CONTRACT.prefix + route + (query === '' ? '' : `?${query}`);
}

/** `panel/workflow` 请求体：只带契约允许的键，且不带空值。 */
function dmWorkflowBody(input) {
  const source = input && typeof input === 'object' ? input : {};
  const body = {};
  for (const key of DM_WORKFLOW_KEYS) {
    const value = dmQueryValue(source[key]);
    if (value !== null) body[key] = value;
  }
  return body;
}

/** L3 列表按 score **升序**（最该忘的在最前），与 `memory_workflow(action:"list")` 同序。 */
function dmSortL3(items) {
  const list = Array.isArray(items) ? items : [];
  return list
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      const a = left.item && typeof left.item.score === 'number' && isFinite(left.item.score)
        ? left.item.score : Number.POSITIVE_INFINITY;
      const b = right.item && typeof right.item.score === 'number' && isFinite(right.item.score)
        ? right.item.score : Number.POSITIVE_INFINITY;
      if (a !== b) return a - b;
      return left.index - right.index;
    })
    .map((entry) => entry.item);
}

/**
 * 点击**之前**的治理预判，只为「不让用户白点一次」。
 * 真判定在 Host（`memory_workflow` 同一套函数）—— 本函数不复制它，只镜像它的两条已知门。
 */
function dmActGate(input) {
  const source = input && typeof input === 'object' ? input : {};
  const action = source.action;
  if (action !== 'pin' && action !== 'unpin' && action !== 'forget') {
    return { allowed: false, reason: dmCopy('gateUnknownAction') };
  }
  if (source.role !== 'coordinator') {
    return { allowed: false, reason: dmCopy('gateWorker') };
  }
  if (action === 'forget' && source.pinned === true) {
    return { allowed: false, reason: dmCopy('gatePinnedForget') };
  }
  return { allowed: true, reason: null };
}

/** Host 的 workflow 响应 → 视图模型。`refused` 逐字保留，坏响应不得伪装成成功。 */
function dmWorkflowOutcome(json) {
  if (!json || typeof json !== 'object') {
    return { ok: false, changed: false, refused: null, hasRefused: false, message: null, l3: null, malformed: true };
  }
  const refused = typeof json.refused === 'string' && json.refused !== '' ? json.refused : null;
  return {
    ok: json.ok === true,
    changed: json.changed === true,
    refused,
    hasRefused: refused !== null,
    message: typeof json.message === 'string' ? json.message : null,
    l3: json.l3 && typeof json.l3 === 'object' ? json.l3 : null,
    malformed: false,
  };
}

/**
 * 会话上下文（契约 §4.4）：**取不到就不猜**。
 * 返回的 `params` 直接喂给 overview 的查询串；`cwd` 缺失即视为未解析，
 * 于是 UI 必须明示「按 Host 默认目录解析」并把 Host 回的 workspace.root/id 显示出来对账。
 */
function dmContextState(input) {
  const source = input && typeof input === 'object' ? input : {};
  const cwd = dmQueryValue(source.cwd);
  const session = dmQueryValue(source.session);
  const params = {};
  if (cwd !== null) params.cwd = cwd;
  if (session !== null) params.session = session;
  const resolved = cwd !== null;
  return {
    resolved,
    params,
    note: resolved ? null : dmCopy('contextUnresolved'),
    source: resolved ? (source.source === 'services' ? 'services' : 'hooks') : 'none',
  };
}

/**
 * 「当前会话」的唯一权威读法，逐字镜像官方 UI 的取法：
 *   `Object.values(sessions.list.getSnapshot().byId).find((row) => (row.retainedBy.mainView ?? 0) > 0)`
 *   —— 证据：`@deepseek-ai/dsh-client-ui-workspace/lib/client.js:89` 与 `:3027`（后者取 `?.id`）。
 * 快照未就绪（`phase !== 'ready'`）时**不给答案**，让调用方走「未解析」分支。
 */
function dmCurrentFromSessionList(snapshot) {
  const empty = { session: null, cwd: null };
  if (!snapshot || typeof snapshot !== 'object') return empty;
  if (snapshot.phase !== 'ready') return empty;
  const byId = snapshot.byId;
  if (!byId || typeof byId !== 'object') return empty;
  for (const row of Object.values(byId)) {
    if (!row || typeof row !== 'object') continue;
    const retained = row.retainedBy;
    const mainView = retained && typeof retained.mainView === 'number' ? retained.mainView : 0;
    if (mainView > 0) {
      return {
        session: dmQueryValue(row.id),
        cwd: dmQueryValue(row.cwd),
      };
    }
  }
  return empty;
}

/** 工作区快照（`useWorkspaces((state) => state)`，见 ui-workspace:2570/3515）→ 会话所属工作区。 */
function dmWorkspaceOfSession(workspaces, session) {
  if (!workspaces || typeof workspaces !== 'object') return null;
  if (workspaces.phase !== 'ready') return null;
  const items = Array.isArray(workspaces.items) ? workspaces.items : [];
  const target = dmQueryValue(session);
  if (target === null) return null;
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const ids = Array.isArray(item.sessionIds) ? item.sessionIds : [];
    if (ids.includes(target)) return item;
  }
  return null;
}

/**
 * hooks 路的上下文汇总：先拿「当前会话」的 cwd；拿不到就用它的工作区 path 补。
 * 两条都拿不到 ⇒ 未解析（由 `dmContextState` 统一给出「不猜」的结论与提示）。
 */
function dmContextFromSnapshots(list, workspaces) {
  const current = dmCurrentFromSessionList(list);
  let cwd = current.cwd;
  if (cwd === null) {
    const workspace = dmWorkspaceOfSession(workspaces, current.session);
    if (workspace !== null) cwd = dmQueryValue(workspace.path);
  }
  return dmContextState({ cwd, session: current.session, source: 'hooks' });
}

/** 从一个 cordis 服务上安静地取快照（服务缺席/未就绪一律 null，不抛）。 */
function dmServiceSnapshot(ctx, serviceKey) {
  if (!ctx || typeof ctx.get !== 'function') return null;
  let service = null;
  try {
    service = ctx.get(serviceKey);
  } catch (error) {
    return null;
  }
  if (!service || !service.list || typeof service.list.getSnapshot !== 'function') return null;
  try {
    return service.list.getSnapshot();
  } catch (error) {
    return null;
  }
}

/**
 * service 路的上下文汇总（hooks 缺席时的后手）。
 * 服务签名证据：`@deepseek-ai/dsh-client-ui-workspace/lib/client.js:1503-1504`
 *   `const workspace = this.workspaces.list.getSnapshot();`
 *   `const sessions  = this.sessions.list.getSnapshot();`
 * 与 `@deepseek-ai/dsh-cordis-client-runner/lib/client.js:1266`（sessions 服务目录）、
 *   `:1615`（workspaces 服务目录）、`:2166`（SessionListState）、`:2342`（WorkspaceView.path）。
 */
function dmContextFromServices(ctx) {
  const list = dmServiceSnapshot(ctx, 'sessions');
  const workspaces = dmServiceSnapshot(ctx, 'workspaces');
  const combined = dmContextFromSnapshots(list, workspaces);
  if (combined.resolved) return Object.assign({}, combined, { source: 'services' });
  return Object.assign({}, combined, { source: 'none' });
}

/** 读 overview：同源相对 fetch，非 2xx 直接抛（调用方落到 error 态）。 */
async function dmFetchOverview(context, signal) {
  const url = dmApiUrl('overview', context && context.params);
  const response = await fetch(url, {
    method: 'GET',
    credentials: 'same-origin',
    headers: { accept: 'application/json' },
    signal,
  });
  if (!response || response.ok !== true) {
    throw new Error(`dsh-memory client: overview HTTP ${response ? response.status : 'no-response'}`);
  }
  return response.json();
}

/** 写 workflow：恒定 200（仅越界/坏 JSON 为 400），故 400 单独报错、其余一律归一。 */
async function dmPostWorkflow(input) {
  const response = await fetch(dmApiUrl('workflow', null), {
    method: 'POST',
    credentials: 'same-origin',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify(dmWorkflowBody(input)),
  });
  if (!response || response.ok !== true) {
    throw new Error(`dsh-memory client: workflow HTTP ${response ? response.status : 'no-response'}`);
  }
  return dmWorkflowOutcome(await response.json());
}

		// ── 内联模块：plugin/client/02-model.js —— 纯模型：三级落位判定与面板视图模型（构建期注入；勿手改本段）──
/**
 * client/02-model.js — 纯模型层：落位判定、治理预判的展示口径、面板视图模型（唯一实现）。
 *
 * 本模块**不碰 DOM、不碰 React、不碰 fetch**：所有输入都是普通值，输出都是普通值。
 * 这样做的两个理由：
 *   1. 契约 §4.2 的三级降级是「必须全部实现且可观测」的判定规则 —— 纯函数才能逐级断言。
 *   2. 平台外壳（`shell.overlay`、标题栏行、shadow root）测不到的部分，绝不允许
 *      靠「跑起来看看」来定稿；判定必须能被离线复现。
 *
 * 契约：零依赖；顶层只许声明。
 */

/** 落位用的缺省与常量。数值全部来自 build-contract.md §2/§4.2 的实测值。 */
const DM_PLACEMENT = {
  gap: 8,               // menubar 右边界与按钮之间的间距
  menuStart: 48,        // var(--dsh-windows-menu-start) 的实测缺省
  menuWidth: 96,        // var(--dsh-memory-menu-width) 的缺省（侧栏展开时「应用/编辑」的实宽）
  titlebarHeight: 40,   // var(--dsh-windows-titlebar-height) 的实测缺省
  leadingClearance: 0,  // var(--dsh-frame-leading-clearance) 的缺省
  minInset: 12,         // P2 的最小左内边距
  p2Top: 12,            // 标题栏高度为 0 时给按钮留的最小上内边距
  zIndex: 1100,         // 与 preload 的 menubar 同层
  zIndexP0: 1101,       // P0 必须压在 menubar 之上
};

/** 有限数就用它，否则用 fallback（`null` 表示「未知」，与「0」严格区分开）。 */
function dmNumberOr(value, fallback) {
  return typeof value === 'number' && isFinite(value) ? value : fallback;
}

/**
 * 三级降级落位判定（契约 §4.2）。
 *
 * 输入（全部由 DOM 层量出，测不到就是 null/缺省）：
 *   menuFound         是否找得到 preload 挂的 `[data-windows-menu]`
 *   shadowReadable    open shadow root 是否可读（未来改成 closed 就不可读）
 *   menubarRect       `[role=menubar]` 的 { right, top, height }；**0 宽视为未挂载**
 *   cssStart          var(--dsh-windows-menu-start)
 *   cssLeadingClearance  var(--dsh-frame-leading-clearance)
 *   titlebarHeight    var(--dsh-windows-titlebar-height)
 *   menuWidth         menubar 的实测宽度（P1 的自宽兜底）
 *
 * 输出：{ level, left, top, transform, zIndex, why } —— `why` 让撤级原因在产物里可观测。
 */
function dmResolvePlacement(input) {
  const raw = input && typeof input === 'object' ? input : {};
  const menuFound = raw.menuFound === true;
  const shadowReadable = raw.shadowReadable === true;
  const rect = raw.menubarRect && typeof raw.menubarRect === 'object' ? raw.menubarRect : null;
  const right = rect === null ? 0 : dmNumberOr(rect.right, 0);
  const height = rect === null ? 0 : dmNumberOr(rect.height, 0);
  const rectUsable = right > 0 && height > 0;
  const top = rect === null ? 0 : dmNumberOr(rect.top, 0);
  const declaredTitlebar = dmNumberOr(raw.titlebarHeight, null);
  const titlebar = declaredTitlebar === null ? DM_PLACEMENT.titlebarHeight : declaredTitlebar;

  if (menuFound && shadowReadable && rectUsable) {
    return {
      level: 'P0',
      left: right + DM_PLACEMENT.gap,
      top: top + height / 2,
      transform: 'translateY(-50%)',
      zIndex: DM_PLACEMENT.zIndexP0,
      why: 'menubar 右边界 + 8px（实测）',
    };
  }

  if (menuFound) {
    const menuStart = dmNumberOr(raw.cssStart, DM_PLACEMENT.menuStart);
    const menuWidth = dmNumberOr(raw.menuWidth, DM_PLACEMENT.menuWidth);
    return {
      level: 'P1',
      left: menuStart + menuWidth,
      top: titlebar / 2,
      transform: 'translateY(-50%)',
      zIndex: DM_PLACEMENT.zIndex,
      why: shadowReadable
        ? 'menubar 测到 0 宽（尚未挂载）⇒ 降级到 CSS 变量兜底'
        : 'shadow root 不可读 ⇒ 降级到 CSS 变量兜底',
    };
  }

  const clearance = dmNumberOr(raw.cssLeadingClearance, DM_PLACEMENT.leadingClearance);
  const centered = declaredTitlebar !== null && declaredTitlebar > 0;
  return {
    level: 'P2',
    left: Math.max(clearance, DM_PLACEMENT.minInset),
    top: centered ? titlebar / 2 : DM_PLACEMENT.p2Top,
    transform: centered ? 'translateY(-50%)' : 'none',
    zIndex: DM_PLACEMENT.zIndex,
    why: '没有 [data-windows-menu]（macOS / 纯 web）⇒ leading clearance 兜底',
  };
}

/** 面板四段的**固定顺序**（契约 §4.3）。顺序即契约，故由函数返回而不是散在渲染里。 */
function dmSectionOrder() {
  return ['l1', 'l2', 'l4', 'l3', 'knowledge'];
}

/**
 * 只读边界：面板里**没有**任何编辑 / 新建 / 修改入口（契约 §4.3、计划 §9）。
 * 这是刻意做成可断言常量的 —— 它是一条边界声明，不是实现细节。
 */
function dmHasWriteSurface() {
  return false;
}

/** 状态文案键表。未知状态返回 null，让调用方自己决定（而不是给一句万能兜底）。 */
const DM_STATE_COPY = {
  loading: 'stateLoading',
  error: 'stateError',
  empty: 'stateEmpty',
  unresolved: 'stateUnresolved',
  missing: 'stateMissing',
};

/** 加载 / 错误 / 空 / 缺上下文的明确文案（不用 spinner-only）。 */
function dmStateCopy(state, lang) {
  const key = DM_STATE_COPY[state];
  if (typeof key !== 'string') return null;
  return dmCopyFor(lang === undefined ? dmActiveLang() : lang, key);
}

/**
 * markdown-lite 的**分块**渲染：只认标题 / 列表 / 围栏代码 / 段落四种块。
 * 正文一律原样保留 —— 安全边界在渲染侧（React 文本节点），模型侧不改写用户内容，
 * 否则「面板显示的 markdown」与「vault 里的 markdown」就不再是同一份东西。
 */
function dmMarkdownLite(text) {
  if (typeof text !== 'string' || text === '') return [];
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let inFence = false;
  let fence = [];
  for (const line of lines) {
    if (inFence) {
      if (/^\s*```/.test(line)) {
        blocks.push({ kind: 'code', text: fence.join('\n') });
        inFence = false;
        fence = [];
      } else {
        fence.push(line);
      }
      continue;
    }
    if (/^\s*```/.test(line)) {
      inFence = true;
      fence = [];
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push({ kind: 'heading', level: heading[1].length, text: heading[2] });
      continue;
    }
    const bullet = /^\s*(?:[-*+]|\d+\.)\s+(.*)$/.exec(line);
    if (bullet) {
      blocks.push({ kind: 'bullet', text: bullet[1] });
      continue;
    }
    if (line.trim() === '') continue;
    blocks.push({ kind: 'paragraph', text: line });
  }
  if (inFence && fence.length > 0) blocks.push({ kind: 'code', text: fence.join('\n') });
  return blocks;
}

/**
 * markdown-lite 的**行内**拆分：代码 / 强调 / 双链。
 * 只认成对闭合的标记；未闭合的标记保持字面文本（绝不吃掉后续正文）。
 * 正文内容一字不改：标记本身被剥掉，其余原样。
 */
function dmInlineSpans(text) {
  if (typeof text !== 'string' || text === '') return [];
  const spans = [];
  let rest = text;
  let plain = '';
  const flush = () => {
    if (plain !== '') {
      spans.push({ kind: 'text', text: plain });
      plain = '';
    }
  };
  const pattern = /^(`+)([\s\S]*?)\1|^\*\*([\s\S]+?)\*\*|^\[\[([^\]\n]+)\]\]/;
  while (rest !== '') {
    const match = pattern.exec(rest);
    if (match === null) {
      plain += rest.charAt(0);
      rest = rest.slice(1);
      continue;
    }
    if (match[1] !== undefined) {
      flush();
      spans.push({ kind: 'code', text: match[2] });
    } else if (match[3] !== undefined) {
      flush();
      spans.push({ kind: 'strong', text: match[3] });
    } else {
      flush();
      spans.push({ kind: 'wikilink', text: match[4] });
    }
    rest = rest.slice(match[0].length);
  }
  flush();
  return spans;
}

/** L3 段的状态计数（契约 §3.1 的 byState 形状）→ 可渲染的行。 */
function dmL3Counts(byState, lang) {
  const source = byState && typeof byState === 'object' ? byState : {};
  const order = ['active', 'decaying', 'expired', 'pinned'];
  const rows = [];
  for (const state of order) {
    const count = dmNumberOr(source[state], 0);
    rows.push({ state, count });
  }
  return { rows, lang: lang === undefined ? dmActiveLang() : lang };
}

/** 半衰期等数值的显示口径：保留三位小数、去掉尾零，且**不做四舍五入之外的加工**。 */
function dmScoreText(score) {
  if (typeof score !== 'number' || !isFinite(score)) return '';
  return String(Math.round(score * 1000) / 1000);
}

		// ── 内联模块：plugin/client/03-dom.js —— DOM 接触面：量、贴、观察、样式令牌（构建期注入；勿手改本段）──
/**
 * client/03-dom.js — DOM 侧的全部平台接触面（唯一实现）：量、贴、观察、样式。
 *
 * 三条硬约束都落在这里：
 *   1. **只量不猜**：`[data-windows-menu]` 是 preload 挂在 `document.body` 上的宿主，
 *      open shadow root 内有 `[role=menubar]`（证据：`resources/app/lib/preload-app.cjs:454 installWindowsMenu`，
 *      其 `:host` 规则用 `left: var(--dsh-windows-menu-start, 48px)`）。
 *      量不到就降级（见 02-model.js 的三级判定），**不把 0 当坐标**。
 *   2. **重排要活**：语言切换会改 menubar 文字宽度 ⇒ 必须 MutationObserver；
 *      侧栏收起/展开会改 `--dsh-windows-menu-start` 与字号 ⇒ 必须 ResizeObserver。
 *   3. **卸载全断**：所有观察器/监听器都在返回的 disposer 里断开，不留给下一个实例。
 *
 * 样式令牌纪律（Lead 从 `@deepseek-ai/dsh-client-ui-theme/lib/client.js` 提取的权威清单）：
 *   · 色值/材质/圆角**只许**引用平台变量，且**单层** `var(--real-token)` ——
 *     禁止把 `var()` 套成兜底链（多级兜底会把拼错的令牌静默藏起来）。
 *   · 令牌名必须逐字来自许可名单；本文件用到的每一个都在 client-smoke 的守卫清单里。
 *
 * 契约：零依赖；顶层只许声明。
 */

/** 平台变量名（集中一处，便于对账；改一处即全局生效）。 */
const DM_CSS_VARS = {
  menuStart: '--dsh-windows-menu-start',
  menuWidth: '--dsh-memory-menu-width',
  titlebarHeight: '--dsh-windows-titlebar-height',
  leadingClearance: '--dsh-frame-leading-clearance',
};

/** 面板与按钮的样式表。色值**只许**来自平台变量。 */
const DM_STYLES = `
[data-dsh-memory-button] {
  position: fixed;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 28px;
  padding: 0 10px;
  margin: 0;
  border: 0;
  border-radius: var(--dsw-radius-sm);
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font-family: var(--dsw-font-family);
  font-size: 14px;
  line-height: 1;
  cursor: default;
  pointer-events: auto;
  -webkit-app-region: no-drag;
  transition: background var(--ds-transition-duration-slow) ease,
              color var(--ds-transition-duration-slow) ease;
}
[data-dsh-memory-button]:hover,
[data-dsh-memory-button][aria-expanded="true"] {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}
[data-dsh-memory-button]:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: -2px;
}

[data-dsh-memory-panel] {
  position: fixed;
  display: flex;
  flex-direction: column;
  width: min(720px, calc(100vw - 32px));
  height: min(560px, calc(100vh - 96px));
  border: 1px solid var(--dsw-alias-border-l3);
  border-radius: var(--dsw-radius-lg);
  box-shadow: var(--dsw-shadow-lv3);
  /* 玻璃材质 —— 与平台浮层同一配方，再叠一层左侧栏的底色：
     底色那层让面板与左侧栏同色（没有壁纸时侧栏底色是实心的，面板也就是实心的）；
     壁纸把 --dsw-specific-sidebar-fill 置成 transparent 时，这层透过去，
     剩下 --dsw-menu-surface-fill + 40px 模糊/150% 饱和 = 和侧栏一样的玻璃。
     之前用 --dsw-alias-bg-base 是错的：壁纸模式下宿主让它透出壁纸，面板就成了透明板。
     注意本文件整体是一个模板字符串，注释里不能出现反引号与美元花括号。 */
  background:
    linear-gradient(var(--dsw-specific-sidebar-fill), var(--dsw-specific-sidebar-fill)),
    var(--dsw-menu-surface-fill);
  -webkit-backdrop-filter: var(--dsw-menu-backdrop-filter);
  backdrop-filter: var(--dsw-menu-backdrop-filter);
  color: var(--dsw-alias-label-primary);
  font-family: var(--dsw-font-family);
  font-size: 13px;
  pointer-events: auto;
  -webkit-app-region: no-drag;
  z-index: 1102;
  overflow: hidden;
}
/* 宿主拒绝弹窗时的面板内嵌页：与面板同一位置/同一材质，页头说明原因并可关。 */
[data-dsh-memory-frame] {
  position: fixed;
  display: flex;
  flex-direction: column;
  z-index: 1103;
  overflow: hidden;
  pointer-events: auto;
  -webkit-app-region: no-drag;
  border: 1px solid var(--dsw-alias-border-l3);
  border-radius: var(--dsw-radius-lg);
  box-shadow: var(--dsw-shadow-lv3);
  background: var(--dsw-menu-surface-fill);
  color: var(--dsw-alias-label-primary);
  font-family: var(--dsw-font-family);
  font-size: 13px;
}
[data-dsh-memory-frame-head] {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
}
[data-dsh-memory-frame-title] { font-weight: 600; }
[data-dsh-memory-frame-hint] { flex: 1 1 auto; color: var(--dsw-alias-label-tertiary); font-size: 12px; }
[data-dsh-memory-frame-page] {
  flex: 1 1 auto;
  width: 100%;
  border: 0;
  background: var(--dsw-menu-surface-fill);
}
[data-dsh-memory-panel-head] {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
}
[data-dsh-memory-panel-title] { font-size: 14px; font-weight: 600; }
[data-dsh-memory-panel-body] {
  flex: 1 1 auto;
  overflow-y: auto;
  padding: 8px 4px 12px;
}
[data-dsh-memory-panel-section] { padding: 4px 8px; }
[data-dsh-memory-panel-section] + [data-dsh-memory-panel-section] {
  border-top: 1px solid var(--dsw-alias-border-l2);
}
[data-dsh-memory-section-head] {
  display: flex;
  align-items: baseline;
  gap: 8px;
  width: 100%;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  padding: 4px 0;
  cursor: default;
  -webkit-app-region: no-drag;
}
[data-dsh-memory-section-head]:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: -2px;
}
[data-dsh-memory-section-toggle] {
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
}
[data-dsh-memory-section-title] { font-weight: 600; }
[data-dsh-memory-section-meta] { color: var(--dsw-alias-label-tertiary); font-size: 12px; }
[data-dsh-memory-note],
[data-dsh-memory-refused] {
  border-left: 3px solid var(--dsw-alias-state-business-primary);
  padding: 6px 8px;
  margin: 4px 0 8px;
  background: var(--dsw-alias-interactive-bg-hover);
  white-space: pre-wrap;
  word-break: break-word;
}
[data-dsh-memory-md-paragraph],
[data-dsh-memory-md-bullet] { margin: 2px 0; white-space: pre-wrap; word-break: break-word; }
[data-dsh-memory-md-heading] { font-weight: 600; margin: 6px 0 2px; }
[data-dsh-memory-md-code] {
  display: block;
  margin: 4px 0;
  padding: 6px 8px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-sm);
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-secondary);
  font-family: var(--dsw-font-markdown-code-font-family);
  white-space: pre-wrap;
  word-break: break-word;
}
[data-dsh-memory-row] {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 5px 8px;
  border-top: 1px solid var(--dsw-alias-border-l2);
}
[data-dsh-memory-row-main] { min-width: 0; flex: 1 1 auto; }
[data-dsh-memory-row-title] { font-weight: 600; }
[data-dsh-memory-row-meta],
[data-dsh-memory-row-path] {
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
  word-break: break-all;
}
[data-dsh-memory-row-actions] { display: flex; gap: 6px; flex: 0 0 auto; }
[data-dsh-memory-action] {
  height: 24px;
  padding: 0 8px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: var(--dsw-radius-sm);
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 12px;
  cursor: default;
  -webkit-app-region: no-drag;
  transition: background var(--ds-transition-duration-slow) ease;
}
[data-dsh-memory-action]:hover:enabled { background: var(--dsw-alias-interactive-bg-hover); }
[data-dsh-memory-action]:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: -2px;
}
[data-dsh-memory-action]:disabled { color: var(--dsw-alias-label-secondary); cursor: not-allowed; }
[data-dsh-memory-badge] {
  display: inline-block;
  margin-left: 6px;
  padding: 0 6px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 999px;
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
}
[data-dsh-memory-state] {
  padding: 8px;
  color: var(--dsw-alias-label-secondary);
  white-space: pre-wrap;
  word-break: break-word;
}
[data-dsh-memory-error-detail] {
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
  word-break: break-all;
}
[data-dsh-memory-confirm] {
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: var(--dsw-radius-lg);
  padding: 8px;
  margin: 6px 0;
}
[data-dsh-memory-kv] { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
[data-dsh-memory-tag] {
  padding: 0 6px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 999px;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
}
`;

/** `document` 或 null（无头/SSR 一律静默）。 */
function dmDoc() {
  if (typeof document === 'undefined' || !document) return null;
  return document;
}

/** 量一个平台 CSS 变量的数值；量不到返回 null（与 0 严格区分）。 */
function dmCssNumber(name) {
  const doc = dmDoc();
  if (doc === null || typeof window === 'undefined' ||
      typeof window.getComputedStyle !== 'function' || !doc.documentElement) {
    return null;
  }
  let raw = '';
  try {
    raw = window.getComputedStyle(doc.documentElement).getPropertyValue(name);
  } catch (error) {
    return null;
  }
  const value = parseFloat(String(raw).trim());
  return isFinite(value) ? value : null;
}

/**
 * 量 preload 的标题栏菜单宿主。读不到 shadow root 也算「找到了」（P1 的判据）。
 * `menubarWidth` 用于 P1 的自宽兜底（量不到就是 null，交给 CSS 变量缺省）。
 */
function dmMeasureMenu() {
  const doc = dmDoc();
  const miss = { menuFound: false, shadowReadable: false, shadowRoot: null, bar: null, menubarRect: null, menubarWidth: null };
  if (doc === null || typeof doc.querySelector !== 'function') return miss;
  const host = doc.querySelector('[data-windows-menu]');
  if (!host) return miss;
  let shadowRoot = null;
  try {
    shadowRoot = host.shadowRoot || null;
  } catch (error) {
    shadowRoot = null;
  }
  if (!shadowRoot || typeof shadowRoot.querySelector !== 'function') {
    return { menuFound: true, shadowReadable: false, shadowRoot: null, bar: null, menubarRect: null, menubarWidth: null };
  }
  const bar = shadowRoot.querySelector('[role=menubar]');
  if (!bar || typeof bar.getBoundingClientRect !== 'function') {
    return { menuFound: true, shadowReadable: true, shadowRoot, bar: null, menubarRect: null, menubarWidth: null };
  }
  const rect = bar.getBoundingClientRect();
  return {
    menuFound: true,
    shadowReadable: true,
    shadowRoot,
    bar,
    menubarRect: { right: rect.right, top: rect.top, height: rect.height },
    menubarWidth: rect.width > 0 ? rect.width : null,
  };
}

/** 组装三级判定需要的输入（量到的原值 + 量不到的留给判定层用缺省）。 */
function dmPlacementInput() {
  const measured = dmMeasureMenu();
  return {
    menuFound: measured.menuFound,
    shadowReadable: measured.shadowReadable,
    menubarRect: measured.menubarRect,
    cssStart: dmCssNumber(DM_CSS_VARS.menuStart),
    cssLeadingClearance: dmCssNumber(DM_CSS_VARS.leadingClearance),
    titlebarHeight: dmCssNumber(DM_CSS_VARS.titlebarHeight),
    menuWidth: measured.menubarWidth === null ? dmCssNumber(DM_CSS_VARS.menuWidth) : measured.menubarWidth,
  };
}

/** 把判定结果贴到元素上（只写几何，不写颜色 —— 颜色全在样式表里）。 */
function dmApplyPlacement(element, placement) {
  if (!element || !element.style || !placement) return false;
  element.style.left = `${placement.left}px`;
  element.style.top = `${placement.top}px`;
  element.style.transform = placement.transform;
  element.style.zIndex = String(placement.zIndex);
  if (typeof element.setAttribute === 'function') {
    element.setAttribute('data-dsh-memory-placement', placement.level);
    element.setAttribute('data-dsh-memory-placement-why', placement.why);
  }
  return true;
}

/** 样式表引用计数：多实例共存时不会互相把样式拆掉（卸载仍全断）。 */
let dmStyleNode = null;
let dmStyleRefs = 0;

/** 注入样式表；返回 disposer（引用归零时才真正摘除节点）。 */
function dmInstallStyles() {
  const doc = dmDoc();
  if (doc === null || !doc.head || typeof doc.createElement !== 'function') {
    return function () {};
  }
  if (dmStyleRefs === 0 || dmStyleNode === null) {
    const node = doc.createElement('style');
    node.setAttribute('data-dsh-memory-styles', '');
    node.textContent = DM_STYLES;
    doc.head.appendChild(node);
    dmStyleNode = node;
  }
  dmStyleRefs += 1;
  return function disposeStyles() {
    dmStyleRefs = Math.max(0, dmStyleRefs - 1);
    if (dmStyleRefs === 0 && dmStyleNode !== null && dmStyleNode.parentNode) {
      dmStyleNode.parentNode.removeChild(dmStyleNode);
    }
    if (dmStyleRefs === 0) dmStyleNode = null;
  };
}

/**
 * 持续重排：ResizeObserver（menubar 尺寸）+ 两条 MutationObserver
 * （shadow root 文本变化 = 语言切换；document 只用来**发现**菜单出现/消失）。
 * 返回的 disposer 断开全部观察器与监听器。
 */
function dmWatchPlacement(options) {
  const opts = options && typeof options === 'object' ? options : {};
  const measure = typeof opts.measure === 'function' ? opts.measure : dmPlacementInput;
  const emit = typeof opts.onPlacement === 'function' ? opts.onPlacement : function () {};
  const doc = dmDoc();
  if (doc === null || typeof window === 'undefined') return function () {};

  let disposed = false;
  let frame = 0;
  let burst = 0;
  let bar = null;

  // 侧栏折叠/展开翻转的是 CSS 变量（`html[data-windows-titlebar]:has([data-sidebar-collapsed=true])`
  // ⇒ `--dsh-windows-menu-start` 48px↔84px），于是 menubar **水平位移、尺寸不变**：ResizeObserver
  // 只看尺寸；shadow root 观察器在 shadow 之内，看不到落在 `<html>` 侧的选择符；window resize 也不会
  // 派发。所以"只按尺寸重排"会让按钮停在旧 x、压在官方「编辑」上 —— 属性翻转必须单独听。
  const LAYOUT_ATTRIBUTES = ['data-sidebar-collapsed', 'data-windows-titlebar', 'data-platform', 'data-fullscreen'];

  const resizeObserver = typeof ResizeObserver === 'function'
    ? new ResizeObserver(() => schedule())
    : null;
  const barObserver = typeof MutationObserver === 'function'
    ? new MutationObserver(() => { sync(); schedule(); })
    : null;
  const menuObserver = typeof MutationObserver === 'function'
    ? new MutationObserver(() => { if (bar === null || bar.isConnected === false) sync(); })
    : null;
  // 与 menuObserver **分开**：那个只听 childList（发现菜单出现/消失），若把属性塞进同一个回调，
  // 对流式插入 DOM 的宿主（对话逐字输出）会在每帧触发重测。这两个职责不能混。
  const layoutObserver = typeof MutationObserver === 'function'
    ? new MutationObserver(() => { bumpPlacement(6); })
    : null;

  function schedule() {
    if (disposed || frame !== 0) return;
    frame = window.requestAnimationFrame(() => {
      frame = 0;
      if (disposed) return;
      emit(dmResolvePlacement(measure()));
    });
  }

  /**
   * 连续若干帧重测。侧栏折叠会**同时**改布局（grid 列宽有过渡），所以单帧重测可能落在过渡
   * 中途；用有界的帧数（默认 6）跟到稳定，且自带取消，不引入计时器、不留悬挂回调。
   */
  function bumpPlacement(frames) {
    if (disposed) return;
    let left = Math.max(1, frames | 0);
    const step = () => {
      if (disposed) return;
      burst = 0;
      emit(dmResolvePlacement(measure()));
      left -= 1;
      if (left > 0) burst = window.requestAnimationFrame(step);
    };
    if (burst !== 0) {
      try {
        window.cancelAnimationFrame(burst);
      } catch (error) {
        // 已取消的帧句柄：无所谓，下一步会重排
      }
      burst = 0;
    }
    burst = window.requestAnimationFrame(step);
  }

  function sync() {
    if (disposed) return;
    const measured = dmMeasureMenu();
    const next = measured.bar || null;
    if (next === bar) return;
    if (resizeObserver) {
      try {
        if (bar !== null) resizeObserver.unobserve(bar);
        if (next !== null) resizeObserver.observe(next);
      } catch (error) {
        // 观察器已断开：几何由 window resize 与下一次 sync 兜底，不该因此打断 UI
      }
    }
    if (barObserver) {
      barObserver.disconnect();
      const root = measured.shadowRoot || null;
      if (root !== null) {
        barObserver.observe(root, { subtree: true, childList: true, characterData: true, attributes: true });
      }
    }
    bar = next;
    schedule();
  }

  if (menuObserver) {
    menuObserver.observe(doc.documentElement || doc, { childList: true, subtree: true });
  }
  if (layoutObserver) {
    layoutObserver.observe(doc.documentElement || doc, { attributes: true, subtree: true, attributeFilter: LAYOUT_ATTRIBUTES });
  }
  window.addEventListener('resize', schedule);
  sync();

  return function disposePlacementWatch() {
    if (disposed) return;
    disposed = true;
    if (frame !== 0) {
      try {
        window.cancelAnimationFrame(frame);
      } catch (error) {
        frame = 0;
      }
      frame = 0;
    }
    window.removeEventListener('resize', schedule);
    if (resizeObserver) resizeObserver.disconnect();
    if (barObserver) barObserver.disconnect();
    if (menuObserver) menuObserver.disconnect();
    if (layoutObserver) layoutObserver.disconnect();
    if (burst !== 0) {
      try {
        window.cancelAnimationFrame(burst);
      } catch (error) {
        // 见上：句柄失效也无所谓，disposed 已经挡住后续 emit
      }
      burst = 0;
    }
    bar = null;
  };
}

/** Esc 关面板：挂在 document 上（捕获阶段，避免被内部控件吞掉），返回 disposer。 */
function dmInstallEscapeHandler(onEscape) {
  const doc = dmDoc();
  if (doc === null || typeof doc.addEventListener !== 'function') return function () {};
  const handler = (event) => {
    if (!event || event.key !== 'Escape') return;
    onEscape();
  };
  doc.addEventListener('keydown', handler, true);
  return function () {
    doc.removeEventListener('keydown', handler, true);
  };
}

/**
 * 打开知识库只读页。
 *
 * 契约要求"新标签页 + noopener"，所以先按契约来。但**桌面宿主会拒绝**：`setWindowOpenHandler`
 * 对所有弹窗返回 `deny`，只有 `https:` 目标才交给系统浏览器（来源 lib/main.js）；`will-navigate`
 * 也被 `preventDefault`（所以就地跳转也不行）。我们的入口是 http + 相对路径 ⇒ 弹窗被拒且静默，
 * 用户看到的就是"点了没反应"。
 *
 * 因此：`window.open` 拿不到窗口句柄时，**降级为面板内嵌页**（同一份只读页、同源，所以它里面的
 * fetch 照常工作），并把原因写在页头。绝不返回"成功"了事 —— 静默无反应是最坏的结果。
 */
function dmOpenEntry(url) {
  if (typeof url !== 'string' || url === '' || typeof window === 'undefined') {
    return Promise.resolve({ opened: false, reason: 'no-url' });
  }
  let href = url;
  try {
    const base = typeof document !== 'undefined' && typeof document.baseURI === 'string' && document.baseURI !== ''
      ? document.baseURI
      : window.location.href;
    href = new URL(url, base).href;
  } catch (error) {
    href = url;
  }
  // 1) 先请 Host 用系统默认应用打开 —— 桌面版渲染进程的弹窗一律被 `deny`，这是唯一能
  //    真正"开一个独立窗口/应用"的路径；纯 web 上这一步同样成功，观感等同新标签。
  return dmAskHostToOpen().then((opened) => {
    if (opened) return { opened: true, mode: 'host-browser', href };
    // 2) Host 不帮忙（旧宿主/无路由）⇒ 自己开新标签（纯 web 正常路径）。
    let win = null;
    try {
      win = window.open(href, '_blank', 'noopener');
    } catch (error) {
      win = null;
    }
    if (win) return { opened: true, mode: 'window', href };
    // 3) 桌面弹窗被拒时的兜底：面板内嵌同一份只读页，绝不静默无反应。
    return dmShowInPanelFrame(href);
  });
}

/**
 * 请 Host 用系统默认应用打开知识库页（`POST {prefix}/kb/open`）。
 * 任何失败（网络、非 200、`ok:false`）都返回 false 交给调用方降级 —— 不抛、不猜。
 */
function dmAskHostToOpen() {
  if (typeof fetch !== 'function') return Promise.resolve(false);
  try {
    return fetch(dmApiUrl('kbOpen'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
      .then((response) => (response && response.ok === true ? response.json() : null))
      .then((data) => Boolean(data && data.ok === true))
      .catch(() => false);
  } catch (error) {
    return Promise.resolve(false);
  }
}

/** 面板内嵌打开（宿主拒绝弹窗时的降级）。返回真实结果，不给假成功。 */
function dmShowInPanelFrame(href) {
  const doc = dmDoc();
  if (doc === null || typeof doc.createElement !== 'function') {
    return { opened: false, reason: 'no-dom', href };
  }
  const body = doc.body && typeof doc.body.append === 'function' ? doc.body : null;
  const panel = typeof doc.querySelector === 'function' ? doc.querySelector('[data-dsh-memory-panel]') : null;
  if (body === null || panel === null) return { opened: false, reason: 'no-panel', href };

  const previous = typeof doc.querySelector === 'function' ? doc.querySelector('[data-dsh-memory-frame]') : null;
  if (previous !== null && previous.parentNode) previous.parentNode.removeChild(previous);

  const rect = typeof panel.getBoundingClientRect === 'function' ? panel.getBoundingClientRect() : null;
  const shell = doc.createElement('div');
  shell.setAttribute('data-dsh-memory-frame', '');
  if (rect !== null && rect.width > 0) {
    shell.style.position = 'fixed';
    shell.style.left = `${Math.round(rect.left)}px`;
    shell.style.top = `${Math.round(rect.top)}px`;
    shell.style.width = `${Math.round(rect.width)}px`;
    shell.style.height = `${Math.round(rect.height)}px`;
  }

  const head = doc.createElement('div');
  head.setAttribute('data-dsh-memory-frame-head', '');
  const title = doc.createElement('span');
  title.setAttribute('data-dsh-memory-frame-title', '');
  title.textContent = dmCopy('kbFrameTitle');
  const hint = doc.createElement('span');
  hint.setAttribute('data-dsh-memory-frame-hint', '');
  hint.textContent = dmCopy('kbFrameHint');
  const close = doc.createElement('button');
  close.type = 'button';
  close.setAttribute('data-dsh-memory-action', '');
  close.setAttribute('data-dsh-memory-action-kind', 'kb-frame-close');
  close.textContent = dmCopy('kbFrameClose');
  close.addEventListener('click', function () {
    if (shell.parentNode) shell.parentNode.removeChild(shell);
  });

  const page = doc.createElement('iframe');
  page.setAttribute('data-dsh-memory-frame-page', '');
  page.setAttribute('title', dmCopy('kbFrameTitle'));
  page.setAttribute('src', href);
  page.setAttribute('loading', 'eager');

  head.append(title, hint, close);
  shell.append(head, page);
  body.append(shell);
  return { opened: true, mode: 'frame', href };
}

		// ── 内联模块：plugin/client/04-panel.js —— 面板视图（只读 + L3 动作）（构建期注入；勿手改本段）──
/**
 * client/04-panel.js — 面板的 React 视图（纯展示 + 只调用 02/03 的判定）。
 *
 * 边界声明（契约 §4.3、计划 §9）：面板里**没有**任何编辑 / 新建 / 修改入口。
 * 唯一的写动作是 L3 每行的 pin / unpin / forget —— 它们走 Host 路由，
 * 判定在 Host（`memory_workflow` 同一套函数），本层只负责「不做白点的按钮」与「原样显示拒绝」。
 *
 * 颜色/材质**一个都不在这里**：全部在 03-dom.js 的样式表里引用平台变量，
 * 本层只输出 `data-dsh-memory-*` 属性作为挂钩。这样「禁止硬编码色值」是一条结构性保证，
 * 而不是靠每次改动自觉。
 *
 * 契约：零依赖；顶层只许声明。
 */

/** 行内片段 → React 子节点。纯文本一律走 React 文本节点（无 HTML sink）。 */
function dmElementSpans(text) {
  const spans = dmInlineSpans(text);
  if (spans.length === 0) return null;
  return spans.map((span, index) => {
    if (span.kind === 'code') return React.createElement('code', { key: index }, span.text);
    if (span.kind === 'strong') return React.createElement('strong', { key: index }, span.text);
    if (span.kind === 'wikilink') {
      return React.createElement('span', { key: index, 'data-dsh-memory-wikilink': '' }, span.text);
    }
    return span.text;
  });
}

/** 一个 markdown-lite 块 → React 元素。 */
function dmElementBlock(block, index) {
  if (block.kind === 'heading') {
    return React.createElement('div', {
      key: index,
      'data-dsh-memory-md-heading': '',
      style: { fontSize: 15 - Math.min(block.level, 3) },
    }, dmElementSpans(block.text));
  }
  if (block.kind === 'bullet') {
    return React.createElement('div', { key: index, 'data-dsh-memory-md-bullet': '' },
      '· ', dmElementSpans(block.text));
  }
  if (block.kind === 'code') {
    return React.createElement('pre', { key: index, 'data-dsh-memory-md-code': '' }, block.text);
  }
  return React.createElement('div', { key: index, 'data-dsh-memory-md-paragraph': '' },
    dmElementSpans(block.text));
}

/** 只读 markdown-lite 正文。空正文 ≠ 文件缺失：两者文案不同（不许把 missing 伪装成空）。 */
function dmElementMarkdown(text, present) {
  if (present === false) {
    return React.createElement('div', { 'data-dsh-memory-state': '' }, dmCopy('stateMissing'));
  }
  const blocks = dmMarkdownLite(text);
  if (blocks.length === 0) {
    return React.createElement('div', { 'data-dsh-memory-state': '' }, dmCopy('stateEmpty'));
  }
  return React.createElement('div', null, blocks.map(dmElementBlock));
}

/** 状态块（加载 / 错误 / 空 / 未解析）—— 每态一句话，不用 spinner-only。 */
function dmElementState(state, detail) {
  const text = dmStateCopy(state) || dmCopy('stateError');
  return React.createElement('div', { 'data-dsh-memory-state': '', 'data-dsh-memory-state-kind': state },
    text,
    detail ? React.createElement('div', { 'data-dsh-memory-error-detail': '' }, String(detail)) : null);
}

/** 可折叠分节。`open` 由父组件持有，故折叠状态在重排/刷新后不丢。 */
function dmElementSection(input) {
  const head = React.createElement('button', {
    type: 'button',
    'data-dsh-memory-section-head': '',
    'aria-expanded': input.open ? 'true' : 'false',
    onClick: input.onToggle,
  },
    React.createElement('span', { 'data-dsh-memory-section-title': '' }, input.title),
    input.meta ? React.createElement('span', { 'data-dsh-memory-section-meta': '' }, input.meta) : null,
    React.createElement('span', { 'data-dsh-memory-section-toggle': '' },
      dmCopy(input.open ? 'expanded' : 'collapsed')));
  return React.createElement('section', { 'data-dsh-memory-panel-section': '', 'data-dsh-memory-section': input.kind },
    head,
    input.open ? input.body : null);
}

/** L1 / L2 / L4 的只读段（契约 §4.3：顺序里它们在 L3 之前）。 */
function dmElementLayer(input) {
  const layer = input.layer && typeof input.layer === 'object' ? input.layer : {};
  const meta = [];
  if (typeof layer.path === 'string' && layer.path !== '') meta.push(layer.path);
  if (typeof layer.revision === 'string' && layer.revision !== '') meta.push(layer.revision);
  return dmElementSection({
    kind: input.kind,
    title: typeof layer.title === 'string' && layer.title !== '' ? layer.title : input.fallbackTitle,
    meta: meta.join(' · '),
    open: input.open,
    onToggle: input.onToggle,
    body: dmElementMarkdown(layer.body, layer.present !== false),
  });
}

/** L3 单行：标题 / 路径 / 状态元信息 + 两枚动作（pin 或 unpin + forget）。 */
function dmElementRow(input) {
  const item = input.item && typeof input.item === 'object' ? input.item : {};
  const role = input.role;
  const pinned = item.pinned === true;
  const primaryAction = pinned ? 'unpin' : 'pin';
  const primaryGate = dmActGate({ role, pinned, action: primaryAction });
  const forgetGate = dmActGate({ role, pinned, action: 'forget' });
  const pending = input.pending === true;

  const meta = [];
  if (typeof item.state === 'string' && item.state !== '') meta.push(item.state);
  const score = dmScoreText(item.score);
  if (score !== '') meta.push(`${score} ${dmCopy('l3Score')}`);
  if (typeof item.ageDays === 'number' && isFinite(item.ageDays)) meta.push(`${item.ageDays} ${dmCopy('l3Age')}`);
  if (typeof item.useCount === 'number' && isFinite(item.useCount)) meta.push(`${item.useCount} ${dmCopy('l3Uses')}`);

  const disabled = input.busy === true;
  const action = (actionKey, labelKey, gate, handler) => React.createElement('button', {
    key: actionKey,
    type: 'button',
    'data-dsh-memory-action': '',
    'data-dsh-memory-action-kind': actionKey,
    disabled: disabled || gate.allowed !== true,
    title: gate.allowed === true ? undefined : gate.reason,
    'aria-label': dmCopy(labelKey),
    onClick: () => handler(item.path),
  }, dmCopy(labelKey));

  const actions = React.createElement('div', { 'data-dsh-memory-row-actions': '' },
    action(primaryAction, primaryAction === 'pin' ? 'actionPin' : 'actionUnpin', primaryGate,
      (path) => input.onAct(primaryAction, path)),
    action('forget', 'actionForget', forgetGate, (path) => input.onAskForget(path)));

  const main = React.createElement('div', { 'data-dsh-memory-row-main': '' },
    React.createElement('div', { 'data-dsh-memory-row-title': '' },
      typeof item.title === 'string' && item.title !== '' ? item.title : String(item.path || ''),
      pinned ? React.createElement('span', { 'data-dsh-memory-badge': '' }, dmCopy('actionPin')) : null),
    React.createElement('div', { 'data-dsh-memory-row-path': '' }, String(item.path || '')),
    meta.length > 0
      ? React.createElement('div', { 'data-dsh-memory-row-meta': '' }, meta.join(' · '))
      : null);

  const confirm = pending
    ? React.createElement('div', { 'data-dsh-memory-confirm': '' },
        React.createElement('div', { 'data-dsh-memory-row-title': '' }, dmCopy('confirmTitle')),
        React.createElement('div', { 'data-dsh-memory-row-meta': '' }, dmCopy('confirmBody')),
        React.createElement('div', { 'data-dsh-memory-row-actions': '' },
          React.createElement('button', {
            type: 'button', 'data-dsh-memory-action': '', 'data-dsh-memory-action-kind': 'forget-confirm',
            disabled, onClick: () => input.onConfirmForget(item.path),
          }, dmCopy('confirmYes')),
          React.createElement('button', {
            type: 'button', 'data-dsh-memory-action': '', 'data-dsh-memory-action-kind': 'forget-cancel',
            disabled, onClick: input.onCancelForget,
          }, dmCopy('confirmNo'))))
    : null;

  return React.createElement('div', { 'data-dsh-memory-row': '' }, main, actions, confirm);
}

/** L3 段：状态计数 + 半衰期 + 逐行动作。 */
function dmElementL3(input) {
  const l3 = input.l3 && typeof input.l3 === 'object' ? input.l3 : {};
  const items = dmSortL3(l3.items);
  const counts = dmL3Counts(l3.byState);
  const meta = counts.rows.map((row) => `${row.state} ${row.count}`).join(' · ');
  const body = items.length === 0
    ? dmElementState('empty')
    : React.createElement('div', null, items.map((item, index) => React.createElement(dmElementRow, {
        key: `${String(item && item.path)}#${index}`,
        item,
        role: input.role,
        busy: input.busy,
        pending: input.pendingPath === (item && item.path),
        onAct: input.onAct,
        onAskForget: input.onAskForget,
        onCancelForget: input.onCancelForget,
        onConfirmForget: input.onConfirmForget,
      })));
  return dmElementSection({
    kind: 'l3',
    title: dmCopy('l3Section'),
    meta,
    open: input.open,
    onToggle: input.onToggle,
    body,
  });
}

/** 知识库段：计数 + 标签 + 链接健康 + 一枚「进入」（只读边界，唯一出口是新标签页）。 */
function dmElementKnowledge(input) {
  const knowledge = input.knowledge && typeof input.knowledge === 'object' ? input.knowledge : null;
  if (knowledge === null) {
    return dmElementSection({
      kind: 'knowledge', title: dmCopy('kbSection'), meta: '', open: input.open,
      onToggle: input.onToggle, body: dmElementState('empty'),
    });
  }
  const tags = Array.isArray(knowledge.tags) ? knowledge.tags.slice(0, 12) : [];
  const health = knowledge.linkHealth && typeof knowledge.linkHealth === 'object' ? knowledge.linkHealth : null;
  const entryUrl = typeof knowledge.entryUrl === 'string' && knowledge.entryUrl !== '' ? knowledge.entryUrl : null;
  const body = React.createElement('div', null,
    React.createElement('div', { 'data-dsh-memory-kv': '' },
      React.createElement('span', { 'data-dsh-memory-section-meta': '' },
        `${dmCopy('kbNotes')} ${typeof knowledge.notes === 'number' ? knowledge.notes : 0}`),
      health ? React.createElement('span', { 'data-dsh-memory-section-meta': '' },
        `${dmCopy('kbLinks')} ${health.resolved}/${health.total}`) : null,
      ...tags.map((tag) => React.createElement('span', {
        key: String(tag && tag.tag), 'data-dsh-memory-tag': '',
      }, `${tag && tag.tag} ${tag && tag.count}`))),
    React.createElement('div', { 'data-dsh-memory-row-actions': '' },
      React.createElement('button', {
        type: 'button', 'data-dsh-memory-action': '', 'data-dsh-memory-action-kind': 'kb-enter',
        disabled: entryUrl === null,
        title: entryUrl === null ? dmCopy('kbEntryMissing') : entryUrl,
        onClick: () => dmOpenEntry(entryUrl),
      }, dmCopy('kbEnter'))));
  return dmElementSection({
    kind: 'knowledge', title: dmCopy('kbSection'), meta: '', open: input.open,
    onToggle: input.onToggle, body,
  });
}

/**
 * 顶部对账条：Host 回的 workspace.root/id 必须可见（契约 §4.4 —— 取不到上下文时尤其要能对账）。
 * 这里同时收容 audit / diagnose 两段只读信息，避免它们被静默丢掉。
 */
function dmElementBanner(input) {
  const context = input.context && typeof input.context === 'object' ? input.context : {};
  const workspace = input.workspace && typeof input.workspace === 'object' ? input.workspace : null;
  const audit = input.audit && typeof input.audit === 'object' ? input.audit : null;
  const diagnose = input.diagnose && typeof input.diagnose === 'object' ? input.diagnose : null;
  const lines = [];
  if (workspace) {
    lines.push(`${dmCopy('workspaceLine')}: ${String(workspace.root || '?')} (${String(workspace.id || '?')})`);
    lines.push(`${workspace.role === 'coordinator' ? dmCopy('roleCoordinator') : dmCopy('roleWorker')}`);
  }
  if (audit) lines.push(`${dmCopy('auditLine')}: ${audit.total}/${audit.stale}/${audit.broken}/${audit.gone}`);
  if (Array.isArray(diagnose && diagnose.lines)) {
    for (const line of diagnose.lines.slice(0, 6)) lines.push(String(line));
  }
  const children = [];
  if (context.resolved !== true) {
    children.push(React.createElement('div', { 'data-dsh-memory-note': '' },
      dmCopy('contextUnresolved'),
      React.createElement('div', { 'data-dsh-memory-section-meta': '' },
        context.source === 'services' ? dmCopy('contextSourceServices')
          : context.source === 'none' ? dmCopy('contextSourceNone')
            : dmCopy('contextSourceHooks'))));
  }
  if (lines.length > 0) {
    children.push(React.createElement('div', { 'data-dsh-memory-kv': '' },
      lines.map((line, index) => React.createElement('div', {
        key: index, 'data-dsh-memory-section-meta': '',
      }, line))));
  }
  if (children.length === 0) return null;
  return React.createElement('div', null, children);
}

/** 段的开关状态：由父组件持有（保证重排/刷新后折叠状态不丢）。 */
function dmPanelElement(input) {
  const view = input.view && typeof input.view === 'object' ? input.view : { phase: 'empty' };
  const data = view.data && typeof view.data === 'object' ? view.data : null;
  const openSections = input.openSections && typeof input.openSections === 'object' ? input.openSections : {};
  const toggle = (key) => input.onToggleSection(key);

  const head = React.createElement('div', { 'data-dsh-memory-panel-head': '' },
    React.createElement('div', { 'data-dsh-memory-panel-title': '' }, dmCopy('title')),
    React.createElement('button', {
      type: 'button', 'data-dsh-memory-action': '', 'data-dsh-memory-action-kind': 'close',
      'aria-label': dmCopy('closePanel'), onClick: input.onClose,
    }, dmCopy('closeAction')));

  const children = [];
  if (view.refused) {
    children.push(React.createElement('div', { 'data-dsh-memory-refused': '' },
      `${dmCopy('refusedLabel')}: ${view.refused}`));
  } else if (view.notice) {
    children.push(React.createElement('div', { 'data-dsh-memory-note': '' }, String(view.notice)));
  }
  if (view.error) {
    children.push(React.createElement('div', { 'data-dsh-memory-error-detail': '' }, String(view.error)));
  }
  if (view.phase === 'loading' && data === null) {
    children.push(dmElementState('loading'));
  } else if (view.phase === 'error' && data === null) {
    children.push(dmElementState('error', view.error));
  } else if (data === null) {
    children.push(dmElementState('empty'));
  } else {
    children.push(React.createElement(dmElementBanner, {
      key: 'banner',
      context: input.context,
      workspace: data.workspace,
      audit: data.audit,
      diagnose: data.diagnose,
    }));
    if (view.phase === 'loading') children.push(dmElementState('loading'));
    if (view.phase === 'error') children.push(dmElementState('error', view.error));
    const layers = data.layers && typeof data.layers === 'object' ? data.layers : {};
    const role = data.workspace && data.workspace.role;
    for (const key of dmSectionOrder()) {
      if (key === 'knowledge') {
        children.push(React.createElement(dmElementKnowledge, {
          key, knowledge: data.knowledge, open: openSections.knowledge !== false, onToggle: () => toggle('knowledge'),
        }));
        continue;
      }
      if (key === 'l3') {
        children.push(React.createElement(dmElementL3, {
          key,
          l3: data.l3,
          role,
          busy: input.busy === true,
          pendingPath: input.pendingPath,
          open: openSections.l3 !== false,
          onToggle: () => toggle('l3'),
          onAct: input.onAct,
          onAskForget: input.onAskForget,
          onCancelForget: input.onCancelForget,
          onConfirmForget: input.onConfirmForget,
        }));
        continue;
      }
      children.push(React.createElement(dmElementLayer, {
        key,
        kind: key,
        layer: layers[key],
        fallbackTitle: key.toUpperCase(),
        open: openSections[key] !== false,
        onToggle: () => toggle(key),
      }));
    }
  }

  return React.createElement('section', {
    'data-dsh-memory-panel': '',
    style: input.style || null,
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': dmCopy('title'),
    onKeyDown: (event) => { if (event && event.key === 'Escape') input.onClose(); },
  }, head, React.createElement('div', { 'data-dsh-memory-panel-body': '' }, children));
}

		// ── 内联模块：plugin/client/05-button.js —— shell.overlay 条目：按钮 + 数据流（构建期注入；勿手改本段）──
/**
 * client/05-button.js — `shell.overlay` 的那一枚条目：按钮 + 面板 + 数据流。
 *
 * 为什么入口先分派再渲染（而不是在一个组件里判断）：
 *   React 的 hook 调用顺序必须逐次一致。「平台给了 hooks」与「平台只给了 ctx」是两条
 *   **不同的组件**，各自内部无条件调用自己的 hook —— 于是既不会漏调，也不会条件调用。
 *
 * 会话上下文（契约 §4.4）：
 *   ① 首选平台给 `shell.overlay` 条目注入的标准 props —— `useSessions` / `useWorkspaces`
 *      （证据：`@deepseek-ai/dsh-cordis-client-runner/lib/client.js:5463-5465` 的 standardProps，
 *      其中 `useSessions: UseSessions`、`useWorkspaces: SnapshotSelectorHook<WorkspaceSnapshot>`，
 *      与 `:5433` 的 shell.overlay 座位定义）。
 *   ② 后手：`ctx.get('sessions') / ctx.get('workspaces')` 的 `list.getSnapshot()`
 *      （证据：`@deepseek-ai/dsh-client-ui-workspace/lib/client.js:1503-1504`）。
 *   ③ 两条都拿不到 ⇒ **不猜**：省略 cwd/session 参数，并在面板上明示按 Host 默认目录解析，
 *      同时把 Host 回来的 workspace.root/id 显示出来供对账。
 *
 * 契约：零依赖；顶层只许声明。
 */

/** 入口分派：平台给 hooks 就走 hooks 路，否则走 service 路。 */
function dmMemoryEntry(props) {
  const given = props && typeof props === 'object' ? props : {};
  if (typeof given.useSessions === 'function' && typeof given.useWorkspaces === 'function') {
    return React.createElement(dmEntryHooked, given);
  }
  return React.createElement(dmEntryService, given);
}

/** hooks 路：平台注入的选择器 hook，直接读快照。 */
function dmEntryHooked(props) {
  const list = props.useSessions((state) => state);
  const workspaces = props.useWorkspaces((state) => state);
  const context = React.useMemo(() => dmContextFromSnapshots(list, workspaces), [list, workspaces]);
  return React.createElement(dmEntryView, Object.assign({}, props, { context }));
}

/** service 路：hooks 缺席时的后手。 */
function dmEntryService(props) {
  const context = React.useMemo(() => dmContextFromServices(props.ctx), [props.ctx]);
  return React.createElement(dmEntryView, Object.assign({}, props, { context }));
}

/** 视图：按钮的落位/可达性 + 面板的数据流。 */
function dmEntryView(props) {
  const context = props.context && typeof props.context === 'object'
    ? props.context
    : dmContextState({});

  const [open, setOpen] = React.useState(false);
  const [view, setView] = React.useState({ phase: 'empty', data: null, refused: null, notice: null, error: null });
  const [busy, setBusy] = React.useState(false);
  const [pendingPath, setPendingPath] = React.useState(null);
  const [placement, setPlacement] = React.useState(null);
  const [openSections, setOpenSections] = React.useState({});

  const buttonRef = React.useRef(null);
  const abortRef = React.useRef(null);

  // 落位 + 重排观察 + Esc + 样式：一次性装上，卸载全断（不留给下一个实例）。
  React.useEffect(() => {
    const disposeStyles = dmInstallStyles();
    if (buttonRef.current) dmApplyPlacement(buttonRef.current, dmResolvePlacement(dmPlacementInput()));
    const disposeWatch = dmWatchPlacement({
      onPlacement: (next) => {
        setPlacement(next);
        if (buttonRef.current) dmApplyPlacement(buttonRef.current, next);
      },
    });
    const disposeEscape = dmInstallEscapeHandler(() => setOpen(false));
    return () => {
      disposeEscape();
      disposeWatch();
      disposeStyles();
      if (abortRef.current && typeof abortRef.current.abort === 'function') abortRef.current.abort();
      abortRef.current = null;
    };
  }, []);

  /** 读一次 overview。上下文未解析时 `context.params` 为空 ⇒ 交给 Host 的默认目录。 */
  const load = React.useCallback(() => {
    if (typeof fetch !== 'function') {
      setView({ phase: 'error', data: null, refused: null, notice: null, error: 'fetch unavailable' });
      return;
    }
    if (abortRef.current && typeof abortRef.current.abort === 'function') abortRef.current.abort();
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    abortRef.current = controller;
    setView((previous) => ({
      phase: 'loading', data: previous.data, refused: previous.refused, notice: previous.notice, error: null,
    }));
    dmFetchOverview(context, controller === null ? undefined : controller.signal)
      .then((payload) => {
        setView((previous) => ({
          phase: 'ready', data: payload, refused: previous.refused, notice: previous.notice, error: null,
        }));
      })
      .catch((error) => {
        if (controller !== null && controller.signal && controller.signal.aborted) return;
        setView((previous) => ({
          phase: 'error',
          data: previous.data,
          refused: previous.refused,
          notice: previous.notice,
          error: String((error && error.message) || error),
        }));
      });
  }, [context]);

  /** L3 动作：pin / unpin / forget 全走 Host 路由；被拒绝时把 refused **原样**留下。 */
  const runAction = React.useCallback((action, path) => {
    setBusy(true);
    setPendingPath(null);
    dmPostWorkflow({
      action,
      path,
      cwd: context.params.cwd,
      session: context.params.session,
    })
      .then((outcome) => {
        setView((previous) => ({
          phase: 'ready',
          data: previous.data && outcome.l3
            ? Object.assign({}, previous.data, { l3: outcome.l3 })
            : previous.data,
          refused: outcome.refused,
          notice: outcome.hasRefused ? null : outcome.message,
          error: null,
        }));
      })
      .catch((error) => {
        setView((previous) => Object.assign({}, previous, {
          refused: null,
          notice: null,
          error: String((error && error.message) || error),
        }));
      })
      .then(() => { setBusy(false); });
  }, [context]);

  const toggleOpen = () => {
    const next = !open;
    setOpen(next);
    if (next) load();
  };

  const toggleSection = (key) => {
    setOpenSections((previous) => Object.assign({}, previous, { [key]: previous[key] === false ? true : false }));
  };

  const button = React.createElement('button', {
    type: 'button',
    ref: buttonRef,
    'data-dsh-memory-button': '',
    'aria-expanded': open ? 'true' : 'false',
    'aria-haspopup': 'dialog',
    'aria-label': dmCopy('label'),
    title: dmCopy('openPanel'),
    tabIndex: 0,
    onClick: toggleOpen,
  }, dmCopy('label'));

  if (!open) return React.createElement(React.Fragment, null, button);

  const panelStyle = placement === null
    ? null
    : { left: `${Math.max(placement.left, 8)}px`, top: `${Math.max(placement.top + 34, 8)}px` };

  return React.createElement(React.Fragment, null, button,
    React.createElement(dmPanelElement, {
      context,
      view,
      busy,
      pendingPath,
      openSections,
      style: panelStyle,
      onToggleSection: toggleSection,
      onClose: () => setOpen(false),
      onAct: runAction,
      onAskForget: (path) => setPendingPath(path),
      onCancelForget: () => setPendingPath(null),
      onConfirmForget: (path) => runAction('forget', path),
    }));
}

		// ── 内联模块：plugin/client/06-apply.js —— 注册接缝（构建期注入；勿手改本段）──
/**
 * client/06-apply.js — 插件半边与平台的接缝（唯一注册点）。
 *
 * 契约 §4.2 逐条：
 *   · `inject: ['slots']`，且**只**注册 `shell.overlay` 一枚条目
 *     —— 该座位 kind=list、replaceRisk=none（证据：client-runner:5433/5488），
 *     新 id 是「并排新增」；复用官方 id 才是替换。
 *   · `id: 'dsh-memory-button'`（必须用自己的 id）。
 *   · `order: 40`。
 *   · `label` 传 **thunk**：平台每次投影都要现读（client-runner:5452-5456 的 registerOptions.label），
 *     所以语言切换后按钮文字自动跟随，不需要重注册座位。
 *   · **禁止**注册左上角那个 `single` 型座位（它的 occupants 是官方
 *     `client-ui-sidebar HeaderLeadingControls`，`replaceRisk: shadows-shipped-ui`，见 client-runner:5404-5430）
 *     —— 注册进去会**顶掉官方控件**，不是并排新增。本插件因此只走 `shell.overlay`。
 *
 * 契约：零依赖；顶层只许声明。
 */

/** 唯一的注入声明。 */
const DM_INJECT = ['slots'];

/** 译名 thunk：每次投影现读 `document.documentElement.lang`。 */
function dmButtonLabel() {
  return dmLabel('label');
}

/**
 * 注册（随插件 fiber 注销）：`slots.inject` 把返回值绑在座位声明的生命周期上，
 * 座位消失即整枚条目一起撤销 —— 不需要手工补一层 ctx.effect。
 */
function dmApply(ctx) {
  if (!ctx || !ctx.slots || typeof ctx.slots.inject !== 'function' ||
      typeof ctx.slots.register !== 'function') {
    return;
  }
  return ctx.slots.inject('shell.overlay', () => ctx.slots.register(
    {
      name: 'shell.overlay',
      id: 'dsh-memory-button',
      order: 40,
      label: dmButtonLabel,
    },
    dmMemoryEntry,
  ));
}

		// ── 导出：平台读 apply / inject；__dshMemory 是离线可断言面（无副作用、无 DOM）。──
		exports.apply = dmApply;
		exports.inject = DM_INJECT;
		exports.__dshMemory = {
			apiUrl: dmApiUrl,
			workflowBody: dmWorkflowBody,
			sortL3: dmSortL3,
			actGate: dmActGate,
			workflowOutcome: dmWorkflowOutcome,
			contextState: dmContextState,
			currentFromSessionList: dmCurrentFromSessionList,
			workspaceOfSession: dmWorkspaceOfSession,
			contextFromSnapshots: dmContextFromSnapshots,
			contextFromServices: dmContextFromServices,
			resolvePlacement: dmResolvePlacement,
			sectionOrder: dmSectionOrder,
			hasWriteSurface: dmHasWriteSurface,
			labelFromLang: dmLabelFromLang,
			copyFromLang: dmCopyFromLang,
			forgetConfirm: dmForgetConfirm,
			stateCopy: dmStateCopy,
			markdownLite: dmMarkdownLite,
			inlineSpans: dmInlineSpans,
			l3Counts: dmL3Counts,
			scoreText: dmScoreText,
		};

		return module.exports;
	},
});
