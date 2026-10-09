// 웹폰트 자체 호스팅: @fontsource 패키지의 woff2 중에서 책에 실제로 쓰인 글자가 든 조각만
// dist/assets/fonts/ 로 복사하고 fonts.css 를 만든다. (인쇄 PDF 와 웹이 같은 파일을 쓴다)
// unicode-range 는 책에 쓰인 글자만 남겨 fonts.css 를 줄인다(웹 검수 r1: 493KB, 렌더를 막는 CSS).
// 그래서 책에 없던 글자(빌드 뒤 스크립트가 넣는 글자 등)는 시스템 글꼴로 그려진다.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, ensureDir } from './util.mjs';

export const FONT_SET = [
  { pkg: '@fontsource/noto-serif-kr', weights: [400, 600, 700] },
  { pkg: '@fontsource/noto-sans-kr', weights: [400, 500, 700] },
  { pkg: '@fontsource/noto-serif-jp', weights: [400, 600] },
  { pkg: '@fontsource/noto-sans-jp', weights: [400, 700] },
];

function parseRanges(spec) {
  return spec.split(',').map((r) => {
    const m = r.trim().replace(/^U\+/i, '');
    if (m.includes('-')) {
      const [a, b] = m.split('-');
      return [parseInt(a, 16), parseInt(b, 16)];
    }
    if (m.includes('?')) {
      return [parseInt(m.replace(/\?/g, '0'), 16), parseInt(m.replace(/\?/g, 'f'), 16)];
    }
    const v = parseInt(m, 16);
    return [v, v];
  });
}

function intersects(ranges, cps) {
  for (const cp of cps) for (const [a, b] of ranges) if (cp >= a && cp <= b) return true;
  return false;
}

/** 조각의 unicode-range 를 책에 실제로 쓰인 글자만으로 좁힌다(fonts.css 크기를 줄이려고. 받는 조각은 같다). */
function usedRange(ranges, cps) {
  const used = [...cps].filter((cp) => ranges.some(([a, b]) => cp >= a && cp <= b)).sort((x, y) => x - y);
  const out = [];
  for (let i = 0; i < used.length;) {
    let j = i;
    while (j + 1 < used.length && used[j + 1] === used[j] + 1) j++;
    const h = (v) => v.toString(16).toUpperCase();
    out.push(i === j ? `U+${h(used[i])}` : `U+${h(used[i])}-${h(used[j])}`);
    i = j + 1;
  }
  return out.join(',');
}

/**
 * @param {string} outDir dist 디렉터리
 * @param {string} text 책에 등장하는 모든 문자열(HTML, CSS 포함 상위집합이면 충분)
 */
export function writeFonts(outDir, text, log) {
  const cps = new Set();
  for (const ch of text) cps.add(ch.codePointAt(0));
  for (let c = 0x20; c < 0x7f; c++) cps.add(c); // 기본 라틴은 항상
  const fontDir = path.join(outDir, 'assets', 'fonts');
  ensureDir(fontDir);
  const faces = [];
  let files = 0, bytes = 0;
  for (const { pkg, weights } of FONT_SET) {
    const base = path.join(ROOT, 'node_modules', pkg);
    if (!fs.existsSync(base)) { log?.warn(`폰트 패키지 없음: ${pkg} (npm install 필요)`); continue; }
    for (const w of weights) {
      const cssFile = path.join(base, `${w}.css`);
      if (!fs.existsSync(cssFile)) { log?.warn(`폰트 굵기 없음: ${pkg} ${w}`); continue; }
      const css = fs.readFileSync(cssFile, 'utf8');
      for (const m of css.matchAll(/@font-face\s*{([^}]*)}/g)) {
        const body = m[1];
        const family = body.match(/font-family:\s*'([^']+)'/)?.[1];
        const woff2 = body.match(/url\(\.\/files\/([^)]+\.woff2)\)/)?.[1];
        const range = body.match(/unicode-range:\s*([^;]+);/)?.[1];
        if (!family || !woff2) continue;
        const rs = range ? parseRanges(range) : null;
        if (rs && !intersects(rs, cps)) continue;
        const src = path.join(base, 'files', woff2);
        const dst = path.join(fontDir, woff2);
        if (!fs.existsSync(dst)) fs.copyFileSync(src, dst);
        files++; bytes += fs.statSync(dst).size;
        faces.push(
          `@font-face{font-family:'${family}';font-style:normal;font-weight:${w};font-display:swap;` +
          `src:url(${woff2}) format('woff2');${rs ? `unicode-range:${usedRange(rs, cps)};` : ''}}`,
        );
      }
    }
  }
  fs.writeFileSync(path.join(fontDir, 'fonts.css'),
    `/* 자동 생성: build/lib/fonts.mjs · SIL Open Font License 1.1 (Noto) */\n${faces.join('\n')}\n`);
  return { files, bytes };
}
