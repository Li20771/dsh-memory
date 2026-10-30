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