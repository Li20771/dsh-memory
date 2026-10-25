// 运行时探针 v2：⑤ 库级配置 vs 机器级状态（分动作取证）
// 用法: node probe-10k.mjs [cold|warm]
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const MODE = process.argv[2] || "cold";
const PORT = 9334;
const VAULT = "D:\\DSH记忆\\research\\fixtures\\vault-10k";
const UD = path.join(process.env.TEMP, "obs-10k-userdata");
const CFG = path.join(VAULT, ".obsidian");

if (MODE === "cold") {
  fs.rmSync(UD, { recursive: true, force: true });
  fs.mkdirSync(UD, { recursive: true });
  fs.writeFileSync(path.join(UD, "obsidian.json"),
    JSON.stringify({ vaults: { probe10k: { path: VAULT, ts: Date.now(), open: true } } }), "utf8");
}

const t0 = Date.now();
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
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id === 1) { clearTimeout(timer); ws.close(); resolve(m.result && m.result.result ? m.result.result.value : null); }
    };
    ws.onerror = () => { clearTimeout(timer); reject(new Error("ws error")); };
  });
}

const snap = () => {
  if (!fs.existsSync(CFG)) return {};
  const out = {};
  for (const f of fs.readdirSync(CFG)) {
    const st = fs.statSync(path.join(CFG, f));
    if (st.isFile()) out[f] = { mtimeMs: Math.round(st.mtimeMs), bytes: st.size };
  }
  return out;
};
const diff = (a, b) => {
  const changed = [];
  for (const k of Object.keys(b)) if (!a[k] || a[k].mtimeMs !== b[k].mtimeMs || a[k].bytes !== b[k].bytes) changed.push(k);
  return changed;
};

const page = await cdpTarget();
let readyMs = null;
for (let i = 0; i < 480; i++) {
  const v = await evalIn(page, `(() => { const mc = app.metadataCache; return JSON.stringify([Object.keys(mc.fileCache||{}).length, !!mc.didFinish]); })()`);
  const [n, done] = JSON.parse(v || "[0,false]");
  if (n >= 10000 && done) { readyMs = Date.now() - t0; break; }
  await new Promise((r) => setTimeout(r, 250));
}
await new Promise((r) => setTimeout(r, 1200));

const s0 = snap();
await evalIn(page, `(() => { app.vault.setConfig("showLineNumber", true); app.vault.setConfig("readableLineLength", false); return 1; })()`);
await new Promise((r) => setTimeout(r, 1200));
const s1 = snap();

await evalIn(page, `(async () => { const f = app.vault.getAbstractFileByPath("p000/n005.md"); const leaf = app.workspace.getLeaf(true); await leaf.openFile(f); return 1; })()`);
await new Promise((r) => setTimeout(r, 1500));
const s2 = snap();

await evalIn(page, `(() => { app.internalPlugins.disablePlugin("word-count"); return 1; })()`);
await new Promise((r) => setTimeout(r, 1200));
const s3 = snap();

const read = (f) => { try { return fs.readFileSync(path.join(CFG, f), "utf8"); } catch { return null; } };

const results = {
  mode: MODE,
  indexReadyMs: readyMs,
  snapshots: { afterStartup: s0, afterSetConfig: s1, afterOpenFile: s2, afterDisablePlugin: s3 },
  stepDiffs: {
    setConfig: diff(s0, s1),
    openFile: diff(s1, s2),
    disablePlugin: diff(s2, s3),
  },
  contents: {
    "app.json": read("app.json"),
    "appearance.json": read("appearance.json"),
    "workspace.json.head": (read("workspace.json") || "").slice(0, 160),
  },
  allFiles: Object.keys(s3),
};
fs.writeFileSync(`D:\\DSH记忆\\research\\probe-10k-${MODE}.json`, JSON.stringify(results, null, 2), "utf8");
console.log(JSON.stringify(results, null, 2));
child.kill();
process.exit(0);
