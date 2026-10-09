// 빌드: 원고 조립 → dist/index.html → (2-pass 인쇄) A5 PDF → A4 중철 PDF → 접는 순서 검증
//
//   node build/build.mjs                 전체 (웹 + A5 PDF + A4 중철 PDF)
//   node build/build.mjs --html-only     웹 HTML 만 (목차 쪽번호 없음)
//
// 옵션: --parts <dir>  원고 폴더(기본 src/parts)     --front <dir>  앞뒤 페이지(기본 src/front)
//       --assets <dir> 사진·지도(기본 assets)        --out <dir>    출력(기본 dist)
//       --book <file>  원고 순서(기본 src/book.json)  --report <file> 빌드 보고서(기본 qa/build-report.json)
//       --no-booklet   중철 PDF 생략                  --keep-pass    인쇄 패스용 _pass.html 남기기
//
// 인쇄 패스(최대 6회):
//   1) 원고마다 보이지 않는 앵커 글자를 심어 PDF 를 만들고, pdfjs 로 각 원고가 시작하는 쪽을 찾는다.
//   2) "start": "recto" 인 묶음의 첫 원고가 짝수(왼쪽) 쪽에서 시작하면 바로 앞에 메모 페이지를 끼운다.
//   3) 총 쪽수가 4의 배수가 되도록 뒤표지 앞 메모 페이지 수를 정한다.
//   4) 찾은 쪽번호를 목차에 넣고 다시 출력해 예측과 같아질 때까지 반복한다.
//   5) 앵커를 뺀 최종본을 dist/index.html 로 쓰고 그것을 그대로 인쇄한다(웹과 인쇄가 같은 파일).
import fs from 'node:fs';
import path from 'node:path';
import * as assembleMod from './lib/assemble.mjs';
const { assemble } = assembleMod;
import { writeFonts } from './lib/fonts.mjs';
import { readPdfText } from './lib/pdftext.mjs';
import { serve } from './lib/server.mjs';
import { ROOT, Log, parseArgs, resolveFromRoot, emptyDir, ensureDir, copyDir, exists, readText, isMain } from './lib/util.mjs';

const ANCHOR = /ZZA\[([^\]]+)\]ZZ/g;
const END = /ZZE\[([^\]]+)\]ZZ/g;
const LINE = /ZZL\[(\d+)\.(\d+)\]ZZ/g;

/**
 * 필기선 넘침 세기: 첫 줄과 다른 쪽에 놓인 줄 수. 원고 맨 끝 상자 안의 필기선이면
 * 줄은 다 들어갔는데 상자 아래 여백만 넘어간 경우(원고 끝 앵커가 마지막 줄보다 뒤 쪽)도 1줄로 센다.
 * @returns {Array<{k:number, over:number, lines:number, part:string}>}
 */
function memoOverflow(pages, memo) {
  const linePage = new Map(); // k → [page of row i]
  const endPage = {};
  for (const p of pages) {
    for (const m of p.text.matchAll(LINE)) {
      const k = Number(m[1]); const i = Number(m[2]);
      if (!linePage.has(k)) linePage.set(k, []);
      const arr = linePage.get(k);
      if (arr[i] == null) arr[i] = p.num;
    }
    for (const m of p.text.matchAll(END)) if (!(m[1] in endPage)) endPage[m[1]] = p.num;
  }
  const out = [];
  for (const mi of memo) {
    const rows = linePage.get(mi.k);
    if (!rows || rows[0] == null) continue;
    const p0 = rows[0];
    let over = rows.filter((pg) => pg != null && pg > p0).length;
    const last = rows[rows.length - 1];
    if (over === 0 && mi.tail && endPage[mi.part] && last != null && endPage[mi.part] > last) over = 1;
    if (over > 0) out.push({ k: mi.k, over, lines: mi.lines, part: mi.part, file: mi.file });
  }
  return out;
}

function sameMap(a = {}, b = {}) {
  const ka = Object.keys(a).filter((k) => a[k]);
  const kb = Object.keys(b).filter((k) => b[k]);
  return ka.length === kb.length && ka.every((k) => a[k] === b[k]);
}

