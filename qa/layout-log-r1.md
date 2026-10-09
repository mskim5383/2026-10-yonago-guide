# 검수 1라운드 조판 반영 기록 (조판 디자이너, 2026-10-09)

## TL;DR

- 인쇄 감리(qa-print) 13건, 웹 검수(qa-web) 14건, 편집장 처리 기록(fix-log-r1)의 레이아웃 요청 6건을 봤다.
- **blocker 1건(QR 판독)은 해결했다.** 300dpi 렌더에서 QR 39개를 모두 읽었고, 링크도 모두 맞다. 크기는 15.5~18.9mm다(`node build/check-qr.mjs`, `qa/qr-check.json`).
- **major 5건 중 3건은 해결했다**(결정 규칙 상자 갈림, 모바일 목차 잘림, 모바일 지도 글자).
- 나머지 major 2건은 내 파일이 아니라서 담당에게 넘겼다. map-route 범례 잘림은 지도 작가, 웹판 URL 404는 배포 담당이다.
- 정식 빌드: **64쪽(4의 배수)**, 장 시작 맞춤 메모 1쪽(48쪽), 끝 메모 0쪽. 중철 접는 순서 PASS, `build/test-imposition.mjs` 합성 6종 + 실물 PASS.
- 빌드 경고는 1건이다. まるはち屋 지도 QR이 버전 8(L)이다. 판독은 되고, 인쇄 타일을 키워 모듈 0.384mm를 지켰다.
- 원고 문장은 바꾸지 않았다. 원고 파일에 클래스 힌트도 넣지 않았다(전부 CSS·빌드로 처리).

## 고친 파일

| 파일 | 바뀐 것 |
|---|---|
| `build/lib/assemble.mjs` | QR fill 경로 렌더, 지도 URL 단축, EC 자동 L, 상자 안 QR 띄우기, `lang="ja"` 자동 감싸기, 표 묶음 행·tbody 나누기, 지도 「크게 보기」 링크, `navTo`, 원고 끝 메모(`tailMemo`), `pageref-wrap` 허용 |
| `build/build.mjs` | 안 쓰는 사진 배포 제외, A5 쪽 크기 정규화 호출, QR 버전 경고·보고서 `qr`, 원고 끝 메모 패스 처리 |
| `build/print.mjs` | `normalizePageSize()` 추가: MediaBox·TrimBox 를 정확한 A5 로 |
| `build/lib/fonts.mjs` | fonts.css 의 unicode-range 를 책에 쓰인 글자로 좁힘 |
| `build/check-qr.mjs`, `build/qrscan.swift` (신규) | QR 판독 회귀 검사. 인쇄 감리의 `tmp/print-qa/qrscan.swift` 를 옮겼다 |
| `src/style.css` | 아래 항목별 |
| `src/template.html` | favicon, 표 안 ☐ 체크 토글 |
| `src/book.json` | 러닝헤드 표기, 칩 대상(`navTo`), `tailMemo` |
| `src/front/colophon.html`, `cover.html`, `real-diary.html` | 크레디트 링크, 웹 표지 문구, 진짜 일기 표 |
| `README.md`, `package.json` | 새 동작·`npm run qr` 설명 |

## 인쇄 감리(qa-print) 처리

