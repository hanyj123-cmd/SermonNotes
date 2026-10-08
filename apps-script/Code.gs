// 말씀 노트 — Apps Script 웹앱
//  1) 재생목록 관리 (관리 비밀번호)
//  2) 구글 로그인 사용자별 개인 노트 (설교별 메모 · 묵상 답변 · 적용 체크)
//
// 이 코드는 Google Sheet의 [확장 프로그램 → Apps Script]에 붙여 넣습니다.
// 아래 값들은 코드에 쓰지 않고 [프로젝트 설정 → 스크립트 속성]에 저장합니다.
//   ADMIN_PASSWORD    재생목록 관리 비밀번호
//   GOOGLE_CLIENT_ID  구글 로그인용 OAuth 클라이언트 ID  (…apps.googleusercontent.com)
//   ALLOWED_EMAILS    노트를 쓸 수 있는 구글 계정 (쉼표로 구분). 비워 두면 로그인한 누구나 가능

const SHEET_NAME = 'Playlists';
const HEADERS = ['category', 'playlist_url', 'max_videos'];
const LABELS = ['새벽기도', '수요예배', '주일예배'];
const DEFAULT_MAX = 30;
const MAX_LIMIT = 100;

const NOTES_SHEET = 'Notes';
const NOTE_HEADERS = ['user_sub', 'email', 'video_id', 'memo', 'answers_json', 'checks_json', 'updated_at'];
const MAX_MEMO = 20000;
const MAX_ANSWER = 5000;
const MAX_ITEMS = 20;
const MAX_CELL = 49000; // 구글 시트 셀 하나의 한도는 50,000자

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

// POST (text/plain, JSON 본문)
//   notes_*  : 구글 로그인 토큰(id_token)으로 본인 확인 후 본인 노트만 읽고 씁니다.
//   그 외    : 관리 비밀번호 확인 후 재생목록을 추가·수정·삭제합니다.
function doPost(e) {
  let body;
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return json({ ok: false, error: '요청 형식이 올바르지 않습니다.' });
  }
  const action = String(body.action || '');

  if (action.indexOf('notes_') === 0) return json(handleNotes(action, body));

  if (!passwordOk(body.password)) {
    return json({ ok: false, error: '비밀번호가 맞지 않습니다.' });
  }
  if (action === 'check') return json({ ok: true });

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    if (action === 'add') return json(addRow(body));
    if (action === 'update') return json(updateRow(body));
    if (action === 'delete') return json(deleteRow(body));
    return json({ ok: false, error: '알 수 없는 작업입니다.' });
  } catch (err) {
    return json({ ok: false, error: String(err && err.message ? err.message : err) });
  } finally {
    lock.releaseLock();
  }
}

/* ---------- 공통 ---------- */

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function prop(name) {
  return PropertiesService.getScriptProperties().getProperty(name) || '';
}

function passwordOk(input) {
  const real = prop('ADMIN_PASSWORD');
  if (!real) return false;
  return String(input || '') === real;
}

/* ---------- 구글 로그인 확인 ---------- */

function sha256(text) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text);
  return bytes.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

// 브라우저가 보낸 구글 ID 토큰이 진짜인지, 우리 앱용인지, 허용된 계정인지 확인합니다.
// 실패하면 Error('auth') 또는 Error('forbidden') 를 던집니다.
function verifyIdToken(token) {
  if (!token) throw new Error('auth');
  const cache = CacheService.getScriptCache();
  const key = 'tok_' + sha256(String(token));
  const hit = cache.get(key);
  if (hit) {
    const cached = JSON.parse(hit);
    if (cached.exp * 1000 > Date.now()) return cached;
  }

  const res = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(token), {
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 200) throw new Error('auth');
  const t = JSON.parse(res.getContentText());

  const clientId = prop('GOOGLE_CLIENT_ID');
  if (!clientId || t.aud !== clientId) throw new Error('auth');
  if (t.iss !== 'accounts.google.com' && t.iss !== 'https://accounts.google.com') throw new Error('auth');
  if (String(t.email_verified) !== 'true') throw new Error('auth');
  const exp = Number(t.exp);
  if (!(exp * 1000 > Date.now()) || !t.sub) throw new Error('auth');

  const allowed = prop('ALLOWED_EMAILS')
    .split(',')
    .map(function (x) { return x.trim().toLowerCase(); })
    .filter(Boolean);
  if (allowed.length && allowed.indexOf(String(t.email || '').toLowerCase()) < 0) throw new Error('forbidden');

  const user = { sub: String(t.sub), email: String(t.email || ''), exp: exp };
  const ttl = Math.min(600, Math.max(1, Math.floor(exp - Date.now() / 1000)));
  cache.put(key, JSON.stringify(user), ttl);
  return user;
}

function authError(err) {
  const m = String(err && err.message ? err.message : err);
  if (m === 'forbidden') {
    return { ok: false, code: 'forbidden', error: '이 구글 계정은 노트를 사용할 수 없습니다. (허용된 계정이 아닙니다)' };
  }
  return { ok: false, code: 'auth', error: '로그인이 필요합니다. 다시 로그인해 주세요.' };
}

/* ---------- 개인 노트 ---------- */

