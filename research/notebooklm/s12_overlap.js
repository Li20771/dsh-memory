// Re-install recorder, add a THIRD source that duplicates a fact from source 甲,
// then ask about that fact to observe how overlapping sources are merged.
const DOC3 = [
  '## 文档丙：ZX-9 快速参数卡',
  '',
  '§Q01 ZX-9 型设备的额定功率为 47.3 千瓦（与设备铭牌一致）。',
  '§Q02 ZX-9 的防护等级为 IP54，工作温度范围为 -10℃ 至 45℃。',
].join('\n');
const Q = 'ZX-9 型设备的额定功率是多少千瓦？';

if (!window.__cap) {
  window.__cap = [];
  const interesting = u => /Orchestration|batchexecute|LabsTailwind/i.test(u || '');
  const origFetch = window.fetch;
  window.fetch = async function (...args) {
    const resp = await origFetch.apply(this, args);
    try {
      const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url) || '';
      if (interesting(url)) {
        resp.clone().text()
          .then(t => window.__cap.push({ kind: 'fetch', url, len: t.length, body: t }))
          .catch(e => window.__cap.push({ kind: 'fetch', url, err: String(e) }));
      }
    } catch (e) {}
    return resp;
  };
}

// add source 丙
clickLabel('Sources');
await sleep(1200);
let item = qa('button,[role=button],li').filter(vis).find(e => (e.innerText || '').includes('复制的文字'));
if (!item) { clickLabel('添加来源'); await sleep(900);
  item = qa('button,[role=button],li').filter(vis).find(e => (e.innerText || '').includes('复制的文字')); }
if (item) (item.closest('button') || item).click();
await sleep(1500);

const bodyEl = qa('textarea').filter(vis).find(e => lab(e) === '粘贴的文字');
if (!bodyEl) return { error: 'no paste textarea', buttons: buttons() };
const titleEl = qa('input.title-input').filter(vis)[0];
if (titleEl) setValue(titleEl, 'KB探针-文档丙');
setValue(bodyEl, DOC3);
await sleep(300);
const ins = clickLabel('插入');

const t0 = Date.now();
while (Date.now() - t0 < 50000) { await sleep(1500); if (/3 个来源/.test(text())) break; }
await sleep(2500);

const startCap = window.__cap.length;
const readyBefore = (text().match(/回复已就绪/g) || []).length;
clickLabel('对话');
await sleep(700);
const box = qa('textarea').filter(vis).find(e => lab(e) === '查询框') || q('textarea');
box.focus();
setValue(box, Q);
await sleep(250);
box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));

const deadline = Date.now() + 80000;
while (Date.now() < deadline) {
  await sleep(1500);
  if ((text().match(/回复已就绪/g) || []).length > readyBefore && window.__cap.length > startCap) { await sleep(2000); break; }
}

return {
  insert: ins,
  question: Q,
  sourceLine: (text().match(/\d+ 个来源/) || [])[0] || null,
  caps: window.__cap.slice(startCap).map(c => ({ url: String(c.url).slice(0, 200), len: c.len,
    body: typeof c.body === 'string' ? c.body.slice(0, 200000) : null })),
  uiTail: text().slice(-700),
};
