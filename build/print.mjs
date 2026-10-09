// 인쇄: puppeteer-core 로 설치된 Chrome 을 띄워 print 미디어로 A5 PDF 를 만든다.
// 모듈로는 launchChrome / printPdf 를 내보내고,
// 단독 실행(node build/print.mjs [distDir])은 이미 만들어진 dist/index.html 을 한 번만 출력한다.
// (목차 쪽번호·쪽수 맞춤까지 하려면 node build/build.mjs)
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { PDFDocument } from 'pdf-lib';
import { CHROME_PATH, ROOT, parseArgs, resolveFromRoot, exists, isMain } from './lib/util.mjs';
import { serve } from './lib/server.mjs';

export async function launchChrome() {
  if (!exists(CHROME_PATH)) {
    throw new Error(`Chrome 을 찾지 못했습니다: ${CHROME_PATH} (CHROME_PATH 환경변수로 지정)`);
  }
  return puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: ['--no-first-run', '--no-default-browser-check', '--disable-extensions', '--font-render-hinting=none', '--hide-scrollbars'],
  });
}

/** 페이지를 print 미디어로 열고, 이미지·폰트가 다 준비된 뒤 PDF 버퍼를 돌려준다. */
export async function printPdf(browser, url, { outline = true } = {}) {
  const page = await browser.newPage();
  try {
    await page.emulateMediaType('print');
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 180000 });
    await page.evaluate(async () => {
      for (const img of document.querySelectorAll('img[loading="lazy"]')) img.loading = 'eager';
      await Promise.all([...document.images].map((img) => (img.complete && img.naturalWidth ? null
        : new Promise((r) => { img.addEventListener('load', r, { once: true }); img.addEventListener('error', r, { once: true }); }))));
      await document.fonts.ready;
    });
    // 인쇄 레이아웃에서만 쓰이는 글자(인쇄 전용 쪽)의 폰트 조각까지 받도록 한 번 더 기다린다.
    await new Promise((r) => setTimeout(r, 150));
    await page.evaluate(() => document.fonts.ready);
    const failed = await page.evaluate(() => [...document.fonts].filter((f) => f.status === 'error').map((f) => `${f.family} ${f.weight}`));
    if (failed.length) console.warn(`  ! 폰트 로딩 실패: ${[...new Set(failed)].join(', ')}`);
    const opts = { preferCSSPageSize: true, printBackground: true, displayHeaderFooter: false, timeout: 300000 };
    try {
      return Buffer.from(await page.pdf({ ...opts, tagged: true, outline }));
    } catch (e) {
      if (!outline) throw e;
      return Buffer.from(await page.pdf(opts));
    }
  } finally {
    await page.close();
  }
}

// Chrome 은 A5 를 420 × 594.96pt(148.17 × 209.89mm)로 내보낸다. 인쇄소용으로 쪽 크기를 정확한 A5
// (419.53 × 595.28pt)로 맞춘다. 내용은 가로 0.11%, 세로 0.05% 늘이거나 줄여 그대로 덮는다(표지 사진 가장자리 포함).
export const A5_PT = [419.53, 595.28];
export async function normalizePageSize(buf, [w, h] = A5_PT) {
  const doc = await PDFDocument.load(buf, { updateMetadata: false });
  let changed = 0;
  for (const page of doc.getPages()) {
    const { width, height } = page.getSize();
    if (Math.abs(width - w) > 0.01 || Math.abs(height - h) > 0.01) { page.scale(w / width, h / height); changed++; }
    page.setMediaBox(0, 0, w, h);
    page.setCropBox(0, 0, w, h);
    page.setTrimBox(0, 0, w, h);
    page.setBleedBox(0, 0, w, h);
  }
  return { bytes: Buffer.from(await doc.save()), changed };
}

async function main() {
  const args = parseArgs();
  const dist = resolveFromRoot(args._[0] || args.out, 'dist');
  const book = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'book.json'), 'utf8'));
  const html = path.join(dist, 'index.html');
  if (!exists(html)) { console.error(`${html} 가 없습니다. 먼저 node build/build.mjs`); process.exit(1); }
  const srv = await serve(dist);
  const browser = await launchChrome();
  try {
    const buf = await printPdf(browser, srv.url + 'index.html');
    const out = path.join(dist, book.output?.pdf || 'yonago-guide-a5.pdf');
    fs.writeFileSync(out, buf);
    console.log(`PDF: ${path.relative(ROOT, out)} (${(buf.length / 1024 / 1024).toFixed(1)}MB)`);
  } finally {
    await browser.close();
    await srv.close();
  }
}

if (isMain(import.meta.url)) main().catch((e) => { console.error(e); process.exit(1); });
