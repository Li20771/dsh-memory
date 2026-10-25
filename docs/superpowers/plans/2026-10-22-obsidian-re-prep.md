# Obsidian 逆向（REA）—— 开工前的准备清单

> 目标：产出设计文档 §4 里 P0 的 ③ 链接文法 / ④ 块 id 模型（+ P1 的 ⑤⑥⑦⑩⑪⑫），
> 供 P1 索引器直接当实现依据。日期 2026-10-22。

## A. 已就绪（无需你操作，我已核实）

| 项 | 事实 |
|---|---|
| 版本 | Obsidian **1.13.7**，`D:\Obsidian\Obsidian.exe`，sha256 `a00f15ad…e9965d` |
| Electron fuses | `RunAsNode`=off、`EnableNodeCliInspectArguments`=off → 主进程 `--inspect` 不可用；`EnableEmbeddedAsarIntegrityValidation`=off、`OnlyLoadAppFromAsar`=off → 静态改包/解包不受阻 |
| 包结构 | `resources\obsidian.asar`（25.8MB）含 `app.js` 3.87MB（渲染层：`blockId` `subpath`×131 `linktext`×64 `unlinked`×77 `MetadataCache`）、`main.js` 200KB（主进程）、`worker.js` 239KB（搜索 worker）；`app.asar` 仅启动壳 |
| 已解包 | `research\obsidian-1.13.7\`（app.js / main.js / worker.js / i18n / lib） |
| 工具链 | Node v24.20.0、npx 11.19.0、REA MCP 全套在位 |
| 你的真实库 | `D:\Obsidian-repository`、`D:\others-repository` —— **不读取、不写入** |

## B. 需要你准备 / 拍板

- [ ] **B1 一次性测试 vault**（默认 `D:\DSH记忆\research\fixtures\vault-re`）：供我造样本、反复重建索引；允许写入与删除。
- [ ] **B2 允许启动隔离实例**：`Obsidian.exe --user-data-dir=<临时目录> --remote-debugging-port=<PORT>` 指向 B1，只做只读观测（DOM/命令面板行为/元数据缓存）。会看到窗口，不动你的配置。
- [ ] **B3 样本覆盖面确认**（我造，你只需说可以）：中文名、空格、`Note.md` vs `note.md`、同名不同目录、标题含 `# ^ | [ ]`、列表项/表格行/引用块/代码块内的 `^id`、`![[embed]]`、别名、层级 tag、frontmatter 属性、非 md 附件与 `.canvas`。
- [ ] **B4 版本口径**：只 1.13.7（默认），或额外对比一个旧版验证语义稳定性。
- [ ] **B5 范围确认**：只做「数据结构 + 语义」，不做 UI/主题/同步/加密。

## C. 交付三件套（默认）

1. **语义规格说明**（markdown）：链接文法 BNF + 消歧优先级 + 块边界定义 + `#^id` → 字符区间算法 + 搜索算子语义表。
2. **Evidence bundle**：每条结论绑 REA Evidence ID（静态）/ 复现步骤（运行时），可复算。
3. **fixture 断言集**：一条规则一条用例，可在 P1 索引器上直接跑。

## D. 顺序

B1/B2 确认 → 造 fixture → 静态分析（REA，不启动 UI）→ 运行探测（CDP 只读）→ 规格 + 断言集。
静态阶段先给「最佳猜测 + 置信度」，P1 可并行开工，运行证据到达后校准。
