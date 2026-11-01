import fs from 'node:fs';
import { connectPage, evalJs, sleep } from './cdp.mjs';

const PTS = JSON.parse(process.env.PTS); // [[x,y],...] 顺序：起 1 2 3 终
const c = await connectPage('yuketang');
await c.send('Page.bringToFront');
await sleep(300);

const m = (type, x, y, extra = {}) => c.send('Input.dispatchMouseEvent', {
  type, x: Math.round(x), y: Math.round(y), ...extra,
});

// 悬停到起点
await m('mouseMoved', PTS[0][0], PTS[0][1], { button: 'none', buttons: 0 });
await sleep(150);
// 按下
await m('mousePressed', PTS[0][0], PTS[0][1], { button: 'left', buttons: 1, clickCount: 1 });
await sleep(120);

// 逐段插值
for (let i = 1; i < PTS.length; i++) {
  const [x0, y0] = PTS[i - 1];
  const [x1, y1] = PTS[i];
  const steps = 18;
  for (let s = 1; s <= steps; s++) {
    const t = s / steps;
    const x = x0 + (x1 - x0) * t + (Math.random() - 0.5) * 1.2;
    const y = y0 + (y1 - y0) * t + (Math.random() - 0.5) * 1.2;
    await m('mouseMoved', x, y, { button: 'left', buttons: 1 });
    await sleep(14 + Math.random() * 8);
  }
  // 到点后停顿，确保该点被判定为“经过”
  await m('mouseMoved', x1, y1, { button: 'left', buttons: 1 });
  await sleep(260);
}
// 终点松开
const last = PTS[PTS.length - 1];
await m('mouseReleased', last[0], last[1], { button: 'left', buttons: 0, clickCount: 1 });
console.log('drag done');
await sleep(2500);

const st = await evalJs(c, `(() => {
  const f = document.querySelector('iframe');
  const d = f.contentDocument;
  const host = d.querySelector('div');
  let canvasVisible = false;
  d.querySelectorAll('*').forEach(e => { if (e.shadowRoot) { const cv = e.shadowRoot.querySelector('canvas'); if (cv) { const r = cv.getBoundingClientRect(); canvasVisible = r.width > 10; } } });
  const msgs = [];
  d.querySelectorAll('.el-message, .rain-toast').forEach(e => { const t = (e.innerText||'').trim(); if (t) msgs.push(t); });
  return JSON.stringify({ canvasVisible, msgs });
})()`);
console.log('STATE', st);

const { data } = await c.send('Page.captureScreenshot', { format: 'png' });
const shot = process.env.CAP_AFTER || (process.cwd().replace(/\\/g, '/') + '/cap_after_drag.png');
fs.writeFileSync(shot, Buffer.from(data, 'base64'));
console.log('SAVED', shot);
c.close();
