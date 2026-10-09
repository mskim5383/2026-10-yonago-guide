// 중철 임포지션 검증. 종이를 실제로 접는 과정을 흉내 내서, 접은 소책자를 넘기면 1, 2, 3, … 순서로
// 읽히는지 쪽번호로 확인한다.
//
// 물리 모델 (양면 인쇄 "짧은 쪽으로 넘기기"):
//   - A4 가로 종이를 좌우로 뒤집는다. 뒷면 PDF 의 x 는 실제 종이에서 W - x 위치(앞면 기준)에 놓인다.
//   - 모든 장을 앞면이 바깥으로 오게 반으로 접고, 1장(첫 장)이 가장 바깥이 되게 겹친다.
//   - 오른쪽 반쪽 낱장(바깥 → 안쪽 순): 앞면이 홀수쪽(recto), 그 뒷면이 짝수쪽(verso).
//   - 왼쪽 반쪽 낱장(안쪽 → 바깥 순): 뒷면(안쪽 면)이 recto, 앞면(바깥 면)이 verso.
//   - 뒷면 글자가 뒤집혀 있지 않은지(회전 0°)도 본다. 긴 쪽 넘기기로 뽑으면 이 가정이 깨진다.
//
// 1) 합성 테스트: 쪽마다 "PAGE-n" 을 찍은 A5 PDF(4·8·12·16·64·72쪽)를 만들어 impose() 결과를 검증.
// 2) 실물 테스트: dist 의 A5 PDF 와 A4 중철 PDF 가 있으면, 접은 순서로 읽은 각 반쪽의 텍스트가
//    A5 의 해당 쪽과 같은지, 쪽번호(폴리오)가 맞는지 확인.
//
// 사용: node build/test-imposition.mjs [--a5 path] [--booklet path] [--out distDir]
import fs from 'node:fs';
import path from 'node:path';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { impose, A4_LANDSCAPE } from './impose.mjs';
import { readPdfText } from './lib/pdftext.mjs';
import { ROOT, parseArgs, resolveFromRoot, exists, isMain } from './lib/util.mjs';

const MM = 72 / 25.4;

/** 중철 PDF 의 각 면 텍스트를 "접은 뒤 읽는 순서"로 늘어놓는다. 반환: [{page, pdfHalf, items, upright}] */
export function foldReadingOrder(bookletPages) {
  const [W] = A4_LANDSCAPE;
  const sheets = [];
  bookletPages.forEach((pg, k) => {
    const s = Math.floor(k / 2);
    const side = k % 2 === 0 ? 'front' : 'back';
    sheets[s] ||= { front: { L: [], R: [] }, back: { L: [], R: [] }, idx: {} };
    sheets[s].idx[side] = k;
    for (const it of pg.items) {
      if (!it.str.trim()) continue;
      const xc = it.x + (it.w || 0) / 2;
      const phys = side === 'front' ? xc : W - xc; // 짧은 쪽 넘기기: 뒷면은 좌우 거울
      sheets[s][side][phys >= W / 2 ? 'R' : 'L'].push({ ...it, pdfHalf: xc >= W / 2 ? 'R' : 'L' });
    }
  });
  // 지도 라벨처럼 일부러 돌린 글자가 있을 수 있어, 대부분(80%)이 바로 서 있으면 바로 선 것으로 본다.
  const isUpright = (items) => !items.length || items.filter((it) => Math.abs(it.rot) < 1).length / items.length >= 0.8;
  const face = (s, side, half) => ({
    page: sheets[s].idx[side], side, physHalf: half, items: sheets[s][side][half],
    upright: isUpright(sheets[s][side][half]),
  });
  const seq = [];
  for (let s = 0; s < sheets.length; s++) { seq.push(face(s, 'front', 'R')); seq.push(face(s, 'back', 'R')); }
  for (let s = sheets.length - 1; s >= 0; s--) { seq.push(face(s, 'back', 'L')); seq.push(face(s, 'front', 'L')); }
  return seq;
}

async function syntheticA5(n) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= n; i++) {
    const p = doc.addPage([148 * MM, 210 * MM]);
    const label = `PAGE-${i}`;
    p.drawText(label, { x: (p.getWidth() - font.widthOfTextAtSize(label, 30)) / 2, y: p.getHeight() / 2, size: 30, font });
    // 바깥쪽 아래 모서리 폴리오(홀수=오른쪽, 짝수=왼쪽)
    const fx = i % 2 ? p.getWidth() - 14 * MM : 12 * MM;
    p.drawText(String(i), { x: fx, y: 9 * MM, size: 8, font });
  }
  return doc.save();
}

