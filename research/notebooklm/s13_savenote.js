const btns = qa('button,[role=button]').filter(vis)
  .filter(e => (e.getAttribute('aria-label') || e.innerText || '').includes('保存到笔记'));
const n = btns.length;
const startCap = window.__cap.length;
let clicked = 'NONE';
if (n) { (btns[n - 1].closest('button') || btns[n - 1]).click(); clicked = 'OK last of ' + n; }
await sleep(6000);
return {
  clicked,
  newCaps: window.__cap.slice(startCap).map(c => ({
    url: String(c.url).slice(0, 200), len: c.len,
    body: typeof c.body === 'string' ? c.body.slice(0, 120000) : null,
  })),
  buttons: buttons().slice(-22),
  text: text().slice(-600),
};
