import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { connectPage, evalJs, sleep } from './cdp.mjs';

const c = await connectPage('yuketang');
await c.send('Page.bringToFront');
await sleep(300);

// 找到 shadow DOM 里的验证码 canvas
const box = JSON.parse(await evalJs(c, `(() => {
  const d = document.querySelector('iframe').contentDocument;
  let out = null;
  d.querySelectorAll('*').forEach(e => {
    if (!e.shadowRoot) return;
    const cv = e.shadowRoot.querySelector('canvas');
    if (!cv) return;
    const r = cv.getBoundingClientRect();
    if (r.width > 50) out = { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  return JSON.stringify(out);
})()`));
console.log('CANVAS', JSON.stringify(box));
if (!box) { c.close(); process.exit(1); }

const SCALE = 3;
const { data } = await c.send('Page.captureScreenshot', {
  format: 'png',
  clip: { x: box.x, y: box.y, width: box.w, height: box.h, scale: SCALE },
  captureBeyondViewport: false,
});
const png = process.env.CAP_PNG || (process.cwd().replace(/\\/g, '/') + '/cap_crop.png');
// Python 解释器：$PYTHON 优先；Windows 习惯用 python，其他平台用 python3
const PY = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
// cap_blobs2.py 与本脚本同目录
const HERE = fileURLToPath(new URL('.', import.meta.url));
fs.writeFileSync(png, Buffer.from(data, 'base64'));

// 实际像素宽 / CSS 宽 = 真实缩放比
const size = execFileSync(PY, ['-c',
  `import struct;d=open(r'${png}','rb').read();print(struct.unpack('>II',d[16:24])[0])`]).toString().trim();
const div = Number(size) / box.w;
const blobs = execFileSync(PY, [HERE + 'cap_blobs2.py', png, String(box.x), String(box.y), String(div)]).toString().trim();
console.log('PNGW', size, 'div', div.toFixed(3));
console.log('BLOBS', blobs);
c.close();
