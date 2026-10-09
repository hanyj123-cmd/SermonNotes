// Apps Script(Code.gs)를 가짜 Google 서비스 위에서 실행해 노트 분리·로그인 검증을 점검합니다.
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';

import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const code = fs.readFileSync(path.join(root, 'apps-script/Code.gs'), 'utf8');
let fails = 0; const check = (n, c, x = '') => { console.log(c ? '✓' : '✗', n, c ? '' : x); if (!c) fails++; };

function makeEnv(props) {
  const sheets = new Map();
  const formats = [];
  const mkSheet = (name) => {
    const rows = [];
    const sh = {
      name, rows,
      getLastRow: () => rows.length,
      getLastColumn: () => rows.reduce((m, r) => Math.max(m, (r || []).length), 0),
      getMaxRows: () => 1000,
      getRange(r, c, nr = 1, nc = 1) {
        const range = {
          getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => (rows[r - 1 + i]?.[c - 1 + j] ?? ''))),
          setValues: (v) => { v.forEach((row, i) => { rows[r - 1 + i] = rows[r - 1 + i] || []; row.forEach((x, j) => { rows[r - 1 + i][c - 1 + j] = x; }); }); },
          setNumberFormat: (f) => { formats.push({ sheet: name, r, c, nr, nc, f }); return range; },
        };
        return range;
      },
      appendRow: (arr) => { rows.push(arr); },
      deleteRow: (n) => { rows.splice(n - 1, 1); },
    };
    return sh;
  };
  const ss = {
    getSheetByName: (n) => sheets.get(n) || null,
    insertSheet: (n) => { const s = mkSheet(n); sheets.set(n, s); return s; },
  };
  const cache = new Map();
  // 가짜 토큰: "tok:" + JSON. 진짜 구글처럼 aud/iss/exp/sub/email 을 돌려줍니다.
  const tokenInfo = (t) => { try { return JSON.parse(t.slice(4)); } catch { return null; } };
  let fetches = 0;
  const oembed = [];
  let oembedTitle = '[2026.10.04] 믿음의 길 (창세기 12:1-9) - 홍길동 목사';
  const ghCalls = [];
  let ghHandler = () => ({ code: 200, body: {} });
  const ctx = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ss },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props[k] ?? null, setProperty: (k, v) => { props[k] = v; } }) },
    CacheService: { getScriptCache: () => ({ get: (k) => cache.get(k) ?? null, put: (k, v) => cache.set(k, v) }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' },
      Charset: { UTF_8: 'UTF-8' },
      computeDigest: (_a, text) => Array.from(crypto.createHash('sha256').update(text).digest()).map((b) => (b > 127 ? b - 256 : b)),
      computeHmacSha256Signature: (text, key) => Array.from(crypto.createHmac('sha256', key).update(text).digest()).map((b) => (b > 127 ? b - 256 : b)),
      base64EncodeWebSafe: (data) => (Array.isArray(data) ? Buffer.from(data.map((b) => b & 255)) : Buffer.from(String(data), 'utf8')).toString('base64').replace(/\+/g, '-').replace(/\//g, '_'),
      base64DecodeWebSafe: (str) => Array.from(Buffer.from(String(str).replace(/-/g, '+').replace(/_/g, '/'), 'base64')).map((b) => (b > 127 ? b - 256 : b)),
      newBlob: (bytes) => ({ getDataAsString: () => Buffer.from(bytes.map((b) => b & 255)).toString('utf8') }),
      getUuid: () => crypto.randomUUID(),
      formatDate: (d, tz, fmt) => d.toISOString().slice(0, 10),
    },
    UrlFetchApp: {
      fetch: (url, opts) => {
        if (String(url).startsWith('https://api.github.com/')) {
          ghCalls.push({ url, opts });
          const r = ghHandler(url, opts);
          return { getResponseCode: () => r.code, getContentText: () => JSON.stringify(r.body || {}) };
        }
        if (String(url).startsWith('https://www.youtube.com/oembed')) {
          oembed.push(url);
          return { getResponseCode: () => (oembedTitle ? 200 : 404), getContentText: () => JSON.stringify({ title: oembedTitle }) };
        }
        fetches++;
        const tok = decodeURIComponent(url.split('id_token=')[1]);
        const info = tokenInfo(tok);
        return { getResponseCode: () => (info ? 200 : 400), getContentText: () => JSON.stringify(info || { error: 'invalid_token' }) };
      },
    },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (t) => ({ setMimeType() { return { getContent: () => t }; } }) },
    console,
  };
  vm.createContext(ctx);
  vm.runInContext(code, ctx);
  const post = (body) => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(body) } }).getContent());
  return { ctx, post, ss, sheets, formats, ghCalls, oembed, setOembed: (t) => { oembedTitle = t; }, setGh: (f) => { ghHandler = f; }, get fetches() { return fetches; } };
}

const CID = 'cid.apps.googleusercontent.com';
const exp = Math.floor(Date.now() / 1000) + 3000;
const tok = (o) => 'tok:' + JSON.stringify({ aud: CID, iss: 'https://accounts.google.com', email_verified: 'true', exp: String(exp), ...o });
const A = tok({ sub: '110000000000000000001', email: 'a@x.com' });
const B = tok({ sub: '110000000000000000002', email: 'b@x.com' });
const props = { GOOGLE_CLIENT_ID: CID, ALLOWED_EMAILS: 'a@x.com, B@X.com', ADMIN_PASSWORD: 'pw' };
const env = makeEnv(props);
const { post } = env;
const VID = 'sampleSun001';

// 저장 / 분리
let r = post({ action: 'notes_save', id_token: A, video_id: VID, memo: '=A의 비밀 메모', answers: [{ q: '질문1', a: 'A의 답' }], checks: [{ t: '적용1', done: true, date: '2026-10-05' }] });
check('A 저장 성공', r.ok === true, JSON.stringify(r));
r = post({ action: 'notes_get', id_token: B, video_id: VID });
check('B는 A의 노트를 볼 수 없음', r.ok && r.note === null, JSON.stringify(r));
r = post({ action: 'notes_save', id_token: B, video_id: VID, memo: 'B의 메모', answers: [], checks: [] });
check('B 저장 성공', r.ok === true);
r = post({ action: 'notes_get', id_token: A, video_id: VID });
check('A는 자기 노트만 봄(B의 것과 섞이지 않음)', r.note.memo === '=A의 비밀 메모' && r.note.answers[0].a === 'A의 답' && r.note.checks[0].done === true);
r = post({ action: 'notes_get', id_token: B, video_id: VID });
check('B는 자기 노트만 봄', r.note.memo === 'B의 메모');

// 같은 사람이 다시 저장하면 새 줄이 아니라 같은 줄 갱신
post({ action: 'notes_save', id_token: A, video_id: VID, memo: '수정됨', answers: [], checks: [] });
const rows = env.sheets.get('Notes').rows;
check('다시 저장해도 줄이 늘지 않음 (헤더 + A + B = 3줄)', rows.length === 3, String(rows.length));
check('수정 내용 반영', post({ action: 'notes_get', id_token: A, video_id: VID }).note.memo === '수정됨');

// 형광펜·밑줄·메모 (marks)
{
  const mk = (o = {}) => ({ id: 'ma-0', g: 'ma', k: 'abc123', s: 2, e: 9, q: '하나님의 은혜', st: 'hl', c: 'yellow', n: '', at: '2026-10-08T00:00:00Z', ...o });
  r = post({ action: 'notes_marks_save', id_token: A, video_id: VID, marks: [mk(), mk({ id: 'mb-0', g: 'mb', st: 'ul', c: 'red', n: '=기도 제목' }), mk({ id: 'bad', st: 'xx' }), mk({ id: 'bad2', c: 'black' }), mk({ id: 'bad3', s: 9, e: 2 }), mk({ id: '<script>' })] });
  check('표시 저장 성공', r.ok === true, JSON.stringify(r));
  let n = post({ action: 'notes_get', id_token: A, video_id: VID }).note;
  check('표시: 올바른 것만 저장 (이상한 색·종류·위치·ID 제외)', n.marks.length === 2 && n.marks[1].n === '=기도 제목' && n.marks[1].st === 'ul', JSON.stringify(n.marks));
  check('표시: 다른 사람(B)에게는 안 보임', (post({ action: 'notes_get', id_token: B, video_id: VID }).note.marks || []).length === 0);
  post({ action: 'notes_save', id_token: A, video_id: VID, memo: '수정됨', answers: [], checks: [] });
  n = post({ action: 'notes_get', id_token: A, video_id: VID }).note;
  check('표시: 메모를 저장해도 표시는 그대로', n.memo === '수정됨' && n.marks.length === 2);
  r = post({ action: 'notes_marks_save', id_token: A, video_id: 'otherVideo1', marks: [mk()] });
  const rows2 = env.sheets.get('Notes').rows;
  check('표시: 노트가 없는 설교에도 새 줄로 저장', r.ok && rows2.length === 4 && rows2[3][8].includes('abc123') && rows2[3][3] === '', JSON.stringify(rows2[3]));
  check('표시: 표시만 있는 설교도 "내 노트" 목록에 나옴', post({ action: 'notes_list', id_token: A }).items.some((x) => x.video_id === 'otherVideo1'));
  const many = Array.from({ length: 700 }, (_, i) => mk({ id: `m${i}`, g: `g${i}`, q: 'a', at: '' }));
  post({ action: 'notes_marks_save', id_token: A, video_id: 'otherVideo1', marks: many });
  check('표시: 한 편에 500개까지만', JSON.parse(env.sheets.get('Notes').rows[3][8]).length === 500);
  const huge = Array.from({ length: 400 }, (_, i) => mk({ id: `h${i}`, g: `h${i}`, n: 'x'.repeat(2000) }));
  check('표시: 너무 크면 거부', post({ action: 'notes_marks_save', id_token: A, video_id: 'otherVideo1', marks: huge }).ok === false);
  check('표시: 로그인 없이는 거부', post({ action: 'notes_marks_save', video_id: VID, marks: [mk()] }).ok === false);
  post({ action: 'notes_marks_save', id_token: A, video_id: 'otherVideo1', marks: [] });
  check('표시: 모두 지우면 빈 목록', post({ action: 'notes_get', id_token: A, video_id: 'otherVideo1' }).note.marks.length === 0);
}

