// 말씀결 — Apps Script 웹앱
//  1) 재생목록 관리 (관리 비밀번호)
//  2) 구글 로그인 사용자별 개인 노트 (설교별 메모 · 묵상 답변 · 적용 체크)
//
// 이 코드는 Google Sheet의 [확장 프로그램 → Apps Script]에 붙여 넣습니다.
// 아래 값들은 코드에 쓰지 않고 [프로젝트 설정 → 스크립트 속성]에 저장합니다.
//   ADMIN_PASSWORD    재생목록 관리 비밀번호
//   GOOGLE_CLIENT_ID  구글 로그인용 OAuth 클라이언트 ID  (…apps.googleusercontent.com)
//   ALLOWED_EMAILS    노트를 쓸 수 있는 구글 계정 (쉼표로 구분). 비워 두면 로그인한 누구나 가능
//   SESSION_SECRET    (자동 생성) 30일 로그인 유지용 서명 비밀키. 직접 만들 필요 없습니다.
//   GITHUB_TOKEN      (선택) 앱에서 "지금 동기화"를 누를 때 쓰는 GitHub 토큰. 이 저장소의 Actions 읽기/쓰기 권한만 주세요.
//   GITHUB_REPO       (선택) 예: hanyj123-cmd/SermonNotes
//   GITHUB_REF        (선택) 실행할 브랜치. 비워 두면 main
// Settings 탭(AI 모델)과 Sermons 탭(영상 선택 관리 · 사용자 영상)은 이 코드가 직접 읽고 씁니다. 별도 설정은 필요 없습니다.

const SHEET_NAME = 'Playlists';
const HEADERS = ['category', 'playlist_url', 'max_videos'];
const LABELS = ['주일예배', '새벽기도', '수요예배', '청년부예배'];
const DEFAULT_MAX = 30;
const MAX_LIMIT = 100;

const NOTES_SHEET = 'Notes';
const NOTE_HEADERS = ['user_sub', 'email', 'video_id', 'memo', 'answers_json', 'checks_json', 'updated_at', 'fields_json', 'marks_json'];
const MAX_MARKS = 500; // 설교 한 편에 남길 수 있는 형광펜·밑줄·메모 조각 수
const MARK_COLORS = ['yellow', 'green', 'pink', 'sky', 'orange', 'purple', 'red', 'blue'];
const MAX_FIELDS = 80; // 모드별 개인 기록(묵상 답, 삶의 적용, 소그룹 메모 등) 칸 수
const MAX_FIELD_LEN = 5000;
const MAX_MEMO = 20000;
const MAX_ANSWER = 5000;
const MAX_ITEMS = 20;
const MAX_CELL = 49000; // 구글 시트 셀 하나의 한도는 50,000자

// 여러 표기를 한국어 구분 이름으로 맞춥니다 (sync.mjs 와 같은 기준)
const ALIASES = {
  dawn: '새벽기도', 새벽: '새벽기도', 새벽기도: '새벽기도',
  wednesday: '수요예배', wed: '수요예배', 수요: '수요예배', 수요예배: '수요예배',
  sunday: '주일예배', sun: '주일예배', 주일: '주일예배', 주일예배: '주일예배',
  youth: '청년부예배', 청년: '청년부예배', 청년부: '청년부예배', 청년부예배: '청년부예배',
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
  if (action.indexOf('user_video_') === 0) return json(handleUserVideos(action, body));
  if (action.indexOf('game_') === 0) return json(handleGame(action, body));

  if (!passwordOk(body.password)) {
    return json({ ok: false, error: '비밀번호가 맞지 않습니다.' });
  }
  if (action === 'check') return json({ ok: true });
  if (action === 'sync_status') return json(guarded(syncStatus));
  if (action === 'settings_get') return json(guarded(settingsGet));
  if (action === 'sync_run') return json(guarded(function () { return syncRun(body); }));
  if (action === 'videos_list') return json(guarded(videosList));

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    if (action === 'add') return json(addRow(body));
    if (action === 'update') return json(updateRow(body));
    if (action === 'delete') return json(deleteRow(body));
    if (action === 'settings_set') return json(settingsSet(body));
    if (action === 'videos_mark') return json(videosMark(body));
    if (action === 'sermon_edit') return json(sermonEdit(body));
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

  checkAllowed(t.email);

  const user = { sub: String(t.sub), email: String(t.email || ''), name: String(t.name || ''), exp: exp };
  const ttl = Math.min(600, Math.max(1, Math.floor(exp - Date.now() / 1000)));
  cache.put(key, JSON.stringify(user), ttl);
  return user;
}

// ALLOWED_EMAILS 가 설정되어 있으면, 그 목록에 있는 계정만 통과시킵니다. (로그인할 때마다 다시 확인)
function checkAllowed(email) {
  const allowed = prop('ALLOWED_EMAILS')
    .split(',')
    .map(function (x) { return x.trim().toLowerCase(); })
    .filter(Boolean);
  if (allowed.length && allowed.indexOf(String(email || '').toLowerCase()) < 0) throw new Error('forbidden');
}

/* ---------- 로그인 유지 (앱 전용 세션 토큰) ----------
   구글 ID 토큰은 1시간이면 만료됩니다. 그래서 로그인할 때 한 번만 구글 토큰을 확인하고,
   서버가 서명한 30일짜리 세션 토큰을 내려줍니다. 서명 비밀키(SESSION_SECRET)는 처음 쓸 때 자동으로 만들어
   스크립트 속성에 저장됩니다. 비밀키를 지우면 모든 로그인이 한꺼번에 풀립니다. */

const SESSION_DAYS = 30;

function sessionSecret() {
  const props = PropertiesService.getScriptProperties();
  let s = props.getProperty('SESSION_SECRET');
  if (s) return s;
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    s = props.getProperty('SESSION_SECRET');
    if (!s) {
      s = Utilities.getUuid() + Utilities.getUuid() + Utilities.getUuid();
      props.setProperty('SESSION_SECRET', s);
    }
    return s;
  } finally {
    lock.releaseLock();
  }
}

function sign(text) {
  return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(text, sessionSecret()));
}

