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