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