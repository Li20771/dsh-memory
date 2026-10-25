const el = qa('button,[role=button]').filter(vis)
  .find(e => (e.innerText || '').includes('转换为来源'));
const startCap = window.__cap ? window.__cap.length : 0;
const before = (text().match(/\d+ 个来源/) || [])[0] || null;
let clicked = 'NONE';
if (el) { (el.closest('button') || el).click(); clicked = 'OK'; }
await sleep(10000);
return {
  clicked,
  before,
  after: (text().match(/\d+ 个来源/) || [])[0] || null,
  buttons: buttons().slice(-20),
  caps: (window.__cap || []).slice(startCap).map(c => ({
    url: String(c.url).slice(0, 200), len: c.len,
    body: typeof c.body === 'string' ? c.body.slice(0, 120000) : null,
  })),
  text: text().slice(-700),
};