// 목록: 본인 것만
post({ action: 'notes_save', id_token: A, video_id: 'otherVideo01', memo: '다른 영상 메모', answers: [], checks: [] });
const la = post({ action: 'notes_list', id_token: A }).items.map((x) => x.video_id).sort();
const lb = post({ action: 'notes_list', id_token: B }).items.map((x) => x.video_id);
check('목록: A는 2개, B는 1개', la.length === 2 && lb.length === 1 && lb[0] === VID, JSON.stringify({ la, lb }));
post({ action: 'notes_save', id_token: B, video_id: 'emptyOne0001', memo: '   ', answers: [{ q: 'q', a: '' }], checks: [{ t: 't', done: false, date: '' }] });
check('내용이 비어 있는 노트는 목록에서 제외', post({ action: 'notes_list', id_token: B }).items.length === 1);

// 로그인 검증 실패 케이스
check('토큰 없음 → auth', post({ action: 'notes_get', video_id: VID }).code === 'auth');
check('가짜/깨진 토큰 → auth', post({ action: 'notes_get', id_token: 'garbage', video_id: VID }).code === 'auth');
check('다른 앱용 토큰(aud 불일치) → auth', post({ action: 'notes_get', id_token: tok({ sub: '1', email: 'a@x.com', aud: 'evil.apps.googleusercontent.com' }), video_id: VID }).code === 'auth');
check('이메일 미인증 → auth', post({ action: 'notes_get', id_token: tok({ sub: '1', email: 'a@x.com', email_verified: 'false' }), video_id: VID }).code === 'auth');
check('만료된 토큰 → auth', post({ action: 'notes_get', id_token: tok({ sub: '1', email: 'a@x.com', exp: String(Math.floor(Date.now() / 1000) - 5) }), video_id: VID }).code === 'auth');
check('발급처(iss) 이상 → auth', post({ action: 'notes_get', id_token: tok({ sub: '1', email: 'a@x.com', iss: 'https://evil.example' }), video_id: VID }).code === 'auth');
const stranger = post({ action: 'notes_save', id_token: tok({ sub: '999', email: 'stranger@x.com' }), video_id: VID, memo: '침입', answers: [], checks: [] });
check('허용 목록에 없는 계정 → forbidden', stranger.code === 'forbidden' && stranger.ok === false, JSON.stringify(stranger));
check('허용 목록에 없는 계정의 내용은 시트에 저장되지 않음', !env.sheets.get('Notes').rows.some((r) => r && (String(r[0]) === '999' || String(r[3]).includes('침입'))));
check('허용 목록은 대소문자 무시(B@X.com 허용)', post({ action: 'notes_get', id_token: B, video_id: VID }).ok === true);

// 입력 검증
check('잘못된 영상 ID 거절', post({ action: 'notes_get', id_token: A, video_id: '../../x' }).ok === false);
const longAns = post({ action: 'notes_save', id_token: A, video_id: VID, memo: 'x'.repeat(30000), answers: Array.from({ length: 30 }, () => ({ q: 'q', a: 'y'.repeat(9000) })), checks: [] });
check('답변 전체가 시트 셀 한도를 넘으면 저장 거절 + 안내', longAns.ok === false && /너무 깁니다/.test(longAns.error), JSON.stringify(longAns).slice(0, 120));
const storedAfter = post({ action: 'notes_get', id_token: A, video_id: VID }).note;
check('거절된 저장은 기존 노트를 건드리지 않음', storedAfter.memo === '수정됨');
const longMemo = post({ action: 'notes_save', id_token: A, video_id: VID, memo: 'x'.repeat(30000), answers: [], checks: [] });
check('메모는 20000자까지만 저장', longMemo.ok === true && post({ action: 'notes_get', id_token: A, video_id: VID }).note.memo.length === 20000);

// 텍스트 서식 고정(수식 실행·숫자 변환 방지)
const fm = env.formats.filter((f) => f.sheet === 'Notes');
check('Notes 탭은 텍스트 서식(@)으로 고정', fm.length > 0 && fm.every((f) => f.f === '@'));

// 캐시: 같은 토큰 반복 요청 시 구글 확인 호출 절약
const before = env.fetches;
post({ action: 'notes_get', id_token: A, video_id: VID }); post({ action: 'notes_get', id_token: A, video_id: VID });
check('같은 토큰은 캐시되어 구글 재확인 안 함', env.fetches === before, `${before} → ${env.fetches}`);

// 관리 기능은 기존대로 비밀번호 필요, 구글 로그인으로는 열리지 않음
check('관리: 비밀번호 없으면 거절', post({ action: 'add', category: '새벽기도', playlist_url: 'https://youtube.com/playlist?list=PLabcdefghijk' }).ok === false);
check('관리: 구글 토큰만으로는 거절', post({ action: 'add', id_token: A, category: '새벽기도', playlist_url: 'https://youtube.com/playlist?list=PLabcdefghijk' }).ok === false);
check('관리: 맞는 비밀번호는 통과', post({ action: 'check', password: 'pw' }).ok === true);
const add = post({ action: 'add', password: 'pw', category: 'dawn', playlist_url: 'https://www.youtube.com/playlist?list=PLabcdefghijk', max_videos: 10 });
check('관리: 추가 성공 + 구분 별칭을 한국어로 정규화', add.ok && env.sheets.get('Playlists').rows[1][0] === '새벽기도');

// 허용 목록 비어 있으면 로그인한 누구나 (설정 안내와 일치)
const open = makeEnv({ GOOGLE_CLIENT_ID: CID });
check('ALLOWED_EMAILS 비어 있으면 로그인 계정 누구나 허용', open.post({ action: 'notes_get', id_token: tok({ sub: '5', email: 'z@x.com' }), video_id: VID }).ok === true);
const noCid = makeEnv({});
check('GOOGLE_CLIENT_ID 미설정이면 전부 거절', noCid.post({ action: 'notes_get', id_token: A, video_id: VID }).code === 'auth');


/* ====== 30일 로그인 유지(앱 세션 토큰) ====== */
const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
const signWith = (secret, payload) => { const body = b64url(JSON.stringify(payload)); return `${body}.${b64url(crypto.createHmac('sha256', secret).update(body).digest())}`; };

const login = post({ action: 'notes_login', id_token: A });
check('로그인: 구글 토큰 확인 후 앱 세션 발급', login.ok && typeof login.session === 'string' && login.session.split('.').length === 2, JSON.stringify(login));
check('로그인: 유효기간 약 30일', Math.abs(login.expires_at - (Math.floor(Date.now() / 1000) + 30 * 86400)) < 60);
check('로그인: 사용자 정보(이메일) 반환', login.user.email === 'a@x.com');
check('서명 비밀키가 자동 생성되어 저장됨', typeof props.SESSION_SECRET === 'string' && props.SESSION_SECRET.length > 60);

const fetchesBefore = env.fetches;
const viaSession = post({ action: 'notes_get', session: login.session, video_id: VID });
check('세션으로 노트 읽기 (구글 토큰 없이)', viaSession.ok && viaSession.note && viaSession.note.memo.length > 0, JSON.stringify(viaSession).slice(0, 120));
check('세션 확인에는 구글 서버를 호출하지 않음', env.fetches === fetchesBefore);
check('세션으로 저장 가능', post({ action: 'notes_save', session: login.session, video_id: VID, memo: '세션으로 저장', answers: [], checks: [] }).ok === true);
check('A의 세션은 B의 노트를 못 봄', post({ action: 'notes_get', session: login.session, video_id: VID }).note.memo === '세션으로 저장' && post({ action: 'notes_get', id_token: B, video_id: VID }).note.memo === 'B의 메모');

