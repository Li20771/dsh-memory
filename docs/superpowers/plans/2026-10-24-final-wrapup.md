# 收尾报告：清理 + 保真度套件 + 安装

> 日期：2026-10-24　｜　状态：**完成**（除 UI 阶段）
> 最终验证：**110 单元/保真度测试 · 6 真实 SDK 集成 · 8 可迁移性检查 · 46 条逆向断言全部归类**

---

## 1. 删掉的东西

| 对象 | 体积 | 理由 |
|---|---|---|
| `research/notebooklm/chrome-profile/` | **217.3 MB** | 逆向时留下的浏览器配置，含 `Login Data`、`Cookie`、`Account Web Data`。**这是凭证，不是知识** |
| `research/notebooklm/base.apk` | 30.4 MB | NotebookLM APK。逆向报告的结论是"APK 路线不必再走"，属死证据 |
| `research/fixtures/vault-10k/` | 2.2 MB / 10000 文件 | 早期手工压测残留，**没有任何脚本引用它**，且 0 字节能随时重造 |
| profile 的 `node_modules/.ignored/dsh-m0-probe` | 8.1 KB | 早前探针包，pnpm 已判定"不在依赖树、无安装记录" |

**合计释放 ≈ 250 MB。**

`research/` 从 276.4 MB → **26.5 MB**。

**保留的判断依据**：`research/fixtures/vault-re/`（19 个文件）是保真度测试的夹具，必须入库；`research/notebooklm/*.mjs`（33 个探针脚本）是结论的可复现依据，`docs/reverse/` 的报告直接引用它们，留着比删掉便宜。

`.gitignore` 已挡住 `chrome-profile/` 与解包出的 Obsidian 本体——**即使以后重新抓取，也不会误入版本库**。

---

## 2. 一件差点出事的事

那份 217 MB 的 profile 里有 `Login Data`、`Login Data For Account`、`Cookie`。

当时 `D:\DSH记忆` **还不是 git 仓库**，所以没出事。但只要一次 `git init && git add . && git push`，**浏览器凭证就进了版本库，而 git 历史几乎无法真正清除**。

P6 写 `.gitignore` 时量了一下才发现。这不是理论风险，是差一步的事故。

---

## 3. 把逆向断言变成了可执行的合同

`tools/spec-assertions.json` 一直是**文档**（46 条，逆向 Obsidian 1.13.7 时转录）。现在 `tools/conformance.test.mjs` 让它变成**测试**：逐条跑真代码，输出三类结论。

第一跑就抓出 **15 处偏离**，其中 **6 处是真 bug**：

| bug | 症状 | 根因 |
|---|---|---|
| 有序列表不被识别 | `1. item ^ol-1` 被判成 paragraph | `ITEM_RE` 只认 `-*+` |
| 块 id 被小写化 | `^UPPER-1` 存成 `upper-1` | Obsidian 保留原大小写，只把**缓存键**小写 |
| 缩进代码未屏蔽 | `    code ^in-indent-code` 抽出了块 id | `maskCode` 只处理围栏与行内代码 |
| CRLF 文件块 id 全失效 | `^crlf-1` 找不到 | 行尾残留 `\r`，`[ \t]*$` 匹配不上 |
| 标题 subpath 归一化缺失 | `## With \| pipe` 不响应 `#With pipe` | 缺 TD 归一化（`\|`→空格、剥 `^`） |
| 嵌套链接被误抽 | `[[a[[b]]]]` 抽出 `[[b]]` | 非贪婪匹配拿到了内层 |

另有 2 处是**我的测试映射错**（`#anchor` 未拆分、0-based 与 1-based 行号未对齐），1 处是真**语义偏离**，2 处是**不适用**。全部落在三类里，没有一条被"糊过去"。

### 三类结论的设计意图

- **ok**：与 Obsidian 一致
- **divergence**：我们**有意**不同，附书面理由（`res-01` 歧义不猜、`fm-07` 不模拟 metadataCache 形状、`sub-03` 待复核）
- **fail**：其余一律算 bug

并且——**偏离一旦开始通过，也会报警**（`stale-divergence`）。否则这份清单会烂成一堆没人复查的借口。

