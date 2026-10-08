// 말씀 노트 — Apps Script 웹앱
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
// Settings 탭(AI 모델·성경 역본)과 Sermons 탭(영상 선택 관리)은 이 코드가 직접 읽고 씁니다. 별도 설정은 필요 없습니다.

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

function syncRun(body) {
  let n = parseInt(body.max_new, 10);
  if (isNaN(n)) n = SYNC_DEFAULT;
  n = Math.min(SYNC_MAX, Math.max(SYNC_MIN, n));
  if (latestRun().state === 'running') {
    return { ok: false, error: '이미 실행 중입니다. 끝난 뒤에 다시 눌러 주세요.' };
  }
  ghRequest('post', '/actions/workflows/' + GH_WORKFLOW + '/dispatches', {
    ref: prop('GITHUB_REF') || 'main',
    inputs: { max_new: String(n) },
  });
  return { ok: true, max_new: n };
}

/* ---------- 설정 (AI 모델 · 성경 역본) — Settings 탭 ---------- */

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

function parseVersions(raw) {
  let arr;
  try {
    arr = JSON.parse(raw || '[]');
  } catch (err) {
    arr = [];
  }
  return Array.isArray(arr) ? arr : [];
}

function settingsGet() {
  const m = readSettingsMap();
  return { ok: true, settings: { gemini_model: m.gemini_model || '', bible_versions: parseVersions(m.bible_versions) } };
}

function settingsSet(body) {
  if (body.gemini_model !== undefined) {
    const model = String(body.gemini_model || '').trim();
    if (model && !MODEL_PATTERN.test(model)) return { ok: false, error: '모델 이름이 올바르지 않습니다. 예: gemini-3.8-flash' };
    writeSetting('gemini_model', model);
  }
  if (body.bible_versions !== undefined) {
    const list = Array.isArray(body.bible_versions) ? body.bible_versions : [];
    const clean = [];
    const seen = {};
    list.forEach(function (v) {
      const id = String(v && v.id !== undefined ? v.id : '').trim();
      const label = String(v && v.label !== undefined ? v.label : '').trim().slice(0, 30);
      if (!/^\d{1,8}$/.test(id) || !label || seen[id] || clean.length >= 3) return;
      seen[id] = true;
      clean.push({ id: id, label: label });
    });
    writeSetting('bible_versions', JSON.stringify(clean));
  }
  return { ok: true };
}

/* ---------- 영상 선택 관리 — Sermons 탭 ---------- */

const SERMONS_SHEET = 'Sermons';
// Sermons 탭 열 번호 (scripts/lib/sheets.mjs 의 SERMON_HEADERS 와 같은 순서)
const COL = { video_id: 1, category: 2, title: 3, published_at: 4, url: 5, status: 6, transcript_manual: 7, result_json: 8, updated_at: 9, note: 10 };
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