function sameText(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function issueSession(user) {
  const exp = Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400;
  const payload = Utilities.base64EncodeWebSafe(
    JSON.stringify({ sub: user.sub, email: user.email, name: user.name || '', exp: exp }),
    Utilities.Charset.UTF_8
  );
  return { token: payload + '.' + sign(payload), exp: exp };
}

function verifySession(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 2 || !sameText(sign(parts[0]), parts[1])) throw new Error('auth');
  let p;
  try {
    p = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString('UTF-8'));
  } catch (err) {
    throw new Error('auth');
  }
  if (!p || !p.sub || !(Number(p.exp) * 1000 > Date.now())) throw new Error('auth');
  checkAllowed(p.email); // 허용 목록에서 빠진 계정은 세션이 남아 있어도 바로 막힙니다.
  return { sub: String(p.sub), email: String(p.email || ''), name: String(p.name || ''), exp: Number(p.exp) };
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
  // 로그인 직후 한 번: 구글 ID 토큰을 확인하고 30일짜리 앱 전용 세션 토큰을 발급합니다.
  if (action === 'notes_login') {
    try {
      const u = verifyIdToken(body.id_token);
      const s = issueSession(u);
      return { ok: true, session: s.token, expires_at: s.exp, user: { name: u.name, email: u.email } };
    } catch (err) {
      return authError(err);
    }
  }

  // 그 외 노트 요청: 앱 세션 토큰으로 확인합니다. (구글 ID 토큰을 직접 보내는 방식도 그대로 허용)
  let user;
  try {
    user = body.session ? verifySession(body.session) : verifyIdToken(body.id_token);
  } catch (err) {
    return authError(err);
  }
  try {
    if (action === 'notes_get') return notesGet(user, body);
    if (action === 'notes_list') return notesList(user);
    if (action === 'notes_marks_save') {
      const lock = LockService.getScriptLock();
      lock.waitLock(20000);
      try {
        return marksSave(user, body);
      } finally {
        lock.releaseLock();
      }
    }
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
  } else if (sh.getLastColumn() < NOTE_HEADERS.length) {
    // 예전 버전에서 만든 Notes 탭에 새 열(fields_json, marks_json)을 덧붙입니다
    const have = Math.max(1, sh.getLastColumn());
    sh.getRange(1, 1, 1, NOTE_HEADERS.length).setValues([NOTE_HEADERS]);
    sh.getRange(1, have + 1, sh.getMaxRows(), NOTE_HEADERS.length - have).setNumberFormat('@');
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

function parseJsonObject(text) {
  try {
    const v = JSON.parse(String(text || '{}'));
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch (err) {
    return {};
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
      fields: parseJsonObject(r[7]),
      marks: parseJsonArray(r[8]),
    },
  };
}

// 모드별 개인 기록(fields): { "qt.q.0": "…", "group.note.3": "…" } — 키는 영문·숫자·점·밑줄·하이픈만
function cleanFields(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  let n = 0;
  Object.keys(raw).forEach(function (k) {
    if (n >= MAX_FIELDS || !/^[\w.-]{1,40}$/.test(k)) return;
    const v = String(raw[k] === undefined || raw[k] === null ? '' : raw[k]).slice(0, MAX_FIELD_LEN);
    if (v.trim() === '') return; // 비운 칸은 저장하지 않음
    out[k] = v;
    n++;
  });
  return out;
}

// 보낸 항목만 바꿉니다 (memo / answers / checks / fields 중 body 에 있는 것만 덮어씀)
function notesSave(user, body) {
  const videoId = checkVideoId(body.video_id);
  const sh = getNotesSheet();
  const found = findNoteRow(sh, user.sub, videoId);
  const prev = found ? sh.getRange(found, 1, 1, NOTE_HEADERS.length).getValues()[0] : [];

  let memo = String(prev[3] || '');
  if (body.memo !== undefined) memo = String(body.memo || '').slice(0, MAX_MEMO);

  let answersJson = String(prev[4] || '[]');
  if (body.answers !== undefined) {
    const answers = (Array.isArray(body.answers) ? body.answers : []).slice(0, MAX_ITEMS).map(function (x) {
      return { q: String((x && x.q) || '').slice(0, 500), a: String((x && x.a) || '').slice(0, MAX_ANSWER) };
    });
    answersJson = JSON.stringify(answers);
  }

  let checksJson = String(prev[5] || '[]');
  if (body.checks !== undefined) {
    const checks = (Array.isArray(body.checks) ? body.checks : []).slice(0, MAX_ITEMS).map(function (x) {
      const date = String((x && x.date) || '');
      return {
        t: String((x && x.t) || '').slice(0, 300),
        done: !!(x && x.done),
        date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : '',
      };
    });
    checksJson = JSON.stringify(checks);
  }

  let fieldsJson = String(prev[7] || '{}');
  if (body.fields !== undefined) fieldsJson = JSON.stringify(cleanFields(body.fields));

  if (answersJson.length > MAX_CELL || checksJson.length > MAX_CELL || fieldsJson.length > MAX_CELL) {
    throw new Error('기록이 너무 깁니다. 조금 줄여 주세요.');
  }

  const row = found || sh.getLastRow() + 1;
  const range = sh.getRange(row, 1, 1, NOTE_HEADERS.length);
  range.setNumberFormat('@');
  range.setValues([[user.sub, user.email, videoId, memo, answersJson, checksJson, new Date().toISOString(), fieldsJson, String(prev[8] || '[]')]]);
  return { ok: true };
}

// 형광펜·밑줄·메모 (marks_json). 본인 것만, 설교 한 편 단위로 통째로 저장합니다.
function cleanMarks(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const out = [];
  const idRe = /^[\w-]{1,48}$/;
  for (let i = 0; i < list.length && out.length < MAX_MARKS; i++) {
    const m = list[i] || {};
    const s = Number(m.s);
    const e = Number(m.e);
    if (!idRe.test(String(m.id || '')) || !idRe.test(String(m.g || '')) || !/^[a-z0-9]{1,20}$/.test(String(m.k || ''))) continue;
    if (!(s >= 0 && e > s && e <= 100000 && Math.floor(s) === s && Math.floor(e) === e)) continue;
    if (m.st !== 'hl' && m.st !== 'ul') continue;
    if (MARK_COLORS.indexOf(String(m.c)) < 0) continue;
    out.push({
      id: String(m.id), g: String(m.g), k: String(m.k), s: s, e: e,
      q: String(m.q || '').slice(0, 400), st: m.st, c: String(m.c),
      n: String(m.n || '').slice(0, 2000), at: String(m.at || '').slice(0, 30),
    });
  }
  return out;
}

function marksSave(user, body) {
  const videoId = checkVideoId(body.video_id);
  const json = JSON.stringify(cleanMarks(body.marks));
  if (json.length > MAX_CELL) throw new Error('이 설교에 남긴 표시·메모가 너무 많습니다. 몇 개를 지워 주세요.');
  const sh = getNotesSheet();
  const found = findNoteRow(sh, user.sub, videoId);
  const stamp = new Date().toISOString();
  if (found) {
    sh.getRange(found, 7).setNumberFormat('@').setValues([[stamp]]);
    sh.getRange(found, 9).setNumberFormat('@').setValues([[json]]);
  } else {
    const range = sh.getRange(sh.getLastRow() + 1, 1, 1, NOTE_HEADERS.length);
    range.setNumberFormat('@');
    range.setValues([[user.sub, user.email, videoId, '', '[]', '[]', stamp, '{}', json]]);
  }
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
    const hasField = Object.keys(parseJsonObject(r[7])).length > 0;
    const hasMark = parseJsonArray(r[8]).length > 0;
    if (hasMemo || hasAnswer || hasCheck || hasField || hasMark) items.push({ video_id: String(r[2]), updated_at: String(r[6] || '') });
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
  if (LABELS.indexOf(category) < 0) return { error: '구분은 주일예배 / 새벽기도 / 수요예배 / 청년부예배 중 하나여야 합니다.' };
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

/* ---------- 지금 동기화 (GitHub Actions 실행) ---------- */

const GH_WORKFLOW = 'sync.yml';
const SYNC_MIN = 1;
const SYNC_MAX = 30;
const SYNC_DEFAULT = 5;

function guarded(fn) {
  try {
    return fn();
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
}

// GitHub API 호출. 토큰은 스크립트 속성에만 있고 화면으로는 절대 나가지 않습니다.
function ghRequest(method, path, payload) {
  const token = prop('GITHUB_TOKEN');
  const repo = prop('GITHUB_REPO');
  if (!token || !repo) {
    throw new Error('GitHub 연결이 아직 설정되지 않았습니다. (스크립트 속성 GITHUB_TOKEN, GITHUB_REPO 를 추가하세요)');
  }
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) {
    throw new Error('GITHUB_REPO 형식이 올바르지 않습니다. 예: hanyj123-cmd/SermonNotes');
  }
  const opts = {
    method: method,
    muteHttpExceptions: true,
    headers: {
      Authorization: 'Bearer ' + token,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  };
  if (payload) {
    opts.contentType = 'application/json';
    opts.payload = JSON.stringify(payload);
  }
  const res = UrlFetchApp.fetch('https://api.github.com/repos/' + repo + path, opts);
  const code = res.getResponseCode();
  let body = {};
  try {
    body = JSON.parse(res.getContentText() || '{}');
  } catch (err) {
    body = {};
  }
  if (code === 401) throw new Error('GitHub 토큰이 올바르지 않거나 만료되었습니다. 새 토큰을 만들어 GITHUB_TOKEN 을 바꿔 주세요.');
  if (code === 403 || code === 404) {
    throw new Error('GitHub에서 접근을 거부했습니다. 저장소 이름(GITHUB_REPO)과, 토큰의 Actions "Read and write" 권한을 확인하세요.');
  }
  if (code === 422) {
    throw new Error('GitHub가 실행 요청을 받아들이지 않았습니다: ' + String(body.message || '').slice(0, 150) + ' (브랜치 이름 GITHUB_REF 와 sync.yml 을 확인하세요)');
  }
  if (code >= 300) throw new Error('GitHub 응답 오류 (' + code + ')');
  return { code: code, body: body };
}

// 가장 최근 실행 한 건의 상태
function latestRun() {
  const r = ghRequest('get', '/actions/workflows/' + GH_WORKFLOW + '/runs?per_page=1');
  const run = (r.body.workflow_runs || [])[0];
  if (!run) return { state: 'none' };
  let state = 'running';
  if (run.status === 'completed') state = run.conclusion === 'success' ? 'success' : 'failed';
  return {
    state: state,
    started_at: run.run_started_at || run.created_at || '',
    updated_at: run.updated_at || '',
    event: run.event || '',
    url: run.html_url || '',
  };
}

function syncStatus() {
  return { ok: true, run: latestRun() };
}

const SYNC_CATEGORIES = ['sunday', 'dawn', 'wednesday', 'youth', 'all', 'user', 'none'];

// 허용된 구분만 골라 쉼표로 잇습니다 (비어 있으면 '' = 청년부를 뺀 기본 구분)
function cleanCategories(raw) {
  const list = Array.isArray(raw) ? raw : String(raw || '').split(/[\s,]+/);
  const out = [];
  list.forEach(function (x) {
    const k = String(x || '').trim().toLowerCase();
    if (SYNC_CATEGORIES.indexOf(k) >= 0 && out.indexOf(k) < 0) out.push(k);
  });
  return out.join(',');
}

// 실행을 요청합니다. 반환: true = GitHub 의 sync.yml 이 옛 버전이라 "반영만" 입력 없이 일반 실행으로 요청했음
function dispatchSync(maxNew, categories, exportOnly) {
  const inputs = { max_new: String(maxNew) };
  if (categories) inputs.categories = categories;
  const url = '/actions/workflows/' + GH_WORKFLOW + '/dispatches';
  const ref = prop('GITHUB_REF') || 'main';
  if (exportOnly) inputs.export_only = 'true'; // 새로 정리하지 않고 시트 내용을 사이트에 반영만 합니다
  try {
    ghRequest('post', url, { ref: ref, inputs: inputs });
    return false;
  } catch (err) {
    // GitHub 에 올라간 sync.yml 에 export_only 입력이 아직 없으면 422 "Unexpected inputs" 로 거절됩니다.
    // 그때는 그 입력만 빼고 다시 요청합니다 (구분 'none' 이라 재생목록은 확인하지 않고, 시트 내용을 내보내는 일반 실행이 됩니다).
    if (exportOnly && /export_only/.test(String(err && err.message))) {
      delete inputs.export_only;
      ghRequest('post', url, { ref: ref, inputs: inputs });
      return true;
    }
    throw err;
  }
}

function syncRun(body) {
  let n = parseInt(body.max_new, 10);
  if (isNaN(n)) n = SYNC_DEFAULT;
  n = Math.min(SYNC_MAX, Math.max(SYNC_MIN, n));
  if (latestRun().state === 'running') {
    return { ok: false, error: '이미 실행 중입니다. 끝난 뒤에 다시 눌러 주세요.' };
  }
  const categories = cleanCategories(body.categories);
  const exportOnly = body.export_only === true || body.export_only === 'true';
  const oldWorkflow = dispatchSync(n, categories, exportOnly);
  return { ok: true, max_new: n, categories: categories, export_only: exportOnly && !oldWorkflow, workflow_old: oldWorkflow };
}

/* ---------- 설정 (AI 모델) — Settings 탭 ---------- */

const SETTINGS_SHEET = 'Settings';
const SETTINGS_HEADERS = ['key', 'value'];
const MODEL_PATTERN = /^[\w.-]{3,60}$/;

function getSettingsSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SETTINGS_SHEET);
  if (!sh) {
    sh = ss.insertSheet(SETTINGS_SHEET);
    sh.getRange(1, 1, 1, 2).setValues([SETTINGS_HEADERS]);
  }
  return sh;
}

function readSettingsMap() {
  const sh = getSettingsSheet();
  const last = sh.getLastRow();
  const out = {};
  if (last < 2) return out;
  sh.getRange(2, 1, last - 1, 2).getValues().forEach(function (r) {
    const k = String(r[0] || '').trim();
    if (k) out[k] = String(r[1] === undefined || r[1] === null ? '' : r[1]);
  });
  return out;
}

function writeSetting(key, value) {
  const sh = getSettingsSheet();
  const last = sh.getLastRow();
  const keys = last >= 2 ? sh.getRange(2, 1, last - 1, 1).getValues() : [];
  for (let i = 0; i < keys.length; i++) {
    if (String(keys[i][0]).trim() === key) {
      sh.getRange(i + 2, 2).setNumberFormat('@').setValues([[value]]);
      return;
    }
  }
  const row = Math.max(2, last + 1);
  sh.getRange(row, 1, 1, 2).setNumberFormat('@').setValues([[key, value]]);
}

function settingsGet() {
  const m = readSettingsMap();
  return { ok: true, settings: { gemini_model: m.gemini_model || '' } };
}

function settingsSet(body) {
  if (body.gemini_model !== undefined) {
    const model = String(body.gemini_model || '').trim();
    if (model && !MODEL_PATTERN.test(model)) return { ok: false, error: '모델 이름이 올바르지 않습니다. 예: gemini-3.8-flash' };
    writeSetting('gemini_model', model);
  }
  return { ok: true };
}

/* ---------- 영상 선택 관리 — Sermons 탭 ---------- */

const SERMONS_SHEET = 'Sermons';
// Sermons 탭 열 번호 (scripts/lib/sheets.mjs 의 SERMON_HEADERS 와 같은 순서)
const COL = { video_id: 1, category: 2, title: 3, published_at: 4, url: 5, status: 6, transcript_manual: 7, result_json: 8, updated_at: 9, note: 10, preacher: 11, scripture: 12, mode_qt: 13, mode_study: 14, mode_group: 15, bible_json: 16, owner: 17, title_override: 18, preacher_override: 19, scripture_override: 20, date_override: 21 };
const MARKABLE = { redo: '앱에서 다시 정리를 요청했습니다', skip: '자동 정리에서 제외했습니다', pending: '', listed: '' };

function getSermonsSheet() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SERMONS_SHEET);
  if (!sh) throw new Error('Sermons 탭이 아직 없습니다. 먼저 "지금 동기화"를 한 번 실행하세요.');
  return sh;
}

