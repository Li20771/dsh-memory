const r1 = clickLabel('Sources');
await sleep(1500);
return {
  click: r1,
  buttons: buttons(),
  inputs: qa('textarea,input,[contenteditable=true]').filter(vis).map(e => ({ tag: e.tagName.toLowerCase(), label: lab(e) })),
  text: text().slice(0, 1800),
};