async function testSynthetic(n) {
  const a5 = await syntheticA5(n);
  const { bytes, pages } = await impose(a5);
  const booklet = await readPdfText(bytes);
  const errs = [];
  if (booklet.length !== pages / 2) errs.push(`면 수 ${booklet.length} ≠ ${pages / 2}`);
  for (const pg of booklet) {
    if (Math.abs(pg.width - A4_LANDSCAPE[0]) > 1 || Math.abs(pg.height - A4_LANDSCAPE[1]) > 1) {
      errs.push(`${pg.num}면 크기 ${pg.width.toFixed(1)}×${pg.height.toFixed(1)} (A4 가로 아님)`);
    }
  }
  const seq = foldReadingOrder(booklet);
  const read = seq.map((f) => {
    const m = f.items.map((it) => it.str).join(' ').match(/PAGE-(\d+)/);
    return m ? Number(m[1]) : null;
  });
  const expected = Array.from({ length: n }, (_, i) => i + 1);
  if (read.join(',') !== expected.join(',')) errs.push(`접은 순서 ${read.join(',')} ≠ 1..${n}`);
  seq.forEach((f, i) => {
    if (!f.upright) errs.push(`${i + 1}쪽 글자가 회전돼 있음`);
    const folio = f.items.filter((it) => /^\d+$/.test(it.str.trim()) && it.y < 20 * MM).map((it) => Number(it.str));
    if (folio.length && folio[0] !== i + 1) errs.push(`${i + 1}쪽 자리 폴리오가 ${folio[0]}`);
  });
  return { n, ok: errs.length === 0, errs, read };
}

const norm = (s) => s.replace(/\s+/g, '');

export async function testReal(a5Path, bookletPath) {
  const a5 = await readPdfText(fs.readFileSync(a5Path));
  const booklet = await readPdfText(fs.readFileSync(bookletPath));
  const errs = [];
  const n = a5.length;
  if (n % 4) errs.push(`A5 쪽수 ${n} 이 4의 배수가 아님`);
  if (booklet.length * 2 !== n) errs.push(`중철 ${booklet.length}면 × 2 ≠ A5 ${n}쪽`);
  const seq = foldReadingOrder(booklet);
  let textChecked = 0, folioChecked = 0;
  seq.forEach((f, i) => {
    const want = a5[i];
    if (!want) return;
    const got = norm(f.items.map((it) => it.str).join(''));
    const exp = norm(want.text);
    if (got !== exp) {
      // 같은 글자 묶음인지(순서만 다름) 한 번 더 본다.
      const sort = (s) => [...s].sort().join('');
      if (sort(got) !== sort(exp)) errs.push(`${i + 1}쪽: 접은 위치의 내용이 A5 ${i + 1}쪽과 다름 ("${got.slice(0, 24)}" vs "${exp.slice(0, 24)}")`);
    }
    if (exp) textChecked++;
    if (!f.upright) errs.push(`${i + 1}쪽 글자가 회전돼 있음`);
    // 폴리오: 반쪽 아래 18mm 안의 숫자만 있는 조각
    const folio = f.items.filter((it) => /^\d{1,3}$/.test(it.str.trim()) && it.y < 18 * MM).map((it) => Number(it.str.trim()));
    if (folio.length) {
      folioChecked++;
      if (!folio.includes(i + 1)) errs.push(`${i + 1}쪽 자리에 폴리오 ${folio.join('/')}`);
    }
  });
  return { ok: errs.length === 0, errs, pages: n, textChecked, folioChecked };
}

async function main() {
  const args = parseArgs();
  let failed = false;
  for (const n of [4, 8, 12, 16, 64, 72]) {
    const r = await testSynthetic(n);
    console.log(`${r.ok ? 'PASS' : 'FAIL'} 합성 ${String(n).padStart(2)}쪽${r.ok ? '' : ': ' + r.errs.slice(0, 4).join(' / ')}`);
    if (!r.ok) failed = true;
  }
  const book = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'book.json'), 'utf8'));
  const dist = resolveFromRoot(args.out, 'dist');
  const a5 = resolveFromRoot(args.a5, path.join(dist, book.output?.pdf || 'yonago-guide-a5.pdf'));
  const bk = resolveFromRoot(args.booklet, path.join(dist, book.output?.booklet || 'yonago-guide-booklet-a4.pdf'));
  if (exists(a5) && exists(bk)) {
    const r = await testReal(a5, bk);
    console.log(`${r.ok ? 'PASS' : 'FAIL'} 실물 ${path.relative(ROOT, bk)}: ${r.pages}쪽, 내용 대조 ${r.textChecked}쪽, 폴리오 대조 ${r.folioChecked}쪽`);
    for (const e of r.errs.slice(0, 20)) console.log(`  - ${e}`);
    if (!r.ok) failed = true;
  } else {
    console.log(`SKIP 실물 테스트 (${path.relative(ROOT, exists(a5) ? bk : a5)} 없음)`);
  }
  process.exit(failed ? 1 : 0);
}

if (isMain(import.meta.url)) main().catch((e) => { console.error(e); process.exit(1); });
