// 설교 내용을 화면·핸드아웃에 그리는 공통 도구 (app.js, handout.js 가 함께 씁니다)
// innerHTML 을 쓰지 않으므로 AI가 만든 글이 코드로 해석되지 않습니다.

// 화면에 보이는 순서: 주일예배 → 새벽기도 → 수요예배 → 청년부예배 (사용자 영상은 따로 [사용자 영상] 메뉴)
const CATEGORIES = [
  { key: 'sunday', label: '주일예배' },
  { key: 'dawn', label: '새벽기도' },
  { key: 'wednesday', label: '수요예배' },
  { key: 'youth', label: '청년부예배' },
];
const EVENT_NAMES = { sunday: '주일예배', dawn: '새벽기도회', wednesday: '수요예배', youth: '청년부예배', user: '사용자 영상' };
const eventName = (cat) => EVENT_NAMES[cat] || '예배';
const catLabel = (key) => (key === 'user' ? '사용자 영상' : CATEGORIES.find((c) => c.key === key)?.label || key);
const footnoteText = (cat) => (cat === 'user' ? '직접 올린 영상에서 설교 본문과 메시지를 중심으로 정리하였습니다.' : `${eventName(cat)} 영상으로 설교 전 찬송, 사도신경, 마침기도 등 의전 순서를 제외하고 설교 본문과 메시지를 중심으로 정리하였습니다.`);

// 4가지 보기 방식 (화면 위 탭 · 핸드아웃 공통)
const MODES = [
  { key: 'review', label: '설교리뷰' },
  { key: 'qt', label: 'QT 묵상' },
  { key: 'study', label: '성경공부' },
  { key: 'group', label: '소그룹 나눔' },
];
const modeLabel = (key) => MODES.find((m) => m.key === key)?.label || key;

/* ---------- 간단한 마크다운 (굵게 · 인용 · 목록) ---------- */
function inlineMd(text) {
  const out = [];
  String(text || '')
    .split(/\*\*(.+?)\*\*/g)
    .forEach((part, i) => {
      if (!part) return;
      out.push(i % 2 ? h('strong', { text: part }) : part.replace(/\*(?!\s)([^*]+?)\*/g, '$1'));
    });
  return out;
}

function mdBlocks(text) {
  const blocks = [];
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  let para = [];
  let quote = [];
  let items = [];
  const flush = () => {
    if (para.length) blocks.push(h('p', {}, inlineMd(para.join(' '))));
    if (quote.length) blocks.push(h('blockquote', {}, quote.map((q) => h('p', {}, inlineMd(q)))));
    if (items.length) blocks.push(h('ul', {}, items.map((i) => h('li', {}, inlineMd(i)))));
    para = [];
    quote = [];
    items = [];
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      flush();
      continue;
    }
    let m;
    if ((m = line.match(/^>\s?(.*)$/))) {
      if (para.length || items.length) flush();
      if (m[1]) quote.push(m[1]);
    } else if ((m = line.match(/^(?:[-*•]|\d+[.)])\s+(.*)$/))) {
      if (para.length || quote.length) flush();
      items.push(m[1]);
    } else if ((m = line.match(/^#{1,6}\s+(.*)$/))) {
      flush();
      blocks.push(h('p', {}, h('strong', { text: m[1].replace(/\*\*/g, '') })));
    } else {
      if (quote.length || items.length) flush();
      para.push(line);
    }
  }
  flush();
  return blocks;
}

const splitParas = (text) =>
  String(text || '')
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

// 대지의 문단들 (새 형식 paragraphs, 옛 형식 content 모두 지원)
const outlineParas = (o) => (Array.isArray(o.paragraphs) && o.paragraphs.length ? o.paragraphs : splitParas(o.content));
const outlineSummary = (o) => o.key_summary || o.key_quote || '';

