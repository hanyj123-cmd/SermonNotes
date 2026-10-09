// 말씀결 — 정적 웹앱 (빌드 도구 없음)
// 데이터: data/sermons.json (목록) + data/s/<영상ID>.json (설교별 내용) — GitHub Actions가 Google Sheets에서 만들어 커밋
// 화면 확인용 샘플: 주소 뒤에 ?demo 를 붙이면 data/sample/ 의 샘플을 불러옵니다.
// 화면 구성: 메뉴 [토론토영락교회 설교] [사용자 영상]  ·  detail.js(상세 4모드) · notes.js(개인 기록) · handout.js(핸드아웃)

const app = document.getElementById('app');
const state = {
  sermons: [],
  updated: null,
  demo: new URLSearchParams(location.search).has('demo'),
  filter: { q: '', month: '', preacher: '', book: '' },
  noteIds: new Set(),
  music: null,
  details: new Map(),
};

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
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return el;
}

const safeYoutube = (url, id) => (/^https:\/\/(www\.)?youtube\.com\//.test(url || '') ? url : `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`);

function formatDate(iso) {
  if (!/^\d{4}-\d{2}-\d{2}/.test(iso || '')) return '';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return `${y}.${m}.${d}`;
}

// "2026년 10월 8일 오전 1:30" (보는 사람의 시간대 기준)
function formatDateTime(iso) {
  const d = new Date(iso);
  if (!iso || isNaN(d)) return '';
  return new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(d);
}

function toast(message, ms = 1800) {
  const t = h('div', { class: 'toast', role: 'status', text: message });
  document.body.append(t);
  setTimeout(() => t.remove(), ms);
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
// 설교 목록은 늘 날짜 최신순 (날짜가 없는 것은 맨 뒤). 같은 날짜는 원래 순서를 유지합니다.
function sermonDateKey(s) {
  const m = String((s && s.date) || '').match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
  return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : '';
}
function sortSermons() {
  state.sermons.sort((a, b) => sermonDateKey(b).localeCompare(sermonDateKey(a)));
}
async function load() {
  const res = await fetch(`${dataBase()}sermons.json?t=${Date.now()}`);
  if (!res.ok) throw new Error(`데이터를 불러오지 못했습니다 (${res.status})`);
  const data = await res.json();
  state.sermons = (Array.isArray(data.sermons) ? data.sermons : []).map((x) =>
    applyLocalEdit({ ...x, title: displayTitle({ category: x.category, title: tidyTitle(x.title), scripture: x.scripture }), preacher: normalizePreacher(x.preacher) }, data.updated), // 이 기기에서 방금 고친 값이 있으면 먼저 보여 줍니다
  );
  sortSermons();
  state.updated = data.updated || null;
  state.details = new Map(); // 새로 불러왔으니 설교별 내용도 다시 받습니다
  // 묵상 음악 목록 (없어도 괜찮습니다)
  try {
    const mr = await fetch(`data/${state.demo ? 'music.sample.json' : 'music.json'}?t=${Date.now()}`);
    if (mr.ok) {
      const m = await mr.json();
      state.music = Array.isArray(m.tracks) ? m : null;
    }
  } catch {
    state.music = null;
  }
}

/* ---------- 라우팅: #/c/<구분>  #/u  #/u/add  #/v/<영상ID>[/<모드>]  #/h/<영상ID>[/<모드>]  #/g[/<탭>]  #/q/<영상ID>  #/r[/<날짜>[/<모드>]]  #/admin ---------- */
function route() {
  const [, kind, arg, arg2] = location.hash.split('/');
  window.scrollTo(0, 0);
  // 다른 화면으로 넘어가기 전에, 아직 저장되지 않은 기록이 있으면 먼저 저장합니다.
  if (currentNotes) {
    currentNotes.flush();
    currentNotes = null;
  }
  teardownMarks(); // 형광펜·밑줄·메모 저장 후 도구 막대 정리
  teardownHandout();
  document.body.classList.toggle('handout-mode', kind === 'h');
  // 첫 화면(#/ 또는 주소 없음)은 말씀 게임 메인입니다
  const home = !kind;
  setActiveMenu(kind === 'r' || (kind === 'h' && /^bible-/.test(arg || '')) ? 'read' : kind === 'u' ? 'user' : home || kind === 'g' || kind === 'q' ? 'game' : kind === 'admin' ? '' : 'church');
  if (home) return renderGame('home');
  if (kind === 'admin') return renderAdminRoute();
  if (kind === 'g') return renderGame(arg || 'home');
  if (kind === 'q' && arg) return renderQuest(decodeURIComponent(arg));
  if (kind === 'r') return renderDaily(arg, arg2);
  if (kind === 'h' && arg) return renderHandout(decodeURIComponent(arg), arg2);
  if (kind === 'v' && arg) return renderDetail(decodeURIComponent(arg), arg2);
  if (kind === 'u') return renderUserRoute(arg);
  renderList(arg === 'past' || PAST_CATS.includes(arg) ? 'past' : 'sunday');
}

// 맨 아래: GitHub 에 새로 푸시되어 사이트에 반영된 시각 (GitHub Pages 가 보내는 index.html 의 Last-Modified)
let pushTimeShown = false;
async function showPushTime() {
  if (pushTimeShown) return;
  pushTimeShown = true;
  const foot = document.querySelector('.site-footer');
  if (!foot) return;
  let when = '';
  try {
    const r = await fetch(`index.html?pushed=${Date.now()}`, { method: 'HEAD', cache: 'no-store' });
    when = r.headers.get('last-modified') || '';
  } catch {
    when = '';
  }
  if (!when) when = document.lastModified;
  const t = new Date(when);
  if (isNaN(t)) return;
  const ver = (document.querySelector('script[src^="app.js"]')?.getAttribute('src').match(/v=([\d.]+)/) || [])[1];
  const text = `앱 업데이트(푸시) ${t.toLocaleString('ko-KR', { timeZone: 'America/Toronto', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' })}${ver ? ` · v${ver}` : ''}`;
  let el = document.getElementById('pushed');
  if (!el) {
    el = h('p', { id: 'pushed', class: 'pushed' });
    foot.append(el);
  }
  el.textContent = text;
}

function setActiveMenu(which) {
  document.querySelectorAll('.menu-link').forEach((a) => {
    if (a.dataset.menu === which) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
}

/* ---------- 목록: 필터 + 줄 목록 ---------- */
const preacherKey = (p) => String(p || '').replace(/\s*(담임|부|협동|원로|객원|초청)?\s*(목사|전도사|강도사|장로|선교사|교수|박사)님?\s*$/, '').trim();

// 현재 목록(items)에서 고를 수 있는 값들로 선택 상자를 만들고, 바뀌면 onChange 를 부릅니다
function filterBar(items, onChange) {
  const f = state.filter;
  const months = [...new Set(items.map((s) => String(s.date || '').slice(0, 7)).filter((m) => /^\d{4}-\d{2}$/.test(m)))].sort().reverse();
  const preachers = [...new Set(items.map((s) => preacherKey(s.preacher)).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko'));
  const books = [...new Map(items.filter((s) => s.book).map((s) => [s.book, s.bookIdx || 999])).entries()].sort((a, b) => a[1] - b[1]).map(([name]) => name);
  const select = (key, label, options, fmt) => {
    const sel = h('select', { class: 'search filter-select', 'aria-label': label }, h('option', { value: '', text: `${label} 전체` }), options.map((o) => h('option', { value: o, text: fmt ? fmt(o) : o })));
    sel.value = options.includes(f[key]) ? f[key] : '';
    f[key] = sel.value;
    sel.addEventListener('change', () => {
      f[key] = sel.value;
      onChange();
    });
    return sel;
  };
  const search = h('input', { class: 'search', type: 'search', placeholder: '제목, 본문, 설교자로 검색', 'aria-label': '검색', value: f.q });
  search.addEventListener('input', () => {
    f.q = search.value;
    onChange();
  });
  const reset = h('button', { class: 'btn small', type: 'button' }, '필터 지우기');
  reset.addEventListener('click', () => {
    state.filter = { q: '', month: '', preacher: '', book: '' };
    onChange(true);
  });
  return h(
    'div',
    { class: 'filters' },
    h('div', { class: 'filter-row' }, select('month', '날짜', months, (m) => `${m.slice(0, 4)}년 ${Number(m.slice(5))}월`), select('preacher', '설교자', preachers), select('book', '성경 본문', books)),
    h('div', { class: 'filter-row' }, search, reset),
  );
}

const matchesFilter = (s) => {
  const f = state.filter;
  if (f.month && String(s.date || '').slice(0, 7) !== f.month) return false;
  if (f.preacher && preacherKey(s.preacher) !== f.preacher) return false;
  if (f.book && s.book !== f.book) return false;
  const q = f.q.trim().toLowerCase();
  if (q && ![s.title, s.summary_short, s.preacher, s.scripture].join(' ').toLowerCase().includes(q)) return false;
  return true;
};

const PAGE_STEP = 40;

function sermonRow(s) {
  const [y, m, d] = /^\d{4}-\d{2}-\d{2}/.test(s.date || '') ? s.date.slice(0, 10).split('-').map(Number) : [0, 0, 0];
  const partial = s.modes && s.modes.length < MODES.length;
  return h(
    'li',
    {},
    h(
      'a',
      { class: 'row', href: `#/v/${encodeURIComponent(s.id)}` },
      h('div', { class: 'row-date' }, y ? [h('span', { class: 'rd-md', text: `${m}.${d}` }), h('span', { class: 'rd-y', text: String(y) })] : null),
      h(
        'div',
        { class: 'row-main' },
        h('div', { class: 'meta' }, s.scripture ? h('span', { class: 'chip', text: s.scripture }) : null, s.preacher ? h('span', { class: 'row-preacher', text: s.preacher }) : null, partial ? h('span', { class: 'chip soft', text: '일부 모드 준비 중' }) : null, state.noteIds.has(s.id) ? h('span', { class: 'chip note-chip', text: '내 기록' }) : null),
        h('h2', { class: 'row-title', text: s.title }),
        s.summary_short ? h('p', { class: 'row-summary', text: s.summary_short }) : null,
      ),
    ),
  );
}

// 필터 + 목록을 한 덩어리로 만듭니다 (church 목록과 사용자 영상 목록이 함께 씁니다)
function sermonBrowser(items, emptyNode) {
  const list = h('ul', { class: 'rows' });
  const more = h('div', { class: 'more' });
  let shown = PAGE_STEP;
  const count = h('p', { class: 'meta result-count', role: 'status' });
  const bar = h('div', {});

  function fill() {
    const rows = items.filter(matchesFilter);
    count.textContent = rows.length === items.length ? `${rows.length}편` : `${items.length}편 중 ${rows.length}편`;
    list.replaceChildren();
    more.replaceChildren();
    if (!rows.length) {
      list.append(h('li', {}, items.length ? h('div', { class: 'empty' }, h('p', {}, h('strong', { text: '조건에 맞는 설교가 없습니다.' }))) : emptyNode));
      return;
    }
    rows.slice(0, shown).forEach((s) => list.append(sermonRow(s)));
    if (rows.length > shown) {
      const btn = h('button', { class: 'btn', type: 'button' }, `더 보기 (${rows.length - shown}편 남음)`);
      btn.addEventListener('click', () => {
        shown += PAGE_STEP;
        fill();
      });
      more.append(btn);
    }
  }
  function drawBar(resetShown) {
    if (resetShown) shown = PAGE_STEP;
    // 필터 선택 상자는 현재 목록 기준으로 다시 만들되, 입력 중인 검색칸은 유지합니다
    bar.replaceChildren(filterBar(items, (full) => (full === true ? drawBar(true) : (shown = PAGE_STEP, fill()))));
    fill();
  }
  drawBar();
  return h('div', {}, bar, count, list, more);
}

// 토론토영락교회 설교: [주일예배] [지난 설교(새벽기도 · 수요예배 · 청년부예배 — 이제 자동 정리는 하지 않고, 이미 정리된 것만 남겨 둡니다)]
const PAST_CATS = ['dawn', 'wednesday', 'youth'];
const LIST_TABS = [
  { key: 'sunday', label: '주일예배' },
  { key: 'past', label: '지난 설교' },
];
function renderList(cat) {
  if (state.lastCat !== cat) {
    state.filter = { q: '', month: '', preacher: '', book: '' };
    state.lastCat = cat;
  }
  const inTab = (key) => (s) => (key === 'past' ? PAST_CATS.includes(s.category) : s.category === key);
  const counts = Object.fromEntries(LIST_TABS.map((t) => [t.key, state.sermons.filter(inTab(t.key)).length]));
  const tabs = h(
    'div',
    { class: 'tabs', role: 'tablist', 'aria-label': '설교 구분' },
    LIST_TABS.map((t) =>
      h(
        'button',
        {
          class: 'tab',
          role: 'tab',
          'aria-selected': String(t.key === cat),
          onclick: () => {
            location.hash = `#/c/${t.key}`;
          },
        },
        t.label,
        h('span', { class: 'count', text: `${counts[t.key]}` }),
      ),
    ),
  );
  const items = state.sermons.filter(inTab(cat));
  const empty = h('div', { class: 'empty' }, h('p', {}, h('strong', { text: cat === 'past' ? '지난 설교가 없습니다.' : '아직 주일예배 정리가 없습니다.' })), h('p', { text: cat === 'past' ? '새벽기도 · 수요예배 · 청년부예배는 이제 자동으로 정리하지 않고, 이미 정리된 설교만 여기에 남겨 둡니다.' : 'Google Sheet의 Playlists 탭에 주일예배 재생목록을 넣으면 매주 일요일 밤 자동으로 정리됩니다.' }));
  app.replaceChildren(h('div', { class: 'page-head' }, h('h1', { text: '토론토영락교회 설교' })), tabs, sermonBrowser(items, empty));
  document.title = `${cat === 'past' ? '지난 설교' : '주일예배'} · 토론토영락교회 설교 · 말씀결`;
}

/* ---------- 사용자 영상 ---------- */
const USER_STATUS = {
  pending: ['정리 대기 중', 'wait'],
  redo: ['정리 대기 중', 'wait'],
  done: ['완료', 'ok'],
  error: ['일부 실패', 'bad'],
  no_transcript: ['자막 없음', 'bad'],
};

function renderUserRoute(sub) {
  const adding = sub === 'add';
  document.title = `${adding ? '영상 추가 · ' : ''}사용자 영상 · 말씀결`;
  const items = state.sermons.filter((s) => s.category === 'user');
  const subTab = (key, label, count) =>
    h(
      'button',
      { class: 'tab', role: 'tab', 'aria-selected': String((key === 'add') === adding), onclick: () => (location.hash = key === 'add' ? '#/u/add' : '#/u') },
      label,
      count == null ? null : h('span', { class: 'count', text: String(count) }),
    );
  const sections = [
    h('div', { class: 'page-head' }, h('h1', { text: '사용자 영상' }), h('p', { class: 'meta', text: '설교 영상의 유튜브 링크를 넣으면 AI가 같은 형식(설교리뷰 · QT 묵상 · 성경공부 · 소그룹 나눔)으로 정리해 줍니다. 여기 올린 영상과 정리는 로그인한 가족 모두가 볼 수 있습니다.' })),
    h('div', { class: 'tabs', role: 'tablist', 'aria-label': '사용자 영상 메뉴' }, subTab('list', '정리된 영상', items.length), subTab('add', '영상 추가')),
  ];

  if (adding) {
    if (!NOTES_ENABLED) {
      sections.push(h('div', { class: 'empty' }, h('p', { text: '로그인 기능이 아직 연결되지 않아 영상을 추가할 수 없습니다. (config.js 설정 필요)' })));
    } else if (!auth.user) {
      sections.push(h('p', { class: 'note-hint', text: '영상을 추가하려면 화면 위쪽에서 구글 로그인을 해 주세요.' }));
    } else {
      sections.push(buildUserForm());
    }
  } else {
    const empty = h(
      'div',
      { class: 'empty' },
      h('p', {}, h('strong', { text: '아직 정리된 사용자 영상이 없습니다.' })),
      h('p', {}, h('a', { href: '#/u/add', text: '영상 추가' }), h('span', { text: '에서 유튜브 링크를 넣어 보세요.' })),
    );
    sections.push(sermonBrowser(items, empty));
  }
  app.replaceChildren(...sections);
}

function buildUserForm() {
  const field = (label, input, hint) => h('label', { class: 'field' }, h('span', { class: 'field-label', text: label }), input, hint ? h('span', { class: 'meta', text: hint }) : null);
  const url = h('input', { class: 'search', type: 'url', placeholder: 'https://www.youtube.com/watch?v=…', required: true, 'aria-label': '유튜브 주소' });
  const date = h('input', { class: 'search', type: 'date', 'aria-label': '설교 날짜' });
  const title = h('input', { class: 'search', placeholder: '비워 두면 영상 제목에서 읽습니다', 'aria-label': '설교 제목' });
  const scripture = h('input', { class: 'search', placeholder: '예: 요한복음 3:16-21', 'aria-label': '성경 본문' });
  const preacher = h('input', { class: 'search', placeholder: '예: 홍길동 목사', 'aria-label': '설교자' });
  const msg = h('p', { class: 'meta', role: 'status' });
  const btn = h('button', { class: 'btn primary', type: 'submit' }, 'AI로 정리하기');
  const form = h(
    'form',
    { class: 'user-form point' },
    h('h2', { text: '영상 추가' }),
    field('유튜브 주소', url, '설교 제목 · 설교자 · 성경 본문 · 날짜는 영상 제목을 보고 알아서 채웁니다. 성경 본문이 있으면 성경 4역본(개역개정 · NIV · 표준새번역 · 메시지)이 함께 붙습니다.'),
    h(
      'details',
      { class: 'user-extra' },
      h('summary', { text: '직접 입력 (선택) — 제목에서 못 읽을 때만 적어 주세요' }),
      h('div', { class: 'form-grid' }, field('설교 날짜', date, '비우면 제목의 날짜, 없으면 유튜브 게시일'), field('설교자', preacher)),
      field('설교 제목', title),
      field('성경 본문', scripture),
    ),
    h('div', { class: 'admin-row' }, btn),
    msg,
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!url.value.trim()) return (msg.textContent = '유튜브 주소를 입력해 주세요.');
    btn.disabled = true;
    msg.textContent = '등록하는 중…';
    try {
      const r = await notesCall('user_video_add', { url: url.value.trim(), date: date.value, title: title.value.trim(), scripture: scripture.value.trim(), preacher: preacher.value.trim() });
      if (!r.ok) throw new Error(r.error || '등록하지 못했습니다.');
      const text = r.dispatched
        ? `"${r.title}" 등록 완료. AI 정리를 시작했습니다. 보통 몇 분 걸리며, 끝나면 "정리된 영상"에 나타납니다 (반영까지 1~2분 더). `
        : `"${r.title}" 등록 완료. 자동 정리는 다음 정해진 시각(새벽기도회 수집 시간)에 시작됩니다. `;
      msg.replaceChildren(text, h('a', { href: '#/u', text: '정리된 영상 보기' }));
      url.value = '';
      title.value = '';
      scripture.value = '';
      preacher.value = '';
      date.value = '';
      mine.refresh();
    } catch (err) {
      msg.textContent = `오류: ${err.message || err}`;
    } finally {
      btn.disabled = false;
    }
  });
  const mine = buildMyVideos();
  return h('div', {}, form, mine.node);
}

// 내가 올린 영상의 처리 현황 (대기 중이면 20초마다 다시 확인)
function buildMyVideos() {
  const list = h('ul', { class: 'mine-list' });
  const info = h('p', { class: 'meta', role: 'status' });
  let timer = null;
  async function refresh() {
    clearTimeout(timer);
    try {
      const r = await notesCall('user_video_mine');
      if (!r.ok) throw new Error(r.error || '목록을 불러오지 못했습니다.');
      const videos = r.videos || [];
      list.replaceChildren(...videos.map(mineRow));
      info.textContent = videos.length ? '' : '아직 내가 올린 영상이 없습니다.';
      if (videos.some((v) => v.status === 'pending' || v.status === 'redo') && document.body.contains(list)) timer = setTimeout(refresh, 20000);
      else if (videos.some((v) => v.status === 'done') && document.body.contains(list)) {
        // 정리가 끝난 영상이 있으면 목록 데이터를 새로 받아 둡니다 (반영 전이면 그대로)
        const before = state.sermons.length;
        await load().catch(() => {});
        if (state.sermons.length !== before) toast('정리가 끝난 영상이 목록에 추가되었습니다');
      }
    } catch (e) {
      info.textContent = `오류: ${e.message || e}`;
    }
  }
  function mineRow(v) {
    const [label, cls] = USER_STATUS[v.status] || [v.status, 'wait'];
    const open = v.status === 'done' ? h('a', { class: 'btn small', href: `#/v/${encodeURIComponent(v.video_id)}` }, '열기') : null;
    const redo = v.status !== 'pending' && v.status !== 'redo' ? h('button', { class: 'btn small', type: 'button' }, '다시 정리') : null;
    const remove = h('button', { class: 'btn small danger', type: 'button' }, '목록에서 빼기');
    redo?.addEventListener('click', async () => {
      const r = await notesCall('user_video_redo', { video_id: v.video_id });
      toast(r.ok ? '다시 정리를 요청했습니다' : r.error || '요청하지 못했습니다');
      refresh();
    });
    remove.addEventListener('click', async () => {
      if (!confirm(`"${v.title}" 을(를) 내 목록에서 뺄까요?`)) return;
      const r = await notesCall('user_video_remove', { video_id: v.video_id });
      toast(r.ok ? '목록에서 뺐습니다' : r.error || '처리하지 못했습니다');
      refresh();
    });
    return h(
      'li',
      { class: 'mine-item' },
      h('div', { class: 'mine-main' }, h('strong', { text: v.title }), h('div', { class: 'meta' }, h('span', { class: `vid-status ${cls}`, text: label }), ` ${v.published_at || ''}${v.note && v.status !== 'done' ? ` · ${v.note}` : ''}`)),
      h('div', { class: 'admin-row' }, open, redo, remove),
    );
  }
  const node = h('section', { class: 'block' }, h('h2', { text: '내가 올린 영상' }), list, info);
  setTimeout(refresh, 0);
  return { node, refresh };
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
  return h('a', { class: 'back', href: '#/c/sunday' }, icon('back'), '목록으로');
}

function renderAdminRoute() {
  document.title = '관리 · 말씀결';
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

// 성경 본문은 설정 없이 웹사이트에서 자동으로 가져옵니다 (대한성서공회 · BibleGateway)
function renderBibleInfo() {
  return h(
    'section',
    { class: 'point' },
    h('h2', { text: '성경 본문' }),
    h('p', { class: 'meta', text: '개역개정 · 표준새번역은 대한성서공회, NIV · 메시지 성경은 BibleGateway 웹사이트에서 자동으로 가져옵니다. 제목의 성경 본문(예: 열왕기상 4, 5장)을 읽어 설교마다 붙고, 설정은 필요 없습니다. 웹사이트의 화면 구조가 바뀌어 읽지 못하게 되면 GitHub Actions의 "Run workflow"에서 bible_check 를 true 로 두고 실행해 점검할 수 있습니다.' }),
  );
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

  // 지금 동기화: GitHub Actions를 앱에서 바로 실행하고 진행 상태를 보여 줍니다.
  const syncInfo = h('p', { class: 'meta', role: 'status' });
  const syncMax = h('select', { class: 'search admin-max', 'aria-label': '정리할 영상 수' }, [1, 3, 5, 10, 20].map((n) => h('option', { value: String(n), text: `${n}편`, selected: n === 5 })));
  const syncBtn = h('button', { class: 'btn primary', type: 'button' }, '지금 동기화');
  let syncTimer = null;
  // 비밀번호가 바뀌었거나 틀리면 저장된 비밀번호를 지우고 입력 화면으로 돌아갑니다.
  const passwordRejected = (r) => {
    if (r && r.ok === false && /비밀번호/.test(r.error || '')) {
      clearTimeout(syncTimer);
      forgetPassword();
      renderAdminGate('비밀번호가 맞지 않습니다. 다시 입력해 주세요.');
      return true;
    }
    return false;
  };
  const syncText = (run) => {
    const when = formatDateTime(run.started_at);
    if (run.state === 'running') return [icon('clock'), ` 실행 중입니다${when ? ` (시작 ${when})` : ''}. 보통 몇 분 걸립니다.`];
    if (run.state === 'success') return [icon('check'), ` 마지막 실행 완료${when ? ` (${when})` : ''}. 앱에는 1~2분 뒤 반영되니 새로고침해 보세요.`];
    if (run.state === 'failed') return [icon('alert'), ` 마지막 실행이 실패했습니다${when ? ` (${when})` : ''}. 자세한 내용은 GitHub Actions 기록을 확인하세요.`];
    return ['아직 실행 기록이 없습니다.'];
  };
  const renderSync = (run) => {
    syncInfo.replaceChildren(...syncText(run));
    if (run.state === 'failed' && /^https:\/\/github\.com\//.test(run.url || '')) {
      syncInfo.append(' ', h('a', { href: run.url, target: '_blank', rel: 'noopener', text: '기록 보기' }));
    }
    syncBtn.disabled = run.state === 'running';
  };
  async function refreshSync() {
    clearTimeout(syncTimer);
    try {
      const r = await adminPost({ action: 'sync_status', password });
      if (passwordRejected(r)) return;
      if (!r.ok) throw new Error(r.error || '상태를 확인하지 못했습니다.');
      renderSync(r.run || { state: 'none' });
      // 이 화면을 보고 있고 실행 중일 때만 10초마다 다시 확인합니다.
      if (r.run && r.run.state === 'running') {
        syncTimer = setTimeout(() => {
          if (document.body.contains(syncInfo)) refreshSync();
        }, 10000);
      }
    } catch (e) {
      syncInfo.textContent = `상태를 확인하지 못했습니다: ${e.message || e}`;
    }
  }
  // 동기화 실행 요청. 성공하면 true (선택한 영상 정리에서도 같이 씁니다)
  async function requestSync(count, categories) {
    syncBtn.disabled = true;
    syncInfo.textContent = '실행을 요청하는 중…';
    try {
      const r = await adminPost({ action: 'sync_run', password, max_new: String(count), categories: categories || syncCategories() });
      if (passwordRejected(r)) return false;
      if (!r.ok) throw new Error(r.error || '실행하지 못했습니다.');
      syncInfo.replaceChildren(icon('clock'), ' 실행을 요청했습니다. 잠시 뒤 상태가 표시됩니다…');
      // GitHub가 실행을 등록하기까지 몇 초 걸립니다. 그 사이 이전 기록이 보이지 않게 잠시 기다립니다.
      syncTimer = setTimeout(refreshSync, 6000);
      return true;
    } catch (e) {
      syncInfo.textContent = `오류: ${e.message || e}`;
      syncBtn.disabled = false;
      return false;
    }
  }
  // 이번에 확인할 구분 (청년부예배는 자동 수집이 없으므로 필요할 때 여기서 체크)
  const catChecks = CATEGORIES.map((c) => {
    const cb = h('input', { type: 'checkbox', value: c.key });
    cb.checked = c.key === 'sunday'; // 자동 수집은 주일예배만, 나머지는 필요할 때 체크
    return h('label', { class: 'ho-opt' }, cb, c.label);
  });
  const syncCategories = () => {
    const keys = catChecks.map((l) => l.querySelector('input')).filter((cb) => cb.checked).map((cb) => cb.value);
    return keys.length ? keys : ['none'];
  };
  syncBtn.addEventListener('click', () => requestSync(syncMax.value));

  // 오늘의 말씀 지금 동기화: 과거 5일 ~ 미래 2일 중 빠진 날 (또는 전부 다시)
  const dailyInfo = h('p', { class: 'meta', role: 'status' });
  const dailyForce = h('input', { type: 'checkbox' });
  const dailyBtn = h('button', { class: 'btn primary', type: 'button' }, '오늘의 말씀 지금 동기화');
  dailyBtn.addEventListener('click', async () => {
    if (dailyForce.checked && !confirm('이미 만든 날도 QT·성경공부·소그룹·퀴즈·영상을 모두 새로 만듭니다. 계속할까요?')) return;
    dailyBtn.disabled = true;
    dailyInfo.textContent = '실행을 요청하는 중…';
    try {
      const r = await adminPost({ action: 'sync_run', password, daily: true, daily_force: dailyForce.checked });
      if (passwordRejected(r)) return;
      if (!r.ok) throw new Error(r.error || '실행하지 못했습니다.');
      const range = r.dates && r.dates.length ? `${r.dates[0].slice(5).replace('-', '/')} ~ ${r.dates[r.dates.length - 1].slice(5).replace('-', '/')}` : '';
      dailyInfo.replaceChildren(
        icon('clock'),
        r.workflow_old
          ? ' 실행을 요청했습니다. GitHub의 sync.yml 이 옛 버전이라 이번에는 오늘·내일만 만듭니다. 새 sync.yml 을 올려 주세요.'
          : ` ${range} ${r.force ? '전부 다시' : '중 빠진 날을'} 만드는 중입니다. 하루치에 몇 분씩 걸려요. 진행 상태는 위 "지금 동기화"에 보입니다.`,
      );
      syncTimer = setTimeout(refreshSync, 6000);
      clearTimeout(dailyTimer);
      dailyTimer = setTimeout(refreshDaily, 8000);
    } catch (e) {
      dailyInfo.textContent = `오류: ${e.message || e}`;
    } finally {
      dailyBtn.disabled = false;
    }
  });
  // 날짜별 진행 상황: 완료 · 만드는 중 · 실패 (실행 중이면 10초마다 새로 봅니다)
  const dailyList = h('ul', { class: 'admin-daily' }, h('li', { class: 'meta', text: '진행 상황을 불러오는 중…' }));
  const dailyRefresh = h('button', { class: 'btn small', type: 'button' }, '새로 보기');
  let dailyTimer = null;
  const dowKo = ['일', '월', '화', '수', '목', '금', '토'];
  const dayLabel = (d) => {
    const x = new Date(`${d}T12:00:00Z`);
    return `${x.getUTCMonth() + 1}/${x.getUTCDate()} (${dowKo[x.getUTCDay()]})`;
  };
  const statusChip = (d, running) => {
    if (d.status === 'running') return running ? ['run', '만드는 중'] : ['err', '중단됨'];
    if (d.status === 'done') return d.videos ? ['ok', '완료'] : ['ok', '완료 · 영상 없음'];
    if (d.status === 'error') return ['err', '일부 실패'];
    return ['', d.status || '대기'];
  };
  // 날짜별 다시 만들기: 전부 또는 한 부분(QT · 성경공부 · 소그룹 · 퀴즈 · 공동체 성경읽기 영상)
  const REDO_PARTS = [['', '전부'], ['study', '성경공부'], ['qt', 'QT'], ['group', '소그룹'], ['quiz', '퀴즈'], ['videos', '영상']];
  const rowRedo = (d, running) => {
    const sel = h('select', { class: 'search ad-redo-sel', 'aria-label': `${d.date} 다시 만들 부분` }, REDO_PARTS.map(([v, l]) => h('option', { value: v, text: l })));
    const btn = h('button', { class: 'btn small', type: 'button', disabled: running }, '다시 만들기');
    btn.addEventListener('click', async () => {
      const part = REDO_PARTS.find(([v]) => v === sel.value)[1];
      if (!confirm(`${dayLabel(d.date)} ${d.refs || ''}\n${part === '전부' ? 'QT · 성경공부 · 소그룹 · 퀴즈 · 영상을 모두' : `${part}만`} 새로 만들까요? (몇 분 걸립니다)`)) return;
      btn.disabled = true;
      dailyInfo.textContent = '실행을 요청하는 중…';
      try {
        const r = await adminPost({ action: 'sync_run', password, daily: true, daily_force: true, dates: [d.date], modes: sel.value ? [sel.value] : [] });
        if (passwordRejected(r)) return;
        if (!r.ok) throw new Error(r.error || '실행하지 못했습니다.');
        dailyInfo.replaceChildren(icon('clock'), r.workflow_old ? ' 실행을 요청했지만 GitHub의 sync.yml 이 옛 버전이라 고른 부분만이 아니라 전부 다시 만들 수 있어요. 새 sync.yml 을 올려 주세요.' : ` ${dayLabel(d.date)} ${part === '전부' ? '전부' : part}을(를) 다시 만드는 중입니다.`);
        clearTimeout(dailyTimer);
        dailyTimer = setTimeout(refreshDaily, 8000);
        syncTimer = setTimeout(refreshSync, 6000);
      } catch (e) {
        dailyInfo.textContent = `오류: ${e.message || e}`;
        btn.disabled = false;
      }
    });
    return h('span', { class: 'ad-redo' }, sel, btn);
  };
  async function refreshDaily() {
    clearTimeout(dailyTimer);
    try {
      const r = await adminPost({ action: 'daily_status', password });
      if (passwordRejected(r)) return;
      if (!r.ok) throw new Error(/알 수 없는 작업/.test(r.error || '') ? 'Apps Script가 옛 버전입니다. 새 Code.gs로 다시 배포해 주세요.' : r.error || '불러오지 못했습니다.');
      const running = r.run && r.run.state === 'running';
      const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Toronto' });
      if (!r.days.length) dailyList.replaceChildren(h('li', { class: 'meta', text: '아직 만든 날이 없습니다.' }));
      else
        dailyList.replaceChildren(
          ...r.days.map((d) => {
            const [cls, label] = statusChip(d, running);
            const part = (ok, name) => h('span', { class: `ad-part${ok ? ' on' : ''}`, text: name });
            return h(
              'li',
              { class: `ad-row ad-${cls}` },
              h('span', { class: 'ad-date' }, dayLabel(d.date), d.date === today ? h('em', { text: '오늘' }) : null),
              h('span', { class: 'ad-refs', text: d.refs || '—' }),
              h('span', { class: 'ad-parts' }, part(d.qt, 'QT'), part(d.study, '공부'), part(d.group, '소그룹'), part(d.quiz, '퀴즈'), part(d.videos > 0, `영상 ${d.videos}`), part(!!d.dawn, '새벽기도')),
              h('span', { class: `ad-chip ad-chip-${cls}`, text: label }),
              rowRedo(d, running),
              d.status === 'running' && !running
                ? h('span', { class: 'ad-note', text: '지난 실행이 이 날을 끝내지 못했어요. "오늘의 말씀 지금 동기화"를 누르면 빠진 부분만 이어서 만듭니다.' })
                : d.note && d.status !== 'done' ? h('span', { class: 'ad-note', text: d.note }) : null,
            );
          }),
        );
      if (running || r.days.some((d) => d.status === 'running')) {
        dailyTimer = setTimeout(() => {
          if (document.body.contains(dailyList)) refreshDaily();
        }, 10000);
      }
    } catch (e) {
      dailyList.replaceChildren(h('li', { class: 'meta', text: `진행 상황을 불러오지 못했습니다: ${e.message || e}` }));
    }
  }
  dailyRefresh.addEventListener('click', refreshDaily);

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
      h('h1', { text: '관리' }),
      logout,
    ),
    h(
      'section',
      { class: 'point admin-sync' },
      h('h2', { text: '지금 동기화' }),
      h('p', { class: 'meta', text: '새 영상을 찾아 설교 정리를 만듭니다. 자동 수집(토론토): 주일예배 매주 일요일 밤 10:00. 새벽기도 · 수요예배 · 청년부예배는 자동 수집이 없어서 필요하면 아래에서 체크하고 직접 실행합니다. 전에 실패한 영상은 같은 구분의 다음 실행 때 먼저 다시 시도하고, 아직 올라오지 않은 예약 라이브는 건너뜁니다. 영상 1편에 몇 분씩 걸립니다.' }),
      h('div', { class: 'admin-row' }, h('span', { class: 'meta', text: '확인할 구분' }), catChecks),
      h('div', { class: 'admin-row' }, h('label', { class: 'meta', text: '한 번에 정리할 영상' }), syncMax, syncBtn),
      syncInfo,
    ),
    h(
      'section',
      { class: 'point admin-sync' },
      h('h2', { text: '오늘의 말씀 동기화' }),
      h('p', { class: 'meta', text: '자동: 매일 아침 7:00(토론토)에 다음 날 분량의 QT 묵상 · 성경공부 · 소그룹 나눔 · 퀴즈 · 공동체 성경읽기 영상을 미리 만듭니다. 아래 버튼은 과거 5일 ~ 미래 2일(8일치) 중 아직 없거나 실패한 날을 지금 만듭니다.' }),
      h('div', { class: 'admin-row' }, h('label', { class: 'ho-opt' }, dailyForce, '이미 만든 날도 다시 만들기'), dailyBtn),
      dailyInfo,
      h('div', { class: 'admin-row ad-head' }, h('h3', { text: '날짜별 진행 상황' }), dailyRefresh),
      dailyList,
    ),
    renderDawnSection(password, passwordRejected),
    renderVideoManager(password, passwordRejected, requestSync),
    renderModelSection(password, passwordRejected),
    renderBibleInfo(),
    h(
      'section',
      { class: 'point admin-add' },
      h('h2', { text: '재생목록 추가' }),
      h('div', { class: 'admin-fields' }, addCat, addUrl, addMax),
      h('div', { class: 'admin-row' }, addBtn),
      h('p', { class: 'meta', text: '추가하거나 바꾼 재생목록은 다음 자동 정리 때 반영됩니다. 바로 반영하려면 위의 "지금 동기화"를 누르세요.' }),
    ),
    status,
    h('h2', { class: 'admin-sub', text: '등록된 재생목록' }),
    list,
  );
  reload();
  refreshSync();
  refreshDaily();
}

/* ---------- 구글 로그인 + 개인 노트 ----------
   로그인: 구글 로그인(Google Identity Services)으로 받은 ID 토큰을 Apps Script에 보내면,
   서버가 토큰을 확인하고 "그 사람의" 노트만 읽고 씁니다. 화면에서 보이는 이름·이메일은 표시용일 뿐 신뢰하지 않습니다. */
const CLIENT_ID = (window.APP_CONFIG && window.APP_CONFIG.GOOGLE_CLIENT_ID) || '';
const NOTES_ENABLED = Boolean(CLIENT_ID && ADMIN_URL);
const SESSION_KEY = 'sn-session';
const auth = { token: '', user: null };
let currentNotes = null;
let expiredShown = false;

// 로그인 유지: 구글 로그인 직후 서버(Apps Script)가 30일짜리 앱 전용 로그인 토큰을 내려줍니다.
// 이 브라우저에는 그 토큰만 저장하고, 구글 ID 토큰(1시간짜리)은 저장하지 않습니다.
function setSession({ session, name, email, exp }) {
  if (!session || !exp || exp * 1000 <= Date.now()) return false;
  auth.token = session;
  auth.user = { name: name || email || '로그인됨', email: email || '', exp };
  expiredShown = false;
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ session, name, email, exp }));
  } catch {
    /* 저장 불가 환경(사생활 보호 모드 등): 이 탭을 닫기 전까지만 유지 */
  }
  return true;
}

