// 말씀 노트 — 재생목록 관리용 Apps Script 웹앱
// 이 코드는 Google Sheet의 [확장 프로그램 → Apps Script]에 붙여 넣습니다.
// 관리 비밀번호는 코드에 쓰지 않고 [프로젝트 설정 → 스크립트 속성]의 ADMIN_PASSWORD 에 저장합니다.

const SHEET_NAME = 'Playlists';
const HEADERS = ['category', 'playlist_url', 'max_videos'];
const LABELS = ['새벽기도', '수요예배', '주일예배'];
const DEFAULT_MAX = 30;
const MAX_LIMIT = 100;

// 여러 표기를 한국어 구분 이름으로 맞춥니다 (sync.mjs 와 같은 기준)
const ALIASES = {
  dawn: '새벽기도', 새벽: '새벽기도', 새벽기도: '새벽기도',
  wednesday: '수요예배', wed: '수요예배', 수요: '수요예배', 수요예배: '수요예배',
  sunday: '주일예배', sun: '주일예배', 주일: '주일예배', 주일예배: '주일예배',
};

function toLabel(raw) {
  const key = String(raw || '').trim().toLowerCase().replace(/\s+/g, '');
  return ALIASES[key] || String(raw || '').trim();
}

/* ---------- 웹 요청 진입점 ---------- */

// GET ?action=list  → 재생목록 목록 (공개 정보라 비밀번호 없이 읽기 가능)
function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) || 'list';
  if (action === 'list') return json({ ok: true, playlists: readAll() });
  return json({ ok: false, error: '알 수 없는 요청입니다.' });
}

// POST (text/plain, JSON 본문) → 추가·수정·삭제. 비밀번호 확인 후 실행.
function doPost(e) {
  let body;
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return json({ ok: false, error: '요청 형식이 올바르지 않습니다.' });
  }
  if (!passwordOk(body.password)) {
    return json({ ok: false, error: '비밀번호가 맞지 않습니다.' });
  }
  if (body.action === 'check') return json({ ok: true });

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    if (body.action === 'add') return json(addRow(body));
    if (body.action === 'update') return json(updateRow(body));
    if (body.action === 'delete') return json(deleteRow(body));
    return json({ ok: false, error: '알 수 없는 작업입니다.' });
  } catch (err) {
    return json({ ok: false, error: String(err && err.message ? err.message : err) });
  } finally {
    lock.releaseLock();
  }
}

/* ---------- 내부 함수 ---------- */

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function passwordOk(input) {
  const real = PropertiesService.getScriptProperties().getProperty('ADMIN_PASSWORD');
  if (!real) return false;
  return String(input || '') === real;
}

function getSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
  }
  return sh;
}

function readAll() {
  const sh = getSheet();
  const last = sh.getLastRow();
  if (last < 2) return [];
  const values = sh.getRange(2, 1, last - 1, HEADERS.length).getValues();
  return values
    .map((r, i) => ({
      row: i + 2,
      category: toLabel(r[0]),
      playlist_url: String(r[1] || '').trim(),
      max_videos: Number(r[2]) > 0 ? Number(r[2]) : DEFAULT_MAX,
    }))
    .filter((p) => p.playlist_url || p.category);
}

function validate(body) {
  const category = toLabel(body.category);
  const url = String(body.playlist_url || '').trim();
  let max = parseInt(body.max_videos, 10);
  if (!LABELS.includes(category)) return { error: '구분은 새벽기도 / 수요예배 / 주일예배 중 하나여야 합니다.' };
  if (!/[?&]list=[\w-]+/.test(url) && !/^(PL|UU|OL|FL|LL)[\w-]{10,}$/.test(url)) {
    return { error: '재생목록 주소에 list= 가 없습니다. 재생목록 페이지의 주소를 넣어 주세요.' };
  }
  if (!(max > 0)) max = DEFAULT_MAX;
  max = Math.min(max, MAX_LIMIT);
  return { category, url, max };
}

function addRow(body) {
  const v = validate(body);
  if (v.error) return { ok: false, error: v.error };
  getSheet().appendRow([v.category, v.url, v.max]);
  return { ok: true };
}

function updateRow(body) {
  const sh = getSheet();
  const row = Number(body.row);
  if (!(row >= 2 && row <= sh.getLastRow())) return { ok: false, error: '수정할 행을 찾지 못했습니다. 새로고침 후 다시 해 주세요.' };
  const v = validate(body);
  if (v.error) return { ok: false, error: v.error };
  sh.getRange(row, 1, 1, HEADERS.length).setValues([[v.category, v.url, v.max]]);
  return { ok: true };
}

function deleteRow(body) {
  const sh = getSheet();
  const row = Number(body.row);
  if (!(row >= 2 && row <= sh.getLastRow())) return { ok: false, error: '삭제할 행을 찾지 못했습니다. 새로고침 후 다시 해 주세요.' };
  sh.deleteRow(row);
  return { ok: true };
}