// 위조 방지
const [bodyPart, sigPart] = login.session.split('.');
const decoded = JSON.parse(Buffer.from(bodyPart.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
const forgedBody = b64url(JSON.stringify({ ...decoded, sub: '110000000000000000002', email: 'b@x.com' }));
check('내용을 바꿔치기한 세션(B로 위조)은 거절', post({ action: 'notes_get', session: `${forgedBody}.${sigPart}`, video_id: VID }).code === 'auth');
check('서명이 틀린 세션은 거절', post({ action: 'notes_get', session: `${bodyPart}.${sigPart.slice(0, -4)}AAAA`, video_id: VID }).code === 'auth');
check('엉터리 세션은 거절', post({ action: 'notes_get', session: 'abc', video_id: VID }).code === 'auth' && post({ action: 'notes_get', session: 'a.b.c', video_id: VID }).code === 'auth');
const expired = signWith(props.SESSION_SECRET, { sub: '110000000000000000001', email: 'a@x.com', name: 'A', exp: Math.floor(Date.now() / 1000) - 5 });
check('만료된 세션은 거절', post({ action: 'notes_get', session: expired, video_id: VID }).code === 'auth');
const validManual = signWith(props.SESSION_SECRET, { sub: '110000000000000000001', email: 'a@x.com', name: 'A', exp: Math.floor(Date.now() / 1000) + 100 });
check('(확인용) 같은 방식으로 만든 유효 세션은 통과 → 위 거절 결과가 서명·만료 때문임을 보장', post({ action: 'notes_get', session: validManual, video_id: VID }).ok === true);

// 접근 통제
check('세션으로는 재생목록 관리 불가', post({ action: 'add', session: login.session, category: '새벽기도', playlist_url: 'https://www.youtube.com/playlist?list=PLabcdefghijk' }).ok === false);
const refused = post({ action: 'notes_login', id_token: tok({ sub: '999', email: 'stranger@x.com' }) });
check('허용되지 않은 계정은 로그인(세션 발급) 불가', refused.code === 'forbidden' && !refused.session);
check('다른 앱용 구글 토큰으로는 로그인 불가', post({ action: 'notes_login', id_token: tok({ sub: '1', email: 'a@x.com', aud: 'evil' }) }).code === 'auth');
check('구글 토큰 없이 로그인 불가', post({ action: 'notes_login' }).code === 'auth');

// 두 번째 로그인해도 비밀키는 그대로 → 먼저 받은 세션 계속 유효
const secretBefore = props.SESSION_SECRET;
post({ action: 'notes_login', id_token: B });
check('다시 로그인해도 비밀키 유지, 기존 세션 계속 유효', props.SESSION_SECRET === secretBefore && post({ action: 'notes_get', session: login.session, video_id: VID }).ok === true);

// 계정 회수: 허용 목록에서 빼면 남아 있는 세션도 즉시 막힘
const saveAllowed = props.ALLOWED_EMAILS;
props.ALLOWED_EMAILS = 'b@x.com';
check('허용 목록에서 뺀 계정은 기존 세션도 즉시 차단', post({ action: 'notes_get', session: login.session, video_id: VID }).code === 'forbidden');
props.ALLOWED_EMAILS = saveAllowed;
check('다시 허용하면 같은 세션으로 복구', post({ action: 'notes_get', session: login.session, video_id: VID }).ok === true);

// 비상 로그아웃: 비밀키를 바꾸면 모든 세션 무효
props.SESSION_SECRET = 'new-secret-' + 'x'.repeat(60);
check('비밀키를 바꾸면 모든 세션 무효', post({ action: 'notes_get', session: login.session, video_id: VID }).code === 'auth');

// 다른 배포(다른 비밀키)에서 만든 세션은 통하지 않음
const other = makeEnv({ GOOGLE_CLIENT_ID: CID, ALLOWED_EMAILS: 'a@x.com' });
const otherLogin = other.post({ action: 'notes_login', id_token: A });
check('다른 배포의 세션은 거절', otherLogin.ok && post({ action: 'notes_get', session: otherLogin.session, video_id: VID }).code === 'auth');


// ---------- 지금 동기화 (GitHub Actions 실행) ----------
{
  const gp = { ADMIN_PASSWORD: 'pw', GITHUB_TOKEN: 'ghp_SECRET', GITHUB_REPO: 'me/Repo' };
  const g = makeEnv(gp);
  const run = (over) => ({ status: 'completed', conclusion: 'success', run_started_at: '2026-10-08T05:00:00Z', updated_at: '2026-10-08T05:03:00Z', event: 'schedule', html_url: 'https://github.com/me/Repo/actions/runs/1', ...over });
  g.setGh((url, opts) => {
    if (opts.method === 'get') return { code: 200, body: { workflow_runs: [g.__run] } };
    return { code: 204, body: {} };
  });
  g.__run = run({});
  let r = g.post({ action: 'sync_status' });
  check('동기화: 비밀번호 없으면 거부 (GitHub 호출 없음)', r.ok === false && g.ghCalls.length === 0, JSON.stringify(r));
  r = g.post({ action: 'sync_run', password: 'bad' });
  check('동기화: 틀린 비밀번호 거부 (GitHub 호출 없음)', r.ok === false && g.ghCalls.length === 0);
  r = g.post({ action: 'sync_status', password: 'pw' });
  check('상태: 완료/성공', r.ok && r.run.state === 'success' && r.run.event === 'schedule', JSON.stringify(r));
  check('상태: 토큰이 응답에 노출되지 않음', !JSON.stringify(r).includes('ghp_SECRET'));
  check('상태 조회 요청: 올바른 주소·헤더', g.ghCalls[0].url === 'https://api.github.com/repos/me/Repo/actions/workflows/sync.yml/runs?per_page=1' && g.ghCalls[0].opts.headers.Authorization === 'Bearer ghp_SECRET' && g.ghCalls[0].opts.headers.Accept === 'application/vnd.github+json');
  g.__run = run({ status: 'in_progress', conclusion: null });
  check('상태: 실행 중', g.post({ action: 'sync_status', password: 'pw' }).run.state === 'running');
  g.__run = run({ conclusion: 'failure' });
  check('상태: 실패', g.post({ action: 'sync_status', password: 'pw' }).run.state === 'failed');
  g.__run = null;
  g.setGh(() => ({ code: 200, body: { workflow_runs: [] } }));
  check('상태: 기록 없음', g.post({ action: 'sync_status', password: 'pw' }).run.state === 'none');

  // 실행
  g.ghCalls.length = 0;
  g.setGh((url, opts) => (opts.method === 'get' ? { code: 200, body: { workflow_runs: [run({})] } } : { code: 204, body: {} }));
  r = g.post({ action: 'sync_run', password: 'pw', max_new: '3' });
  const post1 = g.ghCalls.find((c) => c.opts.method === 'post');
  check('실행: 성공 응답', r.ok === true && r.max_new === 3, JSON.stringify(r));
  check('실행 요청: 주소·ref·max_new', post1.url === 'https://api.github.com/repos/me/Repo/actions/workflows/sync.yml/dispatches' && JSON.parse(post1.opts.payload).ref === 'main' && JSON.parse(post1.opts.payload).inputs.max_new === '3', post1.opts.payload);
  g.ghCalls.length = 0;
  g.post({ action: 'sync_run', password: 'pw', max_new: '9999' });
  check('실행: 개수 상한(30)으로 제한', JSON.parse(g.ghCalls.find((c) => c.opts.method === 'post').opts.payload).inputs.max_new === '30');
  g.ghCalls.length = 0;
  g.post({ action: 'sync_run', password: 'pw', max_new: 'abc' });
  check('실행: 숫자가 아니면 기본값 5', JSON.parse(g.ghCalls.find((c) => c.opts.method === 'post').opts.payload).inputs.max_new === '5');
  gp.GITHUB_REF = 'dev';
  g.ghCalls.length = 0;
  g.post({ action: 'sync_run', password: 'pw' });
  check('실행: GITHUB_REF 속성 사용', JSON.parse(g.ghCalls.find((c) => c.opts.method === 'post').opts.payload).ref === 'dev');
  delete gp.GITHUB_REF;

  // 이미 실행 중이면 중복 실행 막기
  g.ghCalls.length = 0;
  g.setGh((url, opts) => (opts.method === 'get' ? { code: 200, body: { workflow_runs: [run({ status: 'queued', conclusion: null })] } } : { code: 204, body: {} }));
  r = g.post({ action: 'sync_run', password: 'pw' });
  check('실행 중이면 새로 시작하지 않음', r.ok === false && /이미 실행 중/.test(r.error) && !g.ghCalls.some((c) => c.opts.method === 'post'), JSON.stringify(r));

  // 오류 안내
  for (const [code, re] of [[401, /토큰/], [403, /Actions/], [404, /저장소 이름/], [500, /500/]]) {
    g.setGh(() => ({ code, body: {} }));
    const e = g.post({ action: 'sync_status', password: 'pw' });
    check(`GitHub ${code} → 안내 문구`, e.ok === false && re.test(e.error), JSON.stringify(e));
  }
  g.setGh((url, opts) => (opts.method === 'get' ? { code: 200, body: { workflow_runs: [run({})] } } : { code: 422, body: { message: "No ref found for: dev" } }));
  check('GitHub 422 → 브랜치 안내', /브랜치/.test(g.post({ action: 'sync_run', password: 'pw' }).error));

  // 설정 누락 / 잘못된 저장소
  const g2 = makeEnv({ ADMIN_PASSWORD: 'pw' });
  check('토큰 미설정 → 설정 안내', /GITHUB_TOKEN/.test(g2.post({ action: 'sync_status', password: 'pw' }).error));
  const g3 = makeEnv({ ADMIN_PASSWORD: 'pw', GITHUB_TOKEN: 't', GITHUB_REPO: '../evil/x?y' });
  const e3 = g3.post({ action: 'sync_status', password: 'pw' });
  check('저장소 이름 형식 오류 → 호출하지 않음', /형식/.test(e3.error) && g3.ghCalls.length === 0);
}


// ---------- 설정(AI 모델) / 영상 선택 관리 ----------
{
  const e = makeEnv({ ADMIN_PASSWORD: 'pw' });
  check('설정: 비밀번호 없으면 거부', e.post({ action: 'settings_get' }).ok === false && e.post({ action: 'settings_set', gemini_model: 'x-model' }).ok === false);
  let r = e.post({ action: 'settings_get', password: 'pw' });
  check('설정: 처음에는 비어 있음 (Settings 탭 자동 생성)', r.ok && r.settings.gemini_model === '' && !!e.sheets.get('Settings'), JSON.stringify(r));
  r = e.post({ action: 'settings_set', password: 'pw', gemini_model: 'gemini-3.8-flash' });
  check('설정: 모델 저장', r.ok && e.post({ action: 'settings_get', password: 'pw' }).settings.gemini_model === 'gemini-3.8-flash');
  e.post({ action: 'settings_set', password: 'pw', gemini_model: 'gemini-3.1-pro-preview' });
  const rows = e.sheets.get('Settings').rows;
  check('설정: 같은 항목은 줄이 늘지 않고 덮어씀 (헤더 + 1줄)', rows.length === 2 && rows[1][1] === 'gemini-3.1-pro-preview', JSON.stringify(rows));
  check('설정: 이상한 모델 이름 거부', e.post({ action: 'settings_set', password: 'pw', gemini_model: 'bad model; rm -rf' }).ok === false && e.post({ action: 'settings_get', password: 'pw' }).settings.gemini_model === 'gemini-3.1-pro-preview');
  // 영상 관리
  check('영상 목록: Sermons 탭이 없으면 안내', /지금 동기화/.test(e.post({ action: 'videos_list', password: 'pw' }).error || ''));
  const sh = e.ss.insertSheet('Sermons');
  const big = 'x'.repeat(40000);
  sh.rows.push(['video_id', 'category', 'title', 'published_at', 'url', 'status', 'transcript_manual', 'result_json', 'updated_at', 'note']);
  sh.rows.push(['vidAAAAAAAA', 'dawn', '새벽 A', '2026-09-01', 'u', 'done', '', big, '2026-09-02T00:00:00Z', 'Supadata 자막']);
  sh.rows.push(['vidBBBBBBBB', 'sunday', '주일 B', '2026-10-04', 'u', 'listed', '', '', '', '']);
  sh.rows.push(['vidCCCCCCCC', 'dawn', '새벽 C', '2026-10-06', 'u', 'error', '', '', '2026-10-07T00:00:00Z', '오류 내용']);
  sh.rows.push(['', '', '', '', '', '', '', '', '', '']);
  r = e.post({ action: 'videos_list', password: 'pw' });
  check('영상 목록: 최신순, 빈 줄 제외', r.ok && r.videos.map((v) => v.video_id).join() === 'vidCCCCCCCC,vidBBBBBBBB,vidAAAAAAAA', JSON.stringify(r.videos?.map((v) => v.video_id)));
  check('영상 목록: 큰 결과(result_json)는 응답에 포함되지 않음', JSON.stringify(r).length < 2000 && !JSON.stringify(r).includes('xxxxxxxx'));
  check('영상 목록: 상태·메모 전달', r.videos[0].status === 'error' && r.videos[0].note === '오류 내용' && r.videos[2].note === 'Supadata 자막');
  check('영상 선택: 비밀번호 없으면 거부', e.post({ action: 'videos_mark', ids: ['vidBBBBBBBB'], status: 'redo' }).ok === false);
  r = e.post({ action: 'videos_mark', password: 'pw', ids: ['vidBBBBBBBB', 'vidCCCCCCCC', 'nope'], status: 'redo' });
  check('영상 선택: 선택한 영상만 redo 로 변경', r.ok && r.changed === 2 && sh.rows[2][5] === 'redo' && sh.rows[3][5] === 'redo' && sh.rows[1][5] === 'done', JSON.stringify([r, sh.rows.map((x) => x[5])]));
  check('영상 선택: 메모에 요청 기록, 갱신 시각 기록', /다시 정리/.test(sh.rows[2][9]) && /^\d{4}-/.test(sh.rows[2][8]));
  check('영상 선택: 결과(result_json)는 건드리지 않음', sh.rows[1][7] === big);
  check('영상 선택: done 같은 상태로는 바꿀 수 없음', e.post({ action: 'videos_mark', password: 'pw', ids: ['vidAAAAAAAA'], status: 'done' }).ok === false && sh.rows[1][5] === 'done');
  check('영상 선택: 선택이 비어 있으면 거부', e.post({ action: 'videos_mark', password: 'pw', ids: [], status: 'redo' }).ok === false);
  e.post({ action: 'videos_mark', password: 'pw', ids: ['vidCCCCCCCC'], status: 'skip' });
  check('영상 선택: 제외(skip) 처리', sh.rows[3][5] === 'skip');
  e.post({ action: 'videos_mark', password: 'pw', ids: ['vidCCCCCCCC'], status: 'pending' });
  check('영상 선택: 대기(pending)로 복원, 메모 비움', sh.rows[3][5] === 'pending' && sh.rows[3][9] === '');

  // 제목·설교자 직접 고치기
  check('수정: 비밀번호 없으면 거부', e.post({ action: 'sermon_edit', video_id: 'vidAAAAAAAA', title: '가짜' }).ok === false);
  r = e.post({ action: 'sermon_edit', password: 'pw', video_id: 'vidAAAAAAAA', title: '  진리를   분별하는 삶 ', preacher: '전대혁 목사' });
  check('수정: 제목·설교자가 수정값 칸(R,S열)에 저장됨 (공백 정리)', r.ok && r.saved.title === '진리를 분별하는 삶' && sh.rows[1][17] === '진리를 분별하는 삶' && sh.rows[1][18] === '전대혁 목사', JSON.stringify([r, sh.rows[1].slice(15)]));
  check('수정: 영상 제목·AI 결과·상태는 그대로', sh.rows[1][2] === '새벽 A' && sh.rows[1][7] === big && sh.rows[1][5] === 'done' && sh.rows[1][10] === undefined);
  r = e.post({ action: 'sermon_edit', password: 'pw', video_id: 'vidAAAAAAAA', preacher: '' });
  check('수정: 보낸 칸만 바뀜 (제목은 유지, 설교자는 비움)', r.ok && sh.rows[1][17] === '진리를 분별하는 삶' && sh.rows[1][18] === '', JSON.stringify(sh.rows[1].slice(15)));
  r = e.post({ action: 'sermon_edit', password: 'pw', video_id: 'vidAAAAAAAA', title: 'a'.repeat(500) + '\n\t줄바꿈' });
  check('수정: 너무 긴 제목은 120자로, 줄바꿈 제거', r.ok && sh.rows[1][17].length === 120 && !/[\n\t]/.test(sh.rows[1][17]));
  check('수정: 없는 영상은 거부', e.post({ action: 'sermon_edit', password: 'pw', video_id: 'vidZZZZZZZZ', title: 'x' }).ok === false);
  check('수정: 이상한 영상 ID 거부', e.post({ action: 'sermon_edit', password: 'pw', video_id: '../x', title: 'x' }).ok === false);
  r = e.post({ action: 'sermon_edit', password: 'pw', video_id: 'vidAAAAAAAA', scripture: ' 열왕기상  4, 5장 ' });
  check('수정: 성경 본문이 수정값 칸(T열)에 저장됨, 다른 칸은 그대로', r.ok && sh.rows[1][19] === '열왕기상 4, 5장' && sh.rows[1][17].length === 120 && sh.rows[1][11] === undefined, JSON.stringify(sh.rows[1].slice(10)));
  r = e.post({ action: 'sermon_edit', password: 'pw', video_id: 'vidAAAAAAAA', date: '2026-09-27' });
  check('수정: 날짜가 수정값 칸(U열)에 저장됨', r.ok && sh.rows[1][20] === '2026-09-27' && sh.rows[1][3] === '2026-09-01', JSON.stringify(sh.rows[1].slice(19)));
  check('수정: 날짜 형식이 틀리거나 없는 날짜는 거부', e.post({ action: 'sermon_edit', password: 'pw', video_id: 'vidAAAAAAAA', date: '2026.9.27' }).ok === false && e.post({ action: 'sermon_edit', password: 'pw', video_id: 'vidAAAAAAAA', date: '2026-02-30' }).ok === false && sh.rows[1][20] === '2026-09-27');
  e.post({ action: 'sermon_edit', password: 'pw', video_id: 'vidAAAAAAAA', date: '' });
  check('수정: 날짜를 비우면 수정값이 지워짐', sh.rows[1][20] === '');
  check('수정: 바꿀 내용이 없으면 거부', e.post({ action: 'sermon_edit', password: 'pw', video_id: 'vidAAAAAAAA' }).ok === false);
}


// ---------- 모드별 개인 기록(fields) ----------
{
  const e = makeEnv({ GOOGLE_CLIENT_ID: CID, ALLOWED_EMAILS: 'a@x.com,b@x.com' });
  const V = 'sampleSun001';
  let r = e.post({ action: 'notes_save', id_token: A, video_id: V, memo: '메모', fields: { 'qt.life': '이번 주 적용', 'group.note.0': '소그룹 메모', 'bad key!': 'x', empty: '   ' } });
  check('fields: 저장 성공', r.ok === true, JSON.stringify(r));
  r = e.post({ action: 'notes_get', id_token: A, video_id: V });
  check('fields: 읽기 (잘못된 키·빈 칸은 저장 안 됨)', r.note.fields['qt.life'] === '이번 주 적용' && r.note.fields['group.note.0'] === '소그룹 메모' && !('bad key!' in r.note.fields) && !('empty' in r.note.fields), JSON.stringify(r.note));
  e.post({ action: 'notes_save', id_token: A, video_id: V, memo: '메모만 수정' });
  r = e.post({ action: 'notes_get', id_token: A, video_id: V });
  check('보낸 항목만 바뀜: 메모만 보내도 fields 는 그대로', r.note.memo === '메모만 수정' && r.note.fields['qt.life'] === '이번 주 적용');
  e.post({ action: 'notes_save', id_token: A, video_id: V, fields: { 'qt.life': '고친 적용' } });
  r = e.post({ action: 'notes_get', id_token: A, video_id: V });
  check('fields 만 보내도 메모는 그대로', r.note.memo === '메모만 수정' && r.note.fields['qt.life'] === '고친 적용' && !r.note.fields['group.note.0']);
  check('다른 사람은 내 fields 를 못 봄', e.post({ action: 'notes_get', id_token: B, video_id: V }).note === null);
  const many = {};
  for (let i = 0; i < 120; i++) many['k' + i] = 'v' + i;
  e.post({ action: 'notes_save', id_token: A, video_id: V, fields: many });
  check('fields 는 최대 80칸', Object.keys(e.post({ action: 'notes_get', id_token: A, video_id: V }).note.fields).length === 80);
  e.post({ action: 'notes_save', id_token: A, video_id: V, fields: { long: 'z'.repeat(9000) } });
  check('칸 하나는 5000자까지', e.post({ action: 'notes_get', id_token: A, video_id: V }).note.fields.long.length === 5000);
  e.post({ action: 'notes_save', id_token: B, video_id: 'onlyFields01', fields: { 'qt.life': '내용' } });
  check('목록: fields 만 있어도 "내 노트"로 표시', e.post({ action: 'notes_list', id_token: B }).items.some((x) => x.video_id === 'onlyFields01'));
  // 예전 7열 Notes 탭 → 새 열 자동 추가
  const old = makeEnv({ GOOGLE_CLIENT_ID: CID });
  const sh = old.ss.insertSheet('Notes');
  sh.rows.push(['user_sub', 'email', 'video_id', 'memo', 'answers_json', 'checks_json', 'updated_at']);
  sh.rows.push(['110000000000000000001', 'a@x.com', V, '예전 메모', '[]', '[]', '2026-01-01T00:00:00Z']);
  const g = old.post({ action: 'notes_get', id_token: A, video_id: V });
  check('예전 Notes 탭도 읽힘 (fields 는 빈 객체) + 헤더에 fields_json 추가', g.ok && g.note.memo === '예전 메모' && Object.keys(g.note.fields).length === 0 && sh.rows[0][7] === 'fields_json', JSON.stringify([g, sh.rows[0]]));
}

// ---------- 사용자 영상 ----------
{
  const gp = { GOOGLE_CLIENT_ID: CID, ALLOWED_EMAILS: 'a@x.com,b@x.com', ADMIN_PASSWORD: 'pw', GITHUB_TOKEN: 't', GITHUB_REPO: 'me/Repo' };
  const e = makeEnv(gp);
  e.setGh(() => ({ code: 204, body: {} }));
  const run = (over) => ({ code: 200, body: { workflow_runs: [] }, ...over });
  e.setGh((url, opts) => (opts.method === 'get' ? run() : { code: 204, body: {} }));
  const sh = () => e.sheets.get('Sermons');

  check('사용자 영상: 로그인 없이는 거부', e.post({ action: 'user_video_add', url: 'https://youtu.be/abcdefghijk' }).code === 'auth');
  check('사용자 영상: 비밀번호만으로는 거부', e.post({ action: 'user_video_add', password: 'pw', url: 'https://youtu.be/abcdefghijk' }).code === 'auth');
  let r = e.post({ action: 'user_video_add', id_token: A, url: 'https://example.com/x' });
  check('사용자 영상: 유튜브 주소가 아니면 거부', r.ok === false && /주소/.test(r.error));
  r = e.post({ action: 'user_video_add', id_token: A, url: 'https://youtu.be/abcdefghijk', date: '10월 4일' });
  check('사용자 영상: 날짜 형식 확인', r.ok === false && /날짜/.test(r.error));

  e.ghCalls.length = 0;
  r = e.post({ action: 'user_video_add', id_token: A, url: 'https://www.youtube.com/watch?v=abcdefghijk&t=30s', title: '내가 정한 제목', date: '2026-10-04', scripture: '요한복음 3:16-21', preacher: '김목사' });
  check('사용자 영상: 수동 입력으로 추가', r.ok === true && r.video_id === 'abcdefghijk' && r.dispatched === true, JSON.stringify(r));
  const row = sh().rows[1];
  check('시트 행: category=user, pending, 입력값·소유자', row[0] === 'abcdefghijk' && row[1] === 'user' && row[2] === '내가 정한 제목' && row[3] === '2026-10-04' && row[5] === 'pending' && row[10] === '김목사' && row[11] === '요한복음 3:16-21' && row[16] === 'a@x.com', JSON.stringify(row));
  check('시트 헤더가 21열', sh().rows[0].length === 21 && sh().rows[0][16] === 'owner' && sh().rows[0][17] === 'title_override' && sh().rows[0][18] === 'preacher_override' && sh().rows[0][19] === 'scripture_override' && sh().rows[0][20] === 'date_override');
  const d = e.ghCalls.find((c) => c.opts.method === 'post');
  check('GitHub 실행 요청: categories=user', d && JSON.parse(d.opts.payload).inputs.categories === 'user', d && d.opts.payload);
  check('제목을 직접 넣으면 유튜브 제목 조회 안 함', e.oembed.length === 0);

  r = e.post({ action: 'user_video_add', id_token: A, url: 'https://youtu.be/abcdefghijk' });
  check('같은 영상은 중복 추가 안 됨 (대기 중 안내)', r.ok === false && r.exists === true && /대기/.test(r.error) && sh().rows.length === 2, JSON.stringify(r));

  // 제목 비우면 유튜브에서 가져옴 / 날짜 비우면 오늘
  r = e.post({ action: 'user_video_add', id_token: B, url: 'https://youtu.be/ZZZZZZZZZZZ?si=abc' });
  check('제목을 비우면 유튜브 제목을 가져옴, 날짜는 비워 둠(동기화가 채움)', r.ok && sh().rows[2][2].startsWith('[2026.10.04]') && sh().rows[2][3] === '' && sh().rows[2][16] === 'b@x.com', JSON.stringify(sh().rows[2]));
  e.setOembed('');
  r = e.post({ action: 'user_video_add', id_token: B, url: 'https://www.youtube.com/shorts/QQQQQQQQQQQ' });
  check('제목을 가져오지 못하면 직접 입력 안내', r.ok === false && /제목/.test(r.error));
  r = e.post({ action: 'user_video_add', id_token: B, url: 'https://www.youtube.com/live/LLLLLLLLLLL', title: '라이브' });
  check('live/ 주소도 인식', r.ok && r.video_id === 'LLLLLLLLLLL');

  // 내 영상만 보임
  const mineA = e.post({ action: 'user_video_mine', id_token: A });
  const mineB = e.post({ action: 'user_video_mine', id_token: B });
  check('내 영상 목록: 본인 것만', mineA.videos.length === 1 && mineA.videos[0].video_id === 'abcdefghijk' && mineB.videos.length === 2, JSON.stringify([mineA, mineB]));
  check('내 영상 목록: 소유자 이메일은 응답에 없음', !JSON.stringify(mineA).includes('a@x.com'));

  // 다른 사람 영상은 바꿀 수 없음
  r = e.post({ action: 'user_video_remove', id_token: B, video_id: 'abcdefghijk' });
  check('남의 영상은 못 지움', r.ok === false && sh().rows[1][5] === 'pending');
  r = e.post({ action: 'user_video_redo', id_token: A, video_id: 'abcdefghijk' });
  check('내 영상 다시 정리 요청 → redo', r.ok && sh().rows[1][5] === 'redo');
  r = e.post({ action: 'user_video_remove', id_token: A, video_id: 'abcdefghijk' });
  check('내 영상 목록에서 빼기 → skip, 내 목록에서 사라짐', r.ok && sh().rows[1][5] === 'skip' && e.post({ action: 'user_video_mine', id_token: A }).videos.length === 0);
  // skip 된 영상을 다시 넣으면 되살아남
  r = e.post({ action: 'user_video_add', id_token: A, url: 'https://youtu.be/abcdefghijk', title: '다시 넣음', scripture: '시편 23편' });
  check('빼 두었던 영상을 다시 넣으면 redo 로 되살아남 (줄은 그대로)', r.ok && sh().rows[1][5] === 'redo' && sh().rows[1][2] === '다시 넣음' && sh().rows[1][11] === '시편 23편' && sh().rows.length === 4, JSON.stringify(sh().rows[1]));
  // 이미 정리된 교회 영상
  sh().rows.push(['CHURCHVID01', 'dawn', '[2026.10.01] 새벽', '2026-10-01', 'u', 'done', '', '{}', '', '', '', '', '', '', '', '', '']);
  r = e.post({ action: 'user_video_add', id_token: A, url: 'https://youtu.be/CHURCHVID01', title: 't' });
  check('교회 설교로 이미 있는 영상 안내', r.ok === false && /토론토영락교회 설교/.test(r.error));

  // 대기 한도
  const lim = makeEnv({ GOOGLE_CLIENT_ID: CID, GITHUB_TOKEN: 't', GITHUB_REPO: 'me/Repo' });
  lim.setGh(() => ({ code: 204, body: {} }));
  let last;
  for (let i = 0; i < 12; i++) last = lim.post({ action: 'user_video_add', id_token: A, url: `https://youtu.be/lim${String(i).padStart(8, '0')}`, title: 't' + i });
  check('대기 중인 영상은 사람당 10편까지', last.ok === false && /너무 많습니다/.test(last.error) && lim.sheets.get('Sermons').rows.length === 11);

  // GitHub 연결이 없어도 영상은 등록됨
  const nogh = makeEnv({ GOOGLE_CLIENT_ID: CID });
  r = nogh.post({ action: 'user_video_add', id_token: A, url: 'https://youtu.be/nogithub001', title: 't' });
  check('GitHub 미연결이어도 등록은 되고, 자동 실행만 안 됨', r.ok && r.dispatched === false && /GITHUB_TOKEN/.test(r.dispatch_error) && nogh.sheets.get('Sermons').rows.length === 2, JSON.stringify(r));

  // 관리자 목록에도 사용자 영상·설교자·본문이 보임
  const vl = e.post({ action: 'videos_list', password: 'pw' });
  check('영상 관리 목록에 category=user, 설교자·본문 포함', vl.ok && vl.videos.some((v) => v.category === 'user' && v.scripture === '시편 23편'), JSON.stringify(vl.videos?.slice(0, 2)));
}

// ---------- 동기화 실행: 구분 선택 ----------
{
  const g = makeEnv({ ADMIN_PASSWORD: 'pw', GITHUB_TOKEN: 't', GITHUB_REPO: 'me/Repo' });
  g.setGh((url, opts) => (opts.method === 'get' ? { code: 200, body: { workflow_runs: [] } } : { code: 204, body: {} }));
  const sent = () => JSON.parse(g.ghCalls.filter((c) => c.opts.method === 'post').pop().opts.payload).inputs;
  g.post({ action: 'sync_run', password: 'pw', categories: ['youth', 'bogus', 'sunday'] });
  check('구분 선택: 허용된 값만 전달', sent().categories === 'youth,sunday', JSON.stringify(sent()));
  g.post({ action: 'sync_run', password: 'pw' });
  check('구분 선택: 안 보내면 categories 입력 없음(기본 구분)', sent().categories === undefined);
  g.post({ action: 'sync_run', password: 'pw', categories: 'all' });
  check('구분 선택: all', sent().categories === 'all');
  g.post({ action: 'sync_run', password: 'pw', categories: ['none'], export_only: true });
  check('사이트 반영만: export_only 전달', sent().export_only === 'true' && sent().categories === 'none', JSON.stringify(sent()));
  g.post({ action: 'sync_run', password: 'pw' });
  check('사이트 반영만: 안 보내면 export_only 없음', sent().export_only === undefined);
  // 오늘의 말씀 지금 동기화: 과거 5일 ~ 미래 2일
  const rd = g.post({ action: 'sync_run', password: 'pw', daily: true });
  const dd = (sent().daily_dates || '').split(',');
  check('오늘의 말씀 지금 동기화: categories=daily · 8일치 날짜', rd.ok && sent().categories === 'daily' && dd.length === 8 && dd.every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)) && dd[0] < dd[7] && sent().daily_force === undefined, JSON.stringify(sent()));
  g.post({ action: 'sync_run', password: 'pw', daily: true, daily_force: true });
  check('오늘의 말씀 다시 만들기: daily_force 전달', sent().daily_force === 'true');
  g.post({ action: 'sync_run', password: 'pw', daily: true, daily_force: true, dates: ['2026-10-07', 'bad', '2026-10-07'], modes: ['study', 'videos', 'x'] });
  check('날짜별 다시 만들기: 그 날짜만 · 고른 부분만', sent().daily_dates === '2026-10-07' && sent().daily_force === 'true' && sent().daily_modes === 'study,videos', JSON.stringify(sent()));
  g.post({ action: 'sync_run', password: 'pw', daily: true, dates: ['2026-10-07'], modes: ['study'] });
  check('다시 만들기 아님(빠진 것만): modes 는 보내지 않음', sent().daily_modes === undefined && sent().daily_force === undefined);
  {
    const o3 = makeEnv({ ADMIN_PASSWORD: 'pw', GITHUB_TOKEN: 't', GITHUB_REPO: 'me/Repo' });
    o3.setGh((url, opts) => {
      if (opts.method === 'get') return { code: 200, body: { workflow_runs: [] } };
      const inputs = JSON.parse(opts.payload).inputs;
      return 'daily_modes' in inputs ? { code: 422, body: { message: 'Unexpected inputs provided: ["daily_modes"]' } } : { code: 204, body: {} };
    });
    const r = o3.post({ action: 'sync_run', password: 'pw', daily: true, daily_force: true, dates: ['2026-10-07'], modes: ['study'] });
    const last = JSON.parse(o3.ghCalls.filter((c) => c.opts.method === 'post').pop().opts.payload).inputs;
    check('옛 sync.yml(daily_modes 없음): 날짜는 그대로 두고 그 입력만 빼서 다시 요청', r.ok && r.workflow_old && last.daily_dates === '2026-10-07' && last.daily_force === 'true' && !('daily_modes' in last), JSON.stringify(last));
  }
  {
    const o2 = makeEnv({ ADMIN_PASSWORD: 'pw', GITHUB_TOKEN: 't', GITHUB_REPO: 'me/Repo' });
    o2.setGh((url, opts) => {
      if (opts.method === 'get') return { code: 200, body: { workflow_runs: [] } };
      const inputs = JSON.parse(opts.payload).inputs;
      return 'daily_dates' in inputs ? { code: 422, body: { message: 'Unexpected inputs provided: ["daily_dates"]' } } : { code: 204, body: {} };
    });
    const r = o2.post({ action: 'sync_run', password: 'pw', daily: true });
    check('옛 sync.yml: daily_dates 없이 다시 요청 (오늘·내일만)', r.ok && r.workflow_old === true, JSON.stringify(r));
  }
  // GitHub 의 sync.yml 이 옛 버전(export_only 입력 없음)이면: 그 입력만 빼고 다시 요청
  {
    const o = makeEnv({ ADMIN_PASSWORD: 'pw', GITHUB_TOKEN: 't', GITHUB_REPO: 'me/Repo' });
    o.setGh((url, opts) => {
      if (opts.method === 'get') return { code: 200, body: { workflow_runs: [] } };
      const inputs = JSON.parse(opts.payload).inputs;
      return 'export_only' in inputs ? { code: 422, body: { message: 'Unexpected inputs provided: ["export_only"]' } } : { code: 204, body: {} };
    });
    const r = o.post({ action: 'sync_run', password: 'pw', max_new: '1', categories: ['none'], export_only: true });
    const posts = o.ghCalls.filter((c) => c.opts.method === 'post');
    check('옛 sync.yml: export_only 없이 다시 요청해 성공', r.ok === true && r.workflow_old === true && posts.length === 2 && !('export_only' in JSON.parse(posts[1].opts.payload).inputs), JSON.stringify(r));
    const r2 = o.post({ action: 'sync_run', password: 'pw', max_new: '1' });
    check('옛 sync.yml: 평소 실행은 그대로 성공', r2.ok === true && r2.workflow_old === false, JSON.stringify(r2));
  }
  const pl = g.post({ action: 'add', password: 'pw', category: '청년부', playlist_url: 'https://www.youtube.com/playlist?list=PLabcdefghijk' });
  check('재생목록: 청년부예배 구분을 추가할 수 있음', pl.ok && g.sheets.get('Playlists').rows[1][0] === '청년부예배', JSON.stringify(pl));
}


