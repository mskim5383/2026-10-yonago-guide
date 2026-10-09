// 미리보기: PDF 각 쪽을 PNG 로 렌더한다.
//   macOS: swift + PDFKit (build/render-pages.swift)
//   그 밖: pdfjs-dist + @napi-rs/canvas (pdfjs-dist 의 선택 의존성)
//
//   node build/render-pages.mjs                       dist A5 → qa/pages/p-001.png …, dist 중철 → qa/booklet/b-001.png …
//   node build/render-pages.mjs <in.pdf> <outDir> [--dpi 110] [--prefix p] [--first 1 --last 8]
//   옵션: --out <distDir>  --qa <qaDir>  --no-booklet
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT, parseArgs, resolveFromRoot, exists, ensureDir, isMain } from './lib/util.mjs';

function clean(dir, prefix) {
  if (!exists(dir)) return;
  for (const f of fs.readdirSync(dir)) if (new RegExp(`^${prefix}-\\d{3}\\.png$`).test(f)) fs.rmSync(path.join(dir, f));
}

function hasSwift() {
  if (process.platform !== 'darwin') return false;
  const r = spawnSync('swift', ['--version'], { encoding: 'utf8' });
  return r.status === 0;
}

async function renderWithPdfjs(pdfPath, outDir, { dpi, prefix, first, last }) {
  const { createCanvas } = await import('@napi-rs/canvas');
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const base = path.join(ROOT, 'node_modules', 'pdfjs-dist');
  const task = pdfjs.getDocument({
    data: new Uint8Array(fs.readFileSync(pdfPath)),
    cMapUrl: path.join(base, 'cmaps') + path.sep, cMapPacked: true,
    standardFontDataUrl: path.join(base, 'standard_fonts') + path.sep, verbosity: 0,
  });
  const doc = await task.promise;
  const end = Math.min(last || doc.numPages, doc.numPages);
  let n = 0;
  for (let i = first || 1; i <= end; i++) {
    const page = await doc.getPage(i);
    const vp = page.getViewport({ scale: dpi / 72 });
    const canvas = createCanvas(Math.round(vp.width), Math.round(vp.height));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: vp, canvas }).promise;
    fs.writeFileSync(path.join(outDir, `${prefix}-${String(i).padStart(3, '0')}.png`), await canvas.encode('png'));
    n++;
  }
  await task.destroy();
  return n;
}

export async function renderPages(pdfPath, outDir, { dpi = 110, prefix = 'p', first, last } = {}) {
  ensureDir(outDir);
  clean(outDir, prefix);
  if (hasSwift()) {
    const tmp = fs.mkdtempSync(path.join(outDir, '.render-'));
    const r = spawnSync('swift', [path.join(ROOT, 'build', 'render-pages.swift'), pdfPath, tmp, String(dpi), String(first || 1), String(last || 9999)], { encoding: 'utf8' });
    if (r.status === 0) {
      let n = 0;
      for (const f of fs.readdirSync(tmp)) {
        const m = f.match(/^p-(\d{3})\.png$/);
        if (!m) continue;
        fs.renameSync(path.join(tmp, f), path.join(outDir, `${prefix}-${m[1]}.png`));
        n++;
      }
      fs.rmSync(tmp, { recursive: true, force: true });
      return { n, via: 'PDFKit' };
    }
    fs.rmSync(tmp, { recursive: true, force: true });
    console.warn(`  ! swift 렌더 실패, pdf.js 로 전환: ${(r.stderr || '').split('\n')[0]}`);
  }
  return { n: await renderWithPdfjs(pdfPath, outDir, { dpi, prefix, first, last }), via: 'pdf.js' };
}

async function main() {
  const args = parseArgs();
  const dpi = Number(args.dpi || 110);
  const first = args.first ? Number(args.first) : undefined;
  const last = args.last ? Number(args.last) : undefined;
  if (args._.length >= 2) {
    const r = await renderPages(resolveFromRoot(args._[0]), resolveFromRoot(args._[1]), { dpi, prefix: args.prefix || 'p', first, last });
    console.log(`${r.n}쪽 렌더 (${r.via}) → ${args._[1]}`);
    return;
  }
  const book = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'book.json'), 'utf8'));
  const dist = resolveFromRoot(args.out, 'dist');
  const qa = resolveFromRoot(args.qa, 'qa');
  const a5 = path.join(dist, book.output?.pdf || 'yonago-guide-a5.pdf');
  if (!exists(a5)) { console.error(`${path.relative(ROOT, a5)} 가 없습니다. 먼저 node build/build.mjs`); process.exit(1); }
  const r = await renderPages(a5, path.join(qa, 'pages'), { dpi, prefix: 'p', first, last });
  console.log(`A5 ${r.n}쪽 렌더 (${r.via}) → ${path.relative(ROOT, path.join(qa, 'pages'))}/p-001.png …`);
  const bk = path.join(dist, book.output?.booklet || 'yonago-guide-booklet-a4.pdf');
  if (!args['no-booklet'] && exists(bk)) {
    const r2 = await renderPages(bk, path.join(qa, 'booklet'), { dpi: Math.round(dpi * 0.6), prefix: 'b' });
    console.log(`A4 중철 ${r2.n}면 렌더 (${r2.via}) → ${path.relative(ROOT, path.join(qa, 'booklet'))}/b-001.png …`);
  }
}

if (isMain(import.meta.url)) main().catch((e) => { console.error(e); process.exit(1); });
