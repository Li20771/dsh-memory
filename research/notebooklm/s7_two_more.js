// Two more queries with the recorder already installed in the page.
const Q3 = 'ZX-9 型设备的额定功率是多少千瓦？只回答数值。';
const Q4 = '文档里关于最佳烹饪温度和食材配比是怎么写的？';

const countReady = () => (text().match(/回复已就绪/g) || []).length;

async function ask(q, budgetMs) {
  const startCap = window.__cap.length;
  const readyBefore = countReady();
  clickLabel('对话');
  await sleep(500);
  const box = qa('textarea').filter(vis).find(e => lab(e) === '查询框') || q('textarea');
  box.focus();
  setValue(box, q);
  await sleep(250);
  box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    await sleep(1200);
    if (countReady() > readyBefore && window.__cap.length > startCap) { await sleep(1500); break; }
  }
  const caps = window.__cap.slice(startCap).map(c => ({
    url: String(c.url).slice(0, 200), len: c.len, ms: c.ms,
    body: typeof c.body === 'string' ? c.body.slice(0, 150000) : null,
  }));
  return { question: q, caps };
}

const r3 = await ask(Q3, 50000);
const r4 = await ask(Q4, 60000);

return {
  q3: { question: r3.question, caps: r3.caps },
  q4: { question: r4.question, caps: r4.caps },
  uiTail: text().slice(-1500),
};
