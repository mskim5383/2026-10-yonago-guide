# 바다 쪽으로 사흘 · 요나고·사카이미나토 여행 가이드북

여행 가이드북 02 (2026.10.12–14). 원고 하나로 웹판과 인쇄판을 같이 만든다.

| 산출물 | 파일 | 용도 |
|---|---|---|
| 웹 | `dist/index.html` + `dist/assets/` | GitHub Pages. 모바일 우선, 라이트 테마 |
| A5 낱장 PDF | `dist/yonago-guide-a5.pdf` | 인쇄소에 맡기거나 화면으로 보기. 1쪽 = 표지, 마지막 쪽 = 뒤표지 |
| A4 중철 PDF | `dist/yonago-guide-booklet-a4.pdf` | 집 프린터로 소책자 만들기. A4 가로 한 면에 A5 두 쪽 |

편집 기준은 `BRIEF.md`, 사실 근거는 `research/` 에 있다.

---

## 1. 준비

- Node.js 20 이상, `npm install`
- Google Chrome: 기본 경로 `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`.
  다른 곳에 있으면 `CHROME_PATH=/path/to/chrome` 을 붙여 실행한다.
- 미리보기 PNG: macOS 는 기본 `swift`(PDFKit)를 쓰고, 없으면 pdf.js 로 그린다.
- 서체는 `@fontsource` 패키지(Noto Serif/Sans KR·JP, SIL OFL 1.1)에서 빌드가 직접 복사한다.
  책에 실제로 쓰인 글자가 든 조각만 `dist/assets/fonts/` 로 들어간다.

## 2. 빌드

```bash
node build/build.mjs              # 웹 + A5 PDF + A4 중철 PDF + 접는 순서 검증 (30초 안팎)
node build/build.mjs --html-only  # 웹 HTML 만 (목차 쪽번호 없음, 몇 초)
node build/render-pages.mjs       # PDF 를 PNG 로: qa/pages/p-001.png …, qa/booklet/b-001.png …
node build/web-shots.mjs          # 웹 스크린샷 390×844·1280×900: qa/web/, 가로 넘침 검사 qa/web/overflow.json
node build/test-imposition.mjs    # 중철 순서 테스트 (합성 4~72쪽 + dist 의 실물)
node build/check-qr.mjs           # QR 판독 검사(macOS): A5 PDF 300dpi → Vision 디코드, 링크·15mm 대조 → qa/qr-check.json
node build/check-web.mjs          # 배포 게이트: webUrl·PDF 공개 주소가 200 인지 → qa/web-url-check.json (아니면 종료 코드 1)
```

`npm run build`, `npm run pages`, `npm run shots`, `npm test`, `npm run all`, `npm run web-check` 도 같다.

**인쇄 전 게이트**: 판권 「웹판」 줄과 뒤표지 QR 은 `book.json` 의 `webUrl` 을 가리킨다. `dist/` 를 공개 배포한 뒤 `node build/check-web.mjs` 가 PASS 일 때만 인쇄한다.

**배포**: GitHub Pages 는 `main` 브랜치의 `docs/` 를 그대로 올린다. 빌드 뒤 `npm run publish:docs`(`dist/` → `docs/` 복사 + `.nojekyll`)를 하고 `docs/` 까지 commit·push 한다.
공개 주소: https://mskim5383.github.io/2026-10-yonago-guide/

빌드 옵션 (원고·자산·출력 위치를 바꿔 시험할 때):

```bash
node build/build.mjs --parts tmp/designer/parts --assets tmp/designer/assets \
  --out tmp/designer/dist --report tmp/designer/qa/build-report.json
```

| 옵션 | 기본값 | |
|---|---|---|
| `--parts` | `src/parts` | 원고 조각 폴더 |
| `--front` | `src/front` | 표지·판권·차례·진짜 일기·메모·뒤표지 |
| `--assets` | `assets` | `img/`(사진 + `manifest.json`), `svg/`(지도·도판) |
| `--out` | `dist` | 출력 폴더. 빌드 시작 때 비운다(숨김 파일 제외) |
| `--report` | `qa/build-report.json` | 원고별 시작 쪽, 메모 쪽 수, 경고 목록 |
| `--no-booklet` / `--keep-pass` | | 중철 PDF 생략 / 인쇄 패스용 `_pass.html` 남기기 |

