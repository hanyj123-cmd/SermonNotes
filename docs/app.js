// 말씀 노트 — 정적 웹앱 (빌드 도구 없음)
// 데이터: data/sermons.json (GitHub Actions가 Google Sheets에서 만들어 커밋)
// 화면 확인용 샘플: 주소 뒤에 ?demo 를 붙이면 data/sermons.sample.json 을 불러옵니다.

const CATEGORIES = [
  { key: 'dawn', label: '새벽기도' },
  { key: 'wednesday', label: '수요예배' },
  { key: 'sunday', label: '주일예배' },
];

const app = document.getElementById('app');
const state = { sermons: [], updated: null, demo: new URLSearchParams(location.search).has('demo'), query: '' };

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
              h('div', { class: 'meta' }, (r.scripture || [])[0] ? h('span', { class: 'chip', text: r.scripture[0] }) : null, formatDate(s.published_at)),
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
        h('div', { class: 'apps' }, r.applications.map((a) => h('div', { class: 'app-item' }, h('h3', { text: a.title }), h('p', { text: a.detail })))),
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
        h('ol', { class: 'q' }, r.meditation_questions.map((q) => h('li', { text: q }))),
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
      [['outline', '설교 정리'], ['apply', '삶의 적용'], ['meditate', '묵상'], ['group', '소그룹']]
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
}

/* ---------- 시작 ---------- */
(async function init() {
  try {
    await load();
  } catch (e) {
    app.replaceChildren(h('div', { class: 'empty' }, h('p', {}, h('strong', { text: '데이터를 불러오지 못했습니다.' })), h('p', { text: String(e.message || e) })));
    return;
  }
  const upd = document.getElementById('updated');
  if (upd && state.updated) upd.textContent = `최근 갱신: ${state.updated.slice(0, 10)}${state.demo ? ' (샘플 데이터)' : ''}`;
  window.addEventListener('hashchange', route);
  route();
})();
