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