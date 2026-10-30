#!/usr/bin/env node
/**
 * scripts/build-client.mjs — 把 `plugin/client/**` 内联成 `plugin/lib/client.js`。
 *
 * 手法照活先例 `dsh-plugin-wallpaper-engine/lib/client.js`：**同一个工厂作用域**里
 * 按声明顺序把若干「无模块语法的源码片段」拼起来，再把 `plugin/ui-contract.json`
 * （前缀/路由单真源）内联成常量。产物是浏览器模块：
 *
 *   window.__ModuleLoader__.load({ id: 'dsh-memory', factory: (require) => { … } })
 *
 * 铁律：
 *   · 纯 Node 内置模块，零依赖。
 *   · **幂等**：同输入 ⇒ 同字节。不许读时钟、不许读环境、不许读文件系统顺序（清单写死在下面）。
 *   · 源码片段**不许**有 import/export（内联进同一作用域，模块语法会直接语法错误）。
 */

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const CLIENT_DIR = join(ROOT, 'plugin', 'client');
const CONTRACT_PATH = join(ROOT, 'plugin', 'ui-contract.json');
const OUT_PATH = join(ROOT, 'plugin', 'lib', 'client.js');

/** 必须与 `plugin/package.json` 的 `name` 逐字一致（平台按它注册浏览器模块）。 */
const PLUGIN_ID = 'dsh-memory';

/**
 * 内联清单 = 求值顺序。列表最前的模块顶层只能有声明：
 * 后置模块的符号在其顶层会被 TDZ 挡住，所以顺序不是审美问题。
 */
const INLINE_MODULES = [
  { file: '00-i18n.js', title: '词表与「跟随语言」的取值口径' },
  { file: '01-api.js', title: 'Host 数据面：URL / 请求体 / 结果归一' },
  { file: '02-model.js', title: '纯模型：三级落位判定与面板视图模型' },
  { file: '03-dom.js', title: 'DOM 接触面：量、贴、观察、样式令牌' },
  { file: '04-panel.js', title: '面板视图（只读 + L3 动作）' },
  { file: '05-button.js', title: 'shell.overlay 条目：按钮 + 数据流' },
  { file: '06-apply.js', title: '注册接缝' },
];

/** 暴露给 `exports.__dshMemory` 的纯逻辑面（smoke 用它做离线行为断言）。 */
const TEST_SURFACE = [
  'apiUrl', 'workflowBody', 'sortL3', 'actGate', 'workflowOutcome',
  'contextState', 'currentFromSessionList', 'workspaceOfSession',
  'contextFromSnapshots', 'contextFromServices',
  'resolvePlacement', 'sectionOrder', 'hasWriteSurface',
  'labelFromLang', 'copyFromLang', 'forgetConfirm',
  'stateCopy', 'markdownLite', 'inlineSpans', 'l3Counts', 'scoreText',
];

/** 统一 LF + 末尾换行：源码与产物都不许因为编辑器差异而变字节。 */
function normalize(text) {
  return `${text.replace(/\r\n?/g, '\n').replace(/\n*$/, '')}\n`;
}

/** 内联段的分隔横幅（含来源相对路径与一句话职责，便于在产物里导航）。 */
function banner(module) {
  const path = relative(ROOT, join(CLIENT_DIR, module.file)).replace(/\\/g, '/');
  return [
    '',
    `\t\t// ── 内联模块：${path} —— ${module.title}（构建期注入；勿手改本段）──`,
    '',
  ].join('\n');
}

/** 契约常量：单真源内联，键序保持 ui-contract.json 的顺序（JSON 保序）。 */
function contractPrelude(contract) {
  const json = JSON.stringify(contract, null, 2).replace(/\n/g, '\n\t\t');
  return [
    '',
    '\t\t// ── 构建期注入：plugin/ui-contract.json（前缀与路由的**唯一真源**，运行时不许再拼字面量）──',
    `\t\tconst DM_UI_CONTRACT = ${json};`,
    '',
  ].join('\n');
}

/** 头注释：把「谁是源、怎么重建、清单顺序」写在产物第一屏。 */
function fileHeader() {
  const lines = [
    '// ─────────────────────────────────────────────────────────────────────────────',
    '// dsh-memory · client 半边（浏览器模块）',
    '//',
    '// 本文件是**构建产物**：由 scripts/build-client.mjs 从下面这些源内联而成，勿手改。',
    '//   重建：node scripts/build-client.mjs   （纯 Node 内置、零依赖、幂等：同输入同字节）',
    '//',
    '// 内联顺序即求值顺序（同一工厂作用域；顶层读后置模块会撞 TDZ）：',
  ];
  for (const module of INLINE_MODULES) {
    lines.push(`//   · plugin/client/${module.file} —— ${module.title}`);
  }
  lines.push('//');
  lines.push('// 单真源：plugin/ui-contract.json（前缀 / 路由）在下面被内联为 DM_UI_CONTRACT。');
  lines.push('// 注册面：只在 shell.overlay 注册 id=dsh-memory-button / order=40 一枚条目。');
  lines.push('// ─────────────────────────────────────────────────────────────────────────────');
  return `${lines.join('\n')}\n`;
}

/** 组装产物全文（纯函数：不读时钟、不读环境、不读目录顺序）。 */
export function composeClient(sources, contract) {
  const parts = [fileHeader()];
  parts.push('window.__ModuleLoader__.load({\n');
  parts.push(`\tid: '${PLUGIN_ID}',\n`);
  parts.push('\tfactory: (require) => {\n');
  parts.push('\t\tvar module = { exports: {} };\n');
  parts.push('\t\tvar exports = module.exports;\n');
  parts.push('\t\tObject.defineProperty(exports, Symbol.toStringTag, { value: \'Module\' });\n');
  parts.push('\n\t\t// 平台自带的平台模块（工厂参数 provided by __ModuleLoader__）。\n');
  parts.push("\t\tconst React = require('react');\n");
  parts.push(contractPrelude(contract));
  for (const module of INLINE_MODULES) {
    parts.push(banner(module));
    parts.push(normalize(sources[module.file]));
  }
  parts.push('\n\t\t// ── 导出：平台读 apply / inject；__dshMemory 是离线可断言面（无副作用、无 DOM）。──\n');
  parts.push('\t\texports.apply = dmApply;\n');
  parts.push('\t\texports.inject = DM_INJECT;\n');
  parts.push('\t\texports.__dshMemory = {\n');
  for (const name of TEST_SURFACE) {
    parts.push(`\t\t\t${name}: dm${name.charAt(0).toUpperCase()}${name.slice(1)},\n`);
  }
  parts.push('\t\t};\n\n');
  parts.push('\t\treturn module.exports;\n');
  parts.push('\t},\n');
  parts.push('});\n');
  return normalize(parts.join(''));
}

/** 读源与契约 → 写产物；返回写出的字节长度。 */
export async function buildClient() {
  const contractText = await readFile(CONTRACT_PATH, 'utf8');
  const contract = JSON.parse(contractText);
  const sources = {};
  for (const module of INLINE_MODULES) {
    sources[module.file] = await readFile(join(CLIENT_DIR, module.file), 'utf8');
  }
  const output = composeClient(sources, contract);
  await writeFile(OUT_PATH, output, 'utf8');
  return Buffer.byteLength(output, 'utf8');
}

const invoked = process.argv[1] ? fileURLToPath(import.meta.url) === process.argv[1] : false;

if (invoked) {
  const bytes = await buildClient();
  process.stdout.write(`dsh-memory: client 构建完成 → ${relative(ROOT, OUT_PATH).replace(/\\/g, '/')} (${bytes} bytes)\n`);
}