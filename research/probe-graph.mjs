// 运行时探针：⑬ Graph view 边模型（在 fixture vault 上打开图谱，读引擎数据结构）
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const PORT = 9335;
const VAULT = "D:\\DSH记忆\\research\\fixtures\\vault-re";
const UD = path.join(process.env.TEMP, "obs-graph-userdata");
fs.rmSync(UD, { recursive: true, force: true });
fs.mkdirSync(UD, { recursive: true });
fs.writeFileSync(path.join(UD, "obsidian.json"),
  JSON.stringify({ vaults: { gprobe: { path: VAULT, ts: Date.now(), open: true } } }), "utf8");

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

const page = await cdpTarget();
// 等索引完成
for (let i = 0; i < 200; i++) {
  const r = await evalIn(page, `(() => JSON.stringify([Object.keys(app.metadataCache.fileCache||{}).length, !!app.metadataCache.didFinish]))()`);
  const [n, done] = JSON.parse((r.result && r.result.result && r.result.result.value) || "[0,false]");
  if (n >= 14 && done) break;
  await new Promise((rr) => setTimeout(rr, 250));
}

const OPEN = `(async () => {
  const p = app.internalPlugins.getEnabledPluginById("graph");
  p.openGraphView();
  for (let i = 0; i < 40; i++) { if (app.workspace.getLeavesOfType("graph").length) break; await new Promise(r => setTimeout(r, 100)); }
  return "opened";
})()`;
await evalIn(page, OPEN);
await new Promise((r) => setTimeout(r, 3000));

const DUMP = String.raw`(() => {
  const safe = (f) => { try { return f(); } catch (e) { return "ERR:" + e.message; } };
  const out = {};
  const leaves = app.workspace.getLeavesOfType("graph");
  out.graphLeaves = leaves.length;
  if (!leaves.length) return JSON.stringify(out);
  const v = leaves[0].view;
  out.viewKeys = Object.keys(v).slice(0, 40);
  const engine = v.engine || v.renderer || v.dataEngine;
  out.engineKeys = engine ? Object.keys(engine).slice(0, 40) : null;
  if (engine) {
    out.engineNodeCount = safe(() => (engine.nodes ? engine.nodes.size : null));
    out.engineLinkCount = safe(() => (engine.links ? engine.links.size : null));
    out.sampleNodes = safe(() => {
      const arr = [];
      if (engine.nodes && engine.nodes.forEach) engine.nodes.forEach((n) => { if (arr.length < 12) arr.push({ key: n.id || n.key, type: n.type || null, path: n.path || null, tag: n.tag || null, ref: n.ref || null, links: n.links ? (n.links.size !== undefined ? n.links.size : n.links.length) : null }); });
      return arr;
    });
    out.sampleLinks = safe(() => {
      const arr = [];
      if (engine.links && engine.links.forEach) engine.links.forEach((l) => { if (arr.length < 12) arr.push({ source: l.source && (l.source.id || l.source.key), target: l.target && (l.target.id || l.target.key), weight: l.weight }); });
      return arr;
    });
    out.optionKeys = safe(() => Object.keys(engine.options || {}).filter(k => /tag|orphan|attach|arrow|group/i.test(k)).slice(0, 20));
  }
  return JSON.stringify(out);
})()`;
const res = await evalIn(page, DUMP);
const val = res.result && res.result.result && res.result.result.value;
fs.writeFileSync("D:\\DSH记忆\\research\\probe-graph.json", typeof val === "string" ? val : JSON.stringify(res, null, 2), "utf8");
console.log(typeof val === "string" ? val : JSON.stringify(res, null, 2));
child.kill();
process.exit(0);
