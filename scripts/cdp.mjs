// Minimal CDP client (Node 22, built-in fetch + WebSocket)
const BASE = 'http://127.0.0.1:9222';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function listTargets() {
  const r = await fetch(`${BASE}/json/list`);
  return r.json();
}

class Conn {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.listeners = [];
    ws.addEventListener('message', (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      } else if (msg.method) {
        for (const l of this.listeners) l(msg);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP timeout: ${method}`));
        }
      }, 60000);
    });
  }
  on(fn) { this.listeners.push(fn); }
  close() { try { this.ws.close(); } catch {} }
}

async function openWs(url) {
  const ws = new WebSocket(url);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', (e) => reject(new Error('ws error: ' + (e.message || 'unknown'))), { once: true });
  });
  return ws;
}

export async function listPages() {
  return (await listTargets()).filter((t) => t.type === 'page');
}

export async function closeTarget(id) {
  const ver = await (await fetch(`${BASE}/json/version`)).json();
  const ws = await openWs(ver.webSocketDebuggerUrl);
  const bconn = new Conn(ws);
  try {
    await bconn.send('Target.closeTarget', { targetId: id });
  } finally {
    bconn.close();
  }
}

// Connect to a page target. `match` is a substring that the URL must contain;
// when omitted the first page target is used.
export async function connectPage(match) {
  let targets = (await listTargets()).filter((t) => t.type === 'page');
  if (match) {
    const m = targets.filter((t) => (t.url || '').includes(match));
    if (m.length) targets = m;
  }
  if (!targets.length) {
    const ver = await (await fetch(`${BASE}/json/version`)).json();
    const bws = await openWs(ver.webSocketDebuggerUrl);
    const bconn = new Conn(bws);
    const { targetId } = await bconn.send('Target.createTarget', { url: 'about:blank' });
    bconn.close();
    await sleep(500);
    targets = (await listTargets()).filter((t) => t.type === 'page' && t.id === targetId);
  }
  const target = targets[0];
  const ws = await openWs(target.webSocketDebuggerUrl);
  const c = new Conn(ws);
  await c.send('Page.enable');
  await c.send('Runtime.enable');
  return c;
}

export async function evalJs(c, expression, { awaitPromise = true } = {}) {
  const res = await c.send('Runtime.evaluate', {
    expression,
    awaitPromise,
    returnByValue: true,
    userGesture: true,
  });
  if (res.exceptionDetails) {
    const d = res.exceptionDetails;
    throw new Error('JS error: ' + (d.exception?.description || d.text));
  }
  return res.result.value;
}

export async function waitReady(c, timeout = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    try {
      const s = await evalJs(c, 'document.readyState');
      if (s === 'complete') return true;
    } catch {}
    await sleep(300);
  }
  return false;
}

export async function navigate(c, url, timeout = 45000) {
  await c.send('Page.navigate', { url });
  await sleep(800);
  await waitReady(c, timeout);
  await sleep(1200);
}

export async function screenshot(c, path) {
  const { data } = await c.send('Page.captureScreenshot', { format: 'png' });
  const fs = await import('node:fs');
  fs.writeFileSync(path, Buffer.from(data, 'base64'));
}
