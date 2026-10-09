// 원고 조립: book.json 순서대로 src/front + src/parts 조각을 template 에 끼워 한 장의 HTML 을 만든다.
// 같은 HTML 이 웹(dist/index.html)이자 인쇄 원본이다. 인쇄 패스마다 state(목차 쪽번호, 메모 페이지 수,
// 쪽 찾기용 앵커)를 바꿔 다시 조립한다.
import fs from 'node:fs';
import path from 'node:path';
import QRCode from 'qrcode';
import { parseHTML } from 'linkedom';
import { readText, exists, stripComments, escapeHtml, cssString, imageSize } from './util.mjs';

// 장소 카드 「지도」 QR·링크. 공식 Maps URL(…/maps/search/?api=1&query=)보다 21자 짧은 q= 형식을 쓴다.
// 일본어 검색어는 글자마다 %XX 9바이트가 되어 QR 버전이 커지므로(인쇄 감리 r1: v7 이상 판독 실패), 공백도 + 로.
const MAPS = 'https://maps.google.com/?q=';
const mapsUrl = (q) => MAPS + encodeURIComponent(q.trim()).replace(/%20/g, '+');

// BRIEF 4장 컴포넌트 규약에 있는 클래스. 이 밖의 클래스는 경고만 한다.
const KNOWN_CLASSES = new Set([
  'part', 'part-head', 'kicker', 'part-title', 'dek', 'lede', 'pull', 'box', 'tip', 'warn', 'star', 'alt',
  'note', 'sidenote', 'diary', 'diary-entry', 'diary-time', 'timeline', 't', 'what', 'sub', 'place',
  'place-name', 'reading', 'facts', 'tags', 'tag', 'open', 'closed', 'cash', 'rsv', 'beer', 'qr', 'photo',
  'wide', 'half', 'full', 'map', 'data', 'phrases', 'ja', 'pron', 'check', 'verify', 'memo-lines',
  'web-only', 'print-only',
  // 조판 힌트(디자이너): 지도 높이 상한 낮추기, 쪽 사이에서 가르지 않기, 이 앞에서 쪽 나누기
  'short', 'shorter', 'keep', 'break-before',
  // 쪽 참조 괄호: 쪽번호가 비면 빌드가 통째로 지우고, 웹에서는 숨긴다
  'pageref-wrap',
]);

// 전화번호(0859-44-5489, +81-82-505-2100 …)는 하이픈 뒤에서 줄이 갈리지 않게 감싼다.
const PHONE = /(?:\+\d{1,3}-)?\d{2,5}-\d{1,4}-\d{3,4}(?![\d-])/g;
function wrapPhones(html) {
  return html.replace(/>([^<]+)</g, (m, text) => '>' + text.replace(PHONE, (x) => `<span class="nobr">${x}</span>`) + '<');
}

// 짧은 표는 쪽 사이에서 가르지 않는다(본문 행 수가 이 값 이하일 때 .table-wrap.keep).
const KEEP_TABLE_ROWS = 8;

// 오른쪽 쪽 러닝헤드: data-toc 가 이 글자 수 이하면 부제까지, 넘으면 제목만
const RUN_MAX = 34;

const DEFAULT_SERIF_KINDS = ['letter', 'diary', 'feature', 'further', 'essay', 'closing', 'close'];

/** assets/img/manifest.json 을 id → entry 맵으로. 여러 모양을 받아 준다. */
export function loadManifest(assetsDir, log) {
  const file = path.join(assetsDir, 'img', 'manifest.json');
  const map = new Map();
  if (!exists(file)) return map;
  let data;
  try { data = JSON.parse(readText(file)); } catch (e) { log.warn(`manifest.json 파싱 실패: ${e.message}`); return map; }
  const list = Array.isArray(data) ? data
    : Array.isArray(data.images) ? data.images
      : data.images && typeof data.images === 'object' ? Object.entries(data.images).map(([id, v]) => ({ id, ...v }))
        : Object.entries(data).filter(([, v]) => v && typeof v === 'object').map(([id, v]) => ({ id, ...v }));
  for (const e of list) if (e && e.id) map.set(e.id, e);
  return map;
}

// 한글 문맥 안의 일본어(가나·한자) 덩어리를 lang="ja" 로 감싼다(크레디트 작가명, QR 라벨 등 빌드가 만드는 글자)
const JA_RUN = /[\u3005\u3006\u303b\u3040-\u30ff\u31f0-\u31ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff66-\uff9f]+(?:[\s・·ー]*[\u3005\u3006\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]+)*/g;
function langJa(text) {
  return escapeHtml(text).replace(JA_RUN, (m) => `<span lang="ja">${m}</span>`);
}

function creditLine(e) {
  if (typeof e.credit === 'string' && e.credit.trim()) return e.credit.trim();
  const who = e.author || e.artist || e.by || e.creator || e.photographer;
  const lic = e.license || e.licence;
  const parts = [who, lic].filter(Boolean);
  return parts.length ? `사진 ${parts.join(' · ')}` : '';
}

