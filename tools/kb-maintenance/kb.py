# -*- coding: utf-8 -*-
"""vehicle-security 知识库维护 CLI（供 DSH 每日自动任务调用）。

用法：
  python kb.py verify      # 体检：空壳 / 断链 / 结构 / 标注覆盖
  python kb.py type        # 给所有文档补 type: knowledge（幂等）
  python kb.py relink      # 修复断链：失效项目→项目索引、后缀匹配、无法解析降级
  python kb.py all         # type → relink → verify
"""
import os
import re
import sys
from collections import Counter
from pathlib import Path

# vault 路径跟着脚本走：<仓库根>/kb/knowledge/vehicle-security，可用 DSH_KB_VAULT 覆盖
VAULT = Path(os.environ.get("DSH_KB_VAULT") or (Path(__file__).resolve().parents[2] / "kb" / "knowledge" / "vehicle-security"))
SKIP = (".obsidian", ".workbuddy", ".trash", ".kb-index")
MARK = "📌 定位评估（对齐 2028 届车载安全求职目标"
LINK_RE = re.compile(r"\[\[([^\]\|#]+)(?:#[^\]\|]*)?(?:\|([^\]]*))?\]\]")
TYPE_LINE = "type: knowledge"


def docs():
    return [p for p in sorted(VAULT.rglob("*.md"))
            if not any(s in p.parts for s in SKIP)]


def split_fm(text):
    if not text.startswith("---"):
        return "", text
    lines = text.split("\n")
    if lines[0].strip() != "---":
        return "", text
    for i in range(1, len(lines)):
        if lines[i].strip() == "---":
            return "\n".join(lines[: i + 1]), "\n".join(lines[i + 1:])
    return "", text


def unfenced(body):
    out, inside = [], False
    for line in body.split("\n"):
        if line.lstrip().startswith("```"):
            inside = not inside
            continue
        if not inside:
            out.append(line)
    return "\n".join(out)


# ---------------------------------------------------------------- type
def cmd_type():
    n = 0
    for p in docs():
        text = p.read_text(encoding="utf-8")
        fm, body = split_fm(text)
        if not fm or TYPE_LINE in fm:
            continue
        lines = fm.split("\n")
        lines.insert(len(lines) - 1, TYPE_LINE)          # 插到收尾 --- 之前
        p.write_text("\n".join(lines) + "\n" + body, encoding="utf-8", newline="\n")
        n += 1
    print(f"type: knowledge 补写 {n} 篇")


# ---------------------------------------------------------------- relink
DEAD_PROJ = re.compile(r"(^|/)project-\d+|00-项目实战总览|00-master-plan")


def normalize(t):
    t = t.strip().replace("\\", "/")
    while t.startswith("../"):
        t = t[3:]
    if t.startswith("./"):
        t = t[2:]
    if t.startswith("knowledge/"):
        t = t[len("knowledge/"):]
    if t.endswith(".md"):
        t = t[:-3]
    return t


def rel(p, ref):
    r = os.path.relpath(p, ref).replace(os.sep, "/")
    return r[:-3] if r.endswith(".md") else r


def cmd_relink():
    all_docs = docs()
    by_suffix = {}
    for p in all_docs:
        relpath = p.relative_to(VAULT).as_posix()
        noext = relpath[:-3] if relpath.endswith(".md") else relpath
        parts = noext.split("/")
        for i in range(len(parts)):
            by_suffix.setdefault("/".join(parts[i:]), []).append(p)
    proj_index = VAULT / "projects" / "README.md"
    stats = Counter()
    changed = 0
    for p in all_docs:
        text = p.read_text(encoding="utf-8")
        orig = text

        def sub(m):
            target = (m.group(1) or "").strip().rstrip("\\").strip()
            label = m.group(2)
            if not target:
                return m.group(0)
            if (p.parent / target).exists() or (p.parent / (target + ".md")).exists():
                stats["kept"] += 1
                return m.group(0)
            norm = normalize(target)
            if DEAD_PROJ.search(norm) and proj_index.exists():
                stats["reproj"] += 1
                return f"[[{rel(proj_index, p.parent)}|{label or '项目索引'}]]"
            hits = by_suffix.get(norm, [])
            if len(hits) == 1:
                stats["suffix"] += 1
                r = rel(hits[0], p.parent)
                return f"[[{r}|{label}]]" if label else f"[[{r}]]"
            stats["unwrap"] += 1
            return label if label else norm.split("/")[-1]

        text = LINK_RE.sub(sub, text)
        if text != orig:
            p.write_text(text, encoding="utf-8", newline="\n")
            changed += 1
    print(f"relink: 改动 {changed} 篇 | 保留 {stats['kept']} / 收敛项目 {stats['reproj']} / 后缀改写 {stats['suffix']} / 降级 {stats['unwrap']}")