| 심각도 | 지적 | 처리 | 내용 |
|---|---|---|---|
| blocker | QR 버전 7 이상 10개가 판독 불가 | **해결** | ① `qrSvg()` 를 `QRCode.create()` 의 모듈로 칸마다 사각형을 채우는 fill path 로 바꿨다(`shape-rendering=crispEdges`, 흰 바탕 rect 포함). ② 지도 URL 을 `https://maps.google.com/?q=` + 검색어(공백은 `+`)로 바꿔 21~22바이트 줄였다. ③ 버전이 6을 넘으면 EC 를 L 로 낮춘다. 결과는 v3~v6 38개, v8(L) 1개(まるはち屋 「紅ズワイガニらぁ麺 まるはち屋 米子鬼太郎空港」). ④ `build/check-qr.mjs` 로 300dpi 렌더 전량 디코드: **39/39 읽힘, 링크 일치, 15.5~18.9mm** |
| major | 결정 규칙 상자가 7~8쪽으로 갈림 | **해결** | 상자 맨 끝 단독 QR 을 빌드가 상자 맨 앞으로 옮겨 오른쪽 위에 띄운다(`a.qr.qr-float`, 라벨은 QR 아래, URL 줄은 숨김). 그런 상자는 `break-inside: avoid`. 7쪽에 상자 전체가 들어가고, 8쪽은 「출발 전 예약」 표에서 시작한다. 원고는 손대지 않았다 |
| major | map-route 범례 Day 2 줄 잘림 | **넘김(지도 작가)** | `assets/svg/map-route.svg` 76행. 정식 빌드(6쪽)에서도 「境線 귀」까지만 보인다. 조판 쪽에서는 고칠 수 없다 |
| major | 웹판 URL 404 | **넘김(배포 담당)** | `book.json` webUrl 은 그대로 두었다. 공개 경로가 바뀌면 이 값만 바꿔 다시 빌드하면 판권·뒤표지 QR 이 같이 바뀐다 |
| minor | p17→18 리드 문단 위도우 | 해결(재배치) | 22 지도가 `shorter`(편집장 반영)가 되고 표 여백이 줄어 리드 문단이 17쪽 안에서 끝난다 |
| minor | map-day2 범례 「케」가 테두리에 닿음, '비 안' 표기 | 넘김(지도 작가) | SVG 안 문제 |
| minor | QR 최소 크기(v3 이 14.96mm) | 해결 | 인쇄 타일 16.5mm(코드 15.4mm 이상), 칸 수가 많으면 `max(16.5mm, 칸 수 × 0.384mm)`. 상자 안 QR 에도 같은 규칙. 처음에 상자 안 QR 이 14.8mm 로 나와 높이 규칙을 고쳤다 |
| minor | 큰 빈자리(p26·p42·p31·p27·p55) | 부분 해결 | Day 1·3 일정 끝에 인쇄 전용 필기선 「NOTES」를 남은 자리만큼 붙였다(`book.json tailMemo`, 14쪽 8줄, 26쪽 13줄). Day 2(20쪽)는 자리가 없어 빌드가 뺐다. 31쪽은 「16개 역」 상자의 표 행 간격을 줄여 30~31쪽 쪽 구성이 바뀌었다(아래 「남은 것」). 42쪽은 편집장이 넣은 테이스팅 노트로 이미 찬다. 사진 추가(yonago-airport 등)는 원고·사진 담당 몫이라 하지 않았다 |
| minor | 양끝 맞춤 자간 벌어짐(p30·p34·p42) | 해결 | 양끝 맞춤 문단 안의 일본어는 `word-break: auto-phrase` 대신 일본어 금칙(`normal`+`strict`)으로 줄을 바꾼다. 『週刊少年マガジン』 같은 긴 구가 통째로 내려가지 않아 30쪽 자간이 고르게 됐다. `inter-word`·`auto` 정렬도 시험했지만 한글 띄어쓰기 틈이 더 벌어져 쓰지 않았다(tmp/designer/r1/jw·ja) |
| minor | 영업 캘린더 묶음이 쪽 사이에서 갈림 | 해결 | 빌드가 묶음 행을 `tr.group` 으로 표시하고 묶음마다 `tbody.grp` 로 나눈다. 인쇄에서 묶음을 가르지 않는다. 52쪽은 머리행 + 「가이케·요나고」 묶음 이름으로 시작한다. 인쇄 표 행 간격도 조금 줄였다 |
| minor | 디렉터리 2단 곁글이 괄호 한가운데에서 갈림 | 해결 | 감아 돌 본문이 없는 곁글은 2단 대신 판 너비 한 단으로 편다. 46·47쪽 「예비」 곁글이 한 덩어리로 읽힌다 |
| minor | 러닝헤드 대소문자·크레디트 이름 | 해결 | `run` 을 `Day 1 · 10.12 월` 형식으로, 크레디트 `run` 을 「사진과 참고 자료」로. **장 첫 쪽 러닝헤드 생략은 하지 않았다.** Chrome 에서 이름 붙은 페이지의 `:first` 가 적용되지 않는 것을 시험으로 확인했다(tmp/designer/r1/firsttest) |
| minor | 크레디트 출처·라이선스 URI 없음 | 넘김(사진 에디터) | `90-credits.html` 내용 추가가 필요하다 |
| minor | A5 쪽 크기 0.1~0.2mm 차이 | 해결 | Chrome 출력(420×594.96pt)을 pdf-lib 로 정확한 A5(419.53×595.28pt)로 맞추고 MediaBox=CropBox=TrimBox=BleedBox. 중철 PDF 는 A4 가로 841.89×595.28pt. 도련판은 만들지 않았다(README 안내 유지) |