// 큰 열(result_json, transcript_manual)은 읽지 않고, 목록에 필요한 열만 읽습니다.
function videosList() {
  const sh = getSermonsSheet();
  const last = sh.getLastRow();
  if (last < 2) return { ok: true, videos: [] };
  const n = last - 1;
  const a = sh.getRange(2, COL.video_id, n, COL.status).getValues();
  const b = sh.getRange(2, COL.updated_at, n, 2).getValues();
  const c = sh.getLastColumn() >= COL.scripture ? sh.getRange(2, COL.preacher, n, 2).getValues() : [];
  const videos = [];
  for (let i = 0; i < n; i++) {
    const id = String(a[i][0] || '').trim();
    if (!id) continue;
    videos.push({
      video_id: id,
      category: String(a[i][1] || ''),
      title: String(a[i][2] || ''),
      published_at: String(a[i][3] || '').slice(0, 10),
      status: String(a[i][5] || ''),
      updated_at: String(b[i][0] || ''),
      note: String(b[i][1] || '').slice(0, 160),
      preacher: String((c[i] && c[i][0]) || ''),
      scripture: String((c[i] && c[i][1]) || ''),
    });
  }
  videos.sort(function (x, y) { return String(y.published_at).localeCompare(String(x.published_at)); });
  return { ok: true, videos: videos };
}

function videosMark(body) {
  const status = String(body.status || '');
  if (!Object.prototype.hasOwnProperty.call(MARKABLE, status)) return { ok: false, error: '바꿀 수 없는 상태입니다.' };
  const ids = (Array.isArray(body.ids) ? body.ids : []).map(function (x) { return String(x || '').trim(); }).filter(Boolean).slice(0, 200);
  if (!ids.length) return { ok: false, error: '선택한 영상이 없습니다.' };
  const want = {};
  ids.forEach(function (id) { want[id] = true; });
  const sh = getSermonsSheet();
  const last = sh.getLastRow();
  if (last < 2) return { ok: true, changed: 0 };
  const idCol = sh.getRange(2, COL.video_id, last - 1, 1).getValues();
  const stamp = new Date().toISOString();
  let changed = 0;
  for (let i = 0; i < idCol.length; i++) {
    const id = String(idCol[i][0] || '').trim();
    if (!want[id]) continue;
    const row = i + 2;
    sh.getRange(row, COL.status).setNumberFormat('@').setValues([[status]]);
    sh.getRange(row, COL.updated_at, 1, 2).setNumberFormat('@').setValues([[stamp, MARKABLE[status]]]);
    changed++;
  }
  return { ok: true, changed: changed };
}