function handleNotes(action, body) {
  let user;
  try {
    user = verifyIdToken(body.id_token);
  } catch (err) {
    return authError(err);
  }
  try {
    if (action === 'notes_get') return notesGet(user, body);
    if (action === 'notes_list') return notesList(user);
    if (action === 'notes_save') {
      const lock = LockService.getScriptLock();
      lock.waitLock(20000);
      try {
        return notesSave(user, body);
      } finally {
        lock.releaseLock();
      }
    }
    return { ok: false, error: '알 수 없는 작업입니다.' };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
}

function getNotesSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(NOTES_SHEET);
  if (!sh) {
    sh = ss.insertSheet(NOTES_SHEET);
    sh.getRange(1, 1, 1, NOTE_HEADERS.length).setValues([NOTE_HEADERS]);
    // 모든 칸을 '텍스트'로 고정: 긴 숫자 ID가 깨지거나, "=" 로 시작하는 메모가 수식으로 실행되는 것을 막습니다.
    sh.getRange(1, 1, sh.getMaxRows(), NOTE_HEADERS.length).setNumberFormat('@');
  }
  return sh;
}

function checkVideoId(v) {
  const id = String(v || '');
  if (!/^[\w-]{6,20}$/.test(id)) throw new Error('영상 정보가 올바르지 않습니다.');
  return id;
}

function findNoteRow(sh, sub, videoId) {
  const last = sh.getLastRow();
  if (last < 2) return 0;
  const vals = sh.getRange(2, 1, last - 1, 3).getValues();
  for (let i = 0; i < vals.length; i++) {
    if (String(vals[i][0]) === sub && String(vals[i][2]) === videoId) return i + 2;
  }
  return 0;
}

function parseJsonArray(text) {
  try {
    const v = JSON.parse(String(text || '[]'));
    return Array.isArray(v) ? v : [];
  } catch (err) {
    return [];
  }
}

function notesGet(user, body) {
  const videoId = checkVideoId(body.video_id);
  const sh = getNotesSheet();
  const row = findNoteRow(sh, user.sub, videoId);
  if (!row) return { ok: true, note: null };
  const r = sh.getRange(row, 1, 1, NOTE_HEADERS.length).getValues()[0];
  return {
    ok: true,
    note: {
      memo: String(r[3] || ''),
      answers: parseJsonArray(r[4]),
      checks: parseJsonArray(r[5]),
      updated_at: String(r[6] || ''),
    },
  };
}

function notesSave(user, body) {
  const videoId = checkVideoId(body.video_id);
  const memo = String(body.memo || '').slice(0, MAX_MEMO);
  const answers = (Array.isArray(body.answers) ? body.answers : []).slice(0, MAX_ITEMS).map(function (x) {
    return { q: String((x && x.q) || '').slice(0, 500), a: String((x && x.a) || '').slice(0, MAX_ANSWER) };
  });
  const checks = (Array.isArray(body.checks) ? body.checks : []).slice(0, MAX_ITEMS).map(function (x) {
    const date = String((x && x.date) || '');
    return {
      t: String((x && x.t) || '').slice(0, 300),
      done: !!(x && x.done),
      date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : '',
    };
  });
  const answersJson = JSON.stringify(answers);
  const checksJson = JSON.stringify(checks);
  if (answersJson.length > MAX_CELL || checksJson.length > MAX_CELL) {
    throw new Error('묵상 답변이 너무 깁니다. 조금 줄여 주세요.');
  }

  const sh = getNotesSheet();
  const row = findNoteRow(sh, user.sub, videoId) || sh.getLastRow() + 1;
  const range = sh.getRange(row, 1, 1, NOTE_HEADERS.length);
  range.setNumberFormat('@');
  range.setValues([[user.sub, user.email, videoId, memo, answersJson, checksJson, new Date().toISOString()]]);
  return { ok: true };
}

// 내 노트가 있는 영상 목록 (목록 화면의 "내 노트" 표시용)
function notesList(user) {
  const sh = getNotesSheet();
  const last = sh.getLastRow();
  if (last < 2) return { ok: true, items: [] };
  const vals = sh.getRange(2, 1, last - 1, NOTE_HEADERS.length).getValues();
  const items = [];
  vals.forEach(function (r) {
    if (String(r[0]) !== user.sub) return;
    const hasMemo = String(r[3] || '').trim() !== '';
    const hasAnswer = parseJsonArray(r[4]).some(function (x) { return x && String(x.a || '').trim() !== ''; });
    const hasCheck = parseJsonArray(r[5]).some(function (x) { return x && x.done; });
    if (hasMemo || hasAnswer || hasCheck) items.push({ video_id: String(r[2]), updated_at: String(r[6] || '') });
  });
  return { ok: true, items: items };
}

/* ---------- 재생목록 관리 ---------- */

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
    .map(function (r, i) {
      return {
        row: i + 2,
        category: toLabel(r[0]),
        playlist_url: String(r[1] || '').trim(),
        max_videos: Number(r[2]) > 0 ? Number(r[2]) : DEFAULT_MAX,
      };
    })
    .filter(function (p) { return p.playlist_url || p.category; });
}

function validate(body) {
  const category = toLabel(body.category);
  const url = String(body.playlist_url || '').trim();
  let max = parseInt(body.max_videos, 10);
  if (LABELS.indexOf(category) < 0) return { error: '구분은 새벽기도 / 수요예배 / 주일예배 중 하나여야 합니다.' };
  if (!/[?&]list=[\w-]+/.test(url) && !/^(PL|UU|OL|FL|LL)[\w-]{10,}$/.test(url)) {
    return { error: '재생목록 주소에 list= 가 없습니다. 재생목록 페이지의 주소를 넣어 주세요.' };
  }
  if (!(max > 0)) max = DEFAULT_MAX;
  max = Math.min(max, MAX_LIMIT);
  return { category: category, url: url, max: max };
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
