// 말씀 노트 — 정적 웹앱 (빌드 도구 없음)
// 데이터: data/sermons.json (GitHub Actions가 Google Sheets에서 만들어 커밋)
// 화면 확인용 샘플: 주소 뒤에 ?demo 를 붙이면 data/sermons.sample.json 을 불러옵니다.

const CATEGORIES = [
  { key: 'dawn', label: '새벽기도' },
  { key: 'wednesday', label: '수요예배' },
  { key: 'sunday', label: '주일예배' },
];

const app = document.getElementById('app');
const state = { sermons: [], updated: null, demo: new URLSearchParams(location.search).has('demo'), query: '', noteIds: new Set(), music: null };

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

const catLabel = (key) => CATEGORIES.find((c) => c.key === key)?.label || key;
const thumbUrl = (id) => `https://i.ytimg.com/vi/${encodeURIComponent(id)}/mqdefault.jpg`;
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
async function load() {
  const file = state.demo ? 'data/sermons.sample.json' : 'data/sermons.json';
  const res = await fetch(`${file}?t=${Date.now()}`);
  if (!res.ok) throw new Error(`데이터를 불러오지 못했습니다 (${res.status})`);
  const data = await res.json();
  state.sermons = Array.isArray(data.sermons) ? data.sermons : [];
  state.updated = data.updated || null;
  // 기도 배경음악 목록 (없어도 괜찮습니다)
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

/* ---------- 라우팅: #/c/<구분>  #/v/<영상ID> ---------- */
function route() {
  const [, kind, arg] = location.hash.split('/');
  window.scrollTo(0, 0);
  // 다른 화면으로 넘어가기 전에, 아직 저장되지 않은 노트가 있으면 먼저 저장합니다.
  if (currentNotes) {
    currentNotes.flush();
    currentNotes = null;
  }
  teardownHandout();
  document.body.classList.toggle('handout-mode', kind === 'h');
  if (kind === 'admin') return renderAdminRoute();
  if (kind === 'h' && arg) return renderHandout(decodeURIComponent(arg));
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
  document.title = `${r.title || s.title} · 말씀 노트`;

  const ytUrl = safeYoutube(s.url, s.id);

  // 로그인했다면 이 설교의 개인 노트를 준비합니다 (로그인 전이면 null).
  const notes = NOTES_ENABLED && auth.user ? createNotes(s) : null;
  currentNotes = notes;

  const questionGroup = (title, arr) =>
    arr?.length ? h('div', { class: 'sg-group' }, h('h3', { text: title }), h('ol', { class: 'q' }, arr.map((q) => h('li', { text: q })))) : null;

  const sections = [];

  // 추천 찬양 (맨 앞)
  const worship = renderWorshipSection(r.worship_songs);
  if (worship) sections.push(worship);

  // 성경 본문 (여러 역본을 나란히)
  const passage = renderBibleBlock(r.bible);
  if (passage) sections.push(passage);

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
          h('div', { class: 'md' }, outlineParas(o).map((t) => mdBlocks(t))),
          outlineSummary(o) ? h('div', { class: 'keybox' }, h('strong', { class: 'keybox-label', text: '핵심 요약' }), h('p', {}, inlineMd(outlineSummary(o)))) : null,
        ),
      ),
      r.gospel_connection ? h('div', { class: 'gospel' }, h('h3', { text: '복음과의 연결' }), h('div', { class: 'md' }, mdBlocks(r.gospel_connection))) : null,
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
          r.applications.map((a, i) => h('div', { class: 'app-item' }, h('h3', {}, inlineMd(a.title)), h('div', { class: 'md' }, mdBlocks(a.detail)), notes ? notes.checkRow(i) : null)),
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
        h('ol', { class: 'q' }, r.meditation_questions.map((q, i) => h('li', {}, h('span', {}, inlineMd(q)), notes ? notes.answerBox(i) : null))),
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

  // 기도 배경음악
  const music = renderMusicSection(state.music);
  if (music) sections.push(music);

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

  sections.push(
    h(
      'footer',
      { class: 'sermon-foot' },
      h('p', { text: `참고: ${footnoteText(s.category)}` }),
      r.caveats ? h('p', { class: 'caveats', text: `유의: ${r.caveats}` }) : null,
      h('p', { class: 'ai-notice', text: AI_NOTICE }),
    ),
  );

  app.replaceChildren(
    h('a', { class: 'back', href: `#/c/${s.category}`, text: `← ${catLabel(s.category)} 목록` }),
    h(
      'div',
      { class: 'detail-head' },
      h('div', { class: 'meta' }, h('span', { class: 'chip', text: catLabel(s.category) }), formatDate(s.published_at), r.preacher ? ` · ${r.preacher}` : ''),
      h('h1', { text: r.title || s.title }),
      r.scripture?.length ? h('p', { class: 'meta', text: `본문 ${r.scripture.join(', ')}` }) : null,
      r.summary_short || r.theme ? h('div', { class: 'detail-theme', text: r.summary_short || r.theme }) : null,
      h(
        'div',
        { class: 'actions' },
        h('a', { class: 'btn primary', href: ytUrl, target: '_blank', rel: 'noopener noreferrer' }, '▶ 영상 보기'),
        h('a', { class: 'btn', href: `#/h/${encodeURIComponent(s.id)}` }, '핸드아웃 (PDF)'),
      ),
    ),
    h(
      'nav',
      { class: 'secnav', 'aria-label': '섹션 이동' },
      [['worship', '추천 찬양'], ['passage', '본문'], ['outline', '설교 정리'], ['apply', '삶의 적용'], ['meditate', '묵상'], ['group', '소그룹'], ['music', '기도 음악'], ['mynote', '내 메모']]
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
    if (run.state === 'running') return `⏳ 실행 중입니다${when ? ` (시작 ${when})` : ''}. 보통 몇 분 걸립니다.`;
    if (run.state === 'success') return `✅ 마지막 실행 완료${when ? ` (${when})` : ''}. 앱에는 1~2분 뒤 반영되니 새로고침해 보세요.`;
    if (run.state === 'failed') return `⚠️ 마지막 실행이 실패했습니다${when ? ` (${when})` : ''}. 자세한 내용은 GitHub Actions 기록을 확인하세요.`;
    return '아직 실행 기록이 없습니다.';
  };
  const renderSync = (run) => {
    syncInfo.replaceChildren(syncText(run));
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
  async function requestSync(count) {
    syncBtn.disabled = true;
    syncInfo.textContent = '실행을 요청하는 중…';
    try {
      const r = await adminPost({ action: 'sync_run', password, max_new: String(count) });
      if (passwordRejected(r)) return false;
      if (!r.ok) throw new Error(r.error || '실행하지 못했습니다.');
      syncInfo.textContent = '⏳ 실행을 요청했습니다. 잠시 뒤 상태가 표시됩니다…';
      // GitHub가 실행을 등록하기까지 몇 초 걸립니다. 그 사이 이전 기록이 보이지 않게 잠시 기다립니다.
      syncTimer = setTimeout(refreshSync, 6000);
      return true;
    } catch (e) {
      syncInfo.textContent = `오류: ${e.message || e}`;
      syncBtn.disabled = false;
      return false;
    }
  }
  syncBtn.addEventListener('click', () => requestSync(syncMax.value));

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
      { class: 'point admin-sync' },
      h('h2', { text: '지금 동기화' }),
      h('p', { class: 'meta', text: '새 영상을 찾아 설교 정리를 만듭니다. 자동으로는 매일 아침 7:30(토론토)에 실행되고, 전에 실패한 영상은 그때 먼저 다시 시도합니다. 아직 영상이 올라오지 않은 예약 라이브는 건너뜁니다. 영상 1편에 몇 분씩 걸립니다.' }),
      h('div', { class: 'admin-row' }, h('label', { class: 'meta', text: '한 번에 정리할 영상' }), syncMax, syncBtn),
      syncInfo,
    ),
    renderVideoManager(password, passwordRejected, requestSync),
    renderModelSection(password, passwordRejected),
    renderBibleSection(password, passwordRejected),
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

/* ---------- 글자 크기 (10~20pt) ---------- */
const FS_KEY = 'sn-fs';
const FS_MIN = 10;
const FS_MAX = 20;
const FS_DEFAULT = 14;
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
  if (upd && updatedAt) upd.textContent = `마지막 업데이트 ${updatedAt}${state.demo ? ' (샘플 데이터)' : ''}`;
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