// 설교 제목·설교자·성경 본문·날짜 직접 고치기. 영상 제목(title)이나 AI 결과는 건드리지 않고 별도 "수정값" 칸에만 씁니다.
// 그래서 나중에 AI로 다시 정리해도 고친 값이 그대로 남습니다. 빈 값을 보내면 수정값을 지우고 자동 값으로 돌아갑니다.
// body.title / body.preacher / body.scripture / body.date 중 보낸 것만 바뀝니다 (보내지 않은 칸은 그대로).
const EDIT_TITLE_MAX = 120;
const EDIT_PREACHER_MAX = 60;
const EDIT_SCRIPTURE_MAX = 80;

function cleanEditText(raw, max) {
  return String(raw == null ? '' : raw).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function sermonEdit(body) {
  const id = checkVideoId(String(body.video_id || '').trim());
  const has = function (k) { return Object.prototype.hasOwnProperty.call(body, k); };
  if (!has('title') && !has('preacher') && !has('scripture') && !has('date')) return { ok: false, error: '바꿀 내용이 없습니다.' };
  let date = '';
  if (has('date')) {
    date = cleanEditText(body.date, 10);
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, error: '날짜는 2026-10-08 처럼 입력해 주세요.' };
    if (date) {
      const t = new Date(date + 'T00:00:00Z');
      if (isNaN(t.getTime()) || t.toISOString().slice(0, 10) !== date) return { ok: false, error: '없는 날짜입니다. 다시 확인해 주세요.' };
    }
  }
  const sh = getSermonsSheet();
  if (sh.getLastColumn() < COL.date_override) {
    const have = sh.getRange(1, 1, 1, Math.max(1, sh.getLastColumn())).getValues()[0];
    const same = have.every(function (h, i) { return !h || h === SERMON_SHEET_HEADERS[i]; });
    if (!same) return { ok: false, error: 'Sermons 탭의 열 이름이 예상과 달라 저장하지 못했습니다. "지금 동기화"를 한 번 실행한 뒤 다시 시도하세요.' };
    sh.getRange(1, 1, 1, SERMON_SHEET_HEADERS.length).setValues([SERMON_SHEET_HEADERS]);
  }
  const last = sh.getLastRow();
  if (last < 2) return { ok: false, error: '시트에 설교가 없습니다.' };
  const ids = sh.getRange(2, COL.video_id, last - 1, 1).getValues();
  let row = 0;
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0] || '').trim() === id) { row = i + 2; break; }
  }
  if (!row) return { ok: false, error: '시트에서 이 설교를 찾지 못했습니다.' };
  const saved = {};
  if (has('title')) {
    saved.title = cleanEditText(body.title, EDIT_TITLE_MAX);
    sh.getRange(row, COL.title_override).setNumberFormat('@').setValues([[saved.title]]);
  }
  if (has('preacher')) {
    saved.preacher = cleanEditText(body.preacher, EDIT_PREACHER_MAX);
    sh.getRange(row, COL.preacher_override).setNumberFormat('@').setValues([[saved.preacher]]);
  }
  if (has('scripture')) {
    saved.scripture = cleanEditText(body.scripture, EDIT_SCRIPTURE_MAX);
    sh.getRange(row, COL.scripture_override).setNumberFormat('@').setValues([[saved.scripture]]);
  }
  if (has('date')) {
    saved.date = date;
    sh.getRange(row, COL.date_override).setNumberFormat('@').setValues([[date]]);
  }
  return { ok: true, saved: saved };
}

/* ---------- 사용자 영상 — 구글 로그인한 가족이 직접 유튜브 링크를 넣는 영상 ---------- */
// 교회 재생목록과 별개로, Sermons 탭에 category = user 인 행으로 들어갑니다. 정리 방식은 같습니다.

const SERMON_SHEET_HEADERS = [
  'video_id', 'category', 'title', 'published_at', 'url', 'status', 'transcript_manual', 'result_json', 'updated_at', 'note',
  'preacher', 'scripture', 'mode_qt', 'mode_study', 'mode_group', 'bible_json', 'owner', 'title_override', 'preacher_override', 'scripture_override', 'date_override',
];
const USER_MAX_PENDING = 10;

function ensureSermonsSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SERMONS_SHEET);
  if (!sh) {
    sh = ss.insertSheet(SERMONS_SHEET);
    sh.getRange(1, 1, 1, SERMON_SHEET_HEADERS.length).setValues([SERMON_SHEET_HEADERS]);
  } else if (sh.getLastColumn() < SERMON_SHEET_HEADERS.length) {
    const have = sh.getRange(1, 1, 1, Math.max(1, sh.getLastColumn())).getValues()[0];
    const same = have.every(function (h, i) { return !h || h === SERMON_SHEET_HEADERS[i]; });
    if (same) sh.getRange(1, 1, 1, SERMON_SHEET_HEADERS.length).setValues([SERMON_SHEET_HEADERS]);
  }
  return sh;
}

