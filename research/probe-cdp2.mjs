const EP = "http://127.0.0.1:9333";
const list = await (await fetch(`${EP}/json/list`)).json();
const page = list.filter((t) => t.type === "page").find((p) => p.url.includes("obsidian.md"));
if (!page) throw new Error("no obsidian page target");

const EXPR = String.raw`(() => {
  const safe = (f) => { try { return f(); } catch (e) { return "ERR:" + e.message; } };
  const out = {};
  out.blockCommands = safe(() => Object.keys(app.commands.commands).filter((k) => /block|link/i.test(k)).slice(0, 40));
  out.copyBlock = safe(() => Object.keys(app.commands.commands).filter((k) => /copy/i.test(k)).slice(0, 20));
  out.mcProto = safe(() => Object.getOwnPropertyNames(Object.getPrototypeOf(app.metadataCache)));
  out.mcOwn = safe(() => Object.keys(app.metadataCache).slice(0, 30));
  out.fillIds = safe(() => app.metadataCache.getCache("Note.md").frontmatterPosition);
  out.settingsKeys = safe(() => Object.keys(app.setting || {}).slice(0, 40));
  out.vaultConfigSample = safe(() => ["newLinkFormat", "useMarkdownLinks", "showLineNumber", "readableLineLength", "defaultViewMode", "attachmentFolderPath"].map((k) => [k, app.vault.getConfig(k)]));
  out.indexStats = safe(() => ({ resolved: Object.keys(app.metadataCache.resolvedLinks || {}).length, unresolved: Object.keys(app.metadataCache.unresolvedLinks || {}).length }));
  out.hasCacheFileApi = safe(() => typeof app.metadataCache.getCache === "function");
  out.canvasCache = safe(() => Object.keys(app.metadataCache.getCache("Map.canvas") || {}));
  out.bigBlocks = safe(() => Object.keys(app.metadataCache.getCache("Big.md").blocks || {}).length);
  out.rebuild = safe(() => typeof app.metadataCache.rebuildCache);
  return JSON.stringify(out);
})()`;

const res = await new Promise((resolve, reject) => {
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  const timer = setTimeout(() => reject(new Error("ws timeout")), 25000);
  ws.onopen = () => ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression: EXPR, returnByValue: true, awaitPromise: true } }));
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id === 1) { clearTimeout(timer); ws.close(); resolve(m); } };
  ws.onerror = () => reject(new Error("ws error"));
});
import fs from "node:fs";
const r = res.result && res.result.result;
const v = r && r.value;
fs.writeFileSync("D:\\DSH记忆\\research\\probe-2.json", typeof v === "string" ? v : JSON.stringify(res, null, 2), "utf8");
console.log(typeof v === "string" ? v : JSON.stringify(res, null, 2));