## 웹 검수(qa-web) 처리

| 심각도 | 지적 | 처리 | 내용 |
|---|---|---|---|
| major | 모바일 목차 팝오버가 왼쪽으로 32px 잘림 | **해결** | 520px 이하에서 패널을 상단 바 기준(`left:12px; right:12px`)으로 편다. 실측: 390 → 12~378px, 360 → 12~348px, 320 → 12~308px |
| major | 모바일 지도 글자 7px | **해결** | 720px 이하에서 지도·도판을 620px 폭으로 그리고 가로로 밀어 본다. viewBox 1000 기준 font-size 21 라벨이 약 13px 로 그려진다(390 기준, 이전 7.1px. 6개 도판 모두 620px 폭, 감싼 상자 안에서만 스크롤). 캡션 끝에 웹 전용 「크게 보기 ↗」 링크(원본 SVG, 핀치 줌 가능)를 달았다. 페이지 가로 스크롤은 없다(390·360·320 실측) |
| minor | 폰트 첫 로드 7.29MB | 부분 해결 | fonts.css 의 unicode-range 를 책에 쓰인 글자로 좁혀 493KB → 179KB. woff2 파일 서브셋(pyftsubset·subset-font)은 이 환경에 fontTools 가 없어 하지 않았다 |
| minor | 안 쓰는 사진 19장 배포 | 해결 | 책에 쓰인 10장만 `dist/assets/img` 로(3.4MB). manifest.json 도 배포하지 않는다 |
| minor | map-route·map-sakaiminato 라벨 잘림 | 넘김(지도 작가) | SVG 안 문제. 인쇄본 12·45쪽에서도 「기념관」 끝이 잘려 보인다 |
| minor | 반쪽 사진·곁글 float 빈칸(721px 이상) | 해결 | 인쇄와 같은 판정으로, 뒤에 감아 돌 본문이 없으면 띄우지 않는다. 사진 58% + 캡션 오른쪽 아래. 768·1280 에서 9장 중 8장이 이 배치, mihonoseki 1장만 본문과 함께 뜬다 |
| minor | lang 속성 | 부분 해결 | 크레디트 작가명·QR 라벨(Tabelog 三光水産 등)의 가나·한자를 `span lang="ja"` 로 감싼다. 화면 본문에서 lang 밖 일본어 텍스트 0건(실측). SVG 라벨은 지도 작가 몫 |
| minor | 「괴담」 표 가로 25px 스크롤 | 해결 | 520px 이하에서 표 칸 `overflow-wrap: anywhere`. 390·360·320 에서 넘치는 표 0개 |
| minor | 웹 판권의 「(60쪽)」 | 해결 | `.pageref-wrap` 은 화면에서 숨긴다. 판권 「크레디트 쪽」은 `#credits` 링크. `pageref-wrap` 을 원고 허용 클래스에 넣었다(편집장 요청 5). 표지의 「그리고 빈 페이지」는 인쇄 전용 |
| minor | 웹판 URL·뒤표지 QR 404 | 넘김(배포 담당) | 위와 같음 |
| minor | favicon 404 | 해결 | 인라인 SVG 아이콘(쪽빛 바탕, 물결 두 줄). 콘솔 에러 0건(5개 폭 실측) |
| minor | 「출발 전 예약」 ☐ 가 눌리지 않음 | 해결 | 표 칸이 ☐ 하나뿐이면 누르면 ☑ 로 바뀌고 체크리스트와 같은 localStorage 키에 저장한다. 5칸 토글 확인 |
| minor | D1~D3 칩이 일기로 감 | 해결(판단) | 현지에서 쓰는 건 시간표라 칩을 Day 일정으로 바꿨다(`book.json navTo`). 일기는 목차에서 간다 |