// 유튜브 주소(watch?v= · youtu.be · shorts · live · embed) 또는 11자리 영상 ID → 영상 ID, 아니면 ''
function parseVideoId(input) {
  const s = String(input || '').trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  const m = /(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:watch\?(?:[^#\s]*&)?v=|embed\/|shorts\/|live\/|v\/))([\w-]{11})(?![\w-])/.exec(s);
  return m ? m[1] : '';
}

function todayString() {
  return Utilities.formatDate(new Date(), 'America/Toronto', 'yyyy-MM-dd');
}

function youtubeTitle(videoId) {
  try {
    const res = UrlFetchApp.fetch(
      'https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent('https://www.youtube.com/watch?v=' + videoId),
      { muteHttpExceptions: true }
    );
    if (res.getResponseCode() !== 200) return '';
    return String(JSON.parse(res.getContentText()).title || '');
  } catch (err) {
    return '';
  }
}

// 사용자 영상 행 찾기: { row, values } — owner/status 등은 열 단위로 읽어 큰 열을 피합니다
function readUserRows(sh) {
  const last = sh.getLastRow();
  if (last < 2) return [];
  const n = last - 1;
  const a = sh.getRange(2, COL.video_id, n, COL.status).getValues();
  const b = sh.getRange(2, COL.updated_at, n, 4).getValues(); // updated_at, note, preacher, scripture
  const o = sh.getLastColumn() >= COL.owner ? sh.getRange(2, COL.owner, n, 1).getValues() : [];
  const out = [];
  for (let i = 0; i < n; i++) {
    const id = String(a[i][0] || '').trim();
    if (!id) continue;
    out.push({
      row: i + 2,
      video_id: id,
      category: String(a[i][1] || ''),
      title: String(a[i][2] || ''),
      published_at: String(a[i][3] || '').slice(0, 10),
      status: String(a[i][5] || ''),
      updated_at: String(b[i][0] || ''),
      note: String(b[i][1] || '').slice(0, 200),
      preacher: String(b[i][2] || ''),
      scripture: String(b[i][3] || ''),
      owner: String((o[i] && o[i][0]) || '').toLowerCase(),
    });
  }
  return out;
}

function handleUserVideos(action, body) {
  let user;
  try {
    user = body.session ? verifySession(body.session) : verifyIdToken(body.id_token);
  } catch (err) {
    return authError(err);
  }
  try {
    const lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      if (action === 'user_video_add') return userVideoAdd(user, body);
      if (action === 'user_video_mine') return userVideoMine(user);
      if (action === 'user_video_redo') return userVideoChange(user, body, 'redo');
      if (action === 'user_video_remove') return userVideoChange(user, body, 'skip');
    } finally {
      lock.releaseLock();
    }
    return { ok: false, error: '알 수 없는 작업입니다.' };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
}

function dispatchUserRun() {
  try {
    dispatchSync(5, 'user');
    return { dispatched: true };
  } catch (err) {
    return { dispatched: false, dispatch_error: String(err && err.message ? err.message : err) };
  }
}

function userVideoAdd(user, body) {
  const id = parseVideoId(body.url);
  if (!id) return { ok: false, error: '유튜브 영상 주소를 확인해 주세요. (예: https://www.youtube.com/watch?v=… 또는 https://youtu.be/…)' };

  let title = String(body.title || '').trim().slice(0, 200);
  const scripture = String(body.scripture || '').trim().slice(0, 60);
  const preacher = String(body.preacher || '').trim().slice(0, 40);
  let date = String(body.date || '').trim();
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, error: '날짜는 2026-10-08 처럼 입력해 주세요.' };
  // 날짜를 안 적으면 비워 두고, 동기화가 제목의 날짜 → 유튜브 게시일 순서로 채웁니다

  const sh = ensureSermonsSheet();
  const rows = readUserRows(sh);
  const email = String(user.email || '').toLowerCase();

  const existing = rows.filter(function (r) { return r.video_id === id; })[0];
  if (existing) {
    if (existing.status === 'pending' || existing.status === 'redo') {
      return { ok: false, exists: true, error: '이미 정리 대기 중인 영상입니다. 잠시 후 [사용자 영상]에서 확인해 주세요.' };
    }
    if (existing.status === 'done' && existing.category !== 'user') {
      return { ok: false, exists: true, error: '이 영상은 이미 [토론토영락교회 설교]에 정리되어 있습니다.' };
    }
    if (existing.status === 'done') {
      return { ok: false, exists: true, error: '이미 정리된 영상입니다. [사용자 영상]에서 찾아 보세요.' };
    }
  }

  const pending = rows.filter(function (r) { return r.owner === email && (r.status === 'pending' || r.status === 'redo'); }).length;
  if (pending >= USER_MAX_PENDING) return { ok: false, error: '정리 대기 중인 영상이 너무 많습니다. 몇 편이 끝난 뒤에 다시 넣어 주세요.' };

  if (!title) title = youtubeTitle(id);
  if (!title) return { ok: false, error: '영상 제목을 가져오지 못했습니다. 제목을 직접 입력해 주세요.' };

  const stamp = new Date().toISOString();
  if (existing) {
    // 예전에 실패·제외된 영상을 다시 넣은 경우: 입력값을 새로 고치고 다시 정리
    sh.getRange(existing.row, COL.category, 1, 1).setNumberFormat('@').setValues([['user']]);
    sh.getRange(existing.row, COL.title, 1, 3).setNumberFormat('@').setValues([[title, date, 'https://www.youtube.com/watch?v=' + id]]);
    sh.getRange(existing.row, COL.status).setNumberFormat('@').setValues([['redo']]);
    sh.getRange(existing.row, COL.updated_at, 1, 2).setNumberFormat('@').setValues([[stamp, '사용자 영상으로 다시 요청했습니다']]);
    sh.getRange(existing.row, COL.preacher, 1, 2).setNumberFormat('@').setValues([[preacher, scripture]]);
    sh.getRange(existing.row, COL.owner).setNumberFormat('@').setValues([[email]]);
  } else {
    const row = new Array(SERMON_SHEET_HEADERS.length).fill('');
    row[COL.video_id - 1] = id;
    row[COL.category - 1] = 'user';
    row[COL.title - 1] = title;
    row[COL.published_at - 1] = date;
    row[COL.url - 1] = 'https://www.youtube.com/watch?v=' + id;
    row[COL.status - 1] = 'pending';
    row[COL.updated_at - 1] = stamp;
    row[COL.note - 1] = '사용자 영상 — 정리 대기 중';
    row[COL.preacher - 1] = preacher;
    row[COL.scripture - 1] = scripture;
    row[COL.owner - 1] = email;
    const next = Math.max(2, sh.getLastRow() + 1);
    sh.getRange(next, 1, 1, row.length).setNumberFormat('@').setValues([row]);
  }
  const d = dispatchUserRun();
  return { ok: true, video_id: id, title: title, dispatched: d.dispatched, dispatch_error: d.dispatch_error || '' };
}

function userVideoMine(user) {
  const sh = ensureSermonsSheet();
  const email = String(user.email || '').toLowerCase();
  const mine = readUserRows(sh)
    .filter(function (r) { return r.category === 'user' && r.owner === email && r.status !== 'skip'; })
    .sort(function (x, y) { return String(y.updated_at).localeCompare(String(x.updated_at)); })
    .map(function (r) {
      return { video_id: r.video_id, title: r.title, published_at: r.published_at, status: r.status, note: r.note, scripture: r.scripture, preacher: r.preacher, updated_at: r.updated_at };
    });
  return { ok: true, videos: mine.slice(0, 100) };
}

// 내가 올린 영상만 "다시 정리"(redo) 또는 "목록에서 빼기"(skip)
function userVideoChange(user, body, status) {
  const id = checkVideoId(body.video_id);
  const sh = ensureSermonsSheet();
  const email = String(user.email || '').toLowerCase();
  const r = readUserRows(sh).filter(function (x) { return x.video_id === id && x.category === 'user'; })[0];
  if (!r || r.owner !== email) return { ok: false, error: '내가 올린 영상만 바꿀 수 있습니다.' };
  sh.getRange(r.row, COL.status).setNumberFormat('@').setValues([[status]]);
  sh.getRange(r.row, COL.updated_at, 1, 2).setNumberFormat('@').setValues([[new Date().toISOString(), status === 'redo' ? '다시 정리를 요청했습니다' : '목록에서 뺐습니다']]);
  if (status === 'redo') return Object.assign({ ok: true }, dispatchUserRun());
  return { ok: true };
}

/* ---------- 말씀결 게임 (Game 탭) ----------
   구글 로그인한 사람마다 한 줄: 경험치 · 달란트 · 연속 도장 · 여정 · 옷장(아이템) 을 state_json 에 담습니다.
   퀴즈 채점은 서버가 Sermons 탭의 성경공부 퀴즈로 다시 합니다(화면이 보낸 점수를 그대로 믿지 않습니다).
   날짜는 토론토 기준입니다. 규칙·아이템 값은 아래 GAME_CONF(docs/game-data.js 에서 자동 생성)를 씁니다. */

// <GAME_CONF> (scripts/game-conf.mjs 가 docs/game-data.js 에서 만듭니다 — 직접 고치지 마세요)
const GAME_CONF = {"rules":{"xp":{"mc":4,"blank":6,"perfect":20,"stamp":20,"reflect":10,"read":15},"talent":{"mc":2,"blank":3,"perfect":15,"stamp":10,"reflect":5,"read":8,"week":50,"comeback":20},"passRate":0.5,"dailyScored":2,"freezePrice":120,"freezeMax":2},"streak":[[30,2],[14,1.7],[7,1.5],[3,1.2],[1,1]],"journeys":{"pilgrim":{"steps":11,"xpPerStep":160,"title":"천성에 이른 순례자","rewards":{"1":"staff","3":"scroll","4":"robe_linen","6":"lamp","11":"laurel"}},"armor":{"steps":18,"xpPerStep":100,"title":"믿음의 용사","rewards":{"18":"bg_stars"}},"tree":{"steps":13,"xpPerStep":140,"title":"열매 맺는 나무","rewards":{"4":"bg_garden","13":"halo_flower"}}},"armor":["belt_bronze","chest_bronze","feet_bronze","shield_bronze","helmet_bronze","sword_bronze","belt_silver","chest_silver","feet_silver","shield_silver","helmet_silver","sword_silver","belt_gold","chest_gold","feet_gold","shield_gold","helmet_gold","sword_gold"],"items":{"s1":["skin",0,"start"],"s2":["skin",0,"start"],"s3":["skin",0,"start"],"hair_short":["hair",0,"start"],"hair_bob":["hair",0,"start"],"hair_long":["hair",0,"start"],"hair_bun":["hair",0,"start"],"hair_curly":["hair",60,"shop"],"hair_spiky":["hair",60,"shop"],"black":["hairColor",0,"start"],"brown":["hairColor",0,"start"],"gray":["hairColor",40,"shop"],"auburn":["hairColor",40,"shop"],"blond":["hairColor",40,"shop"],"robe_brown":["robe",0,"start"],"robe_blue":["robe",80,"shop"],"robe_green":["robe",80,"shop"],"robe_red":["robe",120,"shop"],"robe_purple":["robe",200,"shop"],"robe_star":["robe",400,"shop"],"robe_linen":["robe",0,"journey"],"straw_hat":["head",100,"shop"],"scarf":["head",120,"shop"],"laurel":["head",0,"journey"],"halo_flower":["head",0,"journey"],"staff":["handR",0,"journey"],"scroll":["handR",0,"journey"],"lamp":["handL",0,"journey"],"pet_fish":["pet",150,"shop"],"pet_lamb":["pet",250,"shop"],"pet_dove":["pet",300,"shop"],"pet_donkey":["pet",350,"shop"],"bg_dawn":["bg",80,"shop"],"bg_galilee":["bg",120,"shop"],"bg_rainbow":["bg",200,"shop"],"bg_zion":["bg",300,"shop"],"bg_garden":["bg",0,"journey"],"bg_stars":["bg",0,"journey"],"belt_bronze":["belt",0,"journey"],"belt_silver":["belt",0,"journey"],"belt_gold":["belt",0,"journey"],"chest_bronze":["chest",0,"journey"],"chest_silver":["chest",0,"journey"],"chest_gold":["chest",0,"journey"],"feet_bronze":["feet",0,"journey"],"feet_silver":["feet",0,"journey"],"feet_gold":["feet",0,"journey"],"shield_bronze":["handL",0,"journey"],"shield_silver":["handL",0,"journey"],"shield_gold":["handL",0,"journey"],"helmet_bronze":["head",0,"journey"],"helmet_silver":["head",0,"journey"],"helmet_gold":["head",0,"journey"],"sword_bronze":["handR",0,"journey"],"sword_silver":["handR",0,"journey"],"sword_gold":["handR",0,"journey"]},"look":{"skin":"s1","hair":"hair_short","hairColor":"black","robe":"robe_brown","head":"","handR":"","handL":"","chest":"","belt":"","feet":"","pet":"","bg":""},"badges":[["first",20],["streak3",30],["streak7",60],["streak30",200],["perfect1",30],["perfect10",150],["quests10",50],["quests50",200],["reflect10",60],["read7",60],["read30",200],["nt",300],["bible",1000],["journey1",100],["journey3",300]],"levelTitles":[[30,"반석"],[20,"등대"],[15,"일꾼"],[10,"제자"],[5,"순례자"],[1,"새싹"]],"bible":[50,40,27,36,34,24,21,4,31,24,22,25,29,36,10,13,10,42,150,31,12,8,66,52,5,48,12,14,3,9,1,4,7,3,3,3,2,14,4,28,16,24,21,28,16,16,13,6,6,4,4,5,3,6,4,3,1,13,5,5,3,5,1,1,1,22]};
// </GAME_CONF>

const GAME_SHEET = 'Game';
const GAME_HEADERS = ['user_sub', 'email', 'name', 'state_json', 'updated_at'];
const GAME_NICK_MAX = 12;
const GAME_KEEP_STAMPS = 400;

function gameToday() {
  return todayString();
}

function handleGame(action, body) {
  let user;
  try {
    user = body.session ? verifySession(body.session) : verifyIdToken(body.id_token);
  } catch (err) {
    return authError(err);
  }
  try {
    if (action === 'game_board') return gameBoard(user);
    const lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      const sh = getGameSheet();
      const found = gameLoad(sh, user);
      const st = found.state;
      const today = gameToday();
      const events = [];
      let out = {};
      if (action === 'game_get') out = {};
      else if (action === 'game_equip') gameEquip(st, body.look);
      else if (action === 'game_buy') out = gameBuy(st, String(body.item || ''), events);
      else if (action === 'game_journey') gameSelectJourney(st, String(body.key || ''));
      else if (action === 'game_profile') gameProfile(st, body);
      else if (action === 'game_quiz') out = gameQuiz(st, body, today, events);
      else if (action === 'game_reflect') out = gameReflect(st, user, body, today, events);
      else if (action === 'game_read') out = gameRead(st, body, today, events);
      else if (action === 'game_chapter') out = gameChapter(st, body);
      else return { ok: false, error: '알 수 없는 작업입니다.' };
      if (action !== 'game_get' || found.isNew) gameSave(sh, found.row, user, st);
      return Object.assign({ ok: true, state: gameView(st, today), events: events }, out);
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
}

function getGameSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(GAME_SHEET);
  if (!sh) {
    sh = ss.insertSheet(GAME_SHEET);
    sh.getRange(1, 1, 1, GAME_HEADERS.length).setValues([GAME_HEADERS]);
    sh.getRange(1, 1, sh.getMaxRows(), GAME_HEADERS.length).setNumberFormat('@');
  }
  return sh;
}

function gameNewState() {
  const inv = Object.keys(GAME_CONF.items).filter(function (id) {
    return GAME_CONF.items[id][2] === 'start';
  });
  const prog = {};
  Object.keys(GAME_CONF.journeys).forEach(function (k) {
    prog[k] = 0;
  });
  return {
    v: 1,
    xp: 0,
    talents: 0,
    look: Object.assign({}, GAME_CONF.look),
    inv: inv,
    streak: 0,
    best: 0,
    last: '',
    stamps: [],
    freeze: 0,
    week: { key: '', xp: 0 },
    daily: { day: '', n: 0 },
    quizzes: {},
    reflects: {},
    readDays: {},
    bible: [],
    journey: { cur: '', prog: prog, done: [] },
    badges: [],
    titles: [],
    title: '',
    nick: '',
    stats: { quests: 0, perfect: 0, reflects: 0, reads: 0 },
  };
}

function gameLoad(sh, user) {
  const last = sh.getLastRow();
  if (last >= 2) {
    const vals = sh.getRange(2, 1, last - 1, 4).getValues();
    for (let i = 0; i < vals.length; i++) {
      if (String(vals[i][0]) === user.sub) {
        const saved = parseJsonObject(vals[i][3]);
        const st = Object.assign(gameNewState(), saved);
        st.journey = Object.assign(gameNewState().journey, saved.journey || {});
        st.journey.prog = Object.assign(gameNewState().journey.prog, (saved.journey && saved.journey.prog) || {});
        st.stats = Object.assign(gameNewState().stats, saved.stats || {});
        st.look = Object.assign({}, GAME_CONF.look, saved.look || {});
        return { row: i + 2, state: st, isNew: false };
      }
    }
  }
  return { row: 0, state: gameNewState(), isNew: true };
}

function gameSave(sh, row, user, st) {
  if (st.stamps.length > GAME_KEEP_STAMPS) st.stamps = st.stamps.slice(-GAME_KEEP_STAMPS);
  const text = JSON.stringify(st);
  if (text.length > MAX_CELL) throw new Error('게임 기록이 너무 커졌습니다.');
  const values = [[user.sub, user.email || '', user.name || '', text, new Date().toISOString()]];
  if (row) sh.getRange(row, 1, 1, GAME_HEADERS.length).setValues(values);
  else sh.appendRow(values[0]);
}

/* 날짜 계산 (yyyy-MM-dd) */
function gameDayNum(day) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day || ''));
  return m ? Math.round(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86400000) : NaN;
}
function gameWeekKey(day) {
  const n = gameDayNum(day);
  const dow = (new Date(n * 86400000).getUTCDay() + 6) % 7; // 월요일 = 0
  return new Date((n - dow) * 86400000).toISOString().slice(0, 10);
}
function gameLevel(xp) {
  return Math.max(1, Math.floor((1 + Math.sqrt(1 + (8 * Math.max(0, xp)) / 100)) / 2));
}
function gameLevelTitle(lv) {
  const t = GAME_CONF.levelTitles.filter(function (x) {
    return lv >= x[0];
  })[0];
  return t ? t[1] : '새싹';
}
function gameMult(streak) {
  const s = GAME_CONF.streak.filter(function (x) {
    return streak >= x[0];
  })[0];
  return s ? s[1] : 1;
}
function gameOwn(st, id) {
  if (st.inv.indexOf(id) < 0) st.inv.push(id);
}