/** 인라인 SVG 준비: 선언 제거, id 접두어, 내부 <style> 범위 한정, 루트 속성 정리 */
export function prepareSvg(raw, prefix, { label = '', cls = '' } = {}) {
  let s = raw
    .replace(/<\?xml[\s\S]*?\?>/g, '')
    .replace(/<!DOCTYPE[\s\S]*?>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .trim();
  const ids = new Set([...s.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  const pre = (id) => (ids.has(id) ? `${prefix}-${id}` : id);
  s = s.replace(/(\sid=")([^"]+)(")/g, (_, a, id, b) => a + pre(id) + b);
  s = s.replace(/url\(\s*#([^)\s]+)\s*\)/g, (_, id) => `url(#${pre(id)})`);
  s = s.replace(/((?:xlink:)?href=")#([^"]+)"/g, (_, a, id) => `${a}#${pre(id)}"`);
  const rootId = `${prefix}-root`;
  // 내부 스타일시트는 문서 전체에 새므로 루트 id 아래로 가둔다.
  s = s.replace(/(<style[^>]*>)([\s\S]*?)(<\/style>)/gi, (_, open, css, close) => {
    const scoped = css.replace(/(^|})(\s*)([^{}@][^{}]*?)(\s*){/g, (m, brace, ws, sel, ws2) => {
      const fixed = sel.split(',').map((x) => {
        const t = x.trim().replace(/#([A-Za-z_][\w-]*)/g, (mm, id) => `#${pre(id)}`);
        if (!t || /^(from|to|\d+%)$/.test(t)) return t;
        return `#${rootId} ${t}`;
      }).join(', ');
      return `${brace}${ws}${fixed}${ws2}{`;
    });
    return open + scoped + close;
  });
  // 루트 <svg ...> 속성 정리
  s = s.replace(/<svg\b([^>]*)>/, (m, attrs) => {
    let a = attrs;
    const w = a.match(/\swidth="([\d.]+)(?:px)?"/)?.[1];
    const h = a.match(/\sheight="([\d.]+)(?:px)?"/)?.[1];
    if (!/viewBox=/.test(a) && w && h) a += ` viewBox="0 0 ${w} ${h}"`;
    a = a.replace(/\s(width|height)="[^"]*"/g, '').replace(/\sid="[^"]*"/, '').replace(/\sclass="[^"]*"/, '');
    const aria = label ? ` role="img" aria-label="${escapeHtml(label)}"` : ' aria-hidden="true"';
    return `<svg id="${rootId}" class="${cls}"${a}${aria}>`;
  });
  return s;
}

// QR: 모듈을 칸 채우기(fill) 경로로 그린다. qrcode 라이브러리의 SVG 는 행마다 stroke 선이라
// Chrome PDF 에서 버전 7 이상이 가는 빗금으로 나와 판독되지 않았다(인쇄 감리 r1).
// 오류 정정은 M 을 쓰되, 버전이 6을 넘으면 L 로 낮춰 버전(=모듈 수)을 줄인다.
const QR_MAX_V = 6;
const QR_MARGIN = 1;
const QR_INK = '#1e2a33';
function qrModel(text) {
  let qr = QRCode.create(text, { errorCorrectionLevel: 'M' });
  if (qr.version > QR_MAX_V) {
    const low = QRCode.create(text, { errorCorrectionLevel: 'L' });
    if (low.version < qr.version) qr = low;
  }
  return qr;
}
function qrSvg(text) {
  const qr = qrModel(text);
  const n = qr.modules.size;
  const N = n + QR_MARGIN * 2;
  let d = '';
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n;) {
      if (!qr.modules.get(y, x)) { x++; continue; }
      let x2 = x + 1;
      while (x2 < n && qr.modules.get(y, x2)) x2++;
      const w = x2 - x;
      d += `M${x + QR_MARGIN} ${y + QR_MARGIN}h${w}v1h-${w}z`;
      x = x2;
    }
  }
  const ec = { 1: 'L', 0: 'M', 3: 'Q', 2: 'H' }[qr.errorCorrectionLevel?.bit] || '?';
  const svg = `<svg class="qr-svg" viewBox="0 0 ${N} ${N}" shape-rendering="crispEdges" aria-hidden="true" focusable="false">` +
    `<rect width="${N}" height="${N}" fill="#fff"/><path fill="${QR_INK}" d="${d}"/></svg>`;
  return { svg, version: qr.version, ec, mods: N };
}
/** QR 칸 수를 CSS 변수로: 인쇄에서 버전이 큰 QR 은 모듈이 0.38mm 아래로 작아지지 않게 타일을 키운다 */
function qrAttrs(el, q) {
  el.setAttribute('data-qr-v', String(q.version));
  el.setAttribute('style', `--qr-mods:${q.mods}`);
}

function shortUrl(u) {
  try {
    const x = new URL(u);
    const p = x.pathname.length > 18 ? x.pathname.slice(0, 16) + '…' : x.pathname;
    return x.host.replace(/^www\./, '') + (p === '/' ? '' : p);
  } catch { return u; }
}

function splitToc(s) {
  const i = s.indexOf(' · ');
  return i < 0 ? [s.trim(), ''] : [s.slice(0, i).trim(), s.slice(i + 3).trim()];
}

