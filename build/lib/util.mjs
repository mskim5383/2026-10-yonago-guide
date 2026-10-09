// 공용 유틸: 경로, 인자, 경고 수집, 파일 복사, 이미지 크기 읽기.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const CHROME_PATH =
  process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

/** --key value / --flag / 위치 인자를 나눈다. */
export function parseArgs(argv = process.argv.slice(2)) {
  const opts = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq > 0) { opts[a.slice(2, eq)] = a.slice(eq + 1); continue; }
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) { opts[key] = next; i++; }
      else opts[key] = true;
    } else opts._.push(a);
  }
  return opts;
}

export function resolveFromRoot(p, fallback) {
  const v = p ?? fallback;
  return path.isAbsolute(v) ? v : path.resolve(ROOT, v);
}

/** 빌드 중 경고를 모았다가 마지막에 한 번에 보여 준다. */
export class Log {
  constructor(quiet = false) { this.quiet = quiet; this.warnings = []; }
  info(msg) { if (!this.quiet) console.log(msg); }
  warn(msg) { this.warnings.push(msg); console.warn(`  ! ${msg}`); }
  summary() {
    if (!this.warnings.length) { console.log('경고 없음'); return; }
    console.log(`\n경고 ${this.warnings.length}건`);
    for (const w of this.warnings) console.log(`  - ${w}`);
  }
}

export const readText = (p) => fs.readFileSync(p, 'utf8');
export const exists = (p) => { try { fs.accessSync(p); return true; } catch { return false; } };
export function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }

export function copyDir(src, dst, { skip = () => false } = {}) {
  if (!exists(src)) return 0;
  ensureDir(dst);
  let n = 0;
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    if (ent.name.startsWith('.')) continue;
    const s = path.join(src, ent.name);
    const d = path.join(dst, ent.name);
    if (skip(s, ent)) continue;
    if (ent.isDirectory()) n += copyDir(s, d, { skip });
    else { fs.copyFileSync(s, d); n++; }
  }
  return n;
}

/** dist 를 비운다. 숨김 파일(.gitkeep 등)은 남긴다. */
export function emptyDir(dir) {
  if (!exists(dir)) return;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name.startsWith('.')) continue;
    fs.rmSync(path.join(dir, ent.name), { recursive: true, force: true });
  }
}

export function stripComments(html) {
  return html.replace(/<!--[\s\S]*?-->/g, '');
}

export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** CSS 문자열 리터럴용 이스케이프 */
export function cssString(s) {
  return '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ') + '"';
}

/** JPEG/PNG/GIF/WebP/SVG 의 픽셀 크기. 모르면 null. */
export function imageSize(file) {
  const buf = fs.readFileSync(file);
  // PNG
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  // GIF
  if (buf.toString('ascii', 0, 3) === 'GIF') {
    return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
  }
  // WebP
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    const chunk = buf.toString('ascii', 12, 16);
    if (chunk === 'VP8X') return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
    if (chunk === 'VP8 ') return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
    if (chunk === 'VP8L') {
      const b = buf.readUInt32LE(21);
      return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 };
    }
  }
  // JPEG
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
      const len = buf.readUInt16BE(i + 2);
      if ((marker >= 0xc0 && marker <= 0xcf) && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      }
      i += 2 + len;
    }
  }
  // SVG
  const head = buf.toString('utf8', 0, Math.min(buf.length, 4000));
  if (/<svg[\s>]/.test(head)) {
    const vb = head.match(/viewBox\s*=\s*"([^"]+)"/);
    if (vb) {
      const [, , w, h] = vb[1].trim().split(/[\s,]+/).map(Number);
      if (w && h) return { width: Math.round(w), height: Math.round(h) };
    }
  }
  return null;
}

export const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.avif': 'image/avif', '.woff2': 'font/woff2', '.woff': 'font/woff',
  '.ttf': 'font/ttf', '.otf': 'font/otf', '.pdf': 'application/pdf', '.txt': 'text/plain; charset=utf-8',
};

/** 이 모듈이 `node <file>` 로 직접 실행됐는지 */
export function isMain(metaUrl) {
  try { return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(metaUrl)); } catch { return false; }
}
