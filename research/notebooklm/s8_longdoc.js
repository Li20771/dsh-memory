// Add a second, long source (12 chapters) to expose chunk boundaries, then ask a
// cross-chapter question and keep the streamed response.
const chapters = [];
for (let c = 1; c <= 12; c++) {
  const paras = [];
  for (let k = 1; k <= 4; k++) {
    const code = `C${String(c).padStart(2, '0')}-M${k}`;
    paras.push(`第${c}章第${k}段（标记 ${code}）：本节描述第${c}类工序的作业要求。` +
      `设备组 ${code} 的责任人须在班前完成点检，记录编号 ${code}-LOG，` +
      `点检项目包含压力、温度、流量三项读数，任一项越限即升级处理。`);
  }
  chapters.push(`## 第${c}章 工序${c}规范\n` + paras.join('\n'));
}
// two decisive facts far apart
chapters[2] += '\n第3章关键指标：工序3 的一次合格率目标为 98.7%，返修率上限 1.3%。';
chapters[10] += '\n第11章验收阈值：工序11 的验收阈值为 0.42 MPa，连续 5 批低于该值即判定不合格。';

const DOC = ['## 长文档乙：十二道工序规范汇编', ...chapters,
  '## 附注\n本文档由测试夹具生成，仅用于测量分块与检索覆盖，不含真实工艺参数。'].join('\n\n');

const Q = '第3章的关键指标（一次合格率）和第11章的验收阈值分别是多少？';

// add source
clickLabel('Sources');
await sleep(1200);
const menuOpen = qa('button,[role=button],li').filter(vis)
  .find(e => (e.innerText || '').includes('复制的文字'));
if (menuOpen) (menuOpen.closest('button') || menuOpen).click();
else { clickLabel('添加来源'); await sleep(900);
  const m2 = qa('button,[role=button],li').filter(vis).find(e => (e.innerText || '').includes('复制的文字'));
  if (m2) (m2.closest('button') || m2).click(); }
await sleep(1500);

const dialog = q('[role=dialog]') || document;
const titleEl = dialog.querySelector('input.title-input');
const bodyEl = dialog.querySelector('textarea.copied-text-input-textarea');
if (!bodyEl) return { error: 'dialog textarea missing', buttons: buttons() };
if (titleEl) setValue(titleEl, 'KB探针-长文档乙');
setValue(bodyEl, DOC);
await sleep(300);
clickLabel('插入');

// wait for indexing
const t0 = Date.now();
while (Date.now() - t0 < 45000) {
  await sleep(1500);
  if (text().match(/2 个来源|3 个来源/)) break;
}
await sleep(3000);

// ask
const startCap = window.__cap.length;
clickLabel('对话');
await sleep(700);
const box = qa('textarea').filter(vis).find(e => lab(e) === '查询框') || q('textarea');
box.focus();
setValue(box, Q);
await sleep(250);
box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));

const deadline = Date.now() + 70000;
while (Date.now() < deadline) {
  await sleep(1500);
  if (text().includes('回复已就绪') && window.__cap.length > startCap) { await sleep(1500); break; }
}

return {
  docChars: DOC.length,
  docBytes: new TextEncoder().encode(DOC).length,
  chapters: chapters.length,
  question: Q,
  caps: window.__cap.slice(startCap).map(c => ({
    url: String(c.url).slice(0, 200), len: c.len,
    body: typeof c.body === 'string' ? c.body.slice(0, 200000) : null,
  })),
  sourceLine: (text().match(/\d+ 个来源/) || [])[0] || null,
};
