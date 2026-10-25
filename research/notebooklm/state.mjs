import { connect, evaluate, dump } from './cdp.mjs';

const { cdp, close } = await connect();

const probe = `(() => {
  const vis = el => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const label = el => (el.getAttribute('aria-label') || el.getAttribute('placeholder') ||
    el.getAttribute('data-tooltip') || (el.innerText || '').trim().slice(0, 60) || '').replace(/\\s+/g, ' ');
  const btns = [...document.querySelectorAll('button,[role=button],a[role=button]')]
    .filter(vis).map(el => ({ tag: el.tagName.toLowerCase(), label: label(el),
      cls: (el.className || '').toString().slice(0, 70) })).filter(x => x.label);
  const inputs = [...document.querySelectorAll('textarea,input,[contenteditable=true],[role=textbox]')]
    .filter(vis).map(el => ({ tag: el.tagName.toLowerCase(), label: label(el),
      cls: (el.className || '').toString().slice(0, 70) }));
  return {
    url: location.href,
    title: document.title,
    textLen: (document.body.innerText || '').length,
    text: (document.body.innerText || '').slice(0, 2500),
    buttons: btns.slice(0, 60),
    inputs: inputs.slice(0, 20),
    dialogs: [...document.querySelectorAll('[role=dialog],[role=menu],[role=listbox]')].map(d => d.getAttribute('role')),
  };
})()`;

dump(await evaluate(cdp, probe));
close();
