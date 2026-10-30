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