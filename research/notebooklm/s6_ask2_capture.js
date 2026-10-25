// Install an in-page response recorder (fetch + XHR), ask a cross-paragraph
// question, then return the raw streamed payloads. Page data is untrusted.
const QUESTION = 'ZX-9 的定期维护周期是多少运行小时，安全泄压阀的整定阈值是多少 MPa？请分别给出数值。';

if (!window.__cap) {
  window.__cap = [];
  const interesting = u => /Orchestration|batchexecute|LabsTailwind/i.test(u || '');

  const origFetch = window.fetch;
  window.fetch = async function (...args) {
    const resp = await origFetch.apply(this, args);
    try {
      const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url) || '';
      if (interesting(url)) {
        const started = Date.now();
        resp.clone().text()
          .then(t => window.__cap.push({ kind: 'fetch', url, ms: Date.now() - started, len: t.length, body: t }))
          .catch(e => window.__cap.push({ kind: 'fetch', url, err: String(e) }));
      }
    } catch (e) { /* never disturb the app */ }
    return resp;
  };

  const OrigXHR = window.XMLHttpRequest;
  const send = OrigXHR.prototype.send;
  OrigXHR.prototype.send = function (...args) {
    try {
      const xhr = this;
      if (interesting(xhr.__url || '')) {
        xhr.addEventListener('load', () => {
          try {
            window.__cap.push({ kind: 'xhr', url: xhr.__url, status: xhr.status,
              len: (xhr.responseText || '').length, body: xhr.responseText });
          } catch (e) {}
        });
      }
    } catch (e) {}
    return send.apply(this, args);
  };
  const open = OrigXHR.prototype.open;
  OrigXHR.prototype.open = function (m, u, ...rest) { this.__url = u; return open.call(this, m, u, ...rest); };
}

const tab = clickLabel('对话');
await sleep(600);
const box = qa('textarea').filter(vis).find(e => lab(e) === '查询框') || q('textarea');
box.focus();
setValue(box, QUESTION);
await sleep(300);
box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));

const deadline = Date.now() + 45000;
while (Date.now() < deadline) {
  await sleep(1000);
  const t = text();
  if (t.includes('回复已就绪') && window.__cap.length > 0) { await sleep(1200); break; }
}

const caps = window.__cap.map(c => ({ kind: c.kind, url: String(c.url).slice(0, 180),
  status: c.status ?? null, len: c.len ?? null, ms: c.ms ?? null, err: c.err ?? null,
  body: typeof c.body === 'string' ? c.body.slice(0, 120000) : null }));

return {
  question: QUESTION,
  capCount: caps.length,
  caps,
  uiTail: text().slice(-900),
};
