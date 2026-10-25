const r = clickLabel('Studio');
await sleep(2500);
return {
  click: r,
  buttons: buttons().slice(-30),
  text: text().slice(-900),
};
