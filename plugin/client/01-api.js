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