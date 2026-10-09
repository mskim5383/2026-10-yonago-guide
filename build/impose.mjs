// 임포지션: A5 낱장 PDF → A4 가로 한 면에 A5 두 쪽씩, 중철(saddle-stitch) 순서.
//
// 양면 인쇄 "짧은 쪽으로 넘기기(flip on short edge)" 기준. 가로로 놓인 종이를 좌우로 뒤집으면
// 앞면 오른쪽 반의 뒤가 뒷면 왼쪽 반이 된다. 그래서 뒷면은 회전 없이 아래 순서로 놓는다.
//
//   종이 i (0부터, 0이 가장 바깥 장), 총 N쪽(4의 배수):
//     앞면  왼쪽 = N - 2i       오른쪽 = 1 + 2i
//     뒷면  왼쪽 = 2 + 2i       오른쪽 = N - 1 - 2i
//
// 예) N=8: 1장 앞(8|1) 뒤(2|7), 2장 앞(6|3) 뒤(4|5)
//
// 사용: node build/impose.mjs [in.pdf] [out.pdf]   (기본값: dist 의 A5 → dist 의 booklet)
import fs from 'node:fs';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { ROOT, parseArgs, resolveFromRoot, isMain } from './lib/util.mjs';

export const A4_LANDSCAPE = [841.89, 595.28];

/** 1부터 세는 쪽번호 배치표. [{sheet, side:'front'|'back', left, right}] */
export function saddleOrder(n) {
  if (n % 4) throw new Error(`쪽수 ${n} 은 4의 배수가 아닙니다`);
  const out = [];
  for (let i = 0; i < n / 4; i++) {
    out.push({ sheet: i + 1, side: 'front', left: n - 2 * i, right: 1 + 2 * i });
    out.push({ sheet: i + 1, side: 'back', left: 2 + 2 * i, right: n - 1 - 2 * i });
  }
  return out;
}

/**
 * @param {Uint8Array|Buffer} srcBytes A5 낱장 PDF
 * @returns {Promise<{bytes: Uint8Array, pages: number, padded: number, layout: ReturnType<typeof saddleOrder>}>}
 */
export async function impose(srcBytes, { title } = {}) {
  const src = await PDFDocument.load(srcBytes);
  let n = src.getPageCount();
  const padded = (4 - (n % 4)) % 4;
  if (padded) {
    const [w, h] = [src.getPage(0).getWidth(), src.getPage(0).getHeight()];
    for (let i = 0; i < padded; i++) src.insertPage(n - 1, [w, h]); // 뒤표지 앞에 빈 쪽
    n += padded;
  }
  const out = await PDFDocument.create();
  out.setTitle(title || src.getTitle() || 'booklet');
  out.setCreator('build/impose.mjs (saddle-stitch, flip on short edge)');
  const embedded = await out.embedPages(src.getPages());
  const [W, H] = A4_LANDSCAPE;
  const layout = saddleOrder(n);
  for (const spread of layout) {
    const page = out.addPage([W, H]);
    for (const [slot, num] of [['left', spread.left], ['right', spread.right]]) {
      const e = embedded[num - 1];
      const s = Math.min((W / 2) / e.width, H / e.height);
      const w = e.width * s;
      const h = e.height * s;
      // 왼쪽 쪽은 접는 선(가운데)에 붙이고, 오른쪽 쪽도 접는 선에 붙인다.
      const x = slot === 'left' ? W / 2 - w : W / 2;
      page.drawPage(e, { x, y: (H - h) / 2, width: w, height: h });
    }
  }
  return { bytes: await out.save(), pages: n, padded, layout };
}

async function main() {
  const args = parseArgs();
  const book = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'book.json'), 'utf8'));
  const dist = resolveFromRoot(args.out, 'dist');
  const input = resolveFromRoot(args._[0], path.join(dist, book.output?.pdf || 'yonago-guide-a5.pdf'));
  const output = resolveFromRoot(args._[1], path.join(dist, book.output?.booklet || 'yonago-guide-booklet-a4.pdf'));
  const res = await impose(fs.readFileSync(input), { title: `${book.title} (A4 중철)` });
  fs.writeFileSync(output, res.bytes);
  console.log(`booklet: ${path.relative(ROOT, output)} · A5 ${res.pages}쪽 → A4 ${res.pages / 2}면(${res.pages / 4}장)` +
    (res.padded ? ` · 빈 쪽 ${res.padded}개 추가` : ''));
}

if (isMain(import.meta.url)) main().catch((e) => { console.error(e); process.exit(1); });
