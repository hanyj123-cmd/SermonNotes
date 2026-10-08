// 말씀 노트 — 정적 웹앱 (빌드 도구 없음)
// 데이터: data/sermons.json (GitHub Actions가 Google Sheets에서 만들어 커밋)
// 화면 확인용 샘플: 주소 뒤에 ?demo 를 붙이면 data/sermons.sample.json 을 불러옵니다.

const CATEGORIES = [
  { key: 'dawn', label: '새벽기도' },
  { key: 'wednesday', label: '수요예배' },
  { key: 'sunday', label: '주일예배' },
];

const app = document.getElementById('app');
const state = { sermons: [], updated: null, demo: new URLSearchParams(location.search).has('demo'), query: '', noteIds: new Set() };

/* ---------- 작은 DOM 헬퍼 (innerHTML 미사용 → 내용이 코드로 해석되지 않음) ---------- */
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return el;
}

const paragraphs = (text) =>
  String(text || '')
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => h('p', { text: p }));

const catLabel = (key) => CATEGORIES.find((c) => c.key === key)?.label || key;
const thumbUrl = (id) => `https://i.ytimg.com/vi/${encodeURIComponent(id)}/mqdefault.jpg`;
const safeYoutube = (url, id) => (/^https:\/\/(www\.)?youtube\.com\//.test(url || '') ? url : `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`);

function formatDate(iso) {
  if (!/^\d{4}-\d{2}-\d{2}/.test(iso || '')) return '';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return `${y}.${m}.${d}`;
}

function toast(message) {
  const t = h('div', { class: 'toast', role: 'status', text: message });
  document.body.append(t);
  setTimeout(() => t.remove(), 1800);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = h('textarea', { style: 'position:fixed;opacity:0' });
    ta.value = text;
    document.body.append(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  toast('복사했습니다');
}

/* ---------- 데이터 ---------- */
async function load() {
  const file = state.demo ? 'data/sermons.sample.json' : 'data/sermons.json';
  const res = await fetch(`${file}?t=${Date.now()}`);
  if (!res.ok) throw new Error(`데이터를 불러오지 못했습니다 (${res.status})`);
  const data = await res.json();
  state.sermons = Array.isArray(data.sermons) ? data.sermons : [];
  state.updated = data.updated || null;
}

/* ---------- 라우팅: #/c/<구분>  #/v/<영상ID> ---------- */
function route() {
  const [, kind, arg] = location.hash.split('/');
  window.scrollTo(0, 0);
  // 다른 화면으로 넘어가기 전에, 아직 저장되지 않은 노트가 있으면 먼저 저장합니다.
  if (currentNotes) {
    currentNotes.flush();
    currentNotes = null;
  }
  if (kind === 'admin') return renderAdminRoute();
  if (kind === 'v' && arg) return renderDetail(decodeURIComponent(arg));
  const firstWithData = CATEGORIES.find((c) => state.sermons.some((s) => s.category === c.key));
  const cat = CATEGORIES.some((c) => c.key === arg) ? arg : (firstWithData || CATEGORIES[0]).key;
  renderList(cat);
}

/* ---------- 목록 ---------- */
function renderList(cat) {
  const counts = Object.fromEntries(CATEGORIES.map((c) => [c.key, state.sermons.filter((s) => s.category === c.key).length]));

  const tabs = h(
    'div',
    { class: 'tabs', role: 'tablist' },
    CATEGORIES.map((c) =>
      h(
        'button',
        {
          class: 'tab',
          role: 'tab',
          'aria-selected': String(c.key === cat),
          onclick: () => {
            state.query = '';
            location.hash = `#/c/${c.key}`;
          },
        },
        c.label,
        h('span', { class: 'count', text: `${counts[c.key]}` }),
      ),
    ),
  );

  const list = h('ul', { class: 'list' });
  const search = h('input', {
    class: 'search',
    type: 'search',
    placeholder: '제목, 본문, 주제로 검색',
    'aria-label': '검색',
    value: state.query,
    oninput: (e) => {
      state.query = e.target.value;
      fillList();
    },
  });

  function fillList() {
    const q = state.query.trim().toLowerCase();
    const items = state.sermons
      .filter((s) => s.category === cat)
      .filter((s) => {
        if (!q) return true;
        const r = s.result || {};
        return [s.title, r.theme, r.summary_short, r.preacher, ...(r.scripture || [])].join(' ').toLowerCase().includes(q);
      });
    list.replaceChildren();
    if (!items.length) {
      list.append(
        h(
          'li',
          {},
          h(
            'div',
            { class: 'empty' },
            q
              ? h('p', {}, h('strong', { text: '검색 결과가 없습니다.' }))
              : [
                  h('p', {}, h('strong', { text: `아직 ${catLabel(cat)} 정리가 없습니다.` })),
                  h('p', { text: 'Google Sheet의 Playlists 탭에 재생목록을 넣고 GitHub Actions를 한 번 실행해 보세요.' }),
                ],
          ),
        ),
      );
      return;
    }
    for (const s of items) {
      const r = s.result || {};
      list.append(
        h(
          'li',
          {},
          h(
            'a',
            { class: 'card', href: `#/v/${encodeURIComponent(s.id)}` },
            h('img', { class: 'thumb', src: thumbUrl(s.id), alt: '', loading: 'lazy', onerror: (e) => (e.target.style.visibility = 'hidden') }),
            h(
              'div',
              { class: 'card-body' },
              h(
                'div',
                { class: 'meta' },
                (r.scripture || [])[0] ? h('span', { class: 'chip', text: r.scripture[0] }) : null,
                state.noteIds.has(s.id) ? h('span', { class: 'chip note-chip', text: '📝 내 노트' }) : null,
                formatDate(s.published_at),
              ),
              h('h2', { class: 'card-title', text: s.title }),
              h('p', { class: 'card-summary', text: r.summary_short || r.theme || '' }),
            ),
          ),
        ),
      );
    }
  }

  app.replaceChildren(tabs, search, list);
  fillList();
  document.title = `${catLabel(cat)} · 말씀 노트`;
}

/* ---------- 상세 ---------- */
function sermonToText(s) {
  const r = s.result;
  const sg = r.small_group || {};
  const lines = [];
  const list = (arr) => (arr || []).forEach((x, i) => lines.push(`${i + 1}. ${x}`));
  lines.push(`[${catLabel(s.category)}] ${s.title}`);
  if (r.scripture?.length) lines.push(`본문: ${r.scripture.join(', ')}`);
  lines.push('');
  return { lines, list, sg, r };
}

function smallGroupText(s) {
  const { lines, list, sg } = sermonToText(s);
  lines.push('◆ 소그룹 나눔 질문', '');
  if (sg.icebreaker) lines.push('[마음 열기]', sg.icebreaker, '');
  const sections = [
    ['본문 관찰', sg.observation],
    ['묵상과 해석', sg.reflection],
    ['삶의 적용', sg.application],
    ['기도와 결단', sg.prayer],
  ];
  for (const [name, arr] of sections) {
    if (!arr?.length) continue;
    lines.push(`[${name}]`);
    list(arr);
    lines.push('');
  }
  return lines.join('\n').trim();
}

function renderDetail(id) {
  const s = state.sermons.find((x) => x.id === id);
  if (!s) {
    app.replaceChildren(h('a', { class: 'back', href: '#/', text: '← 목록으로' }), h('div', { class: 'empty' }, h('p', { text: '해당 설교를 찾을 수 없습니다.' })));
    return;
  }
  const r = s.result || {};
  const sg = r.small_group || {};
  document.title = `${s.title} · 말씀 노트`;

  const ytUrl = safeYoutube(s.url, s.id);

  // 로그인했다면 이 설교의 개인 노트를 준비합니다 (로그인 전이면 null).
  const notes = NOTES_ENABLED && auth.user ? createNotes(s) : null;
  currentNotes = notes;

  const questionGroup = (title, arr) =>
    arr?.length ? h('div', { class: 'sg-group' }, h('h3', { text: title }), h('ol', { class: 'q' }, arr.map((q) => h('li', { text: q })))) : null;

  const sections = [];

  // 설교 정리
  sections.push(
    h(
      'section',
      { class: 'block', id: 'outline' },
      h('h2', { text: '설교 정리' }),
      (r.outline || []).map((o) =>
        h(
          'div',
          { class: 'point' },
          h('h3', { text: o.heading }),
          o.scripture ? h('p', { class: 'ref', text: o.scripture }) : null,
          paragraphs(o.content),
          o.key_quote ? h('blockquote', { class: 'quote', text: o.key_quote }) : null,
        ),
      ),
      r.gospel_connection ? h('div', { class: 'gospel' }, h('h3', { text: '복음과의 연결' }), h('p', { text: r.gospel_connection })) : null,
    ),
  );

  // 삶의 적용
  if (r.applications?.length) {
    sections.push(
      h(
        'section',
        { class: 'block', id: 'apply' },
        h('h2', { text: '삶의 적용 포인트' }),
        h(
          'div',
          { class: 'apps' },
          r.applications.map((a, i) => h('div', { class: 'app-item' }, h('h3', { text: a.title }), h('p', { text: a.detail }), notes ? notes.checkRow(i) : null)),
        ),
      ),
    );
  }

  // 묵상
  if (r.meditation_questions?.length) {
    sections.push(
      h(
        'section',
        { class: 'block', id: 'meditate' },
        h('h2', { text: '묵상 질문' }),
        h('ol', { class: 'q' }, r.meditation_questions.map((q, i) => h('li', {}, h('span', { text: q }), notes ? notes.answerBox(i) : null))),
      ),
    );
  }

  // 소그룹
  sections.push(
    h(
      'section',
      { class: 'block', id: 'group' },
      h(
        'div',
        { class: 'block-head' },
        h('h2', { text: '소그룹 나눔 질문' }),
        h('button', { class: 'btn', type: 'button', onclick: () => copyText(smallGroupText(s)) }, '질문 복사'),
      ),
      sg.icebreaker ? h('div', { class: 'sg-group' }, h('h3', { text: '마음 열기' }), h('div', { class: 'sg-ice', text: sg.icebreaker })) : null,
      questionGroup('본문 관찰', sg.observation),
      questionGroup('묵상과 해석', sg.reflection),
      questionGroup('삶의 적용', sg.application),
      questionGroup('기도와 결단', sg.prayer),
    ),
  );

  // 내 메모 (로그인 전에는 안내 문구만 보입니다)
  if (NOTES_ENABLED) {
    sections.push(
      h(
        'section',
        { class: 'block', id: 'mynote' },
        h('div', { class: 'block-head' }, h('h2', { text: '내 메모' }), notes ? notes.status : null),
        notes
          ? [notes.memoBox(), h('p', { class: 'meta', text: '내 구글 계정으로 자동 저장되며, 다른 로그인 사용자에게는 보이지 않습니다.' })]
          : h('p', { class: 'note-hint', text: '화면 위쪽에서 구글 로그인을 하면, 이 설교에 대한 메모와 묵상 답변, 적용 체크를 나만의 노트로 남길 수 있어요.' }),
      ),
    );
  }

  if (r.caveats) sections.push(h('p', { class: 'caveats', text: `참고: ${r.caveats}` }));

  app.replaceChildren(
    h('a', { class: 'back', href: `#/c/${s.category}`, text: `← ${catLabel(s.category)} 목록` }),
    h(
      'div',
      { class: 'detail-head' },
      h('div', { class: 'meta' }, h('span', { class: 'chip', text: catLabel(s.category) }), formatDate(s.published_at), r.preacher ? ` · ${r.preacher}` : ''),
      h('h1', { text: s.title }),
      r.scripture?.length ? h('p', { class: 'meta', text: `본문 ${r.scripture.join(', ')}` }) : null,
      r.theme ? h('div', { class: 'detail-theme', text: r.theme }) : null,
      h(
        'div',
        { class: 'actions' },
        h('a', { class: 'btn primary', href: ytUrl, target: '_blank', rel: 'noopener noreferrer' }, '▶ 영상 보기'),
        h('button', { class: 'btn', type: 'button', onclick: () => window.print() }, '인쇄 / PDF'),
      ),
    ),
    h(
      'nav',
      { class: 'secnav', 'aria-label': '섹션 이동' },
      [['outline', '설교 정리'], ['apply', '삶의 적용'], ['meditate', '묵상'], ['group', '소그룹'], ['mynote', '내 메모']]
        .filter(([sid]) => sections.some((el) => el.id === sid))
        .map(([sid, label]) =>
          h('a', {
            href: `#${sid}`,
            text: label,
            onclick: (e) => {
              e.preventDefault();
              document.getElementById(sid)?.scrollIntoView({ behavior: 'smooth' });
            },
          }),
        ),
    ),
    ...sections,
  );
  if (notes) notes.load();
}

/* ---------- 관리: 재생목록 추가·수정·삭제 (Apps Script 웹앱 경유) ---------- */
const ADMIN_URL = (window.APP_CONFIG && window.APP_CONFIG.ADMIN_API_URL) || '';
const PW_KEY = 'sn-admin-pw';

// 비밀번호는 이 브라우저 탭 안에서만 기억합니다 (탭을 닫으면 사라짐). 저장 실패해도 동작은 계속됩니다.
const storedPassword = () => {
  try {
    return sessionStorage.getItem(PW_KEY) || '';
  } catch {
    return '';
  }
};
const rememberPassword = (pw) => {
  try {
    sessionStorage.setItem(PW_KEY, pw);
  } catch {
    /* 저장 불가 환경: 무시 */
  }
};
const forgetPassword = () => {
  try {
    sessionStorage.removeItem(PW_KEY);
  } catch {
    /* 무시 */
  }
};

async function adminGet(params) {
  const res = await fetch(`${ADMIN_URL}?${new URLSearchParams(params)}`);
  if (!res.ok) throw new Error(`서버 응답 오류 (${res.status})`);
  return res.json();
}

// Apps Script는 text/plain 으로 보내야 브라우저가 사전 요청(preflight) 없이 바로 보낼 수 있습니다.
async function adminPost(payload) {
  const res = await fetch(ADMIN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`서버 응답 오류 (${res.status})`);
  return res.json();
}

function backToHome() {
  return h('a', { class: 'back', href: '#/', text: '← 목록으로' });
}

function renderAdminRoute() {
  document.title = '관리 · 말씀 노트';
  if (!ADMIN_URL) {
    app.replaceChildren(
      backToHome(),
      h(
        'div',
        { class: 'empty' },
        h('p', {}, h('strong', { text: '관리 기능을 아직 연결하지 않았습니다.' })),
        h('p', { text: 'docs/config.js 의 ADMIN_API_URL 에 Apps Script 웹앱 주소를 넣어 주세요.' }),
      ),
    );
    return;
  }
  const pw = storedPassword();
  if (pw) renderAdminPanel(pw);
  else renderAdminGate();
}

function renderAdminGate(message = '') {
  const input = h('input', {
    class: 'search',
    type: 'password',
    placeholder: '관리 비밀번호',
    'aria-label': '관리 비밀번호',
    autocomplete: 'current-password',
  });
  const msg = h('p', { class: 'meta', role: 'status', text: message });
  const btn = h('button', { class: 'btn primary', type: 'button' }, '들어가기');

  const submit = async () => {
    const password = input.value;
    if (!password) return;
    btn.disabled = true;
    msg.textContent = '확인 중…';
    try {
      const r = await adminPost({ action: 'check', password });
      if (!r.ok) throw new Error(r.error || '확인에 실패했습니다.');
      rememberPassword(password);
      renderAdminPanel(password);
    } catch (e) {
      msg.textContent = e.message || String(e);
      btn.disabled = false;
    }
  };
  btn.addEventListener('click', submit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submit();
  });

  app.replaceChildren(
    backToHome(),
    h('div', { class: 'point' }, h('h2', { text: '관리' }), h('p', { class: 'meta', text: '재생목록을 추가하거나 수정하려면 비밀번호를 입력하세요.' }), input, h('div', { class: 'admin-row' }, btn), msg),
  );
  input.focus();
}

function categoryOptions(selected) {
  return CATEGORIES.map((c) => h('option', { value: c.label, text: c.label, selected: c.label === selected }));
}

function renderAdminPanel(password) {
  const status = h('p', { class: 'meta', role: 'status' });
  const list = h('ul', { class: 'admin-list' });

  const flash = (msg) => {
    status.textContent = msg;
  };

  const runAction = async (payload, okMsg) => {
    flash('저장 중…');
    try {
      const r = await adminPost({ ...payload, password });
      if (r.ok === false && /비밀번호/.test(r.error || '')) {
        forgetPassword();
        renderAdminGate('비밀번호가 맞지 않습니다. 다시 입력해 주세요.');
        return false;
      }
      if (!r.ok) throw new Error(r.error || '저장하지 못했습니다.');
      flash(okMsg);
      await reload();
      return true;
    } catch (e) {
      flash(`오류: ${e.message || e}`);
      return false;
    }
  };

  // 추가 입력란
  const addCat = h('select', { class: 'search admin-cat', 'aria-label': '구분' }, categoryOptions(CATEGORIES[0].label));
  const addUrl = h('input', { class: 'search', placeholder: 'https://www.youtube.com/playlist?list=…', 'aria-label': '재생목록 주소' });
  const addMax = h('input', { class: 'search admin-max', type: 'number', min: '1', max: '100', value: '30', 'aria-label': '최대 개수' });
  const addBtn = h('button', { class: 'btn primary', type: 'button' }, '추가');
  addBtn.addEventListener('click', async () => {
    if (!addUrl.value.trim()) return flash('재생목록 주소를 입력해 주세요.');
    const ok = await runAction({ action: 'add', category: addCat.value, playlist_url: addUrl.value.trim(), max_videos: addMax.value }, '재생목록을 추가했습니다.');
    if (ok) addUrl.value = '';
  });

  const rowFor = (p) => {
    const cat = h('select', { class: 'search admin-cat', 'aria-label': '구분' }, categoryOptions(p.category));
    const url = h('input', { class: 'search', value: p.playlist_url, 'aria-label': '재생목록 주소' });
    const max = h('input', { class: 'search admin-max', type: 'number', min: '1', max: '100', value: String(p.max_videos), 'aria-label': '최대 개수' });
    const save = h('button', { class: 'btn', type: 'button' }, '저장');
    const del = h('button', { class: 'btn danger', type: 'button' }, '삭제');
    save.addEventListener('click', () =>
      runAction({ action: 'update', row: p.row, category: cat.value, playlist_url: url.value.trim(), max_videos: max.value }, '수정했습니다.'),
    );
    del.addEventListener('click', () => {
      if (!confirm(`이 재생목록을 삭제할까요?\n${p.playlist_url}`)) return;
      runAction({ action: 'delete', row: p.row }, '삭제했습니다.');
    });
    return h('li', { class: 'admin-item' }, h('div', { class: 'admin-fields' }, cat, url, max), h('div', { class: 'admin-row' }, save, del));
  };

  async function reload() {
    list.replaceChildren(h('li', { class: 'meta', text: '불러오는 중…' }));
    try {
      const r = await adminGet({ action: 'list' });
      if (!r.ok) throw new Error(r.error || '목록을 불러오지 못했습니다.');
      if (!r.playlists.length) {
        list.replaceChildren(h('li', { class: 'meta', text: '등록된 재생목록이 없습니다.' }));
        return;
      }
      list.replaceChildren(...r.playlists.map(rowFor));
    } catch (e) {
      list.replaceChildren(h('li', { class: 'meta', text: `오류: ${e.message || e}` }));
    }
  }

  const logout = h('button', { class: 'btn', type: 'button' }, '로그아웃');
  logout.addEventListener('click', () => {
    forgetPassword();
    location.hash = '#/admin';
    renderAdminGate();
  });

  app.replaceChildren(
    backToHome(),
    h(
      'div',
      { class: 'admin-head' },
      h('h1', { text: '재생목록 관리' }),
      logout,
    ),
    h(
      'section',
      { class: 'point admin-add' },
      h('h2', { text: '재생목록 추가' }),
      h('div', { class: 'admin-fields' }, addCat, addUrl, addMax),
      h('div', { class: 'admin-row' }, addBtn),
      h('p', { class: 'meta', text: '추가하거나 바꾼 재생목록은 다음 자동 정리 때 반영됩니다. 바로 반영하려면 GitHub Actions에서 Run workflow를 실행하세요.' }),
    ),
    status,
    h('h2', { class: 'admin-sub', text: '등록된 재생목록' }),
    list,
  );
  reload();
}

/* ---------- 구글 로그인 + 개인 노트 ----------
   로그인: 구글 로그인(Google Identity Services)으로 받은 ID 토큰을 Apps Script에 보내면,
   서버가 토큰을 확인하고 "그 사람의" 노트만 읽고 씁니다. 화면에서 보이는 이름·이메일은 표시용일 뿐 신뢰하지 않습니다. */
const CLIENT_ID = (window.APP_CONFIG && window.APP_CONFIG.GOOGLE_CLIENT_ID) || '';
const NOTES_ENABLED = Boolean(CLIENT_ID && ADMIN_URL);
const TOKEN_KEY = 'sn-id-token';
const auth = { token: '', user: null };
let currentNotes = null;
let expiredShown = false;

function decodeJwt(token) {
  try {
    const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const bytes = atob(part)
      .split('')
      .map((c) => `%${`00${c.charCodeAt(0).toString(16)}`.slice(-2)}`)
      .join('');
    return JSON.parse(decodeURIComponent(bytes));
  } catch {
    return null;
  }
}

function setSession(token) {
  const p = decodeJwt(token || '');
  if (!p || !p.exp || p.exp * 1000 <= Date.now()) return false;
  auth.token = token;
  auth.user = { name: p.name || p.email || '로그인됨', email: p.email || '', exp: p.exp };
  expiredShown = false;
  try {
    sessionStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* 저장 불가 환경: 이 탭에서만 유지 */
  }
  return true;
}

function restoreSession() {
  try {
    const t = sessionStorage.getItem(TOKEN_KEY);
    if (t && !setSession(t)) sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* 무시 */
  }
}

function clearSession() {
  auth.token = '';
  auth.user = null;
  state.noteIds = new Set();
  try {
    sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* 무시 */
  }
  try {
    window.google?.accounts?.id?.disableAutoSelect();
  } catch {
    /* 무시 */
  }
}

function renderAccountArea() {
  const box = document.getElementById('account');
  if (!box || !NOTES_ENABLED) return;
  box.replaceChildren();
  if (auth.user) {
    const out = h('button', { class: 'btn small', type: 'button' }, '로그아웃');
    out.addEventListener('click', async () => {
      // 로그아웃 전에 저장 안 된 노트를 먼저 저장합니다.
      if (currentNotes) await currentNotes.flush();
      currentNotes = null;
      clearSession();
      renderAccountArea();
      route();
    });
    box.append(h('span', { class: 'account-name', text: auth.user.name }), out);
    return;
  }
  if (window.google?.accounts?.id) {
    const slot = h('div');
    box.append(slot);
    window.google.accounts.id.renderButton(slot, { theme: 'outline', size: 'medium', text: 'signin_with', locale: 'ko' });
  }
}

// 로그인 토큰은 약 1시간 뒤 만료됩니다. 서버가 거절하면 다시 로그인하도록 안내합니다.
function handleAuthExpired() {
  if (expiredShown) return;
  expiredShown = true;
  clearSession();
  renderAccountArea();
  toast('로그인이 만료되었습니다. 다시 로그인해 주세요.');
  try {
    window.google?.accounts?.id?.prompt();
  } catch {
    /* 무시 */
  }
}

async function notesCall(action, payload = {}) {
  const r = await adminPost({ action, id_token: auth.token, ...payload });
  if (!r.ok && (r.code === 'auth' || r.code === 'forbidden')) {
    if (r.code === 'auth') handleAuthExpired();
  }
  return r;
}

async function fetchNoteIds() {
  if (!auth.user) return;
  try {
    const r = await notesCall('notes_list');
    if (r.ok) state.noteIds = new Set((r.items || []).map((x) => x.video_id));
  } catch {
    /* 목록의 "내 노트" 표시만 빠질 뿐이라 조용히 넘어갑니다 */
  }
}

function rerenderIfListOrHome() {
  const kind = location.hash.split('/')[1];
  if (kind !== 'admin') route();
}

async function onCredential(resp) {
  if (!setSession(resp && resp.credential)) return;
  renderAccountArea();
  await fetchNoteIds();
  rerenderIfListOrHome();
}

function startGoogle(tries = 0) {
  if (!NOTES_ENABLED) return;
  if (!window.google?.accounts?.id) {
    // 구글 스크립트가 아직 로드되는 중일 수 있습니다 (최대 약 10초 대기).
    if (tries < 50) setTimeout(() => startGoogle(tries + 1), 200);
    return;
  }
  window.google.accounts.id.initialize({ client_id: CLIENT_ID, callback: onCredential, auto_select: true });
  renderAccountArea();
}

const localDate = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// 설교 한 편에 대한 내 노트: 메모 + 묵상 질문 답변 + 적용 체크. 입력하면 잠시 뒤 자동 저장합니다.
function createNotes(s) {
  const r = s.result || {};
  const questions = r.meditation_questions || [];
  const apps = r.applications || [];
  const values = {
    memo: '',
    answers: questions.map(() => ''),
    checks: apps.map(() => ({ done: false, date: '' })),
  };
  const fields = []; // 불러오기가 끝나기 전에는 입력을 막아, 기존 노트를 빈 값으로 덮어쓰지 않게 합니다.
  const painters = [];
  const answerEls = [];
  let memoEl = null;
  const status = h('span', { class: 'meta note-status', role: 'status' });
  let ready = false;
  let dirty = false;
  let timer = null;
  let saving = null;

  const setStatus = (t) => {
    status.textContent = t;
  };

  async function save() {
    if (!ready || !dirty) return;
    if (saving) await saving;
    dirty = false;
    setStatus('저장 중…');
    saving = (async () => {
      try {
        const res = await notesCall('notes_save', {
          video_id: s.id,
          memo: values.memo,
          answers: questions.map((q, i) => ({ q, a: values.answers[i] })),
          checks: apps.map((a, i) => ({ t: a.title, done: values.checks[i].done, date: values.checks[i].date })),
        });
        if (!res.ok) throw new Error(res.error || '저장하지 못했습니다.');
        state.noteIds.add(s.id);
        setStatus(`저장됨 ${new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}`);
      } catch (e) {
        dirty = true;
        setStatus(`저장 실패: ${e.message || e}`);
      }
    })();
    await saving;
    saving = null;
  }

  const touch = () => {
    dirty = true;
    setStatus('입력 중…');
    clearTimeout(timer);
    timer = setTimeout(save, 1200);
  };
  const flush = () => {
    clearTimeout(timer);
    return save();
  };

  function answerBox(i) {
    const ta = h('textarea', { class: 'note-input', rows: '3', placeholder: '내 생각을 적어 보세요', 'aria-label': `묵상 질문 ${i + 1} 답변`, disabled: true });
    ta.addEventListener('input', () => {
      values.answers[i] = ta.value;
      touch();
    });
    fields.push(ta);
    answerEls[i] = ta;
    return ta;
  }

  function checkRow(i) {
    const cb = h('input', { type: 'checkbox', disabled: true, 'aria-label': '실천했어요' });
    const dateEl = h('span', { class: 'meta check-date' });
    const paint = () => {
      const c = values.checks[i];
      cb.checked = c.done;
      dateEl.textContent = c.done && c.date ? `${c.date} 실천` : '';
    };
    cb.addEventListener('change', () => {
      const c = values.checks[i];
      c.done = cb.checked;
      c.date = c.done ? c.date || localDate() : '';
      paint();
      touch();
    });
    fields.push(cb);
    painters.push(paint);
    return h('label', { class: 'check' }, cb, h('span', { text: ' 실천했어요' }), dateEl);
  }

  function memoBox() {
    memoEl = h('textarea', {
      class: 'note-input note-memo',
      rows: '6',
      placeholder: '이 설교를 들으며 떠오른 생각, 기도 제목, 나누고 싶은 말을 자유롭게 적어 보세요.',
      'aria-label': '내 메모',
      disabled: true,
    });
    memoEl.addEventListener('input', () => {
      values.memo = memoEl.value;
      touch();
    });
    fields.push(memoEl);
    return memoEl;
  }

  async function load() {
    setStatus('노트 불러오는 중…');
    try {
      const res = await notesCall('notes_get', { video_id: s.id });
      if (!res.ok) throw new Error(res.error || '노트를 불러오지 못했습니다.');
      const n = res.note;
      if (n) {
        values.memo = n.memo || '';
        // 설교 정리가 다시 만들어져 질문 문구가 바뀌면 옛 답변은 시트에만 남고 화면에는 나오지 않습니다.
        const aMap = new Map((n.answers || []).map((x) => [x.q, x.a]));
        questions.forEach((q, i) => {
          values.answers[i] = aMap.get(q) || '';
        });
        const cMap = new Map((n.checks || []).map((x) => [x.t, x]));
        apps.forEach((a, i) => {
          const c = cMap.get(a.title);
          values.checks[i] = c ? { done: !!c.done, date: c.date || '' } : { done: false, date: '' };
        });
      }
      if (memoEl) memoEl.value = values.memo;
      answerEls.forEach((ta, i) => {
        if (ta) ta.value = values.answers[i] || '';
      });
      painters.forEach((p) => p());
      fields.forEach((el) => {
        el.disabled = false;
      });
      ready = true;
      setStatus('');
    } catch (e) {
      setStatus(`오류: ${e.message || e}`);
    }
  }

  return { answerBox, checkRow, memoBox, status, load, flush };
}

/* ---------- 시작 ---------- */
(async function init() {
  let loadError = null;
  try {
    await load();
  } catch (e) {
    loadError = e;
  }
  const upd = document.getElementById('updated');
  if (upd && state.updated) upd.textContent = `최근 갱신: ${state.updated.slice(0, 10)}${state.demo ? ' (샘플 데이터)' : ''}`;
  window.addEventListener('hashchange', route);
  window.addEventListener('pagehide', () => currentNotes && currentNotes.flush());
  restoreSession();
  // 관리 화면은 정리 데이터가 없어도 열 수 있어야 합니다.
  if (loadError && !location.hash.startsWith('#/admin')) {
    app.replaceChildren(h('div', { class: 'empty' }, h('p', {}, h('strong', { text: '데이터를 불러오지 못했습니다.' })), h('p', { text: String(loadError.message || loadError) })));
  } else {
    route();
  }
  renderAccountArea();
  startGoogle();
  if (auth.user) {
    // 목록 화면에만 "내 노트" 표시를 다시 그립니다. 설교 화면에서 입력 중인 내용은 건드리지 않습니다.
    fetchNoteIds().then(() => {
      const kind = location.hash.split('/')[1];
      if (kind !== 'v' && kind !== 'admin') route();
    });
  }
})();
