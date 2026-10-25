const target = qa('button,[role=button],li,[role=menuitem]').filter(vis)
  .find(e => (e.innerText || '').includes('复制的文字'));
const clicked = target ? ((target.closest('button') || target).click(), 'OK') : 'NO';
await sleep(1500);
return {
  clicked,
  buttons: buttons(),
  fields: qa('textarea,input,[contenteditable=true]').filter(vis).map(e => ({
    tag: e.tagName.toLowerCase(),
    label: lab(e),
    cls: (e.className || '').toString().slice(0, 60),
    maxLength: e.getAttribute('maxlength'),
  })),
  dialogText: (qa('[role=dialog]')[0]?.innerText || '').replace(/\s+/g, ' ').slice(0, 600),
};