### 一个必须点名的不确定项

`sub-03`：断言记录 `#Heading Two` 的区间起点在标题行**之后**（12/14，0-based），而我们把起点取在标题行本身。取标题行是有意的（引用高亮应包含标题文字），但**这条没有运行时证据**，所以标成"待复核"而不是"已定论"。

---

## 4. 补上的缺口

| 缺什么 | 补了什么 |
|---|---|
| 仓库根没有 `README.md` | 写了：四层是什么、目录、装法、10 个工具、验证命令、三条硬规则 |
| 插件没装进 profile | 装好了：`dsh-memory 1.0.0 <- D:\DSH记忆\plugin`，bundle 已挂 |
| 行号是 1-based 但断言是 0-based | 测试里显式换算并注明，不再假装两者一致 |

**安装验证**：通过 profile 的 `node_modules` 解析插件成功，导出 `apply` / `name` / `inject: ["tools","systemPrompt"]`；静态检查确认 `plugin/lib` 下**所有 import 都是 `node:` 内置或相对路径**——零第三方依赖成立。

---

## 5. 最终状态

```
node --test tools/*.test.mjs   110 pass / 0 fail
node tools/integration.mjs     6 confirmed
node tools/portability.mjs     8 checks
conformance                    46 条：43 ok｜3 已记录偏离｜0 失败
```

工具 10 个。设计 v3 主体全部落地。**只剩 UI 阶段。**

---

## 6. 需要你处理的（按优先级）

### ① 重启 DSH —— 否则插件不生效
profile 已改（依赖 + bundles），但新依赖只有在进程重启后才会被加载。重启后再开一个会话，`memory_diagnose` 应该能跑起来。

### ② 改 `kb/positioning.md` —— 收益最大的一件事
它还是我写的草稿。**L1 每轮全文注入、直接定义我的行为边界**，改它比改任何代码都见效快。你写的每一句都会立刻改变我做事的方式。

### ③ 决定哪些工作区打开 L4
我没有替你写 marker——"打开"应该是你的显式动作。命令：

```powershell
# SecurityLab
node tools/enable-workspace.mjs "D:\SecurityLab" --id ws_securitylab --episode ep_2026_10

# AI-Security-Research-Workbench
node tools/enable-workspace.mjs "D:\AI-Security-Research-Workbench" --id ws_workbench --episode ep_2026_10

# 把某个会话设为协调会话（可审查/修订/收割/销毁）
node tools/enable-workspace.mjs "D:\SecurityLab" --coordinator <会话id>
```

`episode` 是项目段的名字。一个工作区同时只有一个活动段。

### ④ `git init` 与首次提交
我没做，也不会未经你同意就做。建议顺序：

```powershell
cd 'D:\DSH记忆'
git init
git add .gitignore README.md kb plugin tools docs research/fixtures
git status --short        # 确认 chrome-profile / obsidian 解包 / .kb-index 都没进去
git commit -m "dsh-memory v1: four-layer memory with governed lifecycle"
```

**提交前一定要看一眼 `git status`**，确认那三类东西没被带进去。

### ⑤ Obsidian 解包目录留不留
`research/obsidian-1.13.7/`（24.5 MB）已 gitignore。留着能复查逆向报告里的字节位置；不留就重解一次。我的建议：**留**，24.5 MB 换"证据可复查"很划算。

### ⑥ 要不要开语义扩召回
默认关。你本机有 `127.0.0.1:8001`，若要开，在 profile 的 `cordis.patch.yml` 加 config（`endpoint` + `model` 填你那个端点的实际值）。开了之后行为变化只有一处：纯同义改写的句子也能被召回；排序不变。

### ⑦ `sub-03` 待复核
如果你手头方便开一次 Obsidian，拖一个链接指向标题，看它高亮的第一行是标题行还是标题下一行——一条消息就能把这条偏差定论。

### ⑧ NotebookLM 账号侧清理
逆向报告里记了：探针笔记里有**两个测试用源**是当时贴进去的。它们还在你的账号里，需要你在网页端删掉。这我做不了。
