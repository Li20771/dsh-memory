const EP = "http://127.0.0.1:9333";
const list = await (await fetch(`${EP}/json/list`)).json();
const page = list.filter((t) => t.type === "page").find((p) => p.url.includes("obsidian.md"));
if (!page) throw new Error("no obsidian page target");

const EXPR = String.raw`(() => {
  const mc = app.metadataCache;
  const P = (v) => { try { return v && v.path ? v.path : (v === null ? null : String(v)); } catch (e) { return "ERR"; } };
  const safe = (f, d) => { try { return f(); } catch (e) { return "ERR:" + e.message; } };
  const out = {};
  out.appVersion = safe(() => app.appVersion, null);
  out.linkDest = safe(() => ({
    Index_from_Links: P(mc.getFirstLinkpathDest("Index", "Links.md")),
    Index_from_a: P(mc.getFirstLinkpathDest("Index", "a/x.md")),
    Index_from_b: P(mc.getFirstLinkpathDest("Index", "b/x.md")),
    note_lower: P(mc.getFirstLinkpathDest("note", "Links.md")),
    NOTE_upper: P(mc.getFirstLinkpathDest("NOTE", "Links.md")),
    zh_cn: P(mc.getFirstLinkpathDest("中文 笔记", "Links.md")),
    explicit_a: P(mc.getFirstLinkpathDest("a/Index", "Links.md")),
    missing: P(mc.getFirstLinkpathDest("Does Not Exist", "Links.md")),
    note_md: P(mc.getFirstLinkpathDest("Note.md", "Links.md")),
    pixel_png: P(mc.getFirstLinkpathDest("attachments/pixel.png", "Links.md"))
  }));
  out.blocks = safe(() => {
    const c = mc.getCache("Blocks.md");
    return { keys: Object.keys(c.blocks || {}), detail: c.blocks || {} };
  });
  out.sectionsWithId = safe(() => (mc.getCache("Blocks.md").sections || []).filter((s) => s.id));
  out.listItemsWithId = safe(() => (mc.getCache("Blocks.md").listItems || []).filter((i) => i.id));
  out.links = safe(() => (mc.getCache("Links.md").links || []).map((l) => ({ link: l.link, original: l.original, displayText: l.displayText })));
  out.embeds = safe(() => (mc.getCache("Links.md").embeds || []).map((l) => ({ link: l.link, original: l.original, displayText: l.displayText })));
  out.headingsLinks = safe(() => (mc.getCache("Hub.md").links || []).map((l) => ({ link: l.link, original: l.original })));
  out.frontmatter = safe(() => mc.getCache("Frontmatter.md").frontmatter);
  out.noteHeadings = safe(() => (mc.getCache("Note.md").headings || []).map((h) => ({ heading: h.heading, level: h.level })));
  out.specialHeadings = safe(() => (mc.getCache("Headings.md").headings || []).map((h) => h.heading));
  out.crlfBlocks = safe(() => Object.keys(mc.getCache("CRLF.md").blocks || {}));
  out.tags = safe(() => (mc.getCache("Note.md").tags || []).map((t) => t.tag));
  out.fileCacheSize = safe(() => Object.keys(mc.fileCache).length);
  out.fileCacheSample = safe(() => Object.entries(mc.fileCache).slice(0, 3));
  out.resolved = safe(() => Object.entries(mc.resolvedLinks || {}).filter(([k]) => k === "Links.md" || k === "Hub.md"));
  out.unresolved = safe(() => Object.entries(mc.unresolvedLinks || {}).filter(([k]) => k === "Links.md"));
  out.active = safe(() => (app.workspace.getActiveFile() || {}).path);
  out.config = safe(() => ({ newLinkFormat: app.vault.getConfig("newLinkFormat"), useMarkdownLinks: app.vault.getConfig("useMarkdownLinks") }));
  out.cacheApiKeys = safe(() => Object.keys(mc.getCache("Note.md")));
  return JSON.stringify(out);
})()`;

const res = await new Promise((resolve, reject) => {
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  const timer = setTimeout(() => reject(new Error("ws timeout")), 25000);
  ws.onopen = () => ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression: EXPR, returnByValue: true, awaitPromise: true } }));
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id === 1) { clearTimeout(timer); ws.close(); resolve(msg); }
  };
  ws.onerror = () => reject(new Error("ws error"));
});

import fs from "node:fs";
fs.writeFileSync("D:\\DSH记忆\\research\\probe-raw.json", JSON.stringify(res, null, 2), "utf8");
const r = res.result && res.result.result;
let payload = r && r.value;
if (typeof payload === "string") {
  fs.writeFileSync("D:\\DSH记忆\\research\\probe-1.json", payload, "utf8");
  const obj = JSON.parse(payload);
  console.log(JSON.stringify(obj, null, 2));
} else {
  console.log(JSON.stringify(res, null, 2));
}
