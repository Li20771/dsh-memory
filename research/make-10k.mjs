// 生成 10k 文件的压力 vault（用于测 Obsidian 首次索引耗时 + .obsidian 写入行为）
import fs from "node:fs";
import path from "node:path";

const ROOT = "D:\\DSH记忆\\research\\fixtures\\vault-10k";
fs.rmSync(ROOT, { recursive: true, force: true });
fs.mkdirSync(ROOT, { recursive: true });

const N = 10000;
const DIRS = 100;
const perDir = N / DIRS;

let t0 = Date.now();
for (let d = 0; d < DIRS; d++) {
  const dir = path.join(ROOT, `p${String(d).padStart(3, "0")}`);
  fs.mkdirSync(dir, { recursive: true });
  for (let i = 0; i < perDir; i++) {
    const id = d * perDir + i;
    const prev = id === 0 ? "p000/n000.md" : `p${String(d).padStart(3, "0")}/n${String(Math.max(0, i - 1)).padStart(3, "0")}.md`;
    const body =
      `---\nid: n${id}\ntype: note\nidx: ${id}\ntags: [bulk, p${d}]\n---\n\n` +
      `# Note ${id}\n\n` +
      `Paragraph alpha ${id} with a link [[${prev}]] and a block id ^blk-${id}\n\n` +
      `- item one ^li-${id}\n- item two\n\n` +
      `> quote ${id}\n\n` +
      `## Sub heading ${id}\n\ntext tail ${id}\n`;
    fs.writeFileSync(path.join(dir, `n${String(i).padStart(3, "0")}.md`), body, "utf8");
  }
}
console.log(JSON.stringify({ root: ROOT, files: N, genMs: Date.now() - t0 }));
