// pdfjs-dist 로 PDF 의 쪽별 텍스트(위치 포함)를 읽는다.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from './util.mjs';

let pdfjs;
async function lib() {
  if (!pdfjs) pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  return pdfjs;
}

const base = path.join(ROOT, 'node_modules', 'pdfjs-dist');
const dirUrl = (d) => pathToFileURL(path.join(base, d) + path.sep).href;

/**
 * @returns {Promise<Array<{num:number,width:number,height:number,text:string,items:Array<{str:string,x:number,y:number,w:number,h:number,rot:number}>}>>}
 */
export async function readPdfText(bytes) {
  const { getDocument } = await lib();
  const task = getDocument({
    data: new Uint8Array(bytes),
    cMapUrl: dirUrl('cmaps'), cMapPacked: true,
    standardFontDataUrl: dirUrl('standard_fonts'),
    disableFontFace: true, isEvalSupported: false, verbosity: 0,
  });
  const doc = await task.promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const [x0, y0, x1, y1] = page.view;
    const tc = await page.getTextContent();
    const items = tc.items.filter((it) => typeof it.str === 'string').map((it) => {
      const [a, b, , , e, f] = it.transform;
      return {
        str: it.str, x: e, y: f, w: it.width, h: it.height,
        rot: Math.round((Math.atan2(b, a) * 180) / Math.PI),
      };
    });
    pages.push({ num: i, width: x1 - x0, height: y1 - y0, text: items.map((t) => t.str).join(''), items });
    page.cleanup();
  }
  await task.destroy();
  return pages;
}