/* ---------- 영상 ID · 링크 ---------- */
/** 화면·PDF에 쓸 깔끔한 제목: "[2026.10.04] 믿음의 길 (창 12:1-9) - 홍길동 목사" → "믿음의 길" (본문 괄호는 성경 책 이름으로 시작할 때만 뗍니다) */
const BOOK_START = /^(창세기|출애굽기|레위기|민수기|신명기|여호수아|사사기|룻기|사무엘|열왕기|역대|에스라|느헤미야|에스더|욥기|시편|잠언|전도서|아가|이사야|예레미야|에스겔|다니엘|호세아|요엘|아모스|오바댜|요나|미가|나훔|하박국|스바냐|학개|스가랴|말라기|마태|마가|누가|요한|사도행전|로마서|고린도|갈라디아서|에베소서|빌립보서|골로새서|데살로니가|디모데|디도서|빌레몬서|히브리서|야고보서|베드로|유다서|요한계시록|창|출|레|민|신|수|삿|룻|삼상|삼하|왕상|왕하|대상|대하|스|느|에|욥|시|잠|전|사|렘|애|겔|단|호|욜|암|옵|욘|미|나|합|습|학|슥|말|마|막|눅|요|행|롬|고전|고후|갈|엡|빌|골|살전|살후|딤전|딤후|딛|몬|히|약|벧전|벧후|요일|요이|요삼|유|계)\s*\d/;
function tidyTitle(raw) {
  let s = String(raw || '').trim();
  if (!s.startsWith('[')) return s; // [날짜]로 시작하는 유튜브 제목 형식일 때만 뗍니다
  const t0 = s;
  s = s.replace(/^\[\s*\d{4}\s*[.\-/]\s*\d{1,2}\s*[.\-/]\s*\d{1,2}\s*\]\s*/, '');
  s = s.replace(/\s[-–—]\s+[^-–—]+$/, '');
  const m = /\(([^()]+)\)\s*$/.exec(s);
  if (m && BOOK_START.test(m[1].trim())) s = s.slice(0, m.index).trim();
  return s.trim() || t0;
}


const CAT_TITLE_LABEL = { sunday: '주일예배', dawn: '새벽기도', wednesday: '수요예배', youth: '청년부예배' };
const GENERIC_TITLE = /^(주일|새벽|수요|청년부?|청년\d?부)(오전|낮|저녁|\d부|\d차)?(예배|기도회|기도|말씀)?$/;
const isGenericTitle = (t) => {
  const k = String(t || '').replace(/\s+/g, '');
  return !k || GENERIC_TITLE.test(k);
};

/** 설교자 이름 통일: "전대혁" · "전대혁 담임목사" · "토론토영락교회 전대혁" → "전대혁 목사" (전도사·강도사·장로·선교사·교수는 그 직함을 그대로 둠) */
const PREACHER_ROLE = '(?:목사|전도사|강도사|장로|선교사|교수|박사)';
const PREACHER_MOD = '(?:담임|부|협동|원로|객원|초청|수석|선임|청년부|청년1부)';
function normalizeOnePreacher(raw) {
  let s = String(raw || '').replace(/[()[\]]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s || !/[가-힣]/.test(s)) return s;
  s = s.replace(/^(설교자|설교|강사|말씀)\s*[:：]\s*/, '').replace(/^(토론토\s*)?영락\s*교회\s*/, '').trim();
  let role = '';
  const lead = new RegExp(`^(?:${PREACHER_MOD}\\s*)*(${PREACHER_ROLE})\\s+`).exec(s);
  if (lead) {
    role = lead[1];
    s = s.slice(lead[0].length);
  }
  const trail = new RegExp(`\\s*(?:${PREACHER_MOD}\\s*)*(${PREACHER_ROLE})\\s*님?$`).exec(s);
  if (trail) {
    role = role || trail[1];
    s = s.slice(0, trail.index);
  }
  s = s.replace(/님$/, '').trim();
  if (!s) return '';
  return `${s} ${role && role !== '목사' ? role : '목사'}`;
}
function normalizePreacher(raw) {
  const parts = String(raw || '').split(/\s*[,/·&]\s*|\s+및\s+/).filter((x) => x.trim());
  return parts.map(normalizeOnePreacher).filter(Boolean).join(', ');
}

