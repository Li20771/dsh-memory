// 自检探针 v2：aliases 解析 / NFC / 反斜杠归一（带容错）
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const PORT = 9337;
const SRC = "D:\\DSH记忆\\research\\fixtures\\vault-re";
const VAULT = "D:\\DSH记忆\\research\\fixtures\\vault-alias";
const UD = path.join(process.env.TEMP, "obs-alias-userdata");

fs.rmSync(VAULT, { recursive: true, force: true });
fs.cpSync(SRC, VAULT, { recursive: true });
fs.rmSync(path.join(VAULT, ".obsidian"), { recursive: true, force: true });
fs.writeFileSync(path.join(VAULT, "AliasTest.md"),
  `# Alias Test\n\n- by alias: [[N1]]\n- by alias 2: [[目标笔记]]\n- by dotted: [[Note.md]]\n`, "utf8");

fs.rmSync(UD, { recursive: true, force: true });
fs.mkdirSync(UD, { recursive: true });
fs.writeFileSync(path.join(UD, "obsidian.json"),
  JSON.stringify({ vaults: { aprobe: { path: VAULT, ts: Date.now(), open: true } } }), "utf8");

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
    const t = setTimeout(() => { try { ws.close(); } catch {}; reject(new Error("timeout")); }, 20000);
    ws.onopen = () => ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression, returnByValue: true, awaitPromise: true } }));
    ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id === 1) { clearTimeout(t); ws.close(); resolve(m); } };
    ws.onerror = () => { clearTimeout(t); reject(new Error("ws")); };
  });
}
const val = (r) => (r && r.result && r.result.result ? r.result.result.value : JSON.stringify(r));

const page = await cdpTarget();
for (let i = 0; i < 200; i++) {
  const v = JSON.parse(val(await evalIn(page, `(() => JSON.stringify([Object.keys(app.metadataCache.fileCache||{}).length, !!app.metadataCache.didFinish]))()`)) || "[0,false]");
  if (v[0] >= 15 && v[1]) break;
  await new Promise((r) => setTimeout(r, 250));
}

const EXPR = String.raw`(() => {
  const mc = app.metadataCache;
  const P = (v) => (v && v.path ? v.path : null);
  const out = {};
  out.aliasN1 = P(mc.getFirstLinkpathDest("N1", "AliasTest.md"));
  out.aliasZh = P(mc.getFirstLinkpathDest("目标笔记", "AliasTest.md"));
  out.byMd = P(mc.getFirstLinkpathDest("Note.md", "AliasTest.md"));
  const ac = mc.getCache("AliasTest.md") || {};
  out.aliasTestLinks = (ac.links || []).map(l => ({ link: l.link, display: l.displayText }));
  out.aliasTestUnresolved = mc.unresolvedLinks["AliasTest.md"] || {};
  const nc = mc.getCache("Note.md") || {};
  out.noteAliases = (nc.frontmatter || {}).aliases;
  const nfc = "中文 笔记".normalize("NFC");
  const nfd = "中文 笔记".normalize("NFD");
  out.nfcProbe = { nfc: P(mc.getFirstLinkpathDest(nfc, "AliasTest.md")), nfd: P(mc.getFirstLinkpathDest(nfd, "AliasTest.md")), differs: nfc !== nfd };
  out.backslashProbe = P(mc.getFirstLinkpathDest("a\\Index", "AliasTest.md"));
  out.dotSlashProbe = P(mc.getFirstLinkpathDest("./a/Index", "AliasTest.md"));
  out.dotDotProbe = P(mc.getFirstLinkpathDest("../vault-re/a/Index", "AliasTest.md"));
  return JSON.stringify(out);
})()`;

const raw = await evalIn(page, EXPR);
const v = raw && raw.result && raw.result.result ? raw.result.result.value : JSON.stringify(raw, null, 2);
fs.writeFileSync("D:\\DSH记忆\\research\\probe-alias.json", String(v), "utf8");
console.log(String(v));
child.kill();
process.exit(0);
