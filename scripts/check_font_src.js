(async () => {
  const d = document.querySelector('iframe').contentDocument;
  const out = { faces: [], fontsLoaded: [], sameple: null };
  for (const sh of Array.from(d.styleSheets)) {
    try {
      for (const r of Array.from(sh.cssRules || [])) {
        if (r.type === 5 || (r.constructor && r.constructor.name === 'CSSFontFaceRule')) {
          const fam = (r.style.fontFamily || '').replace(/["']/g, '');
          if (fam.includes('exam-data-decrypt')) {
            out.faces.push({ family: fam, src: r.style.src });
          }
        }
      }
    } catch (e) {}
  }
  // 也查主文档
  for (const sh of Array.from(document.styleSheets)) {
    try {
      for (const r of Array.from(sh.cssRules || [])) {
        if (r.type === 5) {
          const fam = (r.style.fontFamily || '').replace(/["']/g, '');
          if (fam.includes('exam-data-decrypt')) out.faces.push({ family: fam, src: r.style.src, where: 'top' });
        }
      }
    } catch (e) {}
  }
  out.fontsLoaded = Array.from(d.fonts).filter(f => f.family.includes('exam')).map(f => f.family + ' ' + f.status + ' ' + (f.variationSettings || ''));
  // 当前题第一个加密 span 的文本
  const sp = d.querySelector('span.xuetangx-com-encrypted-font');
  out.sample = sp ? sp.textContent : null;
  // 用 canvas 实测一个字符的像素，确认字体生效
  try {
    const cv = document.createElement('canvas');
    cv.width = 60; cv.height = 60;
    const g = cv.getContext('2d');
    g.font = '48px exam-data-decrypt-font';
    g.fillStyle = '#000';
    g.fillText('保', 4, 48);
    const px = g.getImageData(0, 0, 60, 60).data;
    let ink = 0;
    for (let i = 3; i < px.length; i += 4) if (px[i] > 40) ink++;
    out.canvasInk = ink;
  } catch (e) { out.canvasErr = String(e).slice(0, 80); }
  return JSON.stringify(out);
})()