/** 설교 제목 통일: "주일예배 - 설교제목". 제목이 없으면(새벽기도 등) 성경 본문을 씁니다. 사용자 영상은 구분 이름을 붙이지 않습니다. */
function displayTitle({ category, title, aiTitle = '', scripture = '' }) {
  const label = CAT_TITLE_LABEL[category];
  const t = String(title || '').trim();
  if (label && /^(주일예배|새벽기도회?|수요예배|청년부예배)\s[-–—]\s\S/.test(t)) return t; // 이미 통일된 형식
  const pick = (x) => (isGenericTitle(x) ? '' : String(x).trim());
  const core = pick(t) || (category === 'dawn' ? '' : pick(aiTitle)) || String(scripture || '').trim() || t || String(aiTitle || '').trim();
  return label && core ? `${label} - ${core}` : core;
}

const ytId = (v) => (/^[A-Za-z0-9_-]{11}$/.test(String(v || '')) ? String(v) : '');
// youtube.com 주소를 씁니다 (youtube-nocookie 가 아님): 그래야 이 브라우저에서 로그인한 유튜브 계정(프리미엄 광고 제거)이 퍼가기 재생에도 적용될 수 있습니다.
// 브라우저가 제3자 쿠키를 막은 환경(사파리, 크롬 시크릿 등)에서는 광고가 보일 수 있어서, 항상 "YouTube에서 열기" 링크를 함께 둡니다.
const ytEmbed = (id, { autoplay = true } = {}) => `https://www.youtube.com/embed/${id}?rel=0&modestbranding=1&playsinline=1${autoplay ? '&autoplay=1' : ''}`;
const ytWatch = (id) => `https://www.youtube.com/watch?v=${id}`;
const ytSearch = (q) => `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;

function embedPlayer(id, title, opts) {
  return h('iframe', {
    class: 'yt-frame',
    src: ytEmbed(id, opts),
    title: title || '유튜브 영상',
    allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen',
    allowfullscreen: true,
    referrerpolicy: 'strict-origin-when-cross-origin',
  });
}

/* 프리미엄 광고: 퍼가기(임베드) 재생은 브라우저가 제3자 쿠키를 막으면 프리미엄 로그인이 적용되지 않아 광고가 나옵니다.
   그런 기기에서는 "항상 YouTube에서 열기"를 켜 두면 재생 버튼이 유튜브(앱/사이트)를 바로 열어 프리미엄이 그대로 적용됩니다. */
const YT_OPEN_KEY = 'sn-yt-open';
function ytOpenPref() {
  try {
    return localStorage.getItem(YT_OPEN_KEY) === '1';
  } catch {
    return false;
  }
}
function setYtOpenPref(on) {
  try {
    localStorage.setItem(YT_OPEN_KEY, on ? '1' : '0');
  } catch {
    /* 저장하지 못해도 이번 화면에서는 적용됩니다 */
  }
  document.querySelectorAll('.yt-open-toggle').forEach((el) => {
    el.checked = on;
  });
}
/** 재생 시작: 선택에 따라 YouTube를 새 탭으로 열거나, 이 화면 안에서 재생합니다. 새 탭을 열었으면 true */
function startPlayback(id, title, stage) {
  if (ytOpenPref()) {
    window.open(ytWatch(id), '_blank', 'noopener');
    return true;
  }
  stage.replaceChildren(embedPlayer(id, title), h('p', { class: 'meta', text: PLAYER_HELP }), h('button', { class: 'btn small', type: 'button', onclick: () => { setYtOpenPref(true); toast('앞으로 재생 버튼은 YouTube를 바로 엽니다 (화면 맨 아래에서 바꿀 수 있어요)'); } }, '광고가 나와요 → 앞으로 항상 YouTube에서 열기'));
  return false;
}

const PLAYER_HELP = '광고가 나오거나 프리미엄 로그인이 적용되지 않으면 "YouTube에서 열기"를 눌러 주세요. 이 화면의 영상은 이 브라우저에서 로그인한 유튜브 계정을 따릅니다.';

/* ---------- 성경 본문: 4역본 전환 보기 ---------- */
const BIBLE_VERSIONS = [
  { id: 'GAE', label: '개역개정' },
  { id: 'NIV', label: 'NIV' },
  { id: 'SAE', label: '표준새번역' },
  { id: 'MSG', label: '메시지 성경' },
];
const BIBLE_PREF_KEY = 'sn-bible';
const DEFAULT_BIBLE = 'GAE';

function savedBibleId() {
  try {
    const v = localStorage.getItem(BIBLE_PREF_KEY);
    return BIBLE_VERSIONS.some((b) => b.id === v) ? v : DEFAULT_BIBLE;
  } catch {
    return DEFAULT_BIBLE;
  }
}
function rememberBibleId(id) {
  try {
    localStorage.setItem(BIBLE_PREF_KEY, id);
  } catch {
    /* 저장하지 못해도 이번 화면에서는 적용됩니다 */
  }
}

// 역본 하나의 본문 (구절 번호 + 본문)
function bibleVersionBody(v) {
  return [
    ...(v.passages || []).map((p) =>
      h(
        'div',
        { class: 'bible-passage' },
        p.reference ? h('p', { class: 'ref', text: p.reference }) : null,
        h('div', { class: `bible-text${v.lang === 'en' ? ' en' : ''}` }, (p.verses || []).map((x) => h('p', { class: 'verse' }, h('sup', { class: 'vn', text: String(x.n) }), ' ', x.text))),
      ),
    ),
    v.truncated ? h('p', { class: 'meta', text: '분량이 길어 앞부분만 보여 드립니다.' }) : null,
  ];
}

/** 개역개정 낭독 듣기: 유튜브에 올라온 음원(드라마바이블 등)을 찾았으면 앱 안에서 재생, 못 찾았으면 유튜브 검색 링크 */
function renderBibleAudio(bible, gae) {
  const first = gae && gae.passages && gae.passages[0] && gae.passages[0].reference;
  const m = /^(.+?)\s+(\d+)/.exec(first || '');
  const chapterRef = m ? `${m[1]} ${m[2]}${m[1] === '시편' ? '편' : '장'}` : first || '';
  const items = ((bible && bible.audio) || []).filter((a) => ytId(a.video_id));
  const wrap = h('div', { class: 'bible-audio' }, h('p', { class: 'meta', text: '개역개정 낭독을 들어 보세요. 유튜브에 올라온 음원(예: 드라마바이블)으로 연결합니다.' }));
  items.forEach((a) => {
    const stage = h('div', { class: 'audio-stage' });
    const play = h('button', { class: 'btn primary', type: 'button', onclick: (e) => { if (!startPlayback(a.video_id, `${a.reference} 낭독`, stage)) e.currentTarget.hidden = true; } }, `🎧 ${a.reference} 듣기`);
    wrap.append(h('div', { class: 'audio-item' }, h('div', { class: 'actions' }, play, h('a', { class: 'btn', href: ytWatch(a.video_id), target: '_blank', rel: 'noopener noreferrer' }, 'YouTube에서 열기')), a.title ? h('p', { class: 'meta', text: `${a.title}${a.channel ? ` · ${a.channel}` : ''}` }) : null, stage));
  });
  if (!items.length && chapterRef) wrap.append(h('div', { class: 'actions' }, h('a', { class: 'btn', href: ytSearch(`드라마바이블 ${chapterRef}`), target: '_blank', rel: 'noopener noreferrer' }, `🎧 ${chapterRef} 듣기 (YouTube에서 찾기)`)));
  return wrap;
}

/** 성경 본문 보기: 개역개정 · NIV · 표준새번역 · 메시지 성경 버튼으로 하나씩 바꿔 봅니다 (동시에 한 역본만 보임) */
function renderBibleViewer(bible, { open = true, id = 'passage' } = {}) {
  const versions = (bible && bible.versions) || [];
  const byId = new Map(versions.map((v) => [v.id, v]));
  const head = h('div', { class: 'block-head' }, h('h2', { text: '성경 본문' }));
  if (!versions.length) {
    return h('section', { class: 'block', id }, head, h('p', { class: 'note-hint', text: '성경 본문을 아직 가져오지 못했습니다. 다음 동기화 때 자동으로 붙습니다.' }));
  }
  const wanted = savedBibleId();
  let current = byId.has(wanted) ? wanted : byId.has(DEFAULT_BIBLE) ? DEFAULT_BIBLE : versions[0].id;
  const body = h('div', { class: 'bible-body', role: 'tabpanel' });
  const buttons = BIBLE_VERSIONS.map((b) => {
    const has = byId.has(b.id);
    const btn = h('button', { class: 'bible-tab', type: 'button', role: 'tab', disabled: !has, title: has ? '' : '이 역본은 가져오지 못했습니다' }, b.label);
    btn.addEventListener('click', () => show(b.id, true));
    return [b.id, btn];
  });
  function show(vid, save) {
    current = vid;
    if (save) rememberBibleId(vid);
    buttons.forEach(([bid, btn]) => btn.setAttribute('aria-selected', String(bid === vid)));
    body.replaceChildren(...bibleVersionBody(byId.get(vid)).filter(Boolean), ...(vid === 'GAE' ? [renderBibleAudio(bible, byId.get(vid))] : []));
  }
  show(current, false);
  const credits = versions.filter((v) => v.copyright).map((v) => h('li', {}, h('strong', { text: `${v.label}  ` }), v.copyright, v.source ? ` (출처: ${v.source})` : ''));
  const content = [h('div', { class: 'bible-tabs', role: 'tablist', 'aria-label': '성경 역본' }, buttons.map(([, b]) => b)), body, h('details', { class: 'bible-credit' }, h('summary', { text: '저작권 · 제공처' }), h('ul', {}, credits))];
  if (open) return h('section', { class: 'block', id }, head, content);
  return h('section', { class: 'block', id }, h('details', { class: 'fold' }, h('summary', {}, h('h2', { text: '성경 본문 보기' })), content));
}

/* ---------- 기도문 ---------- */
function renderPrayer(title, text, id) {
  if (!text) return null;
  return h('section', { class: 'block', id }, h('div', { class: 'prayer' }, h('h2', { text: title }), h('div', { class: 'prayer-text md' }, splitParas(text).map((t) => h('p', {}, inlineMd(t))))));
}

/* ---------- 추천 찬양 (찬송가 1 + CCM 1) ---------- */
function renderWorshipSection(songs, { title = '찬양', intro = '말씀을 묵상하며 함께 부르면 좋은 찬양입니다. AI가 추천한 것이라 곡 정보가 정확하지 않을 수 있습니다.', id = 'worship' } = {}) {
  if (!songs || !songs.length) return null;
  return h(
    'section',
    { class: 'block', id },
    h('h2', { text: title }),
    h('p', { class: 'meta', text: intro }),
    h(
      'div',
      { class: 'songs' },
      songs.map((s) => {
        const vid = ytId(s.video_id);
        const stage = h('div', { class: 'song-stage' });
        const play = vid
          ? h('button', {
              class: 'btn primary',
              type: 'button',
              onclick: (e) => {
                if (!startPlayback(vid, `${s.title} 찬양`, stage)) e.currentTarget.hidden = true;
              },
            }, '▶ 듣기')
          : null;
        const link = h('a', { class: 'btn', href: vid ? ytWatch(vid) : ytSearch(`${s.title} ${s.artist || ''}`.trim()), target: '_blank', rel: 'noopener noreferrer' }, vid ? 'YouTube에서 열기' : 'YouTube에서 찾기');
        return h(
          'article',
          { class: 'song' },
          h('div', { class: 'song-head' }, h('h3', { text: s.title }), s.kind ? h('span', { class: `chip kind-${s.kind === 'CCM' ? 'ccm' : 'hymn'}`, text: s.kind }) : null),
          s.artist ? h('p', { class: 'meta', text: s.artist }) : null,
          s.reason ? h('p', { class: 'song-reason', text: s.reason }) : null,
          h('div', { class: 'actions' }, play, link),
          stage,
        );
      }),
    ),
  );
}

/* ---------- 기도 배경음악 (QT 묵상용) — 설교마다 목록에서 한 곡씩 다르게 골라 보여 줍니다 ---------- */
function pickBySeed(list, seed) {
  let n = 0;
  for (const ch of String(seed || '')) n = (n * 31 + ch.charCodeAt(0)) >>> 0;
  return list[n % list.length];
}
function renderMusicSection(music, seed) {
  const tracks = ((music && music.tracks) || []).filter((t) => ytId(t.id));
  if (!tracks.length) return null;
  const t = pickBySeed(tracks, seed);
  const stage = h('div', { class: 'music-stage' });
  const play = h('button', {
    class: 'btn primary',
    type: 'button',
    onclick: (e) => {
      if (!startPlayback(t.id, t.title, stage)) e.currentTarget.hidden = true;
    },
  }, '▶ 듣기');
  return h(
    'section',
    { class: 'block', id: 'music' },
    h('h2', { text: '묵상 음악' }),
    h('p', { class: 'meta', text: '조용히 말씀을 묵상하거나 기도할 때 틀어 두세요. 잔잔한 MR·연주 음악입니다. 다른 곳으로 이동하면 음악이 멈춥니다.' }),
    h('article', { class: 'song' }, h('div', { class: 'song-head' }, h('h3', { text: t.title })), h('p', { class: 'meta', text: `${t.channel || ''}${t.minutes ? ` · ${t.minutes}분` : ''}` }), h('div', { class: 'actions' }, play, h('a', { class: 'btn', href: ytWatch(t.id), target: '_blank', rel: 'noopener noreferrer' }, 'YouTube에서 열기')), stage),
  );
}

/* ---------- 설교 정리 한 대지 ---------- */
function renderPoint(o, extra) {
  return h(
    'div',
    { class: 'point' },
    h('h3', { text: o.heading }),
    o.scripture ? h('p', { class: 'ref', text: o.scripture }) : null,
    h('div', { class: 'md' }, outlineParas(o).map((t) => mdBlocks(t))),
    outlineSummary(o) ? h('div', { class: 'keybox' }, h('strong', { class: 'keybox-label', text: '핵심 요약' }), h('p', {}, inlineMd(outlineSummary(o)))) : null,
    extra || null,
  );
}

/* ---------- 정답 보기 토글 ---------- */
function revealBox(label, content, { hiddenLabel = '답보기', shownLabel = '답 감추기' } = {}) {
  const box = h('div', { class: 'reveal-box', hidden: true }, content);
  box.hidden = true;
  const btn = h('button', { class: 'btn small', type: 'button', 'aria-expanded': 'false' }, hiddenLabel || label);
  btn.addEventListener('click', () => {
    box.hidden = !box.hidden;
    btn.textContent = box.hidden ? hiddenLabel : shownLabel;
    btn.setAttribute('aria-expanded', String(!box.hidden));
  });
  return { btn, box };
}