// ---------- 말씀결 게임 ----------
{
  const g = makeEnv({ GOOGLE_CLIENT_ID: CID, ALLOWED_EMAILS: 'a@x.com, b@x.com' });
  let today = '2026-10-05'; // 월요일
  g.ctx.gameToday = () => today;
  // Sermons 탭에 퀴즈가 있는 설교 3편
  const quiz = (n) => ({ quiz: { multiple_choice: [0, 1, 2].map((i) => ({ question: `q${n}${i}`, options: ['a', 'b', 'c', 'd'], answer_index: i })), fill_blank: [{ question: '____', answer: '하나님 나라', accept: ['천국'] }, { question: '____', answer: '칭의', accept: [] }] } });
  const ss = g.ss.insertSheet('Sermons');
  ss.rows.push(['video_id', 'category', 'title', 'published_at', 'url', 'status', 'transcript_manual', 'result_json', 'updated_at', 'note', 'preacher', 'scripture', 'mode_qt', 'mode_study']);
  ['vidAAAAAAA1', 'vidAAAAAAA2', 'vidAAAAAAA3', 'vidAAAAAAA4'].forEach((v, i) => ss.rows.push([v, 'sunday', 't', '2026-10-04', '', 'done', '', '{}', '', '', '', '', '', JSON.stringify(quiz(i))]));
  const gp = (o, who = A) => g.post({ id_token: who, ...o });
  const all = { mc: [0, 1, 2], fb: ['하나님나라', ' 칭의. '] };

  let r = gp({ action: 'game_get' });
  check('게임: 처음 들어오면 기본 옷·머리가 들어 있는 새 기록', r.ok && r.state.talents === 0 && r.state.inv.includes('robe_brown') && r.state.inv.includes('hair_bun') && !r.state.inv.includes('pet_lamb') && r.state.level === 1, JSON.stringify(r).slice(0, 200));
  check('게임: 로그인 없이는 거절', g.post({ action: 'game_get' }).code === 'auth');
  r = gp({ action: 'game_quiz', video_id: 'vidAAAAAAA1', mc: [0, 1], fb: ['x', 'y'] });
  check('게임: 모든 문제에 답해야 제출', !r.ok && /모든 문제/.test(r.error));

  r = gp({ action: 'game_journey', key: 'pilgrim' });
  check('게임: 여정 고르기', r.ok && r.state.journey.cur === 'pilgrim');
  r = gp({ action: 'game_quiz', video_id: 'vidAAAAAAA1', ...all });
  const res = r.result;
  check('게임 채점: 빈칸은 띄어쓰기·문장부호 무시하고 맞음', res.fb.every(Boolean) && res.mc.every(Boolean), JSON.stringify(res));
  // 객관식 3×4 + 빈칸 2×6 + 만점 20 = 44 XP (+ 도장 20)
  check('게임 점수: 만점 → 경험치 44 + 도장 20', res.perfect && res.xp === 44 && r.state.xp === 64, JSON.stringify(res));
  // 달란트: 3×2 + 2×3 + 15 = 27 (연속 1일 ×1) + 도장 10 + 업적(첫 걸음 20, 만점 30)
  check('게임 달란트: 27 + 도장 10 + 업적 50 = 87', r.state.talents === 87, String(r.state.talents));
  check('게임: 첫 도장 · 연속 1일 · 업적 이벤트', r.state.stampedToday && r.state.streak === 1 && r.events.some((e) => e.type === 'stamp') && r.events.filter((e) => e.type === 'badge').length === 2, JSON.stringify(r.events));
  check('게임 여정: 경험치만큼 순례길이 나아감(64 XP → 아직 0걸음)', r.state.journey.prog.pilgrim === 64);

  r = gp({ action: 'game_quiz', video_id: 'vidAAAAAAA1', ...all });
  check('게임: 같은 설교를 다시 풀면 연습(점수 없음)', r.result.scored === false && r.result.already === true && r.state.xp === 64);
  r = gp({ action: 'game_quiz', video_id: 'vidAAAAAAA2', mc: [0, 1, 0], fb: ['천국', '틀림'] });
  check('게임 채점: 다른 표기(accept) 인정, 틀린 문제는 점수 없음', r.result.right === 3 && r.result.xp === 2 * 4 + 6 && r.result.fb[0] === true && r.result.fb[1] === false, JSON.stringify(r.result));
  r = gp({ action: 'game_quiz', video_id: 'vidAAAAAAA3', ...all });
  check('게임: 하루 점수 퀘스트는 2개까지(세 번째는 연습)', r.result.capped === true && r.result.scored === false && r.state.dailyLeft === 0);

  // 다음 날: 연속 2일
  today = '2026-10-06';
  r = gp({ action: 'game_quiz', video_id: 'vidAAAAAAA3', ...all });
  check('게임: 다음 날 도장 → 연속 2일, 하루 한도 초기화', r.result.scored && r.state.streak === 2 && r.state.dailyLeft === 1, JSON.stringify({ s: r.state.streak, d: r.state.dailyLeft }));
  r = gp({ action: 'game_quiz', video_id: 'vidAAAAAAA4', ...all });
  // 순례길 걸음과 보상(1걸음 = 160 XP → 지팡이)
  check('게임 여정: 1걸음 → 지팡이 보상', r.state.journey.prog.pilgrim >= 160 && r.state.inv.includes('staff') && r.events.some((e) => e.type === 'step' && e.reward === 'staff'), JSON.stringify(r.state.journey));

  // 상점 · 옷장
  r = gp({ action: 'game_buy', item: 'robe_star' });
  check('상점: 달란트가 부족하면 못 삼', !r.ok && /부족/.test(r.error));
  const t0 = gp({ action: 'game_get' }).state.talents;
  r = gp({ action: 'game_buy', item: 'robe_blue' });
  check('상점: 하늘빛 겉옷 구입(80 달란트)', r.ok && r.state.inv.includes('robe_blue') && r.state.talents === t0 - 80, String(r.state.talents));
  check('상점: 같은 것은 두 번 못 삼', !gp({ action: 'game_buy', item: 'robe_blue' }).ok);
  check('상점: 여정 보상은 살 수 없음', !gp({ action: 'game_buy', item: 'laurel' }).ok);
  r = gp({ action: 'game_equip', look: { robe: 'robe_blue', handR: 'staff', hairColor: 'black' } });
  check('옷장: 가진 것으로 갈아입기', r.ok && r.state.look.robe === 'robe_blue' && r.state.look.handR === 'staff');
  check('옷장: 없는 아이템은 못 입음', !gp({ action: 'game_equip', look: { pet: 'pet_lamb' } }).ok);
  check('옷장: 칸이 다른 아이템은 못 입음', !gp({ action: 'game_equip', look: { head: 'robe_blue' } }).ok);
  check('옷장: 옷·머리는 비워 둘 수 없음', !gp({ action: 'game_equip', look: { robe: '' } }).ok);

  // 안식 쿠폰: 하루 쉬어도 연속 유지
  const cash = gp({ action: 'game_get' }).state.talents;
  r = gp({ action: 'game_buy', item: 'freeze' });
  check('안식 쿠폰 구입(120)', cash < 120 ? !r.ok : r.ok && r.state.freeze === 1, String(cash));
  if (r.ok) {
    today = '2026-10-08'; // 7일 하루 쉼
    r = gp({ action: 'game_quiz', video_id: 'vidAAAAAAA1', ...all });
    check('안식 쿠폰: 하루 쉬어도 연속 3일로 이어짐', r.state.streak === 3 && r.state.freeze === 0 && r.events.some((e) => e.type === 'freeze'), JSON.stringify({ s: r.state.streak, ev: r.events.map((e) => e.type) }));
  }
  // 오래 쉬면 다시 1일 + 환영 보너스
  today = '2026-10-15';
  r = gp({ action: 'game_quiz', video_id: 'vidAAAAAAA1', ...all });
  check('오래 쉬었다 오면 연속 1일부터 + 환영 보너스', r.state.streak === 1 && r.events.some((e) => e.type === 'comeback'), JSON.stringify(r.events.map((e) => e.type)));
  check('연습으로 풀어도 절반 이상 맞히면 그날 도장', r.result.scored === false && r.result.stamped === true);

  // 묵상 퀘스트: 내 묵상 답이 30자 이상이어야
  r = gp({ action: 'game_reflect', video_id: 'vidAAAAAAA2' });
  check('묵상 퀘스트: 묵상 답이 없으면 거절', !r.ok && /30자/.test(r.error));
  g.post({ action: 'notes_save', id_token: A, video_id: 'vidAAAAAAA2', memo: '', answers: [], checks: [], fields: { 'qt.q.0': '하나님보다 제 계획표를 더 믿어 왔음을 고백합니다. 이번 주에는 먼저 기도하겠습니다.' } });
  r = gp({ action: 'game_reflect', video_id: 'vidAAAAAAA2' });
  check('묵상 퀘스트: 답을 적으면 경험치·달란트', r.ok && r.result.xp === 10 && r.state.reflects.vidAAAAAAA2, JSON.stringify(r).slice(0, 300));
  check('묵상 퀘스트: 같은 설교는 한 번만', gp({ action: 'game_reflect', video_id: 'vidAAAAAAA2' }).result.already === true);

  // 가족 순위
  gp({ action: 'game_profile', nick: '엄마' }, B);
  gp({ action: 'game_quiz', video_id: 'vidAAAAAAA1', ...all }, B);
  r = gp({ action: 'game_board' });
  check('가족 순위: 두 사람 · 내 표시 · 별명', r.ok && r.players.length === 2 && r.players.some((p) => p.me) && r.players.some((p) => p.name === '엄마'), JSON.stringify(r.players.map((p) => [p.name, p.weekXp, p.me])));
  check('가족 순위: 이번 주 경험치 순', r.players[0].weekXp >= r.players[1].weekXp);
  r = gp({ action: 'game_profile', title: '천성에 이른 순례자' });
  check('칭호: 받지 않은 칭호는 고를 수 없음', !r.ok);
  check('게임: 사람마다 기록이 따로', g.sheets.get('Game').rows.length === 3);
}