빌드가 끝나면 경고를 모아 보여 준다. 자주 나오는 것:

- `사진 없음 → figure 제외: <id>`: `assets/img/manifest.json` 에 항목이 없거나 파일이 없다. 그 figure 는 빠진다.
- `도판 없음 → figure 제외: <id>`: `assets/svg/<id>.svg` 가 없다.
- `규약 밖 클래스`, `인라인 style 속성`, `em dash`: BRIEF 4·5장 위반. style 속성과 `<style>`·`<script>` 는 빌드가 지운다.
- `총 N쪽이 최대 72쪽을 넘습니다`: 원고를 줄이거나 `src/book.json` 의 구성을 바꿔야 한다.

## 3. 빌드가 하는 일

1. `src/book.json` 의 `sequence` 순서대로 `src/front/` 와 `src/parts/` 조각을 `src/template.html` 의 `{{content}}` 자리에 넣는다. HTML 주석은 모두 지운다. 없는 원고는 경고만 하고 건너뛴다.
2. `figure[data-img="<id>"]` → `assets/img/manifest.json` 으로 `<img>`(src, alt, width, height)와 크레디트 한 줄(`figcaption .credit`)을 채운다. 항목이나 파일이 없으면 figure 를 뺀다.
3. `figure[data-svg="<id>"]` → `assets/svg/<id>.svg` 를 인라인으로 넣는다. SVG 안의 id 와 `<style>` 은 그 그림 안으로만 적용되게 접두어를 붙인다.
4. `div.place` 의 `data-maps`(구글맵 검색어 → `https://maps.google.com/?q=…`)와 `data-url`(+`data-url-label`)로 QR 타일을 만든다. `a.qr[data-qr]` 도 QR 로 바꾼다. 웹 좁은 화면에서는 QR 대신 "지도 열기" 같은 버튼으로 보인다.
   - QR 은 칸마다 채운 사각형(fill path)으로 그린다. 오류 정정 M, 버전이 6을 넘으면 L 로 낮춘다. 그래도 7 이상이면 빌드 경고가 나오고, 인쇄 타일이 모듈 0.384mm 를 지키도록 커진다(검색어를 줄이면 작아진다).
   - 상자(`aside.box`) 맨 끝의 단독 QR 은 상자 오른쪽 위로 옮겨 띄우고, 그 상자는 쪽 사이에서 가르지 않는다.
5. 차례: `section.part` 의 `data-toc`(형식 `제목 · 부제`)로 인쇄 차례(`src/front/toc.html`)와 웹 목차·Day 바로가기를 만든다. 묶음 이름과 겹치는 머리말(예: DAY 2 묶음 안의 "Day 2 일정")은 줄인다.
6. 러닝헤드: 원고마다 이름 붙은 `@page` 를 만들어, 왼쪽 쪽 위에는 묶음 이름(`run`), 오른쪽 쪽 위에는 원고 이름(`data-run` 이 있으면 그것, 없으면 `data-toc`. 34자를 넘으면 ` · ` 앞 제목만)을 단다. 쪽번호는 아래 바깥쪽.
7. 인쇄 2-pass: 원고마다 보이지 않는 앵커를 심어 PDF 를 만들고 pdfjs 로 각 원고가 시작하는 쪽을 찾는다.
   `data-pageref="<id>"` 가 원고 안 요소(상자·소제목 등)를 가리키면 그 요소에도 앵커를 심어 그 요소가 놓인 쪽을 넣는다(보고서 `pages.refs`).
   - `"start": "recto"` 묶음(Day 1·2·3, 읽을거리, 실용)의 첫 원고가 짝수(왼쪽) 쪽이면 앞에 메모 페이지 1쪽을 끼운다.
   - 총 쪽수가 4의 배수가 되도록 뒤표지 앞에 메모 페이지를 더한다.
   - 찾은 쪽번호를 차례에 넣어 다시 출력하고, 예측과 같아지면 앵커를 뺀 최종본을 `dist/index.html` 로 쓰고 그 파일을 그대로 인쇄한다.
   - 필기선(`.memo-lines`)은 줄마다 앵커를 심어, 쪽 끝에서 넘친 줄 수만큼 다음 패스에서 줄인다(최소 1줄). 원고 맨 끝 상자 안의 필기선은 상자 아래 여백만 넘어가도 1줄로 센다. 결과는 보고서 `memoLines`(요청 줄 수 / 실제 줄 수).