export async function build(args = parseArgs()) {
  const t0 = Date.now();
  const log = new Log(args.quiet);
  const cfg = {
    bookDir: ROOT,
    bookPath: resolveFromRoot(args.book, 'src/book.json'),
    partsDir: resolveFromRoot(args.parts, 'src/parts'),
    frontDir: resolveFromRoot(args.front, 'src/front'),
    assetsDir: resolveFromRoot(args.assets, 'assets'),
    templatePath: resolveFromRoot(args.template, 'src/template.html'),
    stylePath: resolveFromRoot(args.style, 'src/style.css'),
    outDir: resolveFromRoot(args.out, 'dist'),
  };
  cfg.book = JSON.parse(readText(cfg.bookPath));
  const book = cfg.book;
  const out = cfg.outDir;
  const names = { html: book.output?.html || 'index.html', pdf: book.output?.pdf || 'yonago-guide-a5.pdf', booklet: book.output?.booklet || 'yonago-guide-booklet-a4.pdf' };
  const reportPath = resolveFromRoot(args.report, 'qa/build-report.json');
  console.log(`원고: ${path.relative(ROOT, cfg.partsDir)} · 출력: ${path.relative(ROOT, out) || '.'}`);

  // 1. 출력 폴더 준비, 자산 복사
  ensureDir(out);
  emptyDir(out);
  const nAssets = copyDir(cfg.assetsDir, path.join(out, 'assets'), { skip: (p) => p.endsWith('.md') });
  fs.copyFileSync(cfg.stylePath, path.join(out, 'assets', 'style.css'));

  // 2. 첫 조립(경고는 여기서만 모은다)
  const quiet = new Log(true);
  quiet.warn = () => {};
  const state = { markers: !args['html-only'], fillers: {}, endFillers: 0, pages: null, memoTrim: {} };
  let res = await assemble(cfg, state, log);
  const memoTpl = exists(path.join(cfg.frontDir, 'memo-page.html')) ? readText(path.join(cfg.frontDir, 'memo-page.html')) : '';
  const fonts = writeFonts(out, res.html + readText(cfg.stylePath) + memoTpl + res.info.pageRules, log);
  for (const lic of ['@fontsource/noto-sans-kr/LICENSE']) {
    const p = path.join(ROOT, 'node_modules', lic);
    if (exists(p)) fs.copyFileSync(p, path.join(out, 'assets', 'fonts', 'OFL.txt'));
  }
  // 책에 실리지 않은 사진(와 manifest)은 배포하지 않는다(웹 검수 r1: 안 쓰는 19장 7.2MB)
  const pruned = pruneImages(path.join(out, 'assets', 'img'), res.info.images, cfg.assetsDir, log);
  console.log(`조립: 원고 ${res.info.partOrder.length}편 · 사진 ${res.info.images.length} · 도판 ${res.info.svgCount} · 폰트 조각 ${fonts.files}개(${(fonts.bytes / 1024 / 1024).toFixed(1)}MB) · 자산 ${nAssets - pruned}개(안 쓰는 사진 ${pruned}개 뺌)`);
  const bigQr = (res.info.qr || []).filter((q) => q.v > 6);
  for (const q of bigQr) log.warn(`QR 버전 ${q.v}(${q.ec}): ${q.where} ${q.url.slice(0, 60)}… 인쇄에서 타일을 키웠습니다. 검색어나 URL 을 줄이면 작아집니다`);

  const report = { builtAt: new Date().toISOString(), partsDir: path.relative(ROOT, cfg.partsDir), parts: res.info.files, warnings: log.warnings,
    qr: (res.info.qr || []).map((q) => ({ part: q.where, version: q.v, ec: q.ec, url: q.url })) };

  if (args['html-only']) {
    res = await assemble(cfg, { ...state, markers: false }, quiet);
    fs.writeFileSync(path.join(out, names.html), res.html);
    console.log(`웹: ${path.relative(ROOT, path.join(out, names.html))} (PDF 생략)`);
    writeReport(reportPath, report);
    log.summary();
    return report;
  }

  // 3. 인쇄 패스
  const { launchChrome, printPdf } = await import('./print.mjs');
  const srv = await serve(out);
  const browser = await launchChrome();
  const passFile = path.join(out, '_pass.html');
  let pdfPages = null;
  try {
    let stable = false;
    let pass = 0;
    while (!stable && pass < 6) {
      pass++;
      if (pass > 1) res = await assemble(cfg, state, quiet);
      fs.writeFileSync(passFile, res.html);
      const pdf = await printPdf(browser, srv.url + '_pass.html', { outline: false });
      const pages = await readPdfText(pdf);
      const anchors = {};
      for (const p of pages) for (const m of p.text.matchAll(ANCHOR)) if (!(m[1] in anchors)) anchors[m[1]] = p.num;
      const missing = res.info.partOrder.filter((id) => !anchors[id]);
      if (missing.length && pass === 1) log.warn(`PDF 에서 시작 쪽을 못 찾은 원고: ${missing.join(', ')}`);
      const missingRef = (res.info.refTargets || []).filter((id) => !anchors[id]);
      if (missingRef.length && pass === 1) log.warn(`PDF 에서 쪽을 못 찾은 쪽 참조 대상: ${missingRef.join(', ')}`);

      // 필기선이 쪽 끝에서 넘치면 넘친 줄만큼 덜어 낸다(다음 패스에 반영). 한 줄도 안 들어가면 그대로 둔다.
      let memoChanged = false;
      // 원고 끝 메모(book.json tailMemo): 첫 줄이 앞 내용과 다른 쪽에서 시작하거나 min 줄도 안 남으면 뺀다
      state.memoDrop = state.memoDrop || {};
      const markPage = {};
      const firstLinePage = {};
      for (const p of pages) {
        for (const m of p.text.matchAll(/ZZM\[(\d+)\]ZZ/g)) if (!(m[1] in markPage)) markPage[m[1]] = p.num;
        for (const m of p.text.matchAll(LINE)) if (m[2] === '0' && !(m[1] in firstLinePage)) firstLinePage[m[1]] = p.num;
      }
      for (const mi of res.info.memo || []) {
        if (!mi.trailing || mi.dropped || state.memoDrop[mi.k]) continue;
        const a = markPage[mi.k]; const b = firstLinePage[mi.k];
        if (a && b && b > a) { state.memoDrop[mi.k] = true; memoChanged = true; console.log(`  원고 끝 메모 ${mi.file}: 남은 자리가 없어 뺌`); }
      }
      for (const o of memoOverflow(pages, res.info.memo || [])) {
        const mi = (res.info.memo || []).find((x) => x.k === o.k);
        if (mi?.trailing) {
          if (state.memoDrop[o.k]) continue;
          if (o.lines - o.over < (mi.min || 1)) { state.memoDrop[o.k] = true; memoChanged = true; console.log(`  원고 끝 메모 ${o.file}: ${o.lines - o.over}줄밖에 안 남아 뺌`); continue; }
        }
        if (o.lines - o.over < 1) {
          if (!state.memoWarned?.[o.k]) log.warn(`${o.file}: 필기선이 쪽 끝에서 ${o.over}줄 넘치는데 남길 줄이 없습니다(원고를 줄이거나 쪽나눔 힌트 필요)`);
          state.memoWarned = { ...(state.memoWarned || {}), [o.k]: true };
          continue;
        }
        state.memoTrim[o.k] = (state.memoTrim[o.k] || 0) + o.over;
        memoChanged = true;
        console.log(`  필기선 ${o.file}: 쪽 끝에서 ${o.over}줄 넘쳐 ${o.lines - o.over}줄로 줄임`);
      }

      let shift = 0;
      const fillers = { ...state.fillers };
      const predicted = {};
      // 원고와 쪽 참조 대상을 문서 순서로 본다. 대상 요소는 앞에 끼운 메모 쪽만큼 밀릴 뿐 장 시작 규칙은 없다.
      for (const id of res.info.anchorOrder || res.info.partOrder) {
        if (!anchors[id]) continue;
        let p = anchors[id] + shift;
        if (res.info.recto.has(id) && p % 2 === 0) {
          if ((fillers[id] || 0) > 0) { fillers[id]--; shift--; p--; } else { fillers[id] = (fillers[id] || 0) + 1; shift++; p++; }
        }
        predicted[id] = p;
      }
      const base = pages.length + shift - state.endFillers;
      const endFillers = (4 - (base % 4)) % 4;
      const nRecto = Object.values(fillers).reduce((a, b) => a + b, 0);
      console.log(`인쇄 패스 ${pass}: ${pages.length}쪽 → 장 시작 맞춤 메모 ${nRecto}쪽, 끝 메모 ${endFillers}쪽 → ${base + endFillers}쪽`);
      stable = !memoChanged && state.pages !== null && sameMap(fillers, state.fillers) && endFillers === state.endFillers && sameMap(predicted, state.pages);
      state.fillers = Object.fromEntries(Object.entries(fillers).filter(([, n]) => n > 0));
      state.endFillers = endFillers;
      state.pages = predicted;
      state.total = base + endFillers;
    }
    if (!stable) log.warn('인쇄 패스가 6회 안에 수렴하지 않았습니다(목차 쪽번호가 틀릴 수 있음)');

    // 4. 최종본: 앵커 없이 dist/index.html 을 쓰고 그대로 인쇄
    res = await assemble(cfg, { ...state, markers: false }, quiet);
    fs.writeFileSync(path.join(out, names.html), res.html);
    const raw = await printPdf(browser, srv.url + names.html, { outline: true });
    const { normalizePageSize } = await import('./print.mjs');
    const pdf = (await normalizePageSize(raw)).bytes;
    fs.writeFileSync(path.join(out, names.pdf), pdf);
    pdfPages = await readPdfText(pdf);
    const n = pdfPages.length;
    if (n !== state.total) log.warn(`최종 PDF ${n}쪽이 예측 ${state.total}쪽과 다릅니다`);
    if (n % 4) log.warn(`최종 PDF ${n}쪽이 4의 배수가 아닙니다`);
    // 각 원고 제목이 예측한 쪽에 있는지 가볍게 확인
    for (const [id, p] of Object.entries(state.pages)) {
      const title = (res.info.titles[id] || '').replace(/\s+/g, '').slice(0, 8);
      if (!title) continue;
      const pageText = (pdfPages[p - 1]?.text || '').replace(/\s+/g, '');
      if (!pageText.includes(title)) log.warn(`${id}: 제목 "${title}…" 이 ${p}쪽에서 안 보입니다`);
    }
    const max = book.pages?.max || 72;
    const target = book.pages?.target || 64;
    if (n > max) log.warn(`총 ${n}쪽이 최대 ${max}쪽을 넘습니다`);
    console.log(`A5 PDF: ${path.relative(ROOT, path.join(out, names.pdf))} · ${n}쪽 (목표 ${target}, 최대 ${max}) · ${(pdf.length / 1024 / 1024).toFixed(1)}MB`);
    const refSet = new Set(res.info.refTargets || []);
    const pick = (keep) => Object.fromEntries(Object.entries(state.pages).filter(([id]) => keep(refSet.has(id))));
    report.pages = { total: n, target, max, start: pick((r) => !r), refs: pick((r) => r), fillersBeforeRecto: state.fillers, endFillers: state.endFillers };
    report.memoLines = (res.info.memo || []).map((m) => ({ file: m.file, asked: m.asked, printed: m.lines, ...(m.trailing ? { tailMemo: true } : {}), ...(m.dropped ? { dropped: true } : {}) }));
    if (res.info.creditsDropped) console.log(`크레디트: 책에 안 실린 사진 ${res.info.creditsDropped}행을 뺐습니다`);
  } finally {
    await browser.close();
    await srv.close();
    if (!args['keep-pass'] && exists(passFile)) fs.rmSync(passFile);
  }

  // 5. 중철 임포지션 + 검증
  if (!args['no-booklet']) {
    const { impose } = await import('./impose.mjs');
    const { testReal } = await import('./test-imposition.mjs');
    const a5Path = path.join(out, names.pdf);
    const bkPath = path.join(out, names.booklet);
    const r = await impose(fs.readFileSync(a5Path), { title: `${book.title} (A4 중철)` });
    fs.writeFileSync(bkPath, r.bytes);
    console.log(`A4 중철: ${path.relative(ROOT, bkPath)} · ${r.pages / 2}면(${r.pages / 4}장, 양면 짧은 쪽 넘김)`);
    const t = await testReal(a5Path, bkPath);
    console.log(`접는 순서 검증: ${t.ok ? 'PASS' : 'FAIL'} (내용 대조 ${t.textChecked}쪽, 폴리오 대조 ${t.folioChecked}쪽)`);
    for (const e of t.errs.slice(0, 10)) log.warn(`중철 검증: ${e}`);
    report.imposition = { ok: t.ok, sheets: r.pages / 4, errors: t.errs };
  }

  report.warnings = log.warnings;
  writeReport(reportPath, report);
  console.log(`완료 (${((Date.now() - t0) / 1000).toFixed(1)}초)`);
  log.summary();
  return report;
}

