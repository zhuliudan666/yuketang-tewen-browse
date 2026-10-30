import fs from 'node:fs';
import path from 'node:path';
import { connectPage, evalJs, navigate, listTargets, closeTarget, sleep } from './cdp.mjs';

// 输出目录与课程清单：默认 ./out，可用环境变量覆盖
const OUT = process.env.DISC_OUT || path.join(process.cwd(), 'out');
fs.mkdirSync(OUT, { recursive: true });
const COURSES = JSON.parse(fs.readFileSync(process.env.DISC_COURSES || path.join(OUT, 'courses.json'), 'utf8'));
// 课程清单格式：[{name, cid, rid}, ...]；ONLY=0,3 指定下标；MAX=每课最多尝试次数；MY_NAME=本人昵称
const ONLY = process.env.ONLY ? process.env.ONLY.split(',').map(Number) : null;
const REC = path.join(OUT, 'disc-records.jsonl');
const MIN_LEN = Number(process.env.MIN_LEN || 60);
const MAX = Number(process.env.MAX || 45);
// 本人昵称，用于「该讨论是否已有我的发言」防护。必填，避免重复发表。
const MY_NAME = process.env.MY_NAME || '';
if (!MY_NAME) console.warn('⚠ 未设置 MY_NAME（你的雨课堂昵称），"已有本人发言"防护将失效，可能重复发表');
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const COLLECT = `(()=>{
  const all=[...document.querySelectorAll('.leaf-detail')];
  const items=all.map((r,idx)=>{
    const lines=(r.innerText||'').split('\\n').map(s=>s.trim()).filter(Boolean);
    return { idx, title: lines[0]||'', st: lines.find(l=>/未发言|已发言/.test(l))||'' };
  }).filter(x=>/讨论/.test(x.title) && /未发言|已发言/.test(x.st));
  return JSON.stringify(items);
})()`;

async function waitDirectory(c, timeout = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    try {
      const n = await evalJs(c, `document.querySelectorAll('.leaf-detail').length`);
      if (n > 0) return n;
    } catch {}
    await sleep(500);
  }
  return 0;
}

async function reloadDir(c) {
  try { await evalJs(c, 'location.reload()', { awaitPromise: false }); } catch {}
  await sleep(2500);
  await waitDirectory(c);
  await sleep(800);
}

async function waitNewTarget(before, matcher, timeout = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const ps = (await listTargets()).filter((t) => t.type === 'page');
    const hit = ps.find((t) => !before.has(t.id) && matcher(t.url || ''));
    if (hit) return hit;
    await sleep(350);
  }
  return null;
}

const stats = [];
let totalOk = 0, totalFail = 0;

const c = await connectPage();
const idxs = ONLY || COURSES.map((_, i) => i);