8. 임포지션(`build/impose.mjs`)으로 A4 중철 PDF 를 만들고, 접는 순서를 쪽번호·내용으로 대조한다.

그 밖에 조립 때 하는 일:

- 크레디트 표의 `tr[data-img]` 중 책에 실리지 않은 사진 행은 뺀다.
- 원고 본문의 전화번호(`0859-44-5489`, `+81-82-505-2100`)는 `span.nobr` 로 감싸 하이픈 뒤에서 줄이 갈리지 않게 한다.
- 표의 묶음 행(한 칸이 모든 열을 차지하는 행, 예: 영업 캘린더의 「사카이미나토」)은 `tr.group` 이 되고, 묶음마다 `tbody.grp` 로 나뉜다. 인쇄에서 묶음은 쪽 사이에서 가르지 않는다.
- 지도(`figure.map`) 캡션 끝에 웹 전용 「크게 보기」 링크(원본 SVG)를 단다. 720px 이하 화면에서는 지도를 620px 폭으로 그려 옆으로 밀어 본다.
- 크레디트 줄·QR 라벨의 가나·한자는 `span lang="ja"` 로 감싼다.
- 표 칸이 `☐` 하나뿐이면 웹에서 누르면 체크되는 칸이 된다(체크리스트와 같은 저장).
- 책에 실리지 않은 사진은 `dist/assets/img` 에 복사하지 않는다.
- A5 PDF 쪽 크기를 정확한 A5(419.53×595.28pt, MediaBox=TrimBox)로 맞춘다(Chrome 출력은 420×594.96pt).
- 본문 8행 이하의 표는 `.table-wrap.keep`(쪽 사이에서 가르지 않음). 칸 내용이 짧은 구간(`→` 포함 28자 이하)이면 `td.nw`(인쇄에서 한 줄).

### 조판 힌트 (원고에 붙여도 되는 클래스)

원고 문장은 그대로 두고, 쪽 나눔만 고칠 때 쓴다. 빌드는 이 클래스를 규약 밖으로 보지 않는다.

| 클래스 | 붙이는 곳 | 효과(인쇄) |
|---|---|---|
| `short` / `shorter` | `figure.map` | 지도 높이 상한 125mm → 100mm / 85mm |
| `keep` | 아무 블록, `table.data` | 쪽 사이에서 가르지 않는다(표는 행 수와 상관없이) |
| `break-before` | 아무 블록 | 이 앞에서 쪽을 나눈다 |
| `pageref-wrap` | 쪽 참조 괄호 `span` | 쪽번호가 비면 통째로 지우고, 웹에서는 숨긴다 |
| `id` + `data-pageref` | 대상 요소에 `id`, 쪽 참조 `span` 에 `data-pageref="<id>"` | 원고 첫 쪽(`data-pageref-file`)이 아니라 그 요소가 놓인 쪽 번호를 넣는다. 「~의 결정 규칙」처럼 특정 항목을 가리킬 때 쓴다 |

자동으로 바뀌는 배치(힌트 불필요):