/* 그날 첫 도장: 연속 일수 · 안식 쿠폰 · 다시 돌아옴 · 7일마다 보너스 */
function gameStamp(st, today, events) {
  if (st.last === today) return false;
  const gap = st.last ? gameDayNum(today) - gameDayNum(st.last) : 0;
  if (!st.last) st.streak = 1;
  else if (gap === 1) st.streak += 1;
  else {
    const missed = gap - 1;
    if (missed > 0 && missed <= st.freeze) {
      st.freeze -= missed;
      st.streak += 1;
      events.push({ type: 'freeze', used: missed });
    } else {
      st.streak = 1;
      if (gap >= 3) {
        st.talents += GAME_CONF.rules.talent.comeback;
        events.push({ type: 'comeback', talents: GAME_CONF.rules.talent.comeback });
      }
    }
  }
  st.last = today;
  st.stamps.push(today);
  st.best = Math.max(st.best, st.streak);
  const talents = Math.round(GAME_CONF.rules.talent.stamp * gameMult(st.streak));
  events.push({ type: 'stamp', day: today, streak: st.streak, talents: talents, xp: GAME_CONF.rules.xp.stamp });
  gameGain(st, GAME_CONF.rules.xp.stamp, talents, today, events);
  if (st.streak % 7 === 0) {
    st.talents += GAME_CONF.rules.talent.week;
    events.push({ type: 'week', streak: st.streak, talents: GAME_CONF.rules.talent.week });
  }
  return true;
}

