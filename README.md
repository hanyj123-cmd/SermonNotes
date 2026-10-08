# 말씀결 (sermon-notes) — v9

교회 유튜브 설교 영상의 자막을 Gemini AI가 **4가지 방식**으로 정리해 주는 웹앱입니다. 개혁주의(대한예수교장로회 합동·통합) 신학 기준으로 쓰도록 프롬프트가 설계되어 있습니다 (`scripts/lib/prompt.mjs`).

| 모드 | 내용 |
|---|---|
| **설교리뷰** | 설교 정리(대지별) + Summary |
| **QT 묵상** | 여는 기도 · 찬송가 1곡+CCM 1곡 · 4역본 성경 · 잔잔한 묵상 음악 1곡(설교마다 다르게) · QT 정리 · 묵상 질문 · 삶의 적용(로그인하면 내 글 저장) · 맺는 기도 |
| **성경공부** | 여는 기도 · 찬양 · 성경 · 신학 딥다이브(원어·주석) · Summary · 퀴즈 15문제(객관식 5·빈칸 5·주관식 5, 답은 [답보기]로) · 맺는 기도 |
| **소그룹 나눔** | 대표 기도 · 찬양 · 정리 · 적용 · 질문(로그인 메모 / 핸드아웃 줄 / [모범 답안 보기]) · 삶 나눔·기도제목 나눔 가이드 · 맺는 기도 |

모든 설교 화면 위쪽에는 **한 줄 정리 · 영상 보기 · 핸드아웃 PDF 버튼 · 4가지 모드 탭**이 있습니다.

## 화면 구성

- **토론토영락교회 설교**: 주일예배 → 새벽기도 → 수요예배 → 청년부예배 (고정 순서). 날짜 · 설교자 · 성경 본문(성경 순서)으로 거를 수 있습니다.
- **사용자 영상**: 유튜브 링크를 넣고 날짜·제목·성경 본문·설교자를 직접 입력하면(비워도 됨) 같은 형식으로 정리됩니다. 올린 영상은 로그인한 가족 모두가 볼 수 있습니다.
- **관리** (오른쪽 위): 재생목록 · 영상 선택 정리 · AI 모델 · 지금 동기화.
- 흰 배경에 파랑 + 연두색, 다크 모드 없음. 오른쪽 위 슬라이더로 글자 크기를 바꿀 수 있습니다.

## 자동 수집 시각 (토론토 시간)

| 구분 | 자동 수집 |
|---|---|
| 수요예배 | 매주 목요일 오전 7:00 |
| 주일예배 | 매주 일요일 밤 10:00 |
| 새벽기도회 | 매일 오전 11:00 |
| 청년부예배 | 자동 없음 — 관리 화면 "지금 동기화"에서 체크하고 직접 실행 |

GitHub 예약은 UTC만 되고 토론토는 서머타임이 있어서, `sync.yml` 에 여름·겨울용 예약을 둘 다 등록하고 `scripts/gate.mjs` 가 맞는 쪽만 실행합니다. 직접 실행은 시각과 상관없이 항상 실행됩니다. 사용자 영상과 "다시 정리"로 표시한 영상은 어떤 실행에서든 먼저 처리됩니다.

영상 제목이 `[YYYY.MM.DD] 설교제목 (성경본문) - 설교자` 형식이면 날짜 · 제목 · 본문 · 설교자가 자동으로 태그됩니다.

## 어떻게 돌아가나요

```
Google Sheet (Playlists · Sermons · Notes · Settings 탭)
        │
        ▼  GitHub Actions (예약 / 수동)
  YouTube 새 영상 확인 → 자막 수집 → Gemini(4모드 각각) → 성경 4역본(웹사이트에서 읽기) → 찬양·배경음악 영상 찾기
        │
        ▼
docs/data/sermons.json (목록) + docs/data/s/<영상ID>.json (설교별 상세) 커밋 → GitHub Pages
        ▲
Apps Script 웹앱 (관리 · 구글 로그인 · 개인 노트 · 사용자 영상 · "지금 동기화" 버튼)
```

## 준비물

| 항목 | 용도 |
|---|---|
| GitHub 계정 | 코드·웹사이트 호스팅 |
| Google 서비스 계정 키(JSON) | 시트 읽기/쓰기 |
| YouTube Data API 키 | 재생목록 · 영상 정보 · 찬양/배경음악 검색 |
| Gemini API 키 | 설교 정리 ([Google AI Studio](https://aistudio.google.com/apikey)) |
| (선택) Supadata API 키 | 자막이 안 받아질 때 대체 수단 (유료 크레딧). 없으면 Gemini가 영상을 직접 듣고 옮깁니다 |

성경 본문에는 **API 키가 필요 없습니다** (아래 참고).

## 설정 순서 (처음 한 번)

1. **Google Sheet** 만들기 — 첫 탭 이름 `Playlists`, 1행 `category · playlist_url · max_videos`. `category` 는 `주일예배 / 새벽기도 / 수요예배 / 청년부예배` (또는 `sunday / dawn / wednesday / youth`). 나머지 탭(Sermons · Notes · Settings)은 자동으로 만들어집니다. 주소창의 `/d/`**`여기`**`/edit` 가 `SHEET_ID`.
2. **Google Cloud**: Google Sheets API + YouTube Data API v3 사용 설정 → API 키(= `YOUTUBE_API_KEY`) → 서비스 계정 만들고 JSON 키 내려받기(= `GOOGLE_SERVICE_ACCOUNT_JSON`) → 서비스 계정 이메일을 시트 **편집자**로 공유.
3. **GitHub**: 새 저장소에 이 폴더를 올리고(`.env` 제외), Settings → Secrets and variables → Actions 에 `SHEET_ID`, `GOOGLE_SERVICE_ACCOUNT_JSON`, `YOUTUBE_API_KEY`, `GEMINI_API_KEY` (선택: `SUPADATA_API_KEY`) 등록. 선택 Variables: `GEMINI_MODEL`, `MAX_NEW_PER_RUN`(5), `RETRY_DAYS`(7), `AUTO_WITHIN_DAYS`(14), `GEMINI_VIDEO`(off 로 두면 영상 직접 분석 끔).
4. **Pages**: Settings → Pages → Deploy from a branch → `main` / `/docs`.
5. **Apps Script**: 시트의 확장 프로그램 → Apps Script 에 `apps-script/Code.gs` 를 붙여넣고, 스크립트 속성에 `ADMIN_PASSWORD`, `GOOGLE_CLIENT_ID`, `ALLOWED_EMAILS`(가족 구글 계정, 쉼표로), `GITHUB_TOKEN`·`GITHUB_REPO`(앱에서 "지금 동기화"를 쓰려면) 입력 → 배포 → 웹 앱 주소를 `docs/config.js` 의 `ADMIN_API_URL` 에.
   - **이미 배포한 적이 있다면**: 코드를 바꿔 붙인 뒤 **배포 관리 → 편집 → 새 버전**으로 다시 배포하세요(주소는 그대로). `Notes` 탭에 `fields_json` 칸은 자동으로 추가됩니다.
6. **Actions → 설교 자막 정리 동기화 → Run workflow** 로 첫 실행. 처음엔 `max_new` 를 1~2 로 두고 결과를 확인하세요.

### Actions 직접 실행 옵션

| 입력 | 뜻 |
|---|---|
| `max_new` | 이번에 정리할 최대 영상 수 |
| `categories` | `sunday,dawn,wednesday,youth` 중 쉼표로. 비우면 청년부 제외, `all` 전부, `user` 는 사용자 영상·다시 정리 표시한 것만 |
| `export_only` | `true` 면 새로 정리하지 않고 시트 내용을 사이트에 반영만 함 (제목·설교자를 고친 뒤 앱이 자동으로 씀) |
| `bible_check` | `true` 면 성경 본문 가져오기 점검만 실행 (4역본이 지금도 읽히는지) |

## 성경 본문 (웹사이트에서 읽기)

- 개역개정 · 표준새번역: 대한성서공회(bskorea.or.kr), NIV · 메시지 성경: BibleGateway. 영상 제목의 본문(예: `열왕기상 4, 5장`)을 읽어 설교마다 붙입니다.
- 화면에는 역본 **버튼 4개**로 하나씩 보여 주고, 핸드아웃은 기본 개역개정 · 역본 선택 또는 4개 모두 선택할 수 있습니다.
- 사이트 화면 구조가 바뀌면 읽지 못할 수 있습니다. 확인: Actions 의 `bible_check`, 또는 내 컴퓨터에서 `node scripts/bible-check.mjs "요한복음 3:16-18"`. 일부 역본이 안 읽혀도 나머지로 정리는 완료됩니다.

**개역개정 낭독 듣기**: 개역개정 탭 아래에 "듣기"가 나옵니다. 동기화 때 유튜브에서 `드라마바이블 창세기 12장` 같은 검색으로 이미 올라와 있는 음원을 찾아(제목에 책 이름과 장 번호가 맞는 영상만) 앱 안에서 재생합니다. 장 단위이고, 못 찾으면 유튜브 검색 링크로 열립니다. 음원을 직접 저장하거나 올리지 않습니다.

## 유튜브 재생 (프리미엄)

영상은 유튜브 공식 플레이어(퍼가기)로 재생됩니다. **퍼가기 재생은 브라우저가 제3자 쿠키를 막으면(사파리, 크롬 시크릿 창, 일부 설정·확장프로그램, 아이폰 등) 프리미엄 로그인이 적용되지 않아 광고가 나올 수 있고, 앱이 이를 고칠 수는 없습니다.**

해결: 화면 맨 아래의 **"영상·음악은 항상 YouTube에서 열기"** 를 켜 두면 영상 보기·찬양·묵상음악·성경 낭독 버튼이 YouTube(휴대폰은 YouTube 앱)를 바로 열어 프리미엄(광고 없음, 백그라운드 재생)이 그대로 적용됩니다. 재생 중 광고가 나오면 영상 아래 "앞으로 항상 YouTube에서 열기" 버튼으로도 켤 수 있습니다. 설정은 기기별로 저장됩니다.

## 사용 방법

`Sermons` 탭의 **status**:

| status | 뜻 | 할 일 |
|---|---|---|
| `pending` | 대기 | 다음 실행 때 정리 |
| `done` | 완료 (4모드 모두) | 웹앱에 표시 |
| `error` | 일부 또는 전체 실패 | `note` 확인. 성공한 모드는 저장되어 있고 다음 시도 때 빠진 모드만 다시 만듭니다 |
| `no_transcript` | 자막 없음 | `transcript_manual` 에 붙여넣고 `redo` |
| `redo` | 처음부터 다시 | 프롬프트를 고친 뒤에도 사용 |
| `skip` / `listed` | 제외 / 선택 대기 | 관리 화면에서 골라 정리 |

**예전(v8까지) 형식으로 정리된 설교**는 새 4모드 형식이 아니라서 화면에 나오지 않습니다. 관리 화면 "영상 선택해서 정리하기"에서 골라 다시 정리(`redo`)하세요.

## 알아 두실 점

- **자막 수집이 막힐 수 있습니다** (GitHub 서버 IP). `transcript_manual` 에 직접 붙여넣거나, 내 컴퓨터에서 `.env.example` 을 `.env` 로 채운 뒤 `npm install && node --env-file=.env scripts/sync.mjs`.
- **공개 범위**: 무료 GitHub Pages는 공개 저장소가 필요해서 생성된 정리와 성경 본문이 인터넷에 공개됩니다. 가족용으로만 쓰고 성경 본문 저작권이 걱정되면 비공개 저장소 + 접근 제한 호스팅을 고려하세요. 개인 노트·사용자 영상 소유자 이메일은 공개 데이터에 들어가지 않습니다 (Apps Script 시트에만 있음).
- **Gemini 사용량**: 영상 한 편에 모드 4번 호출합니다. 한도에 걸리면 자동 재시도 후 `error` 로 표시됩니다.
- **AI 정리의 한계**: 자막 오인식·요약 누락이 있을 수 있어 설교별 안내문(caveats)이 데이터에 들어갑니다.
- 한 번에 한 실행만 돌도록 되어 있어, 동시에 여러 번 누르면 순서대로 기다립니다.

## 개발 · 점검

```bash
npm test             # 서버 로직 점검 (제목 규칙·성경 읽기·AI 결과 검사·대기열·예약 시각·내보내기·Apps Script)
node scripts/make-sample.mjs   # ?demo 샘플 데이터 다시 만들기
npm run serve        # docs/ 열기 → http://localhost:3000/?demo
```

## 폴더 구조

```
docs/                  웹사이트 (GitHub Pages)
  index.html style.css config.js
  app.js               목록 · 라우팅 · 관리 화면 · 사용자 영상
  detail.js            설교 화면(모드 탭 4개)
  content.js           공통 그리기 도구 (성경 역본 버튼 · 찬양 · 배경음악 · 유튜브)
  notes.js             로그인 개인 노트 자동 저장
  admin-extra.js       관리: 영상 선택 · 모델
  handout.js handout.css   핸드아웃 (paged.js, vendor/)
  data/sermons.json  data/s/<id>.json   실제 데이터 (Actions가 만듦)
  data/sample/  music.sample.json       ?demo 샘플
apps-script/Code.gs    관리 · 로그인 · 노트 · 사용자 영상 서버
scripts/
  sync.mjs gate.mjs bible-check.mjs make-sample.mjs
  lib/prompt.mjs       신학 기준 · 모드별 프롬프트  ← 가장 자주 고치게 될 파일
  lib/process.mjs      영상 한 편 처리 (4모드 · 부분 재시도)
  lib/{title,bible-web,bible-books,gemini,media,queue,sheets,youtube,transcript}.mjs
  selftest.mjs selftest-gas.mjs   npm test
.github/workflows/sync.yml
```

## 핸드아웃(PDF) 꾸밈

- 제목은 영상 제목(`[날짜] 제목 (본문) - 설교자`)에서 날짜·본문·설교자를 뗀 깔끔한 제목으로 나오고, PDF 기본 파일 이름도 `말씀결_2026.10.04_제목_모드` 형태입니다.
- 맨 위에 말씀결 로고, 맨 끝에 만든 사람 표시가 들어갑니다. 문구는 `docs/config.js` 의 `CREDIT` 에서 바꾸거나 지울 수 있습니다.

## 이름·제목 통일

- **설교자**: `전대혁` · `전대혁 담임목사` · `토론토영락교회 전대혁` 등 어떤 형식이든 `전대혁 목사` 로 통일합니다 (전도사·강도사·장로·선교사·교수는 그 직함 그대로).
- **제목**: `주일예배 - 설교제목` 형식. 제목이 없는 영상(새벽기도회 등)은 `새벽기도 - 열왕기상 4, 5장` 처럼 성경 본문을 씁니다. 사용자 영상은 구분 이름을 붙이지 않습니다.
- 이미 정리해 둔 설교도 화면에서 같은 규칙으로 바로 바뀝니다 (다시 정리할 필요 없음).

## 제목·설교자·성경 본문 직접 고치기

설교 화면 맨 아래의 **"제목·설교자·성경 본문 고치기 (관리자)"** 를 펼쳐 고칩니다.

- 관리 비밀번호로 저장합니다 (탭을 닫기 전까지 한 번만 입력). 바꾼 칸만 저장되고, 구분 이름("주일예배 - ")은 자동으로 붙습니다.
- 값은 Sermons 탭의 `title_override` · `preacher_override` · `scripture_override` 칸에 기록됩니다. 영상 제목이나 AI 결과는 그대로이고, **AI로 다시 정리해도 고친 값이 유지**됩니다. 두 칸은 시트에서 직접 고쳐도 됩니다.
- 칸을 비우고 저장하면 수정값이 지워지고 자동으로 정한 값으로 돌아갑니다.
- 저장하면 앱이 자동으로 "사이트에 반영"(`export_only`)을 요청합니다. 1~2분 뒤 모든 화면에 반영되며, 그 전에도 고친 기기에서는 바뀐 값이 먼저 보입니다.
- 성경 본문을 고치면 동기화가 새 본문의 성경 본문(4역본)과 낭독 영상을 다시 가져옵니다 (2~4분). 그 전에는 틀린 본문이 보이지 않도록 성경 본문 칸이 비어 있습니다. 표기 예: `요한복음 3:16-21` · `열왕기상 4, 5장` · `시편 23편`.
- 설교자 칸에는 이름만 써도 "OOO 목사"로 통일됩니다.
- Apps Script 코드(`apps-script/Code.gs`)를 새 것으로 바꾸고 **새 버전으로 배포**해야 저장이 됩니다.
