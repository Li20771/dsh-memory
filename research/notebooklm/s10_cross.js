const Q = '第3章的一次合格率目标，以及第11章的验收阈值分别是多少？请给出数值。';
const startCap = window.__cap.length;
const readyBefore = (text().match(/回复已就绪/g) || []).length;

clickLabel('对话');
await sleep(800);
const box = qa('textarea').filter(vis).find(e => lab(e) === '查询框') || q('textarea');
box.focus();
setValue(box, Q);
await sleep(250);
box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));

const deadline = Date.now() + 90000;
while (Date.now() < deadline) {
  await sleep(1500);
  if ((text().match(/回复已就绪/g) || []).length > readyBefore && window.__cap.length > startCap) {
    await sleep(2000);
    break;
  }
}

return {
  question: Q,
  sourceLine: (text().match(/\d+ 个来源/) || [])[0] || null,
  caps: window.__cap.slice(startCap).map(c => ({
    url: String(c.url).slice(0, 200), len: c.len,
    body: typeof c.body === 'string' ? c.body.slice(0, 260000) : null,
  })),
  uiTail: text().slice(-800),
};