- `figure.photo.half` 뒤에 감아 돌 본문이 없으면(다음이 `h2`·장소 카드·상자·표·지도 등이거나 원고 끝) 떠 있지 않고, 사진 왼쪽 52% + 캡션 오른쪽 아래로 놓인다. 혼자 다음 쪽으로 밀려 빈자리를 남기지 않게 하려는 것이다.
- `aside.sidenote` 뒤에 감아 돌 본문이 없으면 좁은 기둥 대신 판 너비 2단으로 놓인다.
- `dl.phrases` 는 인쇄에서 뜻(왼쪽 32%)과 일본어·발음(오른쪽) 두 칸이다. A5 한 쪽에 12~13문장이 들어간다.
- 연달아 오는 단독 QR(`a.qr` 두 개)은 한 줄에 나란히. 상자 맨 끝의 QR 은 앞 항목과 떨어져 다음 쪽으로 가지 않는다.
- 일본어(`span.ja`)는 Chrome 의 `word-break: auto-phrase` 로 구 단위 줄바꿈. QR 은 인쇄에서 코드 부분이 15mm 이상(타일 16mm).
- 장소 카드 안의 QR 타일(「지도」·「Tabelog」 등)은 그 카드에서 가장 큰 QR 에 맞춰 같은 크기로 그린다. 라벨이 같은 높이에 선다.
- 떠 있는 반쪽 사진 바로 뒤 문단(읽는 글)은 인쇄에서 왼쪽 맞춤. 좁은 단의 양끝 맞춤이 글자 사이를 벌리지 않게 한다. 사진은 감아 돌 문단 바로 앞에 둔다.
- 크레디트 표(`tr[data-img]`)의 라이선스 칸은 `manifest.json` 의 `licenseUrl` 로 링크하고, 표 아래에 「라이선스 원문」 주소 목록을 붙인다(인쇄에도 주소가 나온다).

### 사진 목록 `assets/img/manifest.json`

id 를 키로 하는 객체(또는 `{id, …}` 배열, `{"images": …}` 도 받는다):

```json
{
  "cover-yumigahama": {
    "file": "cover-yumigahama.jpg",
    "alt": "유미가하마 모래톱 너머의 다이센",
    "width": 1600, "height": 1067,
    "author": "작가 이름", "license": "CC BY-SA 4.0",
    "source": "https://commons.wikimedia.org/wiki/File:…"
  }
}
```

크레디트 줄은 `credit` 문자열이 있으면 그대로, 없으면 `사진 <author> · <license>` 로 만든다. `width`/`height` 가 없으면 파일에서 읽는다.

### 원고 순서 `src/book.json`

```jsonc
{ "group": "day2", "label": "DAY 2", "title": "10/13(화) …", "nav": "D2",
  "run": "DAY 2 · 10.13 화", "start": "recto",
  "parts": ["21-day2-diary.html", "22-day2-plan.html"] }
```

- `label`·`title`: 차례의 묶음 머리. 원고가 하나뿐인 묶음은 묶음 머리 없이 원고만 나온다.
- `nav`: 웹 상단 바로가기 칩 이름(D1·D2·D3).
- `run`: 왼쪽 쪽 러닝헤드.
- `start: "recto"`: 이 묶음은 오른쪽(홀수) 쪽에서 시작. 쪽이 모자라면 이 값을 지우면 메모 쪽이 줄어든다.
- `{ "filler": "end" }`: 4의 배수 맞춤 메모 쪽이 들어가는 자리(뒤표지 바로 앞).
- `navTo`: 웹 칩이 가리킬 원고 파일(지금은 Day 일정). 없으면 묶음의 첫 원고.
- `tailMemo`: `{ "parts": [...], "lines": 24, "min": 4 }`. 이 원고들 끝에 인쇄 전용 필기선(NOTES)을 붙여 마지막 쪽 빈자리를 채운다. 남은 자리만큼만 남기고, `min` 줄도 안 들어가면 뺀다(보고서 `memoLines` 의 `tailMemo`·`dropped`).
- `serifKinds`: 이 `data-kind` 값의 원고는 세리프(일기·읽을거리), 나머지는 산세리프(실용).

## 4. 인쇄

### A. 집에서 A4 양면 → 중철 소책자 (`yonago-guide-booklet-a4.pdf`)

1. **먼저 한 장만 시험한다.** 인쇄 범위를 1–2쪽(첫 번째 종이의 앞뒤)으로 두고 아래 설정으로 뽑는다.
   종이를 반으로 접었을 때 표지(1쪽)를 넘기면 2쪽, 반대편 바깥이 뒤표지면 맞다.