// ---------- 오늘의 말씀: 읽기 완료 · 일독표 · 퀴즈 ----------
{
  const g = makeEnv({ GOOGLE_CLIENT_ID: CID, ALLOWED_EMAILS: 'a@x.com' });
  let today = '2026-10-08';
  g.ctx.gameToday = () => today;
  const gp = (o) => g.post({ id_token: A, ...o });
  const daily = g.ss.insertSheet('Daily');
  daily.rows.push(['date', 'refs', 'status', 'passages_json', 'qt_json', 'study_json', 'group_json', 'quiz_json', 'videos_json', 'updated_at', 'note']);
  const quiz = { multiple_choice: [0, 1, 2, 3].map((i) => ({ question: `q${i}`, options: ['a', 'b', 'c', 'd'], answer_index: i })), fill_blank: [{ question: '____', answer: '솔로몬', accept: [] }] };
  daily.rows.push(['2026-10-08', '열왕기상 11장 · 마가복음 10장', 'done', '[]', '', '', '', JSON.stringify(quiz), '[]', '', '']);

  let r = gp({ action: 'game_read', date: '2026-10-08', chapters: ['11:11', '41:10', '41:99', '99:1', 'x'] });
  check('말씀 읽기 완료: 경험치·달란트·도장, 올바른 장만 일독표에', r.ok && r.result.xp === 15 && r.result.stamped && r.state.bible.length === 2 && r.state.bible.includes('41:10') && r.state.readDays['2026-10-08'], JSON.stringify(r).slice(0, 300));
  r = gp({ action: 'game_read', date: '2026-10-08', chapters: ['11:11'] });
  check('말씀 읽기 완료: 같은 날은 한 번만 점수', r.ok && r.result.already === true && r.state.xp === 15 + 20, String(r.state && r.state.xp));
  check('말씀 읽기: 아직 오지 않은 날은 안 됨', !gp({ action: 'game_read', date: '2026-10-09', chapters: [] }).ok);
  r = gp({ action: 'game_read', date: '2026-10-01', chapters: ['11:3', '41:3'] });
  check('말씀 읽기: 지난 날 분량도 읽으면 점수 (도장은 오늘 이미 받음)', r.ok && r.result.xp === 15 && r.result.stamped === false && r.state.bible.length === 4);

  r = gp({ action: 'game_chapter', key: '1:1' });
  check('일독표: 손으로 체크', r.ok && r.state.bible.includes('1:1'));
  r = gp({ action: 'game_chapter', key: '1:1', on: false });
  check('일독표: 체크 지우기', r.ok && !r.state.bible.includes('1:1'));
  check('일독표: 없는 장은 거절', !gp({ action: 'game_chapter', key: '1:51' }).ok && !gp({ action: 'game_chapter', key: '67:1' }).ok);

  r = gp({ action: 'game_quiz', video_id: 'bible-20261008', mc: [0, 1, 2, 0], fb: [' 솔 로몬 '] });
  check('오늘의 말씀 퀴즈: Daily 탭으로 채점', r.ok && r.result.right === 4 && r.result.total === 5 && r.result.scored, JSON.stringify(r.result || r));
  check('오늘의 말씀 퀴즈: 아직 없는 날은 안내', /준비되지 않았/.test(gp({ action: 'game_quiz', video_id: 'bible-20261009', mc: [], fb: [] }).error || ''));

  // 신약 완독 업적: 신약 260장을 모두 체크하면
  const nt = [];
  const counts = [28, 16, 24, 21, 28, 16, 16, 13, 6, 6, 4, 4, 5, 3, 6, 4, 3, 1, 13, 5, 5, 3, 5, 1, 1, 1, 22];
  counts.forEach((n, i) => { for (let ch = 1; ch <= n; ch++) nt.push(`${40 + i}:${ch}`); });
  for (let i = 0; i < nt.length; i += 30) gp({ action: 'game_read', date: '2026-09-' + String(1 + (i / 30)).padStart(2, '0'), chapters: nt.slice(i, i + 30) });
  r = gp({ action: 'game_get' });
  check('일독표: 신약 260장 → 신약 완독 업적', r.state.badges.includes('nt') && r.state.badges.includes('read7'), JSON.stringify(r.state.badges));
}