## 편집장 처리 기록(fix-log-r1)의 레이아웃 요청

| 요청 | 처리 |
|---|---|
| 2. 02 결정 규칙 상자 쪼개짐 | 해결(위 major) |
| 4. 진짜 일기 「오늘 마신 것」 온도 칸, 6줄 이상 | 해결. 61~63쪽 표가 무엇·어디서·온도(冷 · 常温 · 燗 에 동그라미)·몇 점 4칸, 6줄 |
| 5. `pageref-wrap` 허용 클래스 | 해결. 원고에서 `span.print-only` 를 `span.pageref-wrap` 으로 바꿔도 된다(쪽번호가 비면 괄호째 지워진다) |
| 6. 정식 빌드 | 해결. `dist/`, `qa/pages/`, `qa/booklet/`, `qa/web/`, `qa/build-report.json`, `qa/qr-check.json` 갱신 |
| 1·3 지도 범례, 웹판 404 | 담당에게 넘김(위) |

## 검증

```
node build/build.mjs            # 64쪽, 장 시작 맞춤 메모 1(48쪽), 끝 메모 0, 접는 순서 PASS, 경고 1(QR v8)
node build/render-pages.mjs     # qa/pages 64장, qa/booklet 32장
node build/web-shots.mjs        # 390·1280 가로 스크롤 없음
node build/check-qr.mjs         # QR 판독 PASS: 기대 39 · 읽힘 39 · 15.5~18.9mm (300dpi, PDFKit)
node build/test-imposition.mjs  # 합성 4·8·12·16·64·72쪽 + 실물 64쪽 PASS
```

- 차례 쪽번호 21개는 빌드가 예측 쪽과 PDF 제목을 대조한다(경고 0). 판권 「60쪽」 참조도 맞다.
- 쪽 미리보기를 펼침면으로 전부 확인했다: 넘침·잘림 없음, 장은 원칙대로 오른쪽 쪽에서 시작(Day 1 9, Day 2 15, Day 3 21, 읽을거리 27, 실용 49), 제목만 쪽 끝에 남는 곳 없음, 장소 카드가 갈린 곳 없음.

## 남은 것

- **map-route(6쪽) 범례 잘림**, map-sakaiminato(12·45쪽) 「기념관」 잘림, map-day2 범례: 지도 작가.
- **웹판 URL 404**: 배포 담당. 인쇄 전에 200 확인이 필요하다.
- 31쪽 아래 약 1/4, 32쪽 아래 약 1/5, 47쪽 아래 약 1/5, 59쪽 아래 약 1/3 이 빈다. 31쪽은 「16개 역」 상자가 32쪽 첫머리로 가서 생긴다(상자는 가르지 않는 규칙). 원고 분량이 바뀌면 다시 봐야 한다.
- 20쪽(Day 2 장소 카드) 아래 약 1/6 이 빈다. 원고 끝 메모가 4줄도 안 들어가 빌드가 뺐다.
- まるはち屋 지도 QR 은 버전 8이라 타일이 18.9mm 로 다른 QR 보다 크다. 원고의 `data-maps` 를 「まるはち屋 米子空港」처럼 줄이면 v6 이하가 된다(54 담당 판단).
- 장 첫 쪽 러닝헤드 생략은 Chrome 이 이름 붙은 페이지의 `:first` 를 지원하지 않아 하지 않았다.
- 폰트 woff2 서브셋은 하지 않았다(fontTools 없음). dist 는 46MB(폰트 15MB, PDF 2종 27MB).
- 실제 종이 인쇄와 휴대폰 스캔은 하지 못했다. QR 판독은 300dpi 래스터 + macOS Vision 기준이다.