/** dist/assets/img 에서 책에 쓰인 사진 파일만 남긴다. 지운 파일 수를 돌려준다. */
function pruneImages(imgDir, used, assetsDir, log) {
  if (!exists(imgDir)) return 0;
  const { loadManifest } = assembleMod;
  const manifest = loadManifest(assetsDir, log);
  const keep = new Set();
  for (const id of used) {
    const e = manifest.get(id);
    const f = e && (e.file || e.src || e.path || `${id}.jpg`).replace(/^assets\/img\//, '');
    if (f) keep.add(path.normalize(f));
  }
  let n = 0;
  const walk = (dir, rel = '') => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const r = path.join(rel, ent.name);
      const abs = path.join(dir, ent.name);
      if (ent.isDirectory()) { walk(abs, r); if (!fs.readdirSync(abs).length) fs.rmdirSync(abs); continue; }
      if (!keep.has(path.normalize(r))) { fs.rmSync(abs); n++; }
    }
  };
  walk(imgDir);
  return n;
}

function writeReport(p, report) {
  ensureDir(path.dirname(p));
  fs.writeFileSync(p, JSON.stringify(report, null, 2) + '\n');
  console.log(`보고서: ${path.relative(ROOT, p)}`);
}

if (isMain(import.meta.url)) build().catch((e) => { console.error(e); process.exit(1); });
