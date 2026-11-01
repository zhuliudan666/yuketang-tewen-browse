import fs from 'node:fs';
import { connectPage, evalJs, sleep } from './cdp.mjs';

// 工作目录：$YUKETANG_BASE，缺省用当前目录（与 build_bank2.py / make_bank.py 一致）
const BASE = process.env.YUKETANG_BASE || process.cwd();
const PAPERS = process.env.PAPERS ? JSON.parse(process.env.PAPERS) : null;
const OUT = process.env.OUT || `${BASE}/collector.json`;

const c = await connectPage('yuketang');
await c.send('Page.bringToFront');
await sleep(400);

async function storeReady() {
  const raw = await evalJs(c, `(() => {
    const f = document.querySelector('iframe');
    if (!f || !f.contentDocument) return JSON.stringify({ st: 'noiframe' });
    const app = f.contentDocument.querySelector('#app');
    const v = app && app.__vue__;
    if (!v || !v.$store || !v.$store.state.cloud) return JSON.stringify({ st: 'nostore' });
    const ex = v.$store.state.cloud.exerciseList;
    if (!ex || !Array.isArray(ex.problems) || !ex.problems.length) return JSON.stringify({ st: 'noex' });
    return JSON.stringify({ st: 'ok', name: ex.name || ex.title, n: ex.problems.length, url: location.href });
  })()`);
  return JSON.parse(raw);
}

async function openPaper(title) {
  const before = await evalJs(c, 'location.href');
  // 先确保目录项可见（若已展开）
  const pos = JSON.parse(await evalJs(c, `(() => {
    const t = ${JSON.stringify(title)};
    let el = null;
    document.querySelectorAll('.leaf-item-title').forEach(e => { if ((e.innerText||'').trim() === t) el = e; });
    if (!el) return JSON.stringify({ err: 'notfound' });
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    return JSON.stringify({ x: r.x + r.width/2, y: r.y + r.height/2 });
  })()`));
  if (pos.err) return { err: pos.err };
  await sleep(450);
  const pos2 = JSON.parse(await evalJs(c, `(() => {
    const t = ${JSON.stringify(title)};
    let el = null;
    document.querySelectorAll('.leaf-item-title').forEach(e => { if ((e.innerText||'').trim() === t) el = e; });
    const r = el.getBoundingClientRect();
    return JSON.stringify({ x: r.x + r.width/2, y: r.y + r.height/2 });
  })()`));
  for (const t of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
    await c.send('Input.dispatchMouseEvent', {
      type: t, x: Math.round(pos2.x), y: Math.round(pos2.y),
      button: t === 'mouseMoved' ? 'none' : 'left', clickCount: t === 'mouseMoved' ? 0 : 1,
    });
    await sleep(100);
  }
  for (let k = 0; k < 30; k++) {
    await sleep(600);
    const o = await storeReady();
    if (o.st === 'ok' && o.url !== before && o.name && o.name.includes(title.slice(0, 3))) return o;
    if (k === 29) return { ...o, warn: 'timeout' };
  }
}

async function dumpProblem(i) {
  const raw = await evalJs(c, `(() => {
    const d = document.querySelector('iframe').contentDocument;
    const app = d.querySelector('#app').__vue__;
    const st = app.$store.state.cloud.exerciseList;
    const p = st.problems[${i}];
    p && app.$store.dispatch('cloud/setProblem', p);
    return JSON.stringify({ ok: !!p });
  })()`);
  await sleep(950);
  const raw2 = await evalJs(c, `(() => {
    const d = document.querySelector('iframe').contentDocument;
    const app = d.querySelector('#app').__vue__;
    const st = app.$store.state.cloud.exerciseList;
    const p = st.problems[${i}];
    if (!p) return JSON.stringify({ err: 'nop' });
    const ct = p.content || {};
    const body = d.body.innerText || '';
    const lines = body.split('\\n').map(s => s.trim()).filter(Boolean);
    const an = lines.find(l => l.includes('正确答案'));
    return JSON.stringify({
      type: ct.Type || '',
      typeText: ct.TypeText || '',
      score: ct.Score,
      difficulty: ct.difficulty,
      bodyHtml: ct.Body || '',
      options: (ct.Options || []).map(o => ({ key: o.key, html: o.value })),
      correct: an ? an.split(/[:：]/).pop().trim() : '',
      myAnswer: p._answer === undefined ? null : p._answer,
      isRight: p._isRight,
      submitStatus: p._submitStatus,
      problemId: ct.ProblemID || ct.problem_id
    });
  })()`);
  return JSON.parse(raw2);
}

const result = [];
for (const title of PAPERS) {
  process.stderr.write(`OPEN ${title}\n`);
  const info = await openPaper(title);
  if (!info || info.st !== 'ok') { process.stderr.write(`  FAIL ${JSON.stringify(info)}\n`); continue; }
  // 立即抓当前生效的混淆字体地址（每套卷可能不同）
  const fontSrcRaw = await evalJs(c, `(() => {
    const d = document.querySelector('iframe').contentDocument;
    const hits = [];
    const scan = (sheets) => {
      for (const sh of Array.from(sheets)) {
        try {
          for (const r of Array.from(sh.cssRules || [])) {
            if (r.type === 5) {
              const fam = (r.style.fontFamily || '').replace(/["']/g, '');
              if (fam.indexOf('exam-data-decrypt') >= 0) hits.push(r.style.src);
            }
          }
        } catch (e) {}
      }
    };
    scan(d.styleSheets);
    scan(document.styleSheets);
    return hits.join('|');
  })()`);
  const fm = String(fontSrcRaw).match(/https:\/\/[^"')]+\.ttf/);
  const fontSrc = fm ? fm[0] : '';
  process.stderr.write(`  font=${fontSrc}\n`);
  process.stderr.write(`  ok n=${info.n}\n`);
  const probs = [];
  for (let i = 0; i < info.n; i++) {
    const d = await dumpProblem(i);
    probs.push({ no: i + 1, ...d });
    process.stderr.write(`  Q${i + 1} ${d.typeText || ''} correct=${d.correct} mine=${JSON.stringify(d.myAnswer)} right=${d.isRight}\n`);
  }
  result.push({ name: title, url: info.url, fontSrc, n: info.n, problems: probs });
}
fs.writeFileSync(OUT, JSON.stringify(result, null, 1), 'utf-8');
process.stderr.write(`SAVED ${OUT} papers=${result.length}\n`);
c.close();
process.exit(0);
