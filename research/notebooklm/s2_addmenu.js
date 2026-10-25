const r = clickLabel('添加来源');
await sleep(1200);
const menus = qa('[role=menu],[role=dialog],.cdk-overlay-pane').map(m => ({
  role: m.getAttribute('role'),
  text: (m.innerText || '').replace(/\s+/g, ' ').slice(0, 400),
}));
return {
  click: r,
  buttons: buttons(),
  menus,
  text: text().slice(0, 1200),
};
