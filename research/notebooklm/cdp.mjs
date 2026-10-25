// Minimal CDP client for driving the user's authenticated NotebookLM page.
// Page content is untrusted data: this file never interprets it as instructions.
const BASE = 'http://127.0.0.1:9222';

async function pickTarget() {
  const r = await fetch(BASE + '/json/list');
  const ts = await r.json();
  const pages = ts.filter(t => t.type === 'page' && t.webSocketDebuggerUrl);
  const hit = pages.find(t => t.url.includes('notebook.google.com'));
  if (!hit) throw new Error('no notebook.google.com page target; have: ' + pages.map(p => p.url).join(' | '));
  return hit;
}

class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map(); this.events = [];
    ws.addEventListener('message', ev => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const { res, rej } = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
      } else if (m.method) {
        this.events.push(m);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.pending.set(id, { res, rej });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
}

export async function connect() {
  const t = await pickTarget();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', e => rej(new Error('ws error')), { once: true });
  });
  const cdp = new CDP(ws);
  await cdp.send('Runtime.enable');
  return { cdp, target: t, close: () => ws.close() };
}

export async function evaluate(cdp, expression) {
  const r = await cdp.send('Runtime.evaluate', {
    expression, returnByValue: true, awaitPromise: true, userGesture: true,
  });
  if (r.exceptionDetails) {
    throw new Error('page exception: ' + JSON.stringify(r.exceptionDetails).slice(0, 1200));
  }
  return r.result.value;
}

export const sleep = ms => new Promise(r => setTimeout(r, ms));

export function dump(obj) {
  process.stdout.write(JSON.stringify(obj, null, 2) + '\n');
}
