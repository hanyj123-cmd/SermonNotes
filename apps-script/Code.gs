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
// Settings 탭(AI 모델)과 Sermons 탭(영상 선택 관리 · 사용자 영상)은 이 코드가 직접 읽고 씁니다. 별도 설정은 필요 없습니다.

const SHEET_NAME = 'Playlists';
const HEADERS = ['category', 'playlist_url', 'max_videos'];
const LABELS = ['주일예배', '새벽기도', '수요예배', '청년부예배'];
const DEFAULT_MAX = 30;
const MAX_LIMIT = 100;

const NOTES_SHEET = 'Notes';
const NOTE_HEADERS = ['user_sub', 'email', 'video_id', 'memo', 'answers_json', 'checks_json', 'updated_at', 'fields_json'];
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
  } else if (sh.getLastColumn() < NOTE_HEADERS.length) {
    // 예전 버전에서 만든 Notes 탭에 새 열(fields_json)을 덧붙입니다
    sh.getRange(1, 1, 1, NOTE_HEADERS.length).setValues([NOTE_HEADERS]);
    sh.getRange(1, NOTE_HEADERS.length, sh.getMaxRows(), 1).setNumberFormat('@');
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
  range.setValues([[user.sub, user.email, videoId, memo, answersJson, checksJson, new Date().toISOString(), fieldsJson]]);
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
    if (hasMemo || hasAnswer || hasCheck || hasField) items.push({ video_id: String(r[2]), updated_at: String(r[6] || '') });
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

function dispatchSync(maxNew, categories) {
  const inputs = { max_new: String(maxNew) };
  if (categories) inputs.categories = categories;
  ghRequest('post', '/actions/workflows/' + GH_WORKFLOW + '/dispatches', {
    ref: prop('GITHUB_REF') || 'main',
    inputs: inputs,
  });
}

function syncRun(body) {
  let n = parseInt(body.max_new, 10);
  if (isNaN(n)) n = SYNC_DEFAULT;
  n = Math.min(SYNC_MAX, Math.max(SYNC_MIN, n));
  if (latestRun().state === 'running') {
    return { ok: false, error: '이미 실행 중입니다. 끝난 뒤에 다시 눌러 주세요.' };
  }
  const categories = cleanCategories(body.categories);
  dispatchSync(n, categories);
  return { ok: true, max_new: n, categories: categories };
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
const COL = { video_id: 1, category: 2, title: 3, published_at: 4, url: 5, status: 6, transcript_manual: 7, result_json: 8, updated_at: 9, note: 10, preacher: 11, scripture: 12, mode_qt: 13, mode_study: 14, mode_group: 15, bible_json: 16, owner: 17 };
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

/* ---------- 사용자 영상 — 구글 로그인한 가족이 직접 유튜브 링크를 넣는 영상 ---------- */
// 교회 재생목록과 별개로, Sermons 탭에 category = user 인 행으로 들어갑니다. 정리 방식은 같습니다.

const SERMON_SHEET_HEADERS = [
  'video_id', 'category', 'title', 'published_at', 'url', 'status', 'transcript_manual', 'result_json', 'updated_at', 'note',
  'preacher', 'scripture', 'mode_qt', 'mode_study', 'mode_group', 'bible_json', 'owner',
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
  if (!date) date = todayString();

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