function textOf(el) { return (el?.textContent || '').replace(/\s+/g, ' ').trim(); }

function applyVars(html, vars) {
  return html.replace(/{{\s*([\w.]+)\s*}}/g, (m, k) => (k in vars ? escapeHtml(vars[k]) : m));
}

/** 조각(HTML 문자열)을 파싱해 검사·표시한 뒤 다시 문자열로 */
function prepareFragment(html, { file, isPart, group, serifKinds, log }) {
  const { document } = parseHTML(`<!doctype html><html><body>${html}</body></html>`);
  const body = document.body;
  if (isPart) {
    for (const el of body.querySelectorAll('style, script')) {
      log.warn(`${file}: <${el.tagName.toLowerCase()}> 는 원고에 쓸 수 없어 뺐습니다`);
      el.remove();
    }
    const styled = body.querySelectorAll('[style]');
    if (styled.length) {
      log.warn(`${file}: 인라인 style 속성 ${styled.length}곳을 뺐습니다`);
      for (const el of styled) el.removeAttribute('style');
    }
    const unknown = new Map();
    for (const el of body.querySelectorAll('[class]')) {
      for (const c of el.classList) if (!KNOWN_CLASSES.has(c)) unknown.set(c, (unknown.get(c) || 0) + 1);
    }
    if (unknown.size) log.warn(`${file}: 규약 밖 클래스 ${[...unknown].map(([c, n]) => `${c}(${n})`).join(', ')}`);
    const dash = (body.textContent.match(/—/g) || []).length;
    if (dash) log.warn(`${file}: em dash(—) ${dash}개`);
  }
  const sections = body.querySelectorAll('section.part');
  if (isPart && sections.length === 0) log.warn(`${file}: <section class="part"> 가 없습니다`);
  if (isPart && sections.length > 1) log.warn(`${file}: section.part 가 ${sections.length}개입니다(1개 권장)`);
  for (const sec of sections) {
    if (!sec.id) {
      const id = 'p-' + path.basename(file, '.html').replace(/[^\w-]/g, '-');
      sec.id = id;
      log.warn(`${file}: section.part 에 id 가 없어 "${id}" 로 붙였습니다`);
    }
    if (!sec.getAttribute('data-toc')) log.warn(`${file}: data-toc 가 없어 목차에 안 나옵니다`);
    sec.setAttribute('data-file', file);
    if (group) sec.setAttribute('data-group', group);
    const kind = sec.getAttribute('data-kind') || '';
    sec.classList.add(serifKinds.includes(kind) ? 'k-serif' : 'k-sans');
  }
  return isPart ? wrapPhones(body.innerHTML) : body.innerHTML;
}

/**
 * @param {object} cfg  { book, bookDir, partsDir, frontDir, assetsDir, templatePath, styleHref }
 * @param {object} state { markers, fillers: {id:n}, endFillers, pages: {id:n}|null }
 */
