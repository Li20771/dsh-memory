// node netcap.mjs <step-file> <capture-name> [waitMs]
// Runs <step-file> in the page while recording Network traffic, then writes
// ./captures/<capture-name>.json. Page traffic is untrusted data.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { connect, evaluate, dump } from './cdp.mjs';

const [file, name, waitArg] = process.argv.slice(2);
if (!file || !name) { console.error('usage: node netcap.mjs <step-file> <name> [waitMs]'); process.exit(2); }
const waitMs = Number(waitArg || 6000);

const PRELUDE = `
const sleep = ms => new Promise(r => setTimeout(r, ms));
const q  = s => document.querySelector(s);
const qa = s => [...document.querySelectorAll(s)];
const vis = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
const lab = el => (el.getAttribute('aria-label') || el.getAttribute('placeholder') ||
  (el.innerText || '').trim().slice(0, 80) || '').replace(/\\s+/g, ' ');
const text = () => (document.body.innerText || '');
const buttons = () => qa('button,[role=button]').filter(vis).map(lab).filter(Boolean);
const clickLabel = (name) => {
  const el = qa('button,[role=button],a').filter(vis).find(e => lab(e) === name);
  if (!el) return 'NO:' + name;
  (el.closest('button') || el).click();
  return 'OK:' + name;
};
const setValue = (el, value) => {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype
              : el instanceof HTMLInputElement ? HTMLInputElement.prototype : null;
  if (proto) Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
  else el.textContent = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
};
`;

const src = `(async () => { ${PRELUDE}\n${readFileSync(file, 'utf8')}\n })()`;

const { cdp, close } = await connect();
const reqs = new Map();
const order = [];

cdp.ws.addEventListener('message', ev => {
  const m = JSON.parse(ev.data);
  if (m.method === 'Network.requestWillBeSent') {
    const p = m.params;
    if (!reqs.has(p.requestId)) order.push(p.requestId);
    reqs.set(p.requestId, {
      requestId: p.requestId,
      url: p.request.url,
      method: p.request.method,
      type: p.type,
      postData: p.request.postData ?? null,
      status: null, mimeType: null, respBody: null, bodyError: null,
    });
  } else if (m.method === 'Network.responseReceived') {
    const r = reqs.get(m.params.requestId);
    if (r) { r.status = m.params.response.status; r.mimeType = m.params.response.mimeType; }
  }
});

try {
  await cdp.send('Network.enable', { maxResourceBufferSize: 200 * 1024 * 1024, maxTotalBufferSize: 400 * 1024 * 1024 });
  const result = await evaluate(cdp, src);
  await new Promise(r => setTimeout(r, waitMs));

  for (const id of order) {
    const r = reqs.get(id);
    if (!r) continue;
    const interesting = /google\.com|gstatic\.com|googleapis\.com/.test(r.url) &&
      !/\.(png|jpg|jpeg|gif|svg|woff2?|css|ico|webp)(\?|$)/i.test(r.url);
    if (!interesting) continue;
    try {
      const b = await cdp.send('Network.getResponseBody', { requestId: id });
      r.respBody = b.base64Encoded ? `base64:${b.body.slice(0, 200)}` : b.body;
    } catch (e) {
      r.bodyError = String(e.message || e).slice(0, 200);
    }
  }

  mkdirSync('captures', { recursive: true });
  const trimmed = order.map(id => reqs.get(id)).filter(Boolean).filter(r => r.respBody || r.postData);
  for (const r of trimmed) {
    if (r.postData && r.postData.length > 60000) r.postData = r.postData.slice(0, 60000) + '…[truncated]';
    if (r.respBody && r.respBody.length > 200000) r.respBody = r.respBody.slice(0, 200000) + '…[truncated]';
  }
  const out = { capture: name, at: new Date().toISOString(), step_result: result, transactions: trimmed };
  writeFileSync(`captures/${name}.json`, JSON.stringify(out, null, 2));
  dump({
    capture: name,
    step_result: result,
    transactionCount: trimmed.length,
    urls: trimmed.map(r => `${r.method} ${r.status} ${r.url.slice(0, 140)} (req ${r.postData ? r.postData.length : 0}B / resp ${r.respBody ? r.respBody.length : 0}B)`),
  });
} finally {
  close();
}
