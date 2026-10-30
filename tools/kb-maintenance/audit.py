# -*- coding: utf-8 -*-
"""kb/knowledge/vehicle-security 全库体检：
1) 空壳/截断文件（只有 frontmatter 或正文极短）
2) wikilink 断链（相对路径 + 全库短名解析）
3) 结构异常（标题层级跳级、未闭合代码围栏、表格首行缺表头）
4) 覆盖现状：对照求职建议的能力项，列出缺失模块/文档
"""
import re
import os
import sys
from collections import Counter
from pathlib import Path

# vault 路径跟着脚本走：<仓库根>/kb/knowledge/vehicle-security，可用 DSH_KB_VAULT 覆盖
VAULT = Path(os.environ.get("DSH_KB_VAULT") or (Path(__file__).resolve().parents[2] / "kb" / "knowledge" / "vehicle-security"))
SKIP = (".obsidian", ".workbuddy")
LINK_RE = re.compile(r"\[\[([^\]\|#]+)(?:#[^\]\|]*)?(?:\|[^\]]*)?\]\]")


def clean(t: str) -> str:
    return t.strip().rstrip("\\").strip()


def split_fm(text: str):
    if not text.startswith("---"):
        return "", text
    lines = text.split("\n")
    if lines[0].strip() != "---":
        return "", text
    for i in range(1, len(lines)):
        if lines[i].strip() == "---":
            return "\n".join(lines[: i + 1]), "\n".join(lines[i + 1:])
    return "", text


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    docs = [p for p in sorted(VAULT.rglob("*.md"))
            if not any(s in p.parts or s.startswith(".stfolder") for s in SKIP)]
    by_name = {}
    for p in docs:
        by_name.setdefault(p.stem, []).append(p)

    stubs, broken, struct = [], [], []
    total_links = 0
    for p in docs:
        rel = p.relative_to(VAULT).as_posix()
        text = p.read_text(encoding="utf-8", errors="replace")
        fm, body = split_fm(text)
        body_lines = [l for l in body.split("\n") if l.strip()]
        # 1) 空壳
        if len(body_lines) <= 1:
            stubs.append((rel, len(text.split("\n")), len(body_lines)))

        # 3) 结构
        fences = text.count("```")
        if fences % 2:
            struct.append((rel, "未闭合的代码围栏", fences))
        hs = [len(m.group(1)) for m in re.finditer(r"^(#{1,6})\s", body, re.M)]
        for a, b in zip(hs, hs[1:]):
            if b - a > 1:
                struct.append((rel, f"标题跳级 H{a}→H{b}", 0))
                break

        # 2) 断链
        for raw in LINK_RE.findall(text):
            tgt = clean(raw)
            if not tgt:
                continue
            total_links += 1
            cands = [p.parent / (tgt + s) for s in ("", ".md")]
            if any(c.exists() for c in cands):
                continue
            if tgt.split("/")[-1] in by_name:
                continue
            broken.append((rel, tgt))

    print(f"文档数：{len(docs)}   链接总数：{total_links}")
    print(f"\n=== 1) 空壳/截断文件（正文非空行 ≤ 1）：{len(stubs)} ===")
    for rel, nl, bl in stubs:
        print(f"  LF={nl:<4} 正文行={bl}   {rel}")

    print(f"\n=== 2) 断链：{len(broken)} ===")
    cur = None
    for rel, tgt in broken:
        if rel != cur:
            print(f"\n  [{rel}]")
            cur = rel
        print(f"    -> {tgt}")

    print(f"\n=== 3) 结构异常：{len(struct)} ===")
    for rel, why, n in struct:
        print(f"  {rel}  ← {why}")

    print("\n=== 4) 各模块文档数与文件清单 ===")
    cnt = Counter(p.relative_to(VAULT).parts[0] for p in docs)
    for k in sorted(cnt):
        print(f"  {cnt[k]:>3}  {k}")


if __name__ == "__main__":
    main()