export async function assemble(cfg, state, log) {
  const { book } = cfg;
  const vars = {
    title: book.title, subtitle: book.subtitle, series: book.series, kicker: book.kicker,
    webUrl: book.webUrl, published: book.published,
    pdf: book.output?.pdf || 'yonago-guide-a5.pdf',
    booklet: book.output?.booklet || 'yonago-guide-booklet-a4.pdf',
    ...(book.vars || {}),
  };
  const serifKinds = book.serifKinds || DEFAULT_SERIF_KINDS;
  const groups = new Map(); // key → group config
  const chunks = [];
  const rectoFiles = new Set();
  const read = (dir, file, isPart, group) => {
    const p = path.join(dir, file);
    if (!exists(p)) { log.warn(`${isPart ? '원고' : '앞뒤 페이지'} 없음: ${path.relative(cfg.bookDir, p)}`); return null; }
    let html = stripComments(readText(p));
    if (!isPart) html = applyVars(html, vars);
    return prepareFragment(html, { file, isPart, group, serifKinds, log });
  };

  for (const entry of book.sequence) {
    if (entry.filler === 'end') { chunks.push('<div data-filler-slot="end"></div>'); continue; }
    if (entry.group) groups.set(entry.group, entry);
    const list = [];
    if (entry.front) for (const f of [].concat(entry.front)) list.push([cfg.frontDir, f, false]);
    if (entry.parts) for (const f of entry.parts) list.push([cfg.partsDir, f, true]);
    let first = true;
    for (const [dir, f, isPart] of list) {
      const html = read(dir, f, isPart, entry.group);
      if (html == null) continue;
      if (first && entry.start === 'recto') rectoFiles.add(f);
      first = false;
      chunks.push(html);
    }
  }

  let template = stripComments(readText(cfg.templatePath));
  template = applyVars(template, vars);
  const { document } = parseHTML(template.replace('{{content}}', chunks.join('\n')));
  const slots = [];
  const slot = (svg) => { slots.push(svg); return `<svg-slot data-k="${slots.length - 1}"></svg-slot>`; };

  // --- 앞뒤 메모 페이지(쪽수 맞춤) -------------------------------------------------
  const memoTpl = exists(path.join(cfg.frontDir, 'memo-page.html'))
    ? applyVars(stripComments(readText(path.join(cfg.frontDir, 'memo-page.html'))), vars) : null;
  const makeFiller = (id, why) => {
    const wrap = document.createElement('div');
    wrap.innerHTML = memoTpl || '<section class="front memo-page print-only"><div class="memo-fill"></div></section>';
    const sec = wrap.querySelector('section');
    sec.id = id; sec.setAttribute('data-filler', why);
    return sec;
  };
  for (const [id, n] of Object.entries(state.fillers || {})) {
    const target = document.getElementById(id);
    if (!target || !n) continue;
    for (let i = 0; i < n; i++) target.parentNode.insertBefore(makeFiller(`memo-before-${id}-${i + 1}`, 'recto'), target);
  }
  const endSlot = document.querySelector('[data-filler-slot="end"]');
  if (endSlot) {
    for (let i = 0; i < (state.endFillers || 0); i++) endSlot.parentNode.insertBefore(makeFiller(`memo-end-${i + 1}`, 'end'), endSlot);
    endSlot.remove();
  }

  // --- 사진 -------------------------------------------------------------------
  const manifest = loadManifest(cfg.assetsDir, log);
  const imgUsed = [];
  for (const fig of document.querySelectorAll('figure[data-img]')) {
    const id = fig.getAttribute('data-img');
    const e = manifest.get(id);
    const file = e && (e.file || e.src || e.path || `${id}.jpg`).replace(/^assets\/img\//, '');
    const abs = file && path.join(cfg.assetsDir, 'img', file);
    if (!e || !exists(abs)) {
      log.warn(`사진 없음 → figure 제외: ${id}${e ? ` (파일 ${file} 없음)` : ' (manifest 에 없음)'}`);
      fig.remove();
      continue;
    }
    const size = (e.width && e.height) ? { width: e.width, height: e.height } : imageSize(abs);
    const img = document.createElement('img');
    img.setAttribute('src', `assets/img/${file}`);
    const cap0 = fig.querySelector('figcaption');
    img.setAttribute('alt', e.alt || textOf(cap0) || '');
    if (size) { img.setAttribute('width', String(size.width)); img.setAttribute('height', String(size.height)); }
    img.setAttribute('loading', fig.closest('.cover') ? 'eager' : 'lazy');
    img.setAttribute('decoding', 'async');
    fig.insertBefore(img, fig.firstChild);
    const credit = creditLine(e);
    if (!credit) log.warn(`사진 크레디트 없음: ${id}`);
    let cap = cap0;
    if (!cap) { cap = document.createElement('figcaption'); fig.appendChild(cap); }
    if (credit) {
      const span = document.createElement('span');
      span.className = 'credit';
      span.innerHTML = langJa(credit);
      cap.appendChild(span);
    }
    fig.classList.add('has-img');
    imgUsed.push(id);
  }

  // 크레디트 표: 책에 실리지 않은 사진의 행(tr[data-img])은 뺀다
  const usedSet = new Set(imgUsed);
  let creditsDropped = 0;
  for (const tr of document.querySelectorAll('tr[data-img]')) {
    if (!usedSet.has(tr.getAttribute('data-img'))) { tr.remove(); creditsDropped++; }
  }
  // 크레디트 표의 라이선스 칸: manifest 의 licenseUrl 로 링크를 걸고(웹), 표 아래에 라이선스 원문 주소를
  // 모아 적는다(인쇄). CC BY-SA 2.0·3.0 은 라이선스 URI 표기를 요구한다(인쇄 감리 r2).
  const licTables = new Map(); // table → Map(license → url)
  for (const tr of document.querySelectorAll('tr[data-img]')) {
    const e = manifest.get(tr.getAttribute('data-img'));
    const url = e && (e.licenseUrl || e.license_url);
    const cell = tr.lastElementChild;
    if (!url || !cell || !/creativecommons\.org/.test(url)) continue;
    const name = textOf(cell);
    if (!name || name !== String(e.license || '').trim()) continue;
    if (!cell.querySelector('a')) cell.innerHTML = `<a href="${escapeHtml(url)}" rel="license noopener" target="_blank">${escapeHtml(name)}</a>`;
    const table = tr.closest('table');
    if (!licTables.has(table)) licTables.set(table, new Map());
    licTables.get(table).set(name, url);
  }
  const licShort = (u) => u.replace(/^https?:\/\//, '').replace(/\/?(deed\.[\w-]+)?$/, '/');
  for (const [table, lics] of licTables) {
    const items = [...lics].sort(([a], [b]) => a.localeCompare(b, 'en'))
      .map(([name, url]) => `<span class="lic-item"><b>${escapeHtml(name)}</b> <a href="${escapeHtml(url)}" rel="license noopener" target="_blank">${escapeHtml(licShort(url))}</a></span>`);
    const p = document.createElement('p');
    p.className = 'lic-legend';
    p.innerHTML = `<span class="lic-head">라이선스 원문</span> ${items.join(' ')}`;
    table.parentNode.insertBefore(p, table.nextSibling);
  }

  // --- 지도·도판(SVG) -----------------------------------------------------------
  let svgN = 0;
  for (const fig of document.querySelectorAll('figure[data-svg]')) {
    const id = fig.getAttribute('data-svg');
    const abs = path.join(cfg.assetsDir, 'svg', `${id}.svg`);
    if (!exists(abs)) { log.warn(`도판 없음 → figure 제외: ${id}`); fig.remove(); continue; }
    const label = textOf(fig.querySelector('figcaption')) || id;
    const html = prepareSvg(readText(abs), `s${++svgN}-${id}`, { label, cls: 'fig-svg' });
    const holder = document.createElement('div');
    holder.className = 'fig-svg-wrap';
    holder.innerHTML = slot(html);
    fig.insertBefore(holder, fig.querySelector('figcaption') || null);
    fig.classList.add('has-svg');
    // 웹: 좁은 화면에서는 지도를 옆으로 밀어 보게 하고(style.css), 원본 SVG 를 새 탭으로 여는 링크를 단다
    if (fig.classList.contains('map') && !fig.closest('.cover')) {
      let cap = fig.querySelector('figcaption');
      if (!cap) { cap = document.createElement('figcaption'); fig.appendChild(cap); }
      const a = document.createElement('a');
      a.className = 'fig-open web-only';
      a.setAttribute('href', `assets/svg/${id}.svg`);
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener');
      a.textContent = '크게 보기';
      cap.appendChild(document.createTextNode(' '));
      cap.appendChild(a);
    }
  }

  // --- QR: 장소 카드, 단독 QR -------------------------------------------------------
  const qrList = [];
  for (const pl of document.querySelectorAll('.place')) {
    const tiles = [];
    const q = pl.getAttribute('data-maps');
    if (q) tiles.push({ url: mapsUrl(q), label: '지도' });
    const u = pl.getAttribute('data-url');
    if (u) tiles.push({ url: u, label: pl.getAttribute('data-url-label') || '웹' });
    if (!tiles.length) continue;
    const box = document.createElement('div');
    box.className = 'place-qr';
    let boxMods = 0;
    for (const t of tiles) {
      const a = document.createElement('a');
      a.className = 'qr-tile';
      a.setAttribute('href', t.url);
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener');
      const qq = qrSvg(t.url);
      qrAttrs(a, qq);
      boxMods = Math.max(boxMods, qq.mods);
      a.innerHTML = slot(qq.svg) + `<span class="qr-label">${langJa(t.label)}</span>`;
      box.appendChild(a);
      qrList.push({ url: t.url, v: qq.version, ec: qq.ec, where: pl.closest('section')?.id || '' });
    }
    // 한 카드의 QR 타일은 같은 크기로(인쇄): 큰 QR 하나 때문에 「지도」·「Tabelog」 라벨 높이가 어긋났다(인쇄 감리 r2)
    box.setAttribute('style', `--qr-box-mods:${boxMods}`);
    pl.insertBefore(box, pl.firstChild);
  }
  for (const a of document.querySelectorAll('a.qr[data-qr]')) {
    const url = a.getAttribute('data-qr');
    const label = a.getAttribute('data-label') || textOf(a) || shortUrl(url);
    a.setAttribute('href', url);
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noopener');
    const qq = qrSvg(url);
    qrAttrs(a, qq);
    a.innerHTML = slot(qq.svg) +
      `<span class="qr-text"><span class="qr-label">${langJa(label)}</span><span class="qr-url">${escapeHtml(shortUrl(url))}</span></span>`;
    qrList.push({ url, v: qq.version, ec: qq.ec, where: a.closest('section')?.id || '' });
    // 상자 맨 끝의 단독 QR 은 상자 맨 앞으로 옮겨 오른쪽 위에 띄운다(style.css .qr-float). 상자 머리 줄과
    // 나란히 서서 상자 높이가 QR 한 줄만큼 줄어든다. 상자 끝에 QR 줄이 따로 생기면 상자가 쪽 사이에서
    // 갈리기 쉬웠다(인쇄 감리 r1, 사흘 한눈에 「결정 규칙」).
    const box = a.parentNode;
    if (box?.matches?.('aside.box') && !a.nextElementSibling) {
      a.classList.add('qr-float');
      box.classList.add('has-qr-float');
      box.insertBefore(a, box.firstChild);
    }
  }

  // --- 원고 끝 메모(조판): book.json "tailMemo" 의 원고 끝에 인쇄 전용 필기선을 붙여 마지막 쪽의 빈자리를 채운다.
  // 남은 자리만큼만 남기고(아래 필기선 덜어 내기), 첫 줄부터 다음 쪽으로 밀리거나 min 줄도 안 들어가면 뺀다.
  const tm = book.tailMemo || {};
  for (const f of tm.parts || []) {
    const sec = [...document.querySelectorAll('section.part')].find((x) => x.getAttribute('data-file') === f);
    if (!sec) continue;
    const el = document.createElement('div');
    el.className = 'memo-lines tail-memo print-only';
    el.setAttribute('data-lines', String(tm.lines || 24));
    el.setAttribute('aria-hidden', 'true');
    sec.appendChild(el);
  }

  // --- 필기선, 표 래퍼 ----------------------------------------------------------------
  // 필기선은 줄마다 .ml 하나. 인쇄 패스에서는 줄마다 앵커(ZZL[k.i]ZZ)를 심어 몇 줄이 다음 쪽으로
  // 넘쳤는지 센다. state.memoTrim[k] 만큼 줄을 덜어 낸다(최소 1줄). state.memoDrop[k] 면 원고 끝 메모를 뺀다.
  const memoInfo = [];
  [...document.querySelectorAll('.memo-lines')].forEach((el, k) => {
    const trailing = el.classList.contains('tail-memo');
    if (trailing && state.memoDrop?.[k]) {
      // 번호(k)가 패스마다 같아야 하므로 요소는 남기고 줄만 비운다
      el.className = 'tail-memo-dropped';
      el.innerHTML = '';
      const asked = parseInt(el.getAttribute('data-lines') || '0', 10) || 0;
      memoInfo.push({ k, part: el.closest('section.part')?.id || '', file: el.closest('section.part')?.getAttribute('data-file') || '', lines: 0, asked, trailing, dropped: true });
      return;
    }
    const raw = parseInt(el.getAttribute('data-lines') || '8', 10);
    const n = Number.isFinite(raw) && raw > 0 ? raw : 8;
    const trim = Math.min(state.memoTrim?.[k] || 0, n - 1);
    const lines = n - trim;
    el.setAttribute('style', `--lines:${lines}`);
    el.setAttribute('data-memo', String(k));
    if (trailing && state.markers) {
      const mark = document.createElement('span');
      mark.className = 'pdf-anchor';
      mark.setAttribute('aria-hidden', 'true');
      mark.textContent = `ZZM[${k}]ZZ`;
      el.parentNode.insertBefore(mark, el);
    }
    let rows = '';
    for (let i = 0; i < lines; i++) {
      rows += state.markers
        ? `<span class="ml"><span class="pdf-anchor" aria-hidden="true">ZZL[${k}.${i}]ZZ</span></span>`
        : '<span class="ml"></span>';
    }
    el.innerHTML = rows;
    const sec = el.closest('section.part');
    const box = el.closest('aside.box');
    // 원고 맨 끝 상자 안의 필기선: 상자 아래 여백만 다음 쪽으로 넘어가도 빈 쪽이 생긴다
    const tail = !!(sec && box && box.parentNode === sec && !box.nextElementSibling);
    memoInfo.push({ k, part: sec?.id || '', file: sec?.getAttribute('data-file') || '', lines, asked: n, tail, trailing, min: trailing ? (tm.min || 4) : 1 });
  });
  for (const t of document.querySelectorAll('table.data')) {
    if (t.parentNode?.classList?.contains('table-wrap')) continue;
    const w = document.createElement('div');
    w.className = 'table-wrap';
    const rows = t.querySelectorAll('tbody tr').length || t.querySelectorAll('tr').length;
    if (t.classList.contains('keep') || rows <= KEEP_TABLE_ROWS) w.classList.add('keep');
    t.parentNode.insertBefore(w, t);
    w.appendChild(t);
    // 묶음 행: 한 칸이 모든 열을 차지하는 행(예: 영업 캘린더의 「사카이미나토」). 인쇄에서 다음 행과 붙여 둔다.
    const cols = Math.max(0, ...[...t.querySelectorAll('tr')].map((tr) => [...tr.children].reduce((n, c) => n + (parseInt(c.getAttribute('colspan') || '1', 10) || 1), 0)));
    for (const tr of t.querySelectorAll('tbody tr')) {
      const cells = [...tr.children];
      if (cols > 1 && cells.length === 1 && (parseInt(cells[0].getAttribute('colspan') || '1', 10) || 1) >= cols) tr.classList.add('group');
    }
    // 묶음 행이 있으면 묶음마다 tbody 를 나눈다(tbody.grp). 인쇄에서 묶음을 쪽 사이에서 가르지 않는다.
    // 묶음 이름 없이 다음 쪽으로 넘어간 행이 어느 지역인지 안 보였다(인쇄 감리 r1, 영업 캘린더).
    for (const tb of [...t.querySelectorAll(':scope > tbody')]) {
      const rows = [...tb.children];
      if (!rows.some((r) => r.classList?.contains('group'))) continue;
      let cur = null;
      for (const r of rows) {
        if (r.classList?.contains('group') || !cur) {
          cur = document.createElement('tbody');
          cur.className = 'grp';
          tb.parentNode.insertBefore(cur, tb);
        }
        cur.appendChild(r);
      }
      tb.remove();
    }
    // 「米子空港 16:15 → 境港 16:30」 같은 짧은 구간 칸은 인쇄에서 한 줄로(역 이름과 시각이 갈리지 않게)
    for (const td of t.querySelectorAll('td')) {
      const tx = textOf(td);
      if (tx.includes('→') && tx.length <= 28 && !td.querySelector('br')) td.classList.add('nw');
    }
  }

  // --- 목차·내비게이션 ----------------------------------------------------------------
  const parts = [...document.querySelectorAll('section.part')];
  const ids = new Map();
  for (const s of parts) {
    if (ids.has(s.id)) log.warn(`id 중복: ${s.id} (${ids.get(s.id)} / ${s.getAttribute('data-file')})`);
    ids.set(s.id, s.getAttribute('data-file'));
  }
  const tocModel = []; // [{group, cfg, items:[{id, t, s, printOnly}]}]
  for (const s of parts) {
    const toc = s.getAttribute('data-toc');
    if (!toc) continue;
    const g = s.getAttribute('data-group') || '';
    let last = tocModel[tocModel.length - 1];
    if (!last || last.group !== g) { last = { group: g, cfg: groups.get(g) || {}, items: [] }; tocModel.push(last); }
    let [t, sub] = splitToc(toc);
    // 묶음 이름과 겹치는 머리말은 뺀다: DAY 2 묶음 안의 "Day 2 일정" → "일정", 읽을거리 묶음 안의 "읽을거리 · X" → "X"
    const label = (groups.get(g) || {}).label;
    if (label) {
      const norm = (x) => x.replace(/\s+/g, '').toLowerCase();
      if (norm(t).startsWith(norm(label))) {
        let rest = t, i = 0;
        for (const ch of label.replace(/\s+/g, '')) { // 공백을 무시하고 label 글자 수만큼 앞을 잘라낸다
          while (i < rest.length && /\s/.test(rest[i])) i++;
          if (rest[i] && rest[i].toLowerCase() === ch.toLowerCase()) i++;
        }
        rest = rest.slice(i).trim();
        if (rest) t = rest; else if (sub) { t = sub; sub = ''; }
      }
    }
    last.items.push({ id: s.id, t, s: sub, printOnly: s.classList.contains('print-only') });
  }
  const pg = (id) => {
    const v = state.pages?.[id];
    return v ? String(v) : '';
  };
  const printToc = tocModel.map((g) => {
    const items = g.items.map((it) => `<li class="toc-entry"><a href="#${it.id}"><span class="toc-t">${escapeHtml(it.t)}</span>` +
      (it.s ? `<span class="toc-s">${escapeHtml(it.s)}</span>` : '') +
      `<span class="toc-dots"></span><span class="toc-pg" data-pg-for="${it.id}">${pg(it.id)}</span></a></li>`).join('');
    if (g.cfg.label && g.items.length > 1) {
      return `<li class="toc-group"><p class="toc-group-head"><span class="toc-group-label">${escapeHtml(g.cfg.label)}</span>` +
        (g.cfg.title ? `<span class="toc-group-title">${escapeHtml(g.cfg.title)}</span>` : '') +
        `</p><ol>${items}</ol></li>`;
    }
    return items;
  }).join('');
  for (const root of document.querySelectorAll('[data-toc-root]')) root.innerHTML = `<ol class="toc-list">${printToc}</ol>`;

  const webToc = tocModel.map((g) => {
    const items = g.items.filter((it) => !it.printOnly);
    if (!items.length) return '';
    const lis = items.map((it) => `<li><a href="#${it.id}">${escapeHtml(it.t)}${it.s ? `<small>${escapeHtml(it.s)}</small>` : ''}</a></li>`).join('');
    if (g.cfg.label && items.length > 1) {
      return `<li class="wtoc-group"><span class="wtoc-label">${escapeHtml(g.cfg.label)}${g.cfg.title ? ` <small>${escapeHtml(g.cfg.title)}</small>` : ''}</span><ol>${lis}</ol></li>`;
    }
    return lis;
  }).join('');
  for (const root of document.querySelectorAll('[data-web-toc]')) root.innerHTML = `<ol class="wtoc">${webToc}</ol>`;

  const chips = [];
  for (const g of tocModel) {
    const nav = g.cfg.nav;
    // book.json "navTo": 칩이 가리킬 원고 파일(예: 일정). 없으면 묶음의 첫 원고
    const want = g.cfg.navTo ? parts.find((s) => s.getAttribute('data-file') === g.cfg.navTo)?.id : null;
    const first = g.items.find((it) => !it.printOnly && (!want || it.id === want)) || g.items.find((it) => !it.printOnly);
    if (nav && first && !chips.some((c) => c.nav === nav)) chips.push({ nav, id: first.id, title: g.cfg.label });
  }
  for (const root of document.querySelectorAll('[data-day-nav]')) {
    root.innerHTML = chips.map((c) => `<a class="chip" href="#${c.id}" title="${escapeHtml(c.title || '')}">${escapeHtml(c.nav)}</a>`).join('');
  }

  // 쪽 참조: <span data-pageref="id"> 또는 data-pageref-file="90-credits.html"
  // data-pageref 의 id 는 원고(section.part)뿐 아니라 원고 안 아무 요소(상자, 소제목 등)여도 된다.
  // 원고 안 요소면 인쇄 패스가 그 요소에도 앵커를 심어 그 요소가 놓인 쪽을 찾는다(인쇄 감리 r2:
  // 「사흘 한눈에」의 결정 규칙·예약 표, 「줄 너머로」의 확인 목록이 원고 첫 쪽이 아닌 데 있었다).
  const partIds = new Set(parts.map((s) => s.id));
  const refTargets = new Set();
  for (const el of document.querySelectorAll('[data-pageref], [data-pageref-file]')) {
    let id = el.getAttribute('data-pageref');
    const f = el.getAttribute('data-pageref-file');
    if (!id && f) id = parts.find((s) => s.getAttribute('data-file') === f)?.id;
    if (id && !partIds.has(id)) {
      const target = document.getElementById(id);
      if (!target) log.warn(`쪽 참조 대상 없음: #${id} (${el.closest('section.part')?.getAttribute('data-file') || '?'})`);
      else if (!target.closest('section.part')) log.warn(`쪽 참조 대상 #${id} 가 원고 밖에 있습니다`);
      else refTargets.add(id);
    }
    const v = id ? pg(id) : '';
    if (v) el.textContent = v;
    else el.closest('.pageref-wrap')?.remove();
  }

  // --- 러닝헤드: 원고마다 이름 붙은 페이지(@page) ------------------------------------------
  const rules = [];
  const runOf = (s) => {
    const own = s.getAttribute('data-run');
    if (own) return own;
    const toc = s.getAttribute('data-toc') || textOf(s.querySelector('.part-title'));
    // 34자까지는 부제까지 단다(「Day 3 일정 · 항구의 아침, 기타로 열차로 공항까지」 31자. 인쇄 감리 r2)
    return toc.length > RUN_MAX ? splitToc(toc)[0] : toc;
  };
  parts.forEach((s, i) => {
    const g = groups.get(s.getAttribute('data-group')) || {};
    const verso = g.run || g.label || book.title;
    const recto = runOf(s) || book.title;
    const name = `pt${i}`;
    rules.push(`section[id=${cssString(s.id)}]{page:${name}}`);
    rules.push(`@page ${name}:left{@top-left{content:${cssString(verso)}}}`);
    rules.push(`@page ${name}:right{@top-right{content:${cssString(recto)}}}`);
  });
  const style = document.getElementById('page-rules');
  if (style) style.textContent = rules.join('\n');

  // --- 쪽 찾기 앵커(인쇄 패스에서만) -------------------------------------------------------
  if (state.markers) {
    for (const s of parts) {
      const span = document.createElement('span');
      span.className = 'pdf-anchor';
      span.setAttribute('aria-hidden', 'true');
      span.textContent = `ZZA[${s.id}]ZZ`;
      s.insertBefore(span, s.firstChild);
      // 원고 끝 앵커: 원고 상자 바닥에 절대 위치로 붙인다(흐름 밖이라 쪽을 새로 만들지 않는다)
      const end = document.createElement('span');
      end.className = 'pdf-anchor pdf-anchor-end';
      end.setAttribute('aria-hidden', 'true');
      end.textContent = `ZZE[${s.id}]ZZ`;
      s.appendChild(end);
    }
    // 쪽 참조 대상 요소: 요소 맨 앞에 앵커를 심는다. 표·목록은 첫 칸·첫 항목 안에(그 밖에 두면 HTML 이 깨진다).
    for (const id of refTargets) {
      const t = document.getElementById(id);
      const host = t.matches('table') ? (t.querySelector('th, td') || t)
        : t.matches('ul, ol') ? (t.querySelector('li') || t)
          : t.matches('dl') ? (t.querySelector('dt, dd') || t) : t;
      const span = document.createElement('span');
      span.className = 'pdf-anchor';
      span.setAttribute('aria-hidden', 'true');
      span.textContent = `ZZA[${id}]ZZ`;
      host.insertBefore(span, host.firstChild);
    }
  }
  // 앵커 순서(문서 순서): 원고와 쪽 참조 대상. 인쇄 패스가 이 순서로 장 시작 메모의 밀림을 더한다.
  const anchorOrder = [...document.querySelectorAll('section.part, [id]')]
    .filter((el) => partIds.has(el.id) ? el.matches('section.part') : refTargets.has(el.id))
    .map((el) => el.id);

  // --- 직렬화 -------------------------------------------------------------------------
  let html = '<!doctype html>\n' + document.documentElement.outerHTML;
  html = html.replace(/<svg-slot data-k="(\d+)"><\/svg-slot>/g, (_, k) => slots[Number(k)]);

  const info = {
    partOrder: parts.map((s) => s.id),
    anchorOrder,
    refTargets: [...refTargets],
    recto: new Set(parts.filter((s) => rectoFiles.has(s.getAttribute('data-file'))).map((s) => s.id)),
    titles: Object.fromEntries(parts.map((s) => [s.id, textOf(s.querySelector('.part-title')) || ''])),
    files: Object.fromEntries(parts.map((s) => [s.id, s.getAttribute('data-file')])),
    images: imgUsed,
    creditsDropped,
    memo: memoInfo,
    svgCount: svgN,
    qr: qrList,
    pageRules: rules.join('\n'),
  };
  return { html, info };
}
