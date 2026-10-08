# 말씀 노트 (sermon-notes)

교회 유튜브 재생목록(새벽기도 · 수요예배 · 주일예배)의 **자막**을 바탕으로 아래 내용을 자동으로 만들어 주는 웹앱입니다.

- 설교 정리 (대지별 상세 정리)
- 삶의 적용 포인트
- 묵상 질문
- 소그룹 나눔 질문 (마음 열기 → 관찰 → 묵상 → 적용 → 기도)

내용은 대한예수교장로회(통합·합동) 전통의 개혁주의·복음주의 신학 기준으로 작성되도록 프롬프트가 설계되어 있습니다 (`scripts/lib/prompt.mjs`).

## 어떻게 돌아가나요

```
Google Sheet (Playlists 탭: 재생목록 주소)
        │
        ▼  GitHub Actions (매일 자동 / 수동 실행)
  YouTube 새 영상 확인 → 자막 수집 → Gemini가 정리
        │
        ▼
Google Sheet (Sermons 탭: 영상별 상태·결과 저장)
        │
        ▼
docs/data/sermons.json 커밋 → GitHub Pages 웹앱이 읽어서 표시
```

- **Google Sheet** = 데이터베이스 (재생목록 입력, 진행 상태 확인, 자막 직접 붙여넣기)
- **GitHub Actions** = 일꾼 (비밀 키는 여기에만 저장되므로 웹앱에 노출되지 않음)
- **GitHub Pages** = 사람들이 보는 웹사이트 (`docs/` 폴더)

## 준비물

