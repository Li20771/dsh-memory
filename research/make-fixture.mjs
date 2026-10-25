import fs from "node:fs";
import path from "node:path";

const ROOT = "D:\\DSH记忆\\research\\fixtures\\vault-re";
fs.rmSync(ROOT, { recursive: true, force: true });
fs.mkdirSync(ROOT, { recursive: true });

const w = (rel, text, eol = "\n") => {
  const p = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const body = eol === "\r\n" ? text.replace(/\n/g, "\r\n") : text;
  fs.writeFileSync(p, body, "utf8");
  return rel;
};

const made = [];

// 1. 基础目标笔记
made.push(w("Note.md", `---
title: Note
tags: [base, level1/level2]
aliases: [N1, "目标笔记"]
---

# Heading One

paragraph alpha.

## Heading Two

paragraph beta.
`));

// 2. 同名不同目录
made.push(w("a/Index.md", `# Index in a\n\nalpha body\n`));
made.push(w("b/Index.md", `# Index in b\n\nbeta body\n`));

// 3. 中文 + 空格文件名
made.push(w("中文 笔记.md", `# 中文标题\n\n正文一段。\n\n结尾块 ^zh-1\n`));

// 4. 块边界全集
made.push(w("Blocks.md", `# Blocks

plain paragraph ending with id ^para-1

second paragraph.

^lone-paragraph-id

- list item with id ^li-1
- plain list item
	- nested child ^li-2

1. ordered item ^ol-1

> quote block
> second quote line ^quote-1

| a | b |
| --- | --- |
| 1 | 2 |
^table-1

\`\`\`
code fence line ^in-code
\`\`\`

    indented code ^in-indent-code

inline \`code ^inline-code\` here

paragraph with id in middle ^mid-1 and text after

dup id here ^dup-1
another dup id ^dup-1

uppercase ^UPPER-1

trailing dot ^dot-1.

no space before^nosep-1

has space ^bad id

chinese id ^中文id

heading id test
## Heading With Id ^head-1
`));

// 5. 链接全集
made.push(w("Links.md", `# Link Forms

wikilink: [[Note]]
alias link: [[Note|显示别名]]
heading link: [[Note#Heading Two]]
block link: [[Note#^para-1]]
embed note: ![[Note]]
embed block: ![[Blocks#^para-1]]
embed heading: ![[Note#Heading One]]

duplicate name, bare: [[Index]]
duplicate name, path: [[a/Index]]
duplicate name, other: [[b/Index]]
case variant: [[NOTE]]
chinese target: [[中文 笔记]]
broken: [[Does Not Exist]]
broken heading: [[Note#No Such Heading]]
broken block: [[Note#^does-not-exist]]
link with pipe and heading: [[Note#Heading Two|别名二]]
link inside inline code: \`[[Note]]\`
link inside fence:

\`\`\`
[[Note]] in code
\`\`\`

unlinked mention: this sentence mentions Note and 中文 笔记 without brackets.
unlinked mention of Index appears twice: Index, Index.
`));

// 6. frontmatter 类型系统
made.push(w("Frontmatter.md", `---
string_prop: hello world
number_prop: 42
float_prop: 3.14
bool_prop: true
date_prop: 2026-10-22
datetime_prop: 2026-10-22T21:00:00+08:00
list_prop:
  - one
  - two
inline_list: [x, y, z]
nested:
  a: 1
  b: [p, q]
empty_prop:
quoted: "quoted value"
aliases: single-alias
tags: nested/tag/deep
---

# Frontmatter note

body
`));

// 7. 标题特殊字符与重复
made.push(w("Headings.md", `# Simple

## With | pipe

## With # hash

## With ^ caret

## With [brackets] and (parens)

## Trailing spaces   

##   Leading spaces

## Simple

### Simple

## 中文 标题

## With \`code\`

## With **bold**

# Another Top
`));

// 8. CRLF 文件（区间计算用）
made.push(w("CRLF.md", `# CRLF\n\nfirst line ^crlf-1\n\nsecond line\n`, "\r\n"));

// 9. 大文件（索引性能用）
let big = "# Big\n\n";
for (let i = 0; i < 400; i++) big += `paragraph ${i} with [[Note]] link and ^big-${i}\n\n`;
made.push(w("Big.md", big));

// 10. 附件与 canvas
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);
fs.mkdirSync(path.join(ROOT, "attachments"), { recursive: true });
fs.writeFileSync(path.join(ROOT, "attachments", "pixel.png"), png);
made.push("attachments/pixel.png");

fs.writeFileSync(
  path.join(ROOT, "attachments", "min.pdf"),
  Buffer.from(
    "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n",
    "ascii"
  )
);
made.push("attachments/min.pdf");

made.push(w("Map.canvas", JSON.stringify({
  nodes: [
    { id: "n1", type: "text", text: "Note", x: 0, y: 0, width: 250, height: 60 },
    { id: "n2", type: "file", file: "Note.md", x: 300, y: 0, width: 250, height: 60 }
  ],
  edges: [{ id: "e1", fromNode: "n1", fromSide: "right", toNode: "n2", toSide: "left" }]
}, null, 2)));

// 11. 只含链接的索引页
made.push(w("Hub.md", `# Hub

- [[Note]]
- [[Blocks#^para-1]]
- [[Frontmatter]]
- ![[attachments/pixel.png]]
`));

console.log(JSON.stringify({ root: ROOT, files: made.length, list: made }, null, 2));