// ---------- 관리: 오늘의 말씀 진행 상황 ----------
{
  const g = makeEnv({ ADMIN_PASSWORD: 'pw', GITHUB_TOKEN: 't', GITHUB_REPO: 'me/Repo' });
  g.setGh(() => ({ code: 200, body: { workflow_runs: [{ status: 'in_progress', run_started_at: '2026-10-08T11:00:00Z' }] } }));
  const daily = g.ss.insertSheet('Daily');
  daily.rows.push(['date', 'refs', 'status', 'passages_json', 'qt_json', 'study_json', 'group_json', 'quiz_json', 'videos_json', 'updated_at', 'note']);
  daily.rows.push(['2026-10-08', '열왕기상 11장', 'done', '[]', '{"a":1}', '{"a":1}', '{"a":1}', '{"a":1}', '[{"video_id":"x"}]', 't', '']);
  daily.rows.push(['2026-10-09', '열왕기상 12장', 'running', '[]', '{"a":1}', '', '', '', '[]', 't', '만드는 중']);
  daily.rows.push(['2026-10-07', '열왕기상 10장', 'error', '[]', '', '', '', '', '', 't', 'quiz: 시간 초과']);
  const r = g.post({ action: 'daily_status', password: 'pw' });
  check('오늘의 말씀 진행: 최신 날짜부터 · 상태 · 만든 것 표시', r.ok && r.run.state === 'running' && r.days.map((d) => d.date).join() === '2026-10-09,2026-10-08,2026-10-07' && r.days[0].status === 'running' && r.days[0].qt && !r.days[0].quiz && r.days[1].videos === 1 && r.days[2].note === 'quiz: 시간 초과', JSON.stringify(r));
  check('오늘의 말씀 진행: 비밀번호 필요', !g.post({ action: 'daily_status', password: 'x' }).ok);
}

console.log(fails ? `\n${fails}개 실패` : '\n서버 로직 테스트 모두 통과');
process.exit(fails ? 1 : 0);
