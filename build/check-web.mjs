// 배포 게이트: 판권 「웹판」 줄과 뒤표지 QR 이 가리키는 공개 주소가 실제로 열리는지 본다.
// 인쇄 감리 r1·r2: book.json webUrl 과 PDF 주소가 404 였다. 인쇄 전에 이 검사가 PASS 여야 한다.
//
//   node build/check-web.mjs            book.json 의 webUrl, webUrl + A5 PDF, webUrl + 중철 PDF → qa/web-url-check.json
//   옵션: --url <다른 주소로 시험>  --qa <qaDir>
// 종료 코드: 모두 200 이면 0, 하나라도 아니면 1.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, parseArgs, resolveFromRoot, ensureDir, readText, isMain } from './lib/util.mjs';

async function status(url) {
  try {
    const r = await fetch(url, { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(15000) });
    try { await r.body?.cancel(); } catch { /* 본문은 안 읽는다 */ }
    return { url, status: r.status, ok: r.status === 200, finalUrl: r.url !== url ? r.url : undefined };
  } catch (e) {
    return { url, status: 0, ok: false, error: e.message };
  }
}

export async function checkWeb({ base, qaDir }) {
  const book = JSON.parse(readText(path.join(ROOT, 'src', 'book.json')));
  const web = base || book.webUrl;
  if (!web) throw new Error('book.json 에 webUrl 이 없습니다');
  const root = web.endsWith('/') ? web : web + '/';
  const urls = [root, root + (book.output?.pdf || 'yonago-guide-a5.pdf'), root + (book.output?.booklet || 'yonago-guide-booklet-a4.pdf')];
  const results = [];
  for (const u of urls) results.push(await status(u));
  const ok = results.every((r) => r.ok);
  const report = { checkedAt: new Date().toISOString(), webUrl: web, ok, results };
  ensureDir(qaDir);
  fs.writeFileSync(path.join(qaDir, 'web-url-check.json'), JSON.stringify(report, null, 2) + '\n');
  return report;
}

if (isMain(import.meta.url)) {
  const args = parseArgs();
  const r = await checkWeb({ base: args.url, qaDir: resolveFromRoot(args.qa, 'qa') });
  for (const x of r.results) console.log(`${x.ok ? 'OK ' : 'NG '} ${x.status || 'ERR'}  ${x.url}${x.error ? `  (${x.error})` : ''}`);
  console.log(`웹판 주소 검사: ${r.ok ? 'PASS' : 'FAIL (인쇄 전에 공개 배포가 필요합니다. 판권 웹판 줄·뒤표지 QR 이 이 주소를 가리킵니다)'} → qa/web-url-check.json`);
  process.exit(r.ok ? 0 : 1);
}
