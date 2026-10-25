// 运行时探针：删除语义（v2.1 §6 新增 P0/P1）—— 回收站、断链、索引更新、图节点
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const PORT = 9336;
const SRC = "D:\\DSH记忆\\research\\fixtures\\vault-re";
const VAULT = "D:\\DSH记忆\\research\\fixtures\\vault-del";
const UD = path.join(process.env.TEMP, "obs-del-userdata");

fs.rmSync(VAULT, { recursive: true, force: true });
fs.cpSync(SRC, VAULT, { recursive: true });
for (const junk of [".obsidian"]) fs.rmSync(path.join(VAULT, junk), { recursive: true, force: true });
fs.rmSync(UD, { recursive: true, force: true });
fs.mkdirSync(UD, { recursive: true });
fs.writeFileSync(path.join(UD, "obsidian.json"),
  JSON.stringify({ vaults: { dprobe: { path: VAULT, ts: Date.now(), open: true } } }), "utf8");

const child = spawn("D:\\Obsidian\\Obsidian.exe", [`--user-data-dir=${UD}`, `--remote-debugging-port=${PORT}`], { stdio: "ignore" });

async function cdpTarget() {
  for (let i = 0; i < 240; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === "page" && t.url.includes("obsidian.md"));
      if (page) return page;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("no cdp page");
}
function evalIn(page, expression) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    const timer = setTimeout(() => { try { ws.close(); } catch {}; reject(new Error("eval timeout")); }, 20000);
    ws.onopen = () => ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression, returnByValue: true, awaitPromise: true } }));
    ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id === 1) { clearTimeout(timer); ws.close(); resolve(m); } };
    ws.onerror = () => { clearTimeout(timer); reject(new Error("ws error")); };
  });
}
const val = (r) => (r.result && r.result.result ? r.result.result.value : null);

const page = await cdpTarget();
for (let i = 0; i < 200; i++) {
  const v = JSON.parse(val(await evalIn(page, `(() => JSON.stringify([Object.keys(app.metadataCache.fileCache||{}).length, !!app.metadataCache.didFinish]))()`)) || "[0,false]");
  if (v[0] >= 14 && v[1]) break;
  await new Promise((r) => setTimeout(r, 250));
}

const before = JSON.parse(val(await evalIn(page, String.raw`(() => {
  const mc = app.metadataCache;
  return JSON.stringify({
    trashOption: app.vault.getConfig("trashOption"),
    resolvedNote: Object.keys(mc.resolvedLinks["Links.md"] || {}),
    unresolvedLinks: mc.unresolvedLinks["Links.md"] || {},
    hasNote: !!app.vault.getAbstractFileByPath("Note.md"),
    resolveNote: (mc.getFirstLinkpathDest("Note", "Links.md") || {}).path || null,
  });
})()`)));

// 删除 Note.md（走默认 trashOption）
const delRes = val(await evalIn(page, String.raw`(async () => {
  const f = app.vault.getAbstractFileByPath("Note.md");
  const t0 = Date.now();
  await app.vault.delete(f);
  await new Promise(r => setTimeout(r, 1200));
  const mc = app.metadataCache;
  const fsTree = [];
  const walk = async (dir) => {
    const entries = await app.vault.adapter.list(dir);
    for (const f2 of entries.files) fsTree.push(f2);
    for (const d of entries.folders) await walk(d);
  };
  await walk("");
  return JSON.stringify({
    delMs: Date.now() - t0,
    stillThere: !!app.vault.getAbstractFileByPath("Note.md"),
    resolveNote: (mc.getFirstLinkpathDest("Note", "Links.md") || {}).path || null,
    resolvedNoteKeys: Object.keys(mc.resolvedLinks["Links.md"] || {}),
    unresolvedLinks: mc.unresolvedLinks["Links.md"] || {},
    vaultFiles: fsTree.filter(p => /trash|Note\.md/i.test(p)),
    allTop: fsTree.slice(0, 30),
  });
})()`));

// 图节点：未解析目标是否成 ghost 节点
await evalIn(page, `(() => { const p = app.internalPlugins.getEnabledPluginById("graph"); p.openGraphView(); return 1; })()`);
await new Promise((r) => setTimeout(r, 2500));
const graphRes = val(await evalIn(page, String.raw`(() => {
  const leaves = app.workspace.getLeavesOfType("graph");
  if (!leaves.length) return JSON.stringify({ error: "no graph leaf" });
  const e = leaves[0].view.engine || leaves[0].view.renderer;
  const keys = [];
  e.nodes.forEach((n) => keys.push(n.id || n.key));
  return JSON.stringify({ nodeKeys: keys, noteGhost: keys.filter(k => /note/i.test(k)), linkCount: e.links.size });
})()`));

// 本地文件系统视角：.trash 目录
const disk = { trashDir: fs.existsSync(path.join(VAULT, ".trash")), entries: [] };
if (disk.trashDir) {
  for (const f of fs.readdirSync(path.join(VAULT, ".trash"))) disk.entries.push(f);
}
disk.noteStillInVault = fs.existsSync(path.join(VAULT, "Note.md"));

const results = { before, delete: JSON.parse(delRes), graph: JSON.parse(graphRes), disk };
fs.writeFileSync("D:\\DSH记忆\\research\\probe-delete.json", JSON.stringify(results, null, 2), "utf8");
console.log(JSON.stringify(results, null, 2));
child.kill();
process.exit(0);
