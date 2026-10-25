# P6 交付报告：可迁移性验收

> 日期：2026-10-24　｜　状态：**完成**　｜　107 单元测试 + 6 集成 + 8 可迁移性检查全过

---

## 1. 交付物

| 文件 | 职责 |
|---|---|
| `.gitignore`（仓库根） | 派生物、回收站、机器映射、依赖、**凭证类产物** |
| `tools/portability.mjs` | 四类断言：无绝对路径 / 克隆可用 / ignore 覆盖 / 换机只改一处 |
| `plugin/lib/index.js` | `memory_diagnose` 增加**可迁移性**一行 |
| `kb/workspaces/*.md` | 修掉 2 处硬编码绝对路径 |
| `tools/semantic.test.mjs` | +1 测试（诊断能指出含绝对路径的笔记） |

工具集仍是 **10 个**——P6 没有新增工具。

---

## 2. 绝对路径审计：找到 2 处并修掉

种子文件里各有一行"依据：\`D:\SecurityLab\` 实测"。这类内容的失败方式是**静默的**：索引照建、链接照解、内容只是悄悄在说另一台机器的事。

修法不是删掉信息，而是换掉定位方式：

```
> 依据：本仓库根目录实测（2026-10-23）。
> 根的位置不写死：会话工作目录向上查找 .dsh/memory.json 即定位，本文件在任何机器上都成立。
```

现在 `kb/` 内 **0 处绝对路径**。

---

## 3. 克隆测试：四项断言

只复制**内容**（排除 `.kb-index`/`.trash`/`machines`/`node_modules`），然后从零重建：

| 断言 | 结果 |
|---|---|
| 克隆里不含派生目录 | ✅ |
| 克隆与原件同为 4 篇（无派生数据也能重建） | ✅ |
| 同一查询给出相同结果，**含 revision 一致** | ✅（revision 是内容哈希，一致性同时证明内容没有路径依赖） |
| 在原件上取的引用，克隆上仍解析为 `ok` | ✅（`workflows/spec-to-final-gate.md#规格 → 终局门禁`） |

第四项是关键：如果引用里藏了任何本机上下文，它会变成 `missing` 或 `stale`。

---

## 4. 一个比预期严重得多的发现

写 `.gitignore` 时顺手量了一下工作区，结果：

```
research\notebooklm\chrome-profile\   217.3 MB / 1222 个文件
   ├─ Login Data
   ├─ Login Data For Account
   ├─ Account Web Data
   ├─ Cookies
   └─ Local State
```

这是逆向 NotebookLM 时留下的浏览器配置目录，**含已保存的登录凭证与 cookie**。

当前 `D:\DSH记忆` **还不是 git 仓库**，所以还没有真出事。但只要一次 `git init && git add . && git push`，**217MB 的浏览器凭证就进了版本库**——而且 git 历史基本无法真正清除。

`.gitignore` 已把它挡在外面（`research/notebooklm/chrome-profile/`），并加了注释说明原因。同时挡掉的还有解包出来的 Obsidian 本体（24.5 MB，第三方发行版，非本人作品）。

**建议你做一件事**：如果你不需要那份 profile 了，直接删掉它。忽略规则能防误提交，防不了它一直躺在磁盘上。

---

## 5. 换机器时唯一需要改的

```
dsh-memory 的 vaultRoot → 指向新的 kb/ 路径
```

其余一切——笔记、链接、引用、revision、工作区标记（`.dsh/memory.json` 在各自仓库里随仓库走）——都不需要改。这是设计 §4.3 的落地结果，也是 `machines/<host>.json` 至今为空的原因：**工作区根靠向上查找确定，压根不需要机器映射表**。

---

## 6. 复跑

```powershell
cd 'D:\DSH记忆'
node --test tools/*.test.mjs          # 107 pass
node tools/integration.mjs            # 6 confirmed（真实 SDK 服务）
node tools/portability.mjs            # 8 checks
```

---

## 7. 设计闭环状态

| 期 | 内容 | 状态 |
|---|---|---|
| P1 | 解析 / 链接语义 / 索引 / 搜索 / 规范化文本 | ✅ |
| P2 | 工作区解析 / touch 刷新 / 四层注入 / 覆盖率 | ✅ |
| P3 | 写入准入 / 反回声 / 权限矩阵 / 审查状态机 | ✅ |
| P4 | 收割契约 / 生命周期 / 销毁 / supersedes | ✅ |
| P5 | 引用闭环（双 id + 句子定位 + 断链与陈旧审计） | ✅ |
| P5.1 | 语义扩召回（ADR-0001 采纳）/ L3 工作流生命周期 | ✅ |
| **P6** | **可迁移性验收** | ✅ |

**设计 v3 的全部主体已实现。** 唯一未做的是 UI 阶段（记忆面板 + 知识库独立页面），规格已记录在 `2026-10-24-ui-memory-panel-spec.md`，等另开会话。
