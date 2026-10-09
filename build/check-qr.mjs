// QR 판독 검사: A5 PDF 를 300dpi 로 그려 macOS Vision 으로 QR 을 읽고, dist/index.html 의 QR 링크와 대조한다.
// 인쇄 감리 r1(QR 10개 판독 실패) 뒤로 넣은 회귀 검사. macOS(swift) 전용.
//
//   node build/check-qr.mjs                 dist 의 A5 PDF → qa/qr-check.json
//   옵션: --out <distDir>  --qa <qaDir>  --dpi 300  --work <렌더 임시 폴더(기본: OS 임시 폴더, 끝나면 지움)>
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseHTML } from 'linkedom';
import { ROOT, parseArgs, resolveFromRoot, exists, ensureDir, readText, isMain } from './lib/util.mjs';
import { renderPages } from './render-pages.mjs';

const MIN_MM = 15;

export async function checkQr({ dist, qaDir, dpi = 300, work }) {
  const book = JSON.parse(readText(path.join(ROOT, 'src', 'book.json')));
  const pdf = path.join(dist, book.output?.pdf || 'yonago-guide-a5.pdf');
  const html = path.join(dist, book.output?.html || 'index.html');
  if (!exists(pdf) || !exists(html)) throw new Error('dist 에 PDF·HTML 이 없습니다. 먼저 node build/build.mjs');

  // 기대값: 인쇄에 나오는 QR 링크(장소 카드 타일, 단독 QR)
  const { document } = parseHTML(readText(html));
  const expected = [];
  for (const a of document.querySelectorAll('a.qr-tile[href], a.qr[href]')) {
    if (a.closest('.web-only')) continue;
    expected.push({ url: a.getAttribute('href'), part: a.closest('section')?.id || '', label: (a.textContent || '').trim().slice(0, 30), v: Number(a.getAttribute('data-qr-v') || 0) });
  }

  const tmp = work ? resolveFromRoot(work) : fs.mkdtempSync(path.join(os.tmpdir(), 'qrcheck-'));
  ensureDir(tmp);
  try {
    const r = await renderPages(pdf, tmp, { dpi, prefix: 'p' });
    const pngs = fs.readdirSync(tmp).filter((f) => /^p-\d{3}\.png$/.test(f)).sort().map((f) => path.join(tmp, f));
    const out = spawnSync('swift', [path.join(ROOT, 'build', 'qrscan.swift'), String(dpi), ...pngs], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (out.status !== 0) throw new Error(`qrscan 실패: ${(out.stderr || '').split('\n')[0]}`);
    const found = [];
    for (const line of out.stdout.split('\n')) {
      const c = line.split('\t');
      if (c.length < 8) continue;
      found.push({ page: Number(c[0].match(/(\d{3})/)?.[1]), v: c[1], ec: c[2], wmm: Number(c[3]), hmm: Number(c[4]), url: c.slice(7).join('\t') });
    }
    const missing = [];
    const small = [];
    for (const e of expected) {
      const hit = found.filter((f) => f.url === e.url);
      if (!hit.length) missing.push(e);
      for (const h of hit) if (Math.min(h.wmm, h.hmm) < MIN_MM) small.push({ ...e, page: h.page, mm: Math.min(h.wmm, h.hmm) });
    }
    const unexpected = found.filter((f) => !expected.some((e) => e.url === f.url));
    const sizes = found.map((f) => Math.min(f.wmm, f.hmm));
    const report = {
      checkedAt: new Date().toISOString(), dpi, renderer: r.via,
      expected: expected.length, decoded: found.length,
      ok: missing.length === 0 && small.length === 0 && unexpected.length === 0,
      sizeMm: sizes.length ? { min: Math.min(...sizes), max: Math.max(...sizes) } : null,
      missing, small, unexpected,
      found: found.map((f) => ({ page: f.page, version: f.v, ec: f.ec, mm: Math.min(f.wmm, f.hmm), url: f.url })),
    };
    if (qaDir) { ensureDir(qaDir); fs.writeFileSync(path.join(qaDir, 'qr-check.json'), JSON.stringify(report, null, 2) + '\n'); }
    return report;
  } finally {
    if (!work) fs.rmSync(tmp, { recursive: true, force: true });
  }
}

async function main() {
  const args = parseArgs();
  const r = await checkQr({
    dist: resolveFromRoot(args.out, 'dist'), qaDir: resolveFromRoot(args.qa, 'qa'),
    dpi: Number(args.dpi || 300), work: args.work,
  });
  console.log(`QR 판독 ${r.ok ? 'PASS' : 'FAIL'}: 기대 ${r.expected}개 · 읽힘 ${r.decoded}개 · 크기 ${r.sizeMm ? `${r.sizeMm.min.toFixed(1)}~${r.sizeMm.max.toFixed(1)}mm` : '-'} (${r.dpi}dpi, ${r.renderer})`);
  for (const m of r.missing) console.log(`  - 못 읽음: ${m.part} ${m.label} v${m.v} ${m.url}`);
  for (const m of r.small) console.log(`  - ${MIN_MM}mm 미만: ${m.page}쪽 ${m.mm.toFixed(1)}mm ${m.url}`);
  for (const m of r.unexpected) console.log(`  - 목록에 없는 QR: ${m.page}쪽 ${m.url}`);
  console.log(`보고서: ${path.relative(ROOT, path.join(resolveFromRoot(args.qa, 'qa'), 'qr-check.json'))}`);
  if (!r.ok) process.exitCode = 1;
}

if (isMain(import.meta.url)) main().catch((e) => { console.error(e); process.exit(1); });
