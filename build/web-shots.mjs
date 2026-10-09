// 웹 미리보기: dist/index.html 을 390×844(모바일), 1280×900(데스크톱)으로 찍는다.
//   qa/web/mobile-00-top.png, mobile-NN-<원고id>.png, desktop-…  + 가로 넘침 검사(qa/web/overflow.json)
//
//   node build/web-shots.mjs [--out distDir] [--qa qaDir] [--sections all|none]
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, parseArgs, resolveFromRoot, exists, ensureDir, isMain } from './lib/util.mjs';
import { serve } from './lib/server.mjs';
import { launchChrome } from './print.mjs';

const VIEWS = [
  { name: 'mobile', width: 390, height: 844, dpr: 2, mobile: true },
  { name: 'desktop', width: 1280, height: 900, dpr: 1, mobile: false },
];

export async function webShots({ dist, outDir, sections = 'all' }) {
  ensureDir(outDir);
  for (const f of fs.readdirSync(outDir)) if (/^(mobile|desktop)-.*\.png$/.test(f)) fs.rmSync(path.join(outDir, f));
  const srv = await serve(dist);
  const browser = await launchChrome();
  const report = {};
  try {
    for (const v of VIEWS) {
      const page = await browser.newPage();
      await page.setViewport({ width: v.width, height: v.height, deviceScaleFactor: v.dpr, isMobile: v.mobile, hasTouch: v.mobile });
      await page.emulateMediaType('screen');
      await page.goto(srv.url + 'index.html', { waitUntil: 'networkidle0', timeout: 120000 });
      await page.evaluate(async () => {
        document.documentElement.style.scrollBehavior = 'auto';
        for (const img of document.querySelectorAll('img[loading="lazy"]')) img.loading = 'eager';
        await Promise.all([...document.images].map((i) => (i.complete ? null : new Promise((r) => { i.onload = i.onerror = r; }))));
        await document.fonts.ready;
      });
      // 가로 넘침: 문서 폭과, 화면 밖으로 삐져나간 요소(스크롤 상자 안쪽은 제외)
      report[v.name] = await page.evaluate(() => {
        const vw = document.documentElement.clientWidth;
        const sw = document.documentElement.scrollWidth;
        const offenders = [];
        const inScroller = (el) => { for (let p = el.parentElement; p; p = p.parentElement) { const s = getComputedStyle(p); if (/(auto|scroll|hidden)/.test(s.overflowX)) return true; } return false; };
        for (const el of document.querySelectorAll('body *')) {
          const r = el.getBoundingClientRect();
          if (!r.width || getComputedStyle(el).display === 'none') continue;
          if (r.right > vw + 1 && !inScroller(el)) {
            offenders.push(`${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : ''} → ${Math.round(r.right)}px`);
          }
        }
        return { viewport: vw, scrollWidth: sw, overflow: sw > vw, offenders: offenders.slice(0, 30) };
      });
      await page.screenshot({ path: path.join(outDir, `${v.name}-00-top.png`) });
      if (sections !== 'none') {
        const ids = await page.evaluate(() => [...document.querySelectorAll('main > section')]
          .filter((s) => getComputedStyle(s).display !== 'none' && s.id)
          .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)
          .map((s) => s.id));
        let i = 0;
        for (const id of ids) {
          await page.evaluate((x) => { const el = document.getElementById(x); window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 56); }, id);
          await new Promise((r) => setTimeout(r, 60));
          await page.screenshot({ path: path.join(outDir, `${v.name}-${String(++i).padStart(2, '0')}-${id}.png`) });
        }
      }
      await page.close();
    }
  } finally {
    await browser.close();
    await srv.close();
  }
  fs.writeFileSync(path.join(outDir, 'overflow.json'), JSON.stringify(report, null, 2) + '\n');
  return report;
}

async function main() {
  const args = parseArgs();
  const dist = resolveFromRoot(args.out, 'dist');
  const qa = resolveFromRoot(args.qa, 'qa');
  if (!exists(path.join(dist, 'index.html'))) { console.error('dist/index.html 이 없습니다. 먼저 node build/build.mjs'); process.exit(1); }
  const outDir = path.join(qa, 'web');
  const r = await webShots({ dist, outDir, sections: args.sections || 'all' });
  for (const [k, v] of Object.entries(r)) {
    console.log(`${k} ${v.viewport}px: 가로 스크롤 ${v.overflow ? `있음 (문서 폭 ${v.scrollWidth}px)` : '없음'}${v.offenders.length ? ` · 넘친 요소 ${v.offenders.length}개` : ''}`);
    for (const o of v.offenders.slice(0, 8)) console.log(`  - ${o}`);
  }
  console.log(`스크린샷 → ${path.relative(ROOT, outDir)}/`);
}

if (isMain(import.meta.url)) main().catch((e) => { console.error(e); process.exit(1); });
