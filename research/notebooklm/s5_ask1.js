const QUESTION = 'ZX-9 型设备的额定功率是多少？请给出具体数值。';

const tab = clickLabel('对话');
await sleep(1000);

const box = qa('textarea').filter(vis).find(e => lab(e) === '查询框') || q('textarea');
if (!box) return { error: 'query box not found', buttons: buttons() };

box.focus();
setValue(box, QUESTION);
await sleep(400);

const before = text().length;
box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
await sleep(2500);

const sentByEnter = text().includes(QUESTION);
let clicked = null;
if (!sentByEnter) clicked = clickLabel('提交');
await sleep(8000);

return {
  tab, sentByEnter, clicked,
  question: QUESTION,
  textLen: text().length, before,
  tail: text().slice(-1200),
};
