# -*- coding: utf-8 -*-
"""kb/knowledge/vehicle-security 终检：空壳 / 断链 / 结构 / 标注覆盖。
注意：结构检查会先剔除代码围栏内的内容，避免把 shell 注释 `# xxx` 误判成标题。
"""
import re
import os
import sys
from collections import Counter
from pathlib import Path

# vault 路径跟着脚本走：<仓库根>/kb/knowledge/vehicle-security，可用 DSH_KB_VAULT 覆盖
VAULT = Path(os.environ.get("DSH_KB_VAULT") or (Path(__file__).resolve().parents[2] / "kb" / "knowledge" / "vehicle-security"))
SKIP = (".obsidian", ".workbuddy")
MARK = "📌 定位评估（对齐 2028 届车载安全求职目标"
LINK_RE = re.compile(r"\[\[([^\]\|#]+)(?:#[^\]\|]*)?(?:\|[^\]]*)?\]\]")


def clean(t):
    return t.strip().rstrip("\\").strip()


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


def unfenced(body: str) -> str:
    """剔除 ``` 围栏内的内容"""
    out, inside = [], False
    for line in body.split("\n"):
        if line.lstrip().startswith("```"):
            inside = not inside
            continue
        if not inside:
            out.append(line)
    return "\n".join(out)


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    docs = [p for p in sorted(VAULT.rglob("*.md"))
            if not any(s in p.parts for s in SKIP)]
    by_name = {}
    by_suffix = {}
    for p in docs:
        by_name.setdefault(p.stem, []).append(p)
        rp = p.relative_to(VAULT).as_posix()
        noext = rp[:-3] if rp.endswith(".md") else rp
        parts = noext.split("/")
        for i in range(len(parts)):
            by_suffix.setdefault("/".join(parts[i:]), []).append(p)

    stubs, broken, struct, no_mark = [], [], [], []
    total_links = 0
    lv = Counter()

    for p in docs:
        rel = p.relative_to(VAULT).as_posix()
        text = p.read_text(encoding="utf-8", errors="replace")
        fm, body = split_fm(text)

        # 标注
        head = text.split("\n")[:30]
        if not any(MARK in l for l in head):
            no_mark.append(rel)
        else:
            pl = next((l for l in head if "优先级**：" in l), "")
            for k, e in (("🔴", "red"), ("🟡", "yel"), ("⚪", "ok"), ("🔵", "low")) if False else (
                    ("🔴", "red"), ("🟡", "yel"), ("⚪", "ok"), ("🔵", "low")):
                if k in pl:
                    lv[e] += 1
                    break

        # 空壳
        if len([l for l in body.split("\n") if l.strip()]) <= 1:
            stubs.append(rel)

        # 代码围栏闭合
        if text.count("```") % 2:
            struct.append((rel, "代码围栏未闭合"))

        # 标题跳级（剔除围栏）
        hs = [len(m.group(1)) for m in re.finditer(r"^(#{1,6})\s", unfenced(body), re.M)]
        for a, b in zip(hs, hs[1:]):
            if b - a > 1:
                struct.append((rel, f"标题跳级 H{a}→H{b}"))
                break

        # 断链
        for raw in LINK_RE.findall(text):
            tgt = clean(raw)
            if not tgt:
                continue
            total_links += 1
            if (p.parent / tgt).exists() or (p.parent / (tgt + ".md")).exists():
                continue
            if tgt.split("/")[-1] in by_name:
                continue
            broken.append((rel, tgt))

    print(f"文档数：{len(docs)}   链接总数：{total_links}")
    print(f"标注覆盖率：{len(docs) - len(no_mark)}/{len(docs)}")
    print(f"优先级分布：🔴 {lv['red']}  🟡 {lv['yel']}  ⚪ {lv['ok']}  🔵 {lv['low']}")
    print(f"\n空壳（正文非空行≤1）：{len(stubs)}")
    for s in stubs:
        print(f"  {s}")
    print(f"\n断链：{len(broken)}")
    for r, t in broken:
        print(f"  [{r}] -> {t}")
    print(f"\n结构异常：{len(struct)}")
    for r, w in struct:
        print(f"  {r}  ← {w}")
    print(f"\n缺标注：{len(no_mark)}")
    for r in no_mark:
        print(f"  {r}")

    print("\n=== 各模块篇数 ===")
    cnt = Counter(p.relative_to(VAULT).parts[0] for p in docs)
    for k in sorted(cnt):
        print(f"  {cnt[k]:>3}  {k}")


if __name__ == "__main__":
    main()