/* 경험치 · 달란트 더하기 → 주간 점수 · 레벨 · 여정 진행 */
function gameGain(st, xp, talents, today, events) {
  const before = gameLevel(st.xp);
  st.xp += xp;
  st.talents += talents;
  const wk = gameWeekKey(today);
  if (st.week.key !== wk) st.week = { key: wk, xp: 0 };
  st.week.xp += xp;
  const after = gameLevel(st.xp);
  if (after > before) events.push({ type: 'level', level: after, title: gameLevelTitle(after) });
  gameAdvanceJourney(st, xp, events);
}

function gameJourneySteps(key, prog) {
  const j = GAME_CONF.journeys[key];
  return Math.min(j.steps, Math.floor((prog || 0) / j.xpPerStep));
}

function gameAdvanceJourney(st, xp, events) {
  const key = st.journey.cur;
  if (!key || !GAME_CONF.journeys[key] || st.journey.done.indexOf(key) >= 0) return;
  const j = GAME_CONF.journeys[key];
  const beforeSteps = gameJourneySteps(key, st.journey.prog[key]);
  st.journey.prog[key] = Math.min(j.steps * j.xpPerStep, (st.journey.prog[key] || 0) + xp);
  const afterSteps = gameJourneySteps(key, st.journey.prog[key]);
  for (let s = beforeSteps + 1; s <= afterSteps; s++) {
    const item = key === 'armor' ? GAME_CONF.armor[s - 1] : '';
    const reward = j.rewards[String(s)] || '';
    if (item) gameOwn(st, item);
    if (reward) gameOwn(st, reward);
    events.push({ type: 'step', journey: key, step: s, steps: j.steps, item: item, reward: reward });
  }
  if (afterSteps >= j.steps && st.journey.done.indexOf(key) < 0) {
    st.journey.done.push(key);
    if (st.titles.indexOf(j.title) < 0) st.titles.push(j.title);
    st.journey.cur = '';
    events.push({ type: 'journey', journey: key, title: j.title });
  }
}

function gameBadges(st, events) {
  const has = {
    first: st.stats.quests >= 1,
    streak3: st.streak >= 3,
    streak7: st.streak >= 7,
    streak30: st.streak >= 30,
    perfect1: st.stats.perfect >= 1,
    perfect10: st.stats.perfect >= 10,
    quests10: st.stats.quests >= 10,
    quests50: st.stats.quests >= 50,
    reflect10: st.stats.reflects >= 10,
    read7: (st.stats.reads || 0) >= 7,
    read30: (st.stats.reads || 0) >= 30,
    nt: st.bible.length >= 260 && gameBibleDone(st, 40),
    bible: st.bible.length >= 1189 && gameBibleDone(st, 1),
    journey1: st.journey.done.length >= 1,
    journey3: st.journey.done.length >= 3,
  };
  GAME_CONF.badges.forEach(function (b) {
    if (has[b[0]] && st.badges.indexOf(b[0]) < 0) {
      st.badges.push(b[0]);
      st.talents += b[1];
      events.push({ type: 'badge', id: b[0], talents: b[1] });
    }
  });
}

/* 옷 갈아입기: 가진 아이템만, 칸이 맞아야 합니다 */
function gameEquip(st, look) {
  if (!look || typeof look !== 'object') throw new Error('옷장 정보가 올바르지 않습니다.');
  const next = Object.assign({}, st.look);
  Object.keys(GAME_CONF.look).forEach(function (slot) {
    if (!(slot in look)) return;
    const id = String(look[slot] || '');
    if (!id) {
      if (['skin', 'hair', 'hairColor', 'robe'].indexOf(slot) >= 0) throw new Error('이 칸은 비워 둘 수 없습니다.');
      next[slot] = '';
      return;
    }
    const it = GAME_CONF.items[id];
    if (!it || it[0] !== slot) throw new Error('이 칸에 입을 수 없는 아이템입니다.');
    if (st.inv.indexOf(id) < 0) throw new Error('아직 가지고 있지 않은 아이템입니다.');
    next[slot] = id;
  });
  st.look = next;
}

function gameBuy(st, id, events) {
  if (id === 'freeze') {
    if (st.freeze >= GAME_CONF.rules.freezeMax) throw new Error('안식 쿠폰은 ' + GAME_CONF.rules.freezeMax + '장까지 가질 수 있습니다.');
    if (st.talents < GAME_CONF.rules.freezePrice) throw new Error('달란트가 부족합니다.');
    st.talents -= GAME_CONF.rules.freezePrice;
    st.freeze += 1;
    events.push({ type: 'buy', item: 'freeze' });
    return { bought: 'freeze' };
  }
  const it = GAME_CONF.items[id];
  if (!it || it[2] !== 'shop') throw new Error('상점에서 살 수 없는 아이템입니다.');
  if (st.inv.indexOf(id) >= 0) throw new Error('이미 가지고 있습니다.');
  if (st.talents < it[1]) throw new Error('달란트가 부족합니다.');
  st.talents -= it[1];
  gameOwn(st, id);
  events.push({ type: 'buy', item: id });
  return { bought: id };
}

function gameSelectJourney(st, key) {
  if (!GAME_CONF.journeys[key]) throw new Error('여정을 찾을 수 없습니다.');
  if (st.journey.done.indexOf(key) >= 0) throw new Error('이미 완주한 여정입니다.');
  st.journey.cur = key;
}

function gameProfile(st, body) {
  if ('nick' in body) st.nick = cleanEditText(body.nick, GAME_NICK_MAX);
  if ('title' in body) {
    const t = String(body.title || '');
    if (t && st.titles.indexOf(t) < 0 && t !== gameLevelTitle(gameLevel(st.xp))) throw new Error('아직 받지 않은 칭호입니다.');
    st.title = t;
  }
}

/* 빈칸 정답 비교: 띄어쓰기 · 문장부호 무시 (scripts/lib/gemini.mjs 의 blankKey 와 같은 규칙) */
function gameBlankKey(s) {
  return String(s || '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/[\s.,!?·~'"“”‘’()\[\]{}<>「」『』:;\-_/]/g, '');
}

// 오늘의 말씀 퀴즈 (Daily 탭, GitHub 동기화가 매일 만듭니다)
function gameDailyQuiz(id) {
  const m = /^bible-(\d{4})(\d{2})(\d{2})$/.exec(id);
  const date = m[1] + '-' + m[2] + '-' + m[3];
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Daily');
  if (!sh || sh.getLastRow() < 2) throw new Error('이 날의 말씀 퀴즈가 아직 준비되지 않았습니다.');
  const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  const cDate = head.indexOf('date');
  const cQuiz = head.indexOf('quiz_json');
  if (cDate < 0 || cQuiz < 0) throw new Error('Daily 탭 형식이 올바르지 않습니다.');
  const rows = sh.getRange(2, 1, sh.getLastRow() - 1, head.length).getValues();
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][cDate]) === date) {
      const quiz = parseJsonObject(rows[i][cQuiz]);
      return { mc: Array.isArray(quiz.multiple_choice) ? quiz.multiple_choice : [], fb: Array.isArray(quiz.fill_blank) ? quiz.fill_blank : [] };
    }
  }
  throw new Error('이 날의 말씀 퀴즈가 아직 준비되지 않았습니다.');
}

function gameStudyQuiz(videoId) {
  if (/^bible-\d{8}$/.test(videoId)) return gameDailyQuiz(videoId);
  const sh = getSermonsSheet();
  const last = sh.getLastRow();
  if (last < 2) throw new Error('설교를 찾을 수 없습니다.');
  const ids = sh.getRange(2, COL.video_id, last - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === videoId) {
      const study = parseJsonObject(sh.getRange(i + 2, COL.mode_study, 1, 1).getValues()[0][0]);
      const quiz = study.quiz || {};
      return { mc: Array.isArray(quiz.multiple_choice) ? quiz.multiple_choice : [], fb: Array.isArray(quiz.fill_blank) ? quiz.fill_blank : [] };
    }
  }
  throw new Error('설교를 찾을 수 없습니다.');
}