for (const i of idxs) {
  const co = COURSES[i];
  const url = `https://xidianyjs.yuketang.cn/pro/lms/${co.cid}/${co.rid}/studycontent`;
  log(`\n=== [${i}] ${co.name} ===`);
  await navigate(c, url, 45000);
  await sleep(2000);
  await waitDirectory(c);

  let ok = 0, fail = 0, already = 0, skipped = [];
  const tried = new Map();   // key: 目录索引
  const postedNodes = new Set(); // key: forum node_id，防重复

  for (let round = 0; round < MAX; round++) {
    let items = [];
    try { items = JSON.parse(await evalJs(c, COLLECT)); } catch { items = []; }
    const todo = items.filter((x) => x.st === '未发言' && (tried.get(x.idx) || 0) < 2);
    if (!todo.length) {
      const left = items.filter((x) => x.st === '未发言').length;
      if (left) log(`  剩余 ${left} 条多次尝试未成功，放弃`);
      break;
    }
    const item = todo[0];
    tried.set(item.idx, (tried.get(item.idx) || 0) + 1);

    const before = new Set((await listTargets()).filter((t) => t.type === 'page').map((t) => t.id));
    const clicked = await evalJs(c, `(()=>{
      const el=[...document.querySelectorAll('.leaf-detail')][${item.idx}];
      if(!el) return false;
      el.scrollIntoView({block:'center'});
      el.click();
      return true;
    })()`);
    if (!clicked) { log(`  ✗ 找不到条目 ${item.title}`); fail++; await sleep(800); continue; }

    const target = await waitNewTarget(before, (u) => u.includes('/forum/'));
    if (!target) { log(`  ✗ 未打开讨论页 ${item.title}`); fail++; await reloadDir(c); continue; }
    const nodeId = ((target.url || '').match(/forum\/(\d+)/) || [])[1] || target.id;
    if (postedNodes.has(nodeId)) {
      log(`  ⚠ ${item.title}｜node ${nodeId} 已处理过，跳过`);
      await closeTarget(target.id); await sleep(1000); await reloadDir(c); continue;
    }
    postedNodes.add(nodeId);
    await sleep(2200);

    const d = await connectPage('forum/');
    let info;
    try {
      info = JSON.parse(await evalJs(d, `(()=>{
        const title=(document.querySelector('.main-text-attachment')?.innerText||'').trim();
        const cs=[...document.querySelectorAll('.comment-text')].map(e=>(e.innerText||'').trim());
        const authors=[...document.querySelectorAll('.comment-header')].map(e=>(e.innerText||'').trim().split('\\n')[0]);
        return JSON.stringify({title,count:cs.length,comments:cs,authors});
      })()`));
    } catch (e) {
      log(`  ✗ 读取失败 ${item.title}: ${e.message}`);
      fail++; d.close(); await closeTarget(target.id); await reloadDir(c); continue;
    }

    // 防御：讨论里已有本人发言 → 说明其实已完成，不要再发
    const MY = MY_NAME;
    if ((info.authors || []).some((a) => a.includes(MY))) {
      log(`  ✓ 已有本人发言，跳过（${item.title}｜${info.title.slice(0, 20)}）`);
      already++;
      fs.appendFileSync(REC, JSON.stringify({ time: new Date().toISOString(), course: co.name, title: item.title, topic: info.title, len: 0, note: 'already' }) + '\n', 'utf8');
      d.close(); await closeTarget(target.id); await sleep(1000); await reloadDir(c); continue;
    }

    let usable = info.comments.filter((t) => t.length >= MIN_LEN);
    if (!usable.length) {
      // 评论可能是懒加载/虚拟列表，等一轮再读一次
      await sleep(2500);
      try {
        info = JSON.parse(await evalJs(d, `(()=>{
          const title=(document.querySelector('.main-text-attachment')?.innerText||'').trim();
          const cs=[...document.querySelectorAll('.comment-text')].map(e=>(e.innerText||'').trim());
          return JSON.stringify({title,count:cs.length,comments:cs});
        })()`));
      } catch {}
      usable = info.comments.filter((t) => t.length >= MIN_LEN);
    }
    if (!usable.length) {
      log(`  ⚠ ${item.title}｜「${info.title}」评论区无可复制内容(${info.comments.length}条)，跳过`);
      skipped.push({ title: item.title, topic: info.title, reason: 'no-usable-comment' });
      d.close(); await closeTarget(target.id); await reloadDir(c); continue;
    }

    const pick = usable[Math.floor(Math.random() * usable.length)];
    log(`  → ${item.title}｜${info.title.slice(0, 24)}｜${info.comments.length}条评论｜取${pick.length}字`);

    let success = false;
    try {
      await evalJs(d, `(()=>{
        const ta=document.querySelector('textarea.el-textarea__inner');
        if(!ta) return 'no-textarea';
        const setter=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set;
        setter.call(ta, ${JSON.stringify(pick)});
        ta.dispatchEvent(new Event('input',{bubbles:true}));
        ta.dispatchEvent(new Event('change',{bubbles:true}));
        ta.focus();
        return 'ok';
      })()`);
      await sleep(900);
      await evalJs(d, `(()=>{const b=document.querySelector('.prompt-send-btn');if(b)b.click();})()`);
      let toast = false;
      for (let k = 0; k < 12; k++) {
        await sleep(350);
        try {
          toast = await evalJs(d, `(document.body.innerText||'').includes('评论成功')`);
        } catch {}
        if (toast) break;
      }
      const r = JSON.parse(await evalJs(d, `(()=>{
        const t=document.querySelector('textarea.el-textarea__inner');
        const cs=[...document.querySelectorAll('.comment-text')].map(e=>(e.innerText||'').trim());
        return JSON.stringify({taLen:t?t.value.length:-1,count:cs.length,dup:cs.filter(x=>x.includes(${JSON.stringify(pick.slice(0, 30))})).length});
      })()`));
      success = r.taLen === 0 && (toast || r.dup >= 2);
      log(`  ${success ? '✓ 已发表' : '✗ 发表异常'} toast=${toast} taLen=${r.taLen} count=${r.count} dup=${r.dup}`);
    } catch (e) {
      log(`  ✗ 异常 ${e.message}`);
    }

    if (success) {
      ok++;
      fs.appendFileSync(REC, JSON.stringify({ time: new Date().toISOString(), course: co.name, title: item.title, topic: info.title, len: pick.length }) + '\n', 'utf8');
    } else fail++;

    d.close();
    try { await closeTarget(target.id); } catch {}
    await sleep(1200);
    await reloadDir(c);
  }

  const rest = (() => { try { return 0; } catch { return 0; } })();
  stats.push({ index: i, name: co.name, ok, fail, already, skipped: skipped.length, skippedList: skipped });
  totalOk += ok; totalFail += fail;
  log(`  —— ${co.name}：成功 ${ok}，已有发言 ${already}，失败 ${fail}，跳过 ${skipped.length}`);
}

fs.writeFileSync(`${OUT}/disc-report.json`, JSON.stringify({ stats, totalOk, totalFail, time: new Date().toISOString() }, null, 1), 'utf8');
log(`\n=== 全部结束：成功 ${totalOk}，失败 ${totalFail}`);
process.exit(0);