# ---------------------------------------------------------------- verify
def cmd_verify():
    all_docs = docs()
    by_name = {}
    for p in all_docs:
        by_name.setdefault(p.stem, []).append(p)

    stubs, broken, struct, no_mark = [], [], [], []
    total_links = 0
    lv = Counter()

    for p in all_docs:
        relpath = p.relative_to(VAULT).as_posix()
        text = p.read_text(encoding="utf-8", errors="replace")
        fm, body = split_fm(text)
        head = text.split("\n")[:30]
        if not any(MARK in l for l in head):
            no_mark.append(relpath)
        else:
            pl = next((l for l in head if "优先级**：" in l), "")
            for k, e in (("🔴", "red"), ("🟡", "yel"), ("⚪", "ok"), ("🔵", "low")):
                if k in pl:
                    lv[e] += 1
                    break
        if len([l for l in body.split("\n") if l.strip()]) <= 1:
            stubs.append(relpath)
        if text.count("```") % 2:
            struct.append((relpath, "代码围栏未闭合"))
        hs = [len(m.group(1)) for m in re.finditer(r"^(#{1,6})\s", unfenced(body), re.M)]
        for a, b in zip(hs, hs[1:]):
            if b - a > 1:
                struct.append((relpath, f"标题跳级 H{a}→H{b}"))
                break
        for m in LINK_RE.finditer(text):
            tgt = (m.group(1) or "").strip().rstrip("\\").strip()
            if not tgt:
                continue
            total_links += 1
            if (p.parent / tgt).exists() or (p.parent / (tgt + ".md")).exists():
                continue
            if tgt.split("/")[-1] in by_name:
                continue
            broken.append((relpath, tgt))

    print(f"文档 {len(all_docs)} | 链接 {total_links} | 标注 {len(all_docs)-len(no_mark)}/{len(all_docs)}")
    print(f"优先级 🔴{lv['red']} 🟡{lv['yel']} ⚪{lv['ok']} 🔵{lv['low']}")
    print(f"空壳 {len(stubs)} | 断链 {len(broken)} | 结构异常 {len(struct)} | 缺标注 {len(no_mark)}")
    for s in stubs[:10]:
        print(f"  空壳: {s}")
    for r, t in broken[:15]:
        print(f"  断链: [{r}] -> {t}")
    for r, w in struct[:10]:
        print(f"  结构: {r} ← {w}")
    for r in no_mark[:10]:
        print(f"  缺标注: {r}")
    ok = not (stubs or broken or struct or no_mark)
    print("结论：" + ("✅ 全部通过" if ok else "❌ 有问题需处理"))
    return 0 if ok else 1


# ---------------------------------------------------------------- lint
# 内容质量门：错误隐患 + 可读性 + 结构密度
PLACEHOLDER = re.compile(r"TODO|FIXME|待补充|待完善|占位符")   # 不含 XXX：正则/十六进制里太常见
KNOWN_PLACEHOLDER = re.compile(r"§\[条款号\]")          # 已知占位：等正式文本，不算缺陷
ABSOLUTE = re.compile(r"一定能|必然导致|100%\s*(?:安全|可靠|防护)|完全防止|零风险|万无一失|(?<!意味着)绝对安全")
CLAIM_NO_SRC = re.compile(r"研究表明|数据显示|测试表明|据统计|业界普遍|众所周知|权威指出")
# 这些文件按用途就要引用"错误原句"，不参与措辞/占位检查
EXEMPT_FROM_WORDING = {"99-来源与核验.md"}
STD_GB = re.compile(r"GB\s?/?T?\s?\d{4,5}(?:[-—]\d{4})?")
# 属于刻意重复的结构性小节标题（实验模板、AI/手动双模式等），不算缺陷
TEMPLATE_HEADS = {
    "实验目标", "实验环境", "环境", "步骤", "操作步骤", "预期产出", "验收标准", "常见坑",
    "预期结果", "实际结果", "关联思考", "汽车安全关联", "实验步骤", "实验目标与产出",
    "AI 模式", "手动模式", "验证点", "命令", "说明",
}


def _hkey(h: str) -> str:
    """去掉标题前导的 emoji/符号，便于与模板标题比较。"""
    return re.sub(r"^[\s\W_]+", "", h.strip()).strip()


def _strip_code_and_tables(body: str) -> str:
    """去掉代码块与表格行，避免把整张表/整段代码算成一个超长段落。"""
    out, inside = [], False
    for line in body.split("\n"):
        if line.lstrip().startswith("```"):
            inside = not inside
            continue
        if inside:
            continue
        if line.lstrip().startswith("|"):
            continue
        out.append(line)
    return "\n".join(out)


