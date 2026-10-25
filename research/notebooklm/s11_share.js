const r = clickLabel('分享笔记本');
await sleep(4000);
const dlg = qa('[role=dialog]')[0];
return {
  click: r,
  dialogText: (dlg?.innerText || '').replace(/\s+/g, ' ').slice(0, 1200),
  buttons: buttons(),
  fields: qa('input,textarea,[role=switch],[role=checkbox]').filter(vis).map(e => ({
    tag: e.tagName.toLowerCase(), label: lab(e), type: e.getAttribute('type') ?? null,
  })),
};
