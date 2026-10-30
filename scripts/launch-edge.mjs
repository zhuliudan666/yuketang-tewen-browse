// 启动一个「可被自动化接管」的浏览器并保持常驻。
// 用法：node scripts/launch-edge.mjs
// 说明：新版 Edge/Chrome 禁止在默认用户目录上开调试端口，所以这里用独立目录（.yb-profile）。
//      首次运行窗口里是未登录状态，请手动登录一次；登录态会保存在该目录，后续复用。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { connectPage, listPages, evalJs, sleep } from './cdp.mjs';

const CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
];
const EDGE = process.env.BROWSER_PATH || CANDIDATES.find((p) => fs.existsSync(p));
if (!EDGE) {
  console.error('未找到 Edge/Chrome，可用 BROWSER_PATH 指定可执行文件路径');
  process.exit(1);
}

const PROFILE = process.env.PROFILE_DIR || path.join(process.cwd(), '.yb-profile');
const PORT = Number(process.env.PORT || 9222);
const START_URL = process.env.START_URL || 'about:blank';

const up = async () => {
  try { return (await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok; } catch { return false; }
};

if (!(await up())) {
  console.log('启动浏览器…', EDGE);
  spawn(EDGE, [
    `--user-data-dir=${PROFILE}`,
    `--remote-debugging-port=${PORT}`,
    '--remote-allow-origins=*',
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=1440,900',
    START_URL,
  ], { stdio: 'ignore', detached: false });
  for (let i = 0; i < 80 && !(await up()); i++) await sleep(500);
  if (!(await up())) { console.error('调试端口未起来，请检查是否已在运行另一个使用该目录的浏览器'); process.exit(1); }
} else {
  console.log('检测到已有实例，直接复用');
}

const pages = await listPages();
console.log(`READY 端口=${PORT} 页面数=${pages.length}`);
console.log('如需登录：在该窗口里手动登录雨课堂，完成后本进程会一直保持浏览器存活（Ctrl+C 结束）。');

// 常驻；页面被全部关闭时浏览器会退出，这里做兜底提示
for (let i = 0; i < 10000; i++) {
  await sleep(30000);
  const ps = await listPages().catch(() => []);
  if (!ps.length) { console.log('页面已全部关闭，浏览器可能已退出'); break; }
}