def cmd_lint():
    all_docs = docs()
    rows = []
    problems = []

    for p in all_docs:
        relp = p.relative_to(VAULT).as_posix()
        text = p.read_text(encoding="utf-8", errors="replace")
        fm, body = split_fm(text)
        nlines = len(text.split("\n"))
        is_lab = "LAB-" in p.name or "实验报告模板" in p.name

        fences = len(re.findall(r"^```", body, re.M)) // 2
        tables = len(re.findall(r"^\|.*\|", body, re.M))
        has_example = bool(re.search(r"例|示例|举例|反例|踩坑", body))
        mermaid = len(re.findall(r"```mermaid", body))
        imgs = len(re.findall(r"!\[", body))

        h2 = len(re.findall(r"^##\s", body, re.M))
        h3 = len(re.findall(r"^###\s", body, re.M))
        heads = re.findall(r"^#{2,3}\s+(.+)$", body, re.M)
        # LAB / 实验报告模板：每个实验都复用小节骨架，重复是设计使然，不参与重复检查
        dup_heads = [] if is_lab else [
            h for h, c in Counter(heads).items()
            if c > 1 and _hkey(h) not in TEMPLATE_HEADS
        ]
        real_dup = len([h for h in dup_heads if Counter(heads)[h] > 2])

        # 只对正文（去代码/表格）算段落长度
        plain = _strip_code_and_tables(body)
        paras = [s.strip() for s in re.split(r"\n\s*\n", plain) if len(s.strip()) > 0]
        longest = max((len(x) for x in paras), default=0)

        ph = 0 if p.name in EXEMPT_FROM_WORDING else len(PLACEHOLDER.findall(body))
        kp = len(KNOWN_PLACEHOLDER.findall(body))
        ab = 0 if p.name in EXEMPT_FROM_WORDING else len(ABSOLUTE.findall(body))
        claim = 0 if p.name in EXEMPT_FROM_WORDING else len(CLAIM_NO_SRC.findall(body))
        has_src = bool(re.search(r"https?://|\[\[", body))
        unsourced = claim if (claim and not has_src) else 0

        tri = sum([fences >= 1, tables >= 2, has_example])
        quality = (
            (1 if tri >= 2 else 0)
            + (1 if nlines >= 120 else 0)
            + (1 if h2 >= 3 else 0)
            + (1 if longest <= 600 else 0)
            + (1 if (mermaid or imgs) else 0)
        )
        rows.append(dict(rel=relp, lines=nlines, h2=h2, h3=h3, fences=fences, tables=tables,
                         three=tri, mermaid=mermaid, imgs=imgs, longest=longest,
                         quality=quality, ph=ph, kp=kp, ab=ab, unsourced=unsourced, dup=real_dup))

        if ph:
            problems.append((relp, "待办/占位符残留（需补实）", ph))
        if real_dup:
            problems.append((relp, "非模板小节标题重复", real_dup))
        if ab:
            problems.append((relp, "绝对化措辞（需复核是否夸大）", ab))
        if unsourced:
            problems.append((relp, "有结论式断言但无来源链接", unsourced))
        if longest > 900:
            problems.append((relp, f"单段过长 {longest} 字（建议拆段/加小标题）", 1))
        if nlines < 80:
            problems.append((relp, f"篇幅偏薄 {nlines} 行", 1))

    print(f"文档 {len(all_docs)}\n")
    print("=== 模块质量概览（quality 满分 5）===")
    print(f"{'模块':<26}{'篇数':>4}{'均行数':>7}{'均q':>6}{'三要素达标':>9}{'有图示':>7}{'A类隐患':>8}")
    bymod = {}
    for r in rows:
        m = r["rel"].split("/")[0] if "/" in r["rel"] else "(根)"
        bymod.setdefault(m, []).append(r)
    for m in sorted(bymod):
        rs = bymod[m]
        print(f"{m:<26}{len(rs):>4}{sum(x['lines'] for x in rs)//len(rs):>7}"
              f"{sum(x['quality'] for x in rs)/len(rs):>6.1f}"
              f"{sum(1 for x in rs if x['three']>=2)*100//len(rs):>8}%"
              f"{sum(1 for x in rs if x['mermaid'] or x['imgs']):>7}"
              f"{sum(x['ph']+x['ab']+x['unsourced'] for x in rs):>8}")

    print("\n=== 最需补强 12 篇（quality 低 → 行数少）===")
    for r in sorted(rows, key=lambda r: (r["quality"], r["lines"]))[:12]:
        print(f"  q={r['quality']} 行={r['lines']:<4} H2={r['h2']:<2} 代码={r['fences']:<2} 表={r['tables']:<3} 三要素={r['three']}  {r['rel']}")

    print(f"\n=== 隐患清单（{len(problems)} 条）===")
    for relp, why, n in problems:
        print(f"  [{relp}]  {why}" + (f" ×{n}" if n > 1 else ""))

    kp_total = sum(x["kp"] for x in rows)
    print(f"\n已知占位（§[条款号]，等正式文本）：{kp_total} 处 —— 不算缺陷，但拿到正式文本后必须一次性替换")
    return 0


CMDS = {"type": cmd_type, "relink": cmd_relink, "verify": cmd_verify, "lint": cmd_lint}


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    arg = sys.argv[1] if len(sys.argv) > 1 else "verify"
    if arg == "all":
        cmd_type()
        cmd_relink()
        sys.exit(cmd_verify())
    fn = CMDS.get(arg)
    if not fn:
        print(__doc__)
        sys.exit(2)
    sys.exit(fn() or 0)


if __name__ == "__main__":
    main()