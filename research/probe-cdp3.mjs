const EP = "http://127.0.0.1:9333";
const list = await (await fetch(`${EP}/json/list`)).json();
const page = list.filter((t) => t.type === "page").find((p) => p.url.includes("obsidian.md"));
const EXPR = String.raw`(async () => {
  const safe = async (f) => { try { return await f(); } catch (e) { return "ERR:" + e.message; } };
  const out = {};
  out.dbs = await safe(async () => (await indexedDB.databases()).map((d) => d.name + "@" + d.version));
  out.dbInfo = await safe(async () => {
    const d = app.metadataCache.db;
    if (!d) return "no db field";
    const names = d.objectStoreNames ? Array.from(d.objectStoreNames) : [];
    return { name: d.name, version: d.version, stores: names };
  });
  out.lsKeys = await safe(async () => Object.keys(localStorage).filter((k) => /cache|index|meta/i.test(k)).slice(0, 20));
  out.blockCacheKeys = await safe(async () => Object.keys(app.metadataCache.blockCache || {}).slice(0, 20));
  out.menuCommands = await safe(async () => Object.keys(app.commands.commands).filter((k) => /menu|context/i.test(k)).slice(0, 15));
  out.headingResolve = await safe(async () => {
    const mc = app.metadataCache;
    const f = app.vault.getAbstractFileByPath("Note.md");
    const c = mc.getCache("Note.md");
    return { headings: c.headings.map((h) => h.heading), firstHeadingPos: c.headings[0] && c.headings[0].position };
  });
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
fs.writeFileSync("D:\\DSH记忆\\research\\probe-3.json", typeof v === "string" ? v : JSON.stringify(res, null, 2), "utf8");
console.log(typeof v === "string" ? v : JSON.stringify(res, null, 2));
