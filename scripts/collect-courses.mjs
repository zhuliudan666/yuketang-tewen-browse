// 收集「我的课」列表，生成 courses.json（供 discussion.mjs / 图文浏览使用）
// 用法：SITE=https://xidianyjs.yuketang.cn node scripts/collect-courses.mjs
import fs from 'node:fs';
import path from 'node:path';
import { connectPage, evalJs, navigate, sleep } from './cdp.mjs';

const SITE = process.env.SITE || 'https://xidianyjs.yuketang.cn';
const LIST = `${SITE}/pro/courselist`;
const OUT = process.env.DISC_OUT || path.join(process.cwd(), 'out');
fs.mkdirSync(OUT, { recursive: true });

const c = await connectPage();
await navigate(c, LIST);
await sleep(2500);

const names = await evalJs(c, `(()=>{
  const cards=[...document.querySelectorAll('.lesson-cardS')];
  const seen=[];
  cards.forEach(el=>{
    const name=((el.innerText||'').split('\\n')[0]||'').trim();
    if(name && !seen.includes(name)) seen.push(name);
  });
  return seen;
})()`);
console.log('课程数', names.length);

const result = [];
for (let i = 0; i < names.length; i++) {
  await navigate(c, LIST);
  await sleep(2200);
  const r = await evalJs(c, `(async()=>{
    const el=[...document.querySelectorAll('.lesson-cardS')][${i}];
    if(!el) return {url:''};
    el.click();
    await new Promise(r=>setTimeout(r,3500));
    return {url: location.href};
  })()`);
  const m = (r.url || '').match(/\/pro\/lms\/([^/]+)\/(\d+)/);
  result.push({ name: names[i], cid: m ? m[1] : null, rid: m ? m[2] : null, url: r.url });
  console.log(i, names[i], m ? `${m[1]}/${m[2]}` : '未取到 id');
}

fs.writeFileSync(path.join(OUT, 'courses.json'), JSON.stringify(result, null, 1), 'utf8');
console.log('已保存', path.join(OUT, 'courses.json'), '有效', result.filter((x) => x.cid).length, '门');
c.close();
process.exit(0);
