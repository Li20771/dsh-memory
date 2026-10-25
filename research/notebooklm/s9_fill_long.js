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
chapters[2] += '\n第3章关键指标：工序3 的一次合格率目标为 98.7%，返修率上限 1.3%。';
chapters[10] += '\n第11章验收阈值：工序11 的验收阈值为 0.42 MPa，连续 5 批低于该值即判定不合格。';
const DOC = ['## 长文档乙：十二道工序规范汇编', ...chapters,
  '## 附注\n本文档由测试夹具生成，仅用于测量分块与检索覆盖，不含真实工艺参数。'].join('\n\n');

const body = qa('textarea').filter(vis).find(e => lab(e) === '粘贴的文字');
if (!body) return { error: 'no paste textarea', fields: qa('textarea,input').filter(vis).map(lab) };

const title = qa('input.title-input').filter(vis)[0];
if (title) setValue(title, 'KB探针-长文档乙');
setValue(body, DOC);
await sleep(400);
const r = clickLabel('插入');

const t0 = Date.now();
while (Date.now() - t0 < 60000) {
  await sleep(1500);
  if (/2 个来源|3 个来源/.test(text())) break;
}
await sleep(2500);
return {
  click: r,
  docChars: DOC.length,
  docBytes: new TextEncoder().encode(DOC).length,
  valueLen: body.value.length,
  sourceLine: (text().match(/\d+ 个来源/) || [])[0] || null,
  buttons: buttons(),
};