2. 프린터 설정
   - 용지 **A4**, 방향은 자동(가로 페이지가 세로 종이에 돌아 들어가도 괜찮다)
   - 배율 **실제 크기(100%)**. "용지에 맞춤", "축소", "여러 쪽 모아 찍기"는 끈다
   - **양면 인쇄: 짧은 쪽으로 넘기기**(Flip on short edge / 짧은 쪽 철). 긴 쪽으로 넘기면 뒷면이 거꾸로 나온다
   - 컬러, 보통 이상 품질
3. 다 뽑히면 **순서를 바꾸지 말고** 그대로 겹친다. 첫 장(표지·뒤표지가 찍힌 장)이 맨 바깥이 되게 놓고,
   묶음 전체를 가운데에서 한 번에 반으로 접는다.
4. 접힌 선을 따라 스테이플러 2곳(위·아래 1/4 지점). 긴 중철 스테이플러가 없으면 펼친 채 지우개나 골판지를 받치고
   바깥에서 박은 뒤 안쪽 심을 접는다.
5. 양면 기능이 없는 프린터: 홀수 면(1, 3, 5 … 번째 PDF 면)만 먼저 뽑고, 뽑힌 뭉치를 다시 넣어 짝수 면을 뽑는다.
   다시 넣는 방향은 프린터마다 달라서 1번의 시험 인쇄로 먼저 맞춘다.

참고: 쪽수가 N이면 종이는 N/4장이다(64쪽 = 16장, 72쪽 = 18장). 80g 복사지 18장은 일반 스테이플러로 겨우 박히는 두께다.
가정용 프린터는 가장자리 3~5mm 를 못 찍으므로 표지 사진 둘레가 흰 테두리로 남는다. 본문 여백은 바깥 11mm, 접는 쪽 16mm 라서 잘리지 않는다.

### B. 인쇄소에 맡기기 (`yonago-guide-a5.pdf`)

- 파일: A5(148×210mm) 낱장 PDF. 1쪽이 표지, 마지막 쪽이 뒤표지, 총 쪽수는 4의 배수.
- 주문: "A5 중철 제본, 본문·표지 양면 컬러, 총 N쪽"(N 은 PDF 쪽수). 표지만 두꺼운 종이로 하려면 1·2쪽과 마지막 두 쪽이 표지 용지에 들어간다고 알려 준다.
- 도련(재단 여분 3mm)이 없는 PDF 다. "재단 없이" 또는 "표지 사진 가장자리 흰 여백 1~2mm 허용"으로 요청한다.
- 서체는 PDF 에 들어 있다(부분 포함). 색은 RGB.

## 5. 파일 구조

```
BRIEF.md                 편집 기획서 (사실 기준표, 원고 배정, 컴포넌트 규약)
research/                취재 자료
src/book.json            원고 순서·묶음·러닝헤드·장 시작 규칙
src/template.html        웹 껍데기(상단 바, 목차 팝오버, 옆 차례, 스크립트)
src/style.css            웹 + 인쇄 공용 스타일 (@page, 러닝헤드, 쪽번호)
src/front/               표지, 판권(+제사·기호 안내), 차례 틀, 진짜 일기 3쪽, 메모 쪽 틀, 뒤표지
src/parts/               원고 조각 (기자·에디터)
assets/img, assets/svg   사진(+manifest.json)·지도
build/build.mjs          조립 + 2-pass 인쇄 + 임포지션 + 검증
build/print.mjs          Chrome(puppeteer-core) 인쇄
build/impose.mjs         A4 중철 임포지션 (단독 실행 가능)
build/test-imposition.mjs  접는 순서 테스트
build/render-pages.mjs   PDF → PNG (render-pages.swift 사용)
build/web-shots.mjs      웹 스크린샷·가로 넘침 검사
build/lib/               조립, 폰트, PDF 텍스트, 정적 서버
qa/                      검수 기록 (편집장 보고서, 수정·조판 로그, build-report.json). PNG 렌더(pages/, booklet/, web/)는 commit 하지 않는다
docs/                    GitHub Pages 공개본 (dist/ 사본)
```

인쇄 출력은 Chrome 이 `print` 미디어로 그린다. 웹폰트가 `file://` 에서 막히므로 빌드는 잠깐 로컬 http 서버를 띄워 출력한다.
