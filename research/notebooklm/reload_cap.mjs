// Reload the page and capture the notebook-content RPC (wXbhsf) responses.
import { writeFileSync, mkdirSync } from 'node:fs';
import { connect, sleep, dump } from './cdp.mjs';

const { cdp, close, target } = await connect();
const reqs = new Map();
const order = [];

cdp.ws.addEventListener('message', ev => {
  const m = JSON.parse(ev.data);
  if (m.method === 'Network.requestWillBeSent') {
    const p = m.params;
    if (!reqs.has(p.requestId)) { order.push(p.requestId); reqs.set(p.requestId, { url: p.request.url, method: p.request.method, postData: p.request.postData ?? null }); }
  }
});

try {
  await cdp.send('Network.enable', { maxResourceBufferSize: 100 * 1024 * 1024, maxTotalBufferSize: 200 * 1024 * 1024 });
  await cdp.send('Page.enable');
  await cdp.send('Page.reload', { ignoreCache: false });
  await sleep(18000);

  const out = [];
  for (const id of order) {
    const r = reqs.get(id);
    if (!r || !/wXbhsf/.test(r.url)) continue;
    let body = null;
    try { const b = await cdp.send('Network.getResponseBody', { requestId: id }); body = b.base64Encoded ? null : b.body; } catch (e) { body = 'ERR ' + e.message; }
    out.push({ url: r.url.slice(0, 160), postData: r.postData, body });
  }
  mkdirSync('captures', { recursive: true });
  writeFileSync('captures/08-reload-content.json', JSON.stringify({ target: target.url, at: new Date().toISOString(), rpcs: out }, null, 1), 'utf8');
  dump({ rpcs: out.length, sizes: out.map(o => (o.body || '').length), url: target.url });
} finally {
  close();
}
