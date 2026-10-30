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