| 항목 | 용도 | 발급 위치 |
|---|---|---|
| GitHub 계정 | 코드·웹사이트 호스팅 | github.com |
| Google 서비스 계정 키(JSON) | 시트 읽기/쓰기 | Google Cloud Console |
| YouTube Data API 키 | 재생목록의 영상 목록 조회 | Google Cloud Console |
| Gemini API 키 | 설교 정리 생성 | [Google AI Studio](https://aistudio.google.com/apikey) |

## 설정 순서

### 1. Google Sheet 만들기
1. 새 스프레드시트를 만들고 첫 탭 이름을 **`Playlists`** 로 바꿉니다.
2. 1행에 `category`, `playlist_url`, `max_videos` 를 입력하고 아래처럼 채웁니다.

| category | playlist_url | max_videos |
|---|---|---|
| 새벽기도 | https://www.youtube.com/playlist?list=PL… | 30 |
| 수요예배 | https://www.youtube.com/playlist?list=PL… | 30 |
| 주일예배 | https://www.youtube.com/playlist?list=PL… | 30 |

`category` 는 `새벽기도 / 수요예배 / 주일예배` (또는 `dawn / wednesday / sunday`) 중 하나, `max_videos` 는 비워 두면 30입니다. `Sermons` 탭은 처음 실행할 때 자동으로 만들어집니다.

3. 주소창의 `https://docs.google.com/spreadsheets/d/`**`여기`**`/edit` 부분이 **SHEET_ID** 입니다.

### 2. Google Cloud 설정 (서비스 계정 + YouTube 키)
1. [Google Cloud Console](https://console.cloud.google.com) 에서 프로젝트를 하나 만듭니다.
2. **API 및 서비스 → 라이브러리** 에서 **Google Sheets API** 와 **YouTube Data API v3** 를 각각 "사용"으로 켭니다.
3. **API 및 서비스 → 사용자 인증정보 → 사용자 인증정보 만들기 → API 키** 로 키를 만들고 복사합니다 (= `YOUTUBE_API_KEY`).
4. **서비스 계정 만들기** 로 계정을 만들고, 그 계정의 **키 → 키 추가 → JSON** 으로 키 파일을 내려받습니다 (= `GOOGLE_SERVICE_ACCOUNT_JSON`, 파일 내용 전체).
5. 위 서비스 계정의 이메일(`…@….iam.gserviceaccount.com`)을 **Google Sheet 공유 → 편집자** 로 추가합니다.

### 3. GitHub에 올리기
1. GitHub에서 새 저장소를 만들고 이 폴더의 내용을 올립니다. (`.env` 와 키 파일은 올리지 마세요. `.gitignore` 에 이미 제외되어 있습니다.)
2. 저장소 **Settings → Secrets and variables → Actions → New repository secret** 에 아래 4개를 등록합니다.
   - `SHEET_ID`
   - `GOOGLE_SERVICE_ACCOUNT_JSON`
   - `YOUTUBE_API_KEY`
   - `GEMINI_API_KEY`
3. (선택) 같은 화면의 **Variables** 탭에서 `GEMINI_MODEL`(기본 `gemini-3.8-flash`, 모델 이름은 [공식 목록](https://ai.google.dev/gemini-api/docs/models)에서 확인), `MAX_NEW_PER_RUN`(기본 5)을 설정할 수 있습니다.
4. **Settings → Pages → Build and deployment** 에서 Source를 **Deploy from a branch**, Branch를 **main / `/docs`** 로 지정합니다.
5. **Actions → 설교 자막 정리 동기화 → Run workflow** 를 눌러 첫 실행을 합니다. 처음에는 `max_new` 를 2 정도로 두고 결과를 확인해 보세요.
6. 몇 분 뒤 `https://<계정>.github.io/<저장소 이름>/` 에서 확인합니다.

이후에는 매일 오전(UTC 11시)에 자동으로 새 영상을 확인합니다. 시간은 `.github/workflows/sync.yml` 의 `cron` 에서 바꿀 수 있습니다.

## 사용 방법

`Sermons` 탭의 **status** 칸으로 진행 상황을 보고 조작합니다.

| status | 뜻 | 할 일 |
|---|---|---|
| `pending` | 대기 중 | 다음 실행 때 정리됨 (한 번에 `MAX_NEW_PER_RUN` 편, 최신순) |
| `done` | 완료 | 웹앱에 표시됨 |
| `no_transcript` | 자막을 못 가져옴 | `transcript_manual` 칸에 자막을 붙여넣고 status를 `redo` 로 |
| `error` | 정리 실패 | `note` 칸의 사유 확인 후 `redo` |
| `redo` | 다시 만들기 | 다음 실행 때 다시 정리됨 (프롬프트를 고친 뒤 재생성할 때도 사용) |
| `skip` | 건너뛰기 | 정리하지 않음 (광고 영상 등) |

시트 내용을 바로 웹앱에 반영하고 싶을 때(예: 일부 행을 `skip` 으로 바꾼 뒤)는 Actions를 다시 실행하면 됩니다.

## 알아 두실 점

- **자막 수집이 막힐 수 있습니다.** YouTube가 GitHub 서버(클라우드) IP에서의 자막 요청을 막는 경우가 있습니다. 그럴 때는
  1. `transcript_manual` 칸에 직접 붙여넣거나(영상 설명란 "스크립트 표시" 활용),
  2. 내 컴퓨터에서 실행합니다: `.env.example` 을 `.env` 로 복사해 값을 채운 뒤 `npm install` → `node --env-file=.env scripts/sync.mjs` (집 IP에서는 대개 잘 됩니다). 실행 후 바뀐 `docs/data/sermons.json` 을 커밋·푸시하면 됩니다.
- **Gemini API 사용량/요금을 확인하세요.** 무료 등급은 하루·분당 호출 한도가 있고 요금제에 따라 달라집니다. 한도에 걸리면 자동으로 잠시 기다렸다 재시도하며, 그래도 실패한 영상은 `error` 로 표시됩니다. 처음에는 적은 수로 시험하고, 만족스러우면 `max_videos` 와 `MAX_NEW_PER_RUN` 을 늘리세요.
- **공개 범위.** 무료 GitHub Pages는 공개 저장소가 필요해서, 생성된 정리 내용(`docs/data/sermons.json`)도 공개됩니다. 교회 내부용으로만 쓰고 싶다면 비공개 저장소 + 접근 제한이 되는 호스팅(예: Cloudflare Pages + Access)을 고려하세요.
- **AI 정리의 한계.** 자동 자막의 오인식과 요약 과정의 누락이 있을 수 있습니다. 설교자와 교회의 확인을 거쳐 쓰시길 권합니다. 화면 하단에도 같은 안내가 표시됩니다.
- **신학적 어조 조정.** 교단 색채나 문체(예: 합동 측 용어, 분량, 질문 개수)는 `scripts/lib/prompt.mjs` 의 `SYSTEM_PROMPT` 만 고치면 됩니다. 고친 뒤 기존 영상에 반영하려면 해당 행의 status를 `redo` 로 바꾸세요.

## 화면만 미리 보기

```bash
npm run serve        # docs/ 폴더를 로컬에서 열기
# 브라우저에서 http://localhost:3000/?demo  ← 샘플 데이터로 화면 확인
```

## 폴더 구조

```
docs/                  웹사이트 (GitHub Pages)
  index.html style.css app.js
  data/sermons.json    Actions가 만들어 주는 실제 데이터
  data/sermons.sample.json   ?demo 화면용 샘플
scripts/
  sync.mjs             전체 파이프라인
  lib/prompt.mjs       신학 기준·출력 형식 프롬프트  ← 가장 자주 고치게 될 파일
  lib/sheets.mjs  lib/youtube.mjs  lib/gemini.mjs
  selftest.mjs         `npm test`
.github/workflows/sync.yml   자동 실행 설정
```