function restoreSession() {
  try {
    const saved = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
    if (saved && !setSession(saved)) localStorage.removeItem(SESSION_KEY);
  } catch {
    /* 무시 */
  }
}

function clearSession() {
  auth.token = '';
  auth.user = null;
  state.noteIds = new Set();
  if (typeof gameState !== 'undefined') gameState = null; // 다른 사람이 로그인하면 그 사람 게임 기록을 새로 받습니다
  try {
    localStorage.removeItem(SESSION_KEY);
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
      if (currentMarks) await currentMarks.flush();
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
  const r = await adminPost({ action, session: auth.token, ...payload });
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
  // 구글이 준 1시간짜리 토큰을 서버에 보내 확인받고, 30일짜리 로그인 토큰으로 바꿔 받습니다.
  try {
    const r = await adminPost({ action: 'notes_login', id_token: resp && resp.credential });
    if (!r.ok) throw new Error(r.error || '로그인하지 못했습니다.');
    const user = r.user || {};
    if (!setSession({ session: r.session, name: user.name, email: user.email, exp: r.expires_at })) {
      throw new Error('로그인 정보를 받지 못했습니다.');
    }
  } catch (e) {
    toast(String(e.message || e), 6000);
    return;
  }
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



/* ---------- 글자 크기 (10~20pt) ---------- */
const FS_KEY = 'sn-fs';
const FS_MIN = 10;
const FS_MAX = 20;
const FS_DEFAULT = 16;
const clampFs = (v) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(FS_MAX, Math.max(FS_MIN, n)) : FS_DEFAULT;
};
function savedFs() {
  try {
    const n = parseInt(localStorage.getItem(FS_KEY), 10);
    if (n >= FS_MIN && n <= FS_MAX) return n; // 범위 밖·잘못된 값은 무시 (index.html 의 초기 적용과 같은 기준)
  } catch {
    /* 저장소를 못 쓰는 환경 */
  }
  return FS_DEFAULT;
}
function initFontControl() {
  const ytToggle = document.getElementById('yt-open');
  if (ytToggle) {
    ytToggle.checked = ytOpenPref();
    ytToggle.addEventListener('change', () => setYtOpenPref(ytToggle.checked));
  }
  const range = document.getElementById('fs-range');
  const out = document.getElementById('fs-out');
  const down = document.getElementById('fs-down');
  const up = document.getElementById('fs-up');
  if (!range || !out || !down || !up) return;
  const apply = (v, save) => {
    const n = clampFs(v);
    document.documentElement.style.setProperty('--fs', String(n));
    range.value = String(n);
    range.setAttribute('aria-valuetext', `${n}포인트`);
    out.textContent = `${n}pt`;
    down.disabled = n <= FS_MIN;
    up.disabled = n >= FS_MAX;
    if (save) {
      try {
        localStorage.setItem(FS_KEY, String(n));
      } catch {
        /* 저장하지 못해도 이번 화면에서는 적용됩니다 */
      }
    }
  };
  apply(savedFs(), false);
  range.addEventListener('input', () => apply(range.value, true));
  down.addEventListener('click', () => apply(Number(range.value) - 1, true));
  up.addEventListener('click', () => apply(Number(range.value) + 1, true));
}

/* ---------- 시작 ---------- */
(async function init() {
  initFontControl();
  let loadError = null;
  try {
    await load();
  } catch (e) {
    loadError = e;
  }
  const upd = document.getElementById('updated');
  const updatedAt = formatDateTime(state.updated);
  if (upd && updatedAt) upd.textContent = `설교 · 말씀 자료 업데이트 ${updatedAt}${state.demo ? ' (샘플 데이터)' : ''}`;
  showPushTime();
  window.addEventListener('hashchange', route);
  window.addEventListener('pagehide', () => {
    if (currentNotes) currentNotes.flush();
    if (currentMarks) currentMarks.flush();
  });
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
    // 목록 화면에만 "내 기록" 표시를 다시 그립니다. 설교 화면에서 입력 중인 내용은 건드리지 않습니다.
    fetchNoteIds().then(() => {
      const kind = location.hash.split('/')[1];
      if (kind !== 'v' && kind !== 'admin' && kind !== 'h') route();
    });
  }
})();