function gameQuiz(st, body, today, events) {
  const videoId = checkVideoId(body.video_id);
  const quiz = gameStudyQuiz(videoId);
  const total = quiz.mc.length + quiz.fb.length;
  if (!total) throw new Error('이 설교에는 퀴즈가 없습니다.');
  const mcAns = Array.isArray(body.mc) ? body.mc : [];
  const fbAns = Array.isArray(body.fb) ? body.fb : [];
  if (mcAns.length !== quiz.mc.length || fbAns.length !== quiz.fb.length) throw new Error('모든 문제에 답한 뒤 제출해 주세요.');
  const mcOk = quiz.mc.map(function (q, i) {
    return Number(mcAns[i]) === Number(q.answer_index);
  });
  const fbOk = quiz.fb.map(function (q, i) {
    const got = gameBlankKey(String(fbAns[i] || '').slice(0, 80));
    if (!got) return false;
    const accept = [q.answer].concat(Array.isArray(q.accept) ? q.accept : []);
    return accept.some(function (a) {
      return gameBlankKey(a) === got;
    });
  });
  const mcRight = mcOk.filter(Boolean).length;
  const fbRight = fbOk.filter(Boolean).length;
  const right = mcRight + fbRight;
  const perfect = right === total;
  const passed = right >= Math.ceil(total * GAME_CONF.rules.passRate);
  if (st.daily.day !== today) st.daily = { day: today, n: 0 };
  const already = !!st.quizzes[videoId];
  const scored = !already && st.daily.n < GAME_CONF.rules.dailyScored;
  let stamped = false;
  if (passed) stamped = gameStamp(st, today, events);
  let xp = 0;
  let talents = 0;
  if (scored) {
    const r = GAME_CONF.rules;
    const mult = gameMult(st.streak);
    xp = mcRight * r.xp.mc + fbRight * r.xp.blank + (perfect ? r.xp.perfect : 0);
    talents = Math.round((mcRight * r.talent.mc + fbRight * r.talent.blank + (perfect ? r.talent.perfect : 0)) * mult);
    st.daily.n += 1;
    st.quizzes[videoId] = { s: right, t: total, at: today };
    st.stats.quests += 1;
    if (perfect) st.stats.perfect += 1;
    gameGain(st, xp, talents, today, events);
  }
  gameBadges(st, events);
  return {
    result: {
      scored: scored,
      already: already,
      capped: !already && !scored,
      right: right,
      total: total,
      perfect: perfect,
      passed: passed,
      stamped: stamped,
      xp: xp,
      talents: talents,
      mult: gameMult(st.streak),
      mc: mcOk,
      fb: fbOk,
    },
  };
}

/* 묵상 퀘스트: QT 묵상 질문에 내 답을 적었으면(모두 합쳐 30자 이상) 설교마다 한 번 */
function gameReflect(st, user, body, today, events) {
  const videoId = checkVideoId(body.video_id);
  if (st.reflects[videoId]) return { result: { already: true } };
  const sh = getNotesSheet();
  const row = findNoteRow(sh, user.sub, videoId);
  const fields = row ? parseJsonObject(sh.getRange(row, 8, 1, 1).getValues()[0][0]) : {};
  let len = 0;
  Object.keys(fields).forEach(function (k) {
    if (/^qt\.q\./.test(k)) len += String(fields[k] || '').trim().length;
  });
  if (len < 30) throw new Error('묵상 질문에 내 답을 조금 더 적어 주세요. (모두 합쳐 30자 이상)');
  st.reflects[videoId] = today;
  st.stats.reflects += 1;
  const stamped = gameStamp(st, today, events);
  const r = GAME_CONF.rules;
  const talents = Math.round(r.talent.reflect * gameMult(st.streak));
  gameGain(st, r.xp.reflect, talents, today, events);
  gameBadges(st, events);
  return { result: { already: false, stamped: stamped, xp: r.xp.reflect, talents: talents } };
}

/* ---------- 오늘의 말씀 읽기 · 성경일독표 ---------- */
// 일독표 칸 "41:10" = 마가복음 10장 (책 번호 1~66 : 장)
function gameChapterOk(key) {
  const m = /^(\d{1,2}):(\d{1,3})$/.exec(String(key || ''));
  if (!m) return false;
  const book = Number(m[1]);
  const ch = Number(m[2]);
  return book >= 1 && book <= 66 && ch >= 1 && ch <= GAME_CONF.bible[book - 1];
}
function gameAddChapters(st, keys) {
  let added = 0;
  (Array.isArray(keys) ? keys : []).slice(0, 30).forEach(function (k) {
    const key = String(k);
    if (gameChapterOk(key) && st.bible.indexOf(key) < 0) {
      st.bible.push(key);
      added += 1;
    }
  });
  return added;
}

/* 말씀 읽기 완료: 그날 분량의 장들이 일독표에 체크되고, 날마다 한 번 경험치 · 달란트 · 도장 */
function gameRead(st, body, today, events) {
  const date = String(body.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(gameDayNum(date))) throw new Error('날짜가 올바르지 않습니다.');
  if (gameDayNum(date) > gameDayNum(today)) throw new Error('아직 오지 않은 날의 말씀입니다.');
  const added = gameAddChapters(st, body.chapters);
  if (st.readDays[date]) {
    gameBadges(st, events);
    return { result: { already: true, added: added } };
  }
  st.readDays[date] = today;
  st.stats.reads = (st.stats.reads || 0) + 1;
  const stamped = gameStamp(st, today, events);
  const r = GAME_CONF.rules;
  const talents = Math.round(r.talent.read * gameMult(st.streak));
  gameGain(st, r.xp.read, talents, today, events);
  gameBadges(st, events);
  return { result: { already: false, added: added, stamped: stamped, xp: r.xp.read, talents: talents } };
}

/* 일독표를 손으로 체크하거나 지우기 */
function gameChapter(st, body) {
  const key = String(body.key || '');
  if (!gameChapterOk(key)) throw new Error('성경 장 정보가 올바르지 않습니다.');
  const i = st.bible.indexOf(key);
  if (body.on === false || body.on === 'false') {
    if (i >= 0) st.bible.splice(i, 1);
  } else if (i < 0) st.bible.push(key);
  return {};
}

function gameBibleDone(st, fromBook) {
  for (let b = fromBook; b <= 66; b++) {
    for (let ch = 1; ch <= GAME_CONF.bible[b - 1]; ch++) if (st.bible.indexOf(b + ':' + ch) < 0) return false;
  }
  return true;
}

/* 화면에 보낼 모습 (계산한 값 덧붙임) */
function gameView(st, today) {
  const lv = gameLevel(st.xp);
  const daily = st.daily.day === today ? st.daily.n : 0;
  const wk = gameWeekKey(today);
  // 어제도 오늘도 도장이 없으면(그리고 쿠폰으로도 못 이으면) 연속 기록이 끊긴 것으로 보여 줍니다
  let streak = st.streak;
  if (st.last && st.last !== today) {
    const gap = gameDayNum(today) - gameDayNum(st.last);
    if (gap - 1 > st.freeze) streak = 0;
  }
  return {
    xp: st.xp,
    talents: st.talents,
    level: lv,
    levelTitle: gameLevelTitle(lv),
    look: st.look,
    inv: st.inv,
    streak: streak,
    best: st.best,
    stampedToday: st.last === today,
    stamps: st.stamps.slice(-62),
    freeze: st.freeze,
    weekXp: st.week.key === wk ? st.week.xp : 0,
    dailyLeft: Math.max(0, GAME_CONF.rules.dailyScored - daily),
    mult: gameMult(Math.max(1, streak)),
    quizzes: st.quizzes,
    reflects: st.reflects,
    readDays: st.readDays,
    bible: st.bible,
    journey: st.journey,
    badges: st.badges,
    titles: st.titles,
    title: st.title,
    nick: st.nick,
    stats: st.stats,
    today: today,
  };
}

/* 가족 순위: 이번 주 경험치 · 누적 · 연속 */
function gameBoard(user) {
  const sh = getGameSheet();
  const last = sh.getLastRow();
  const today = gameToday();
  const wk = gameWeekKey(today);
  const players = [];
  if (last >= 2) {
    sh.getRange(2, 1, last - 1, 4)
      .getValues()
      .forEach(function (r) {
        const st = Object.assign(gameNewState(), parseJsonObject(r[3]));
        const v = gameView(st, today);
        players.push({
          me: String(r[0]) === user.sub,
          name: st.nick || String(r[2] || '').split(' ')[0] || String(r[1] || '').split('@')[0] || '이름 없음',
          level: v.level,
          title: st.title || v.levelTitle,
          xp: st.xp,
          weekXp: st.week.key === wk ? st.week.xp : 0,
          streak: v.streak,
          look: Object.assign({}, GAME_CONF.look, st.look || {}),
          stampedToday: v.stampedToday,
        });
      });
  }
  players.sort(function (a, b) {
    return b.weekXp - a.weekXp || b.xp - a.xp;
  });
  return { ok: true, players: players, week: wk };
}
