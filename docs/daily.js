// 오늘의 말씀 읽기
//   #/r                     오늘(이 기기 날짜) 분량
//   #/r/2026-10-08[/모드]    그 날짜 · 모드: read(말씀) | qt | study | group | quiz
// 본문은 토론토영락교회 앱의 성경 서버에서 바로 가져오고(개역개정 · NIV · 표준새번역),
// QT 묵상 · 성경공부 · 소그룹 나눔 · 퀴즈 · 카톡용 요약은 매일 새벽 동기화가 만든 data/daily/<날짜>.json 을 씁니다.
// 이 파일은 app.js(h, state, toast, copyText, auth, notesCall), detail.js(렌더러, dataBase), notes.js, marks.js, game.js 를 씁니다.

const YN_BIBLE_API = 'https://ynchurch.com/ync/web/getBibleVerses/';
const READ_VERSIONS = [
  ['KNKRV', '개역개정'],
  ['NIV', 'NIV'],
  ['KSTNR', '표준새번역'],
];
const READ_MODES = [
  ['read', '말씀'],
  ['qt', 'QT 묵상'],
  ['study', '성경공부'],
  ['group', '소그룹 나눔'],
  ['quiz', '퀴즈'],
];
const READ_VER_KEY = 'sn-read-ver';
const dailyCache = new Map(); // 날짜 → AI 정리(JSON) | null
const readingCache = new Map(); // 날짜|역본 → 본문
let dailyIndexCache = null;

const pad2 = (n) => String(n).padStart(2, '0');
function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && !isNaN(Date.parse(`${s}T12:00:00Z`));
function addDays(date, n) {
  return new Date(Date.parse(`${date}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
}
function dateLabel(date, withDow = true) {
  const d = new Date(`${date}T12:00:00Z`);
  return `${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일${withDow ? ` ${['일', '월', '화', '수', '목', '금', '토'][d.getUTCDay()]}요일` : ''}`;
}
const dailyIdOf = (date) => `bible-${date.replace(/-/g, '')}`;
const dateOfDailyId = (id) => {
  const m = /^bible-(\d{4})(\d{2})(\d{2})$/.exec(id);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
};
function savedReadVersion() {
  try {
    const v = localStorage.getItem(READ_VER_KEY);
    return READ_VERSIONS.some(([id]) => id === v) ? v : 'KNKRV';
  } catch {
    return 'KNKRV';
  }
}

/* ---------- 데이터 ---------- */
async function loadDailyIndex() {
  if (dailyIndexCache) return dailyIndexCache;
  try {
    const r = await fetch(`${dataBase()}daily/index.json?t=${Date.now()}`);
    dailyIndexCache = r.ok ? (await r.json()).days || [] : [];
  } catch {
    dailyIndexCache = [];
  }
  return dailyIndexCache;
}
async function loadDaily(date) {
  if (dailyCache.has(date)) return dailyCache.get(date);
  let data = null;
  try {
    const r = await fetch(`${dataBase()}daily/${date}.json?t=${Math.floor(Date.now() / 600000)}`);
    if (r.ok) data = await r.json();
  } catch {
    data = null;
  }
  dailyCache.set(date, data);
  return data;
}
/** 교회 성경 서버에서 그날 본문 (실패하면 null) */
async function fetchReadingLive(date, version) {
  const key = `${date}|${version}`;
  if (readingCache.has(key)) return readingCache.get(key);
  try {
    const body = JSON.stringify({ accessLevel: 'PUBLIC', forTodayVerses: false, readingDate: date.replace(/-/g, ''), queryList: [{}], languageCode: 'KR', version });
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    const r = await fetch(YN_BIBLE_API, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body, signal: ctrl.signal });
    clearTimeout(timer);
    if (!r.ok) throw new Error(String(r.status));
    const j = await r.json();
    const out = [];
    for (const b of j.bibleVerses || []) {
      for (const c of b.chapters || []) {
        const verses = (c.verses || []).map((v) => ({ n: Number(v.verseNo), text: String(v.verse || '').replace(/\s+/g, ' ').trim() })).filter((v) => v.n > 0 && v.text);
        if (verses.length) out.push({ bookId: String(b.bookID || '').padStart(2, '0'), book: String(b.bookName || '').trim(), chapter: Number(c.chapterNo), verses });
      }
    }
    readingCache.set(key, out);
    return out;
  } catch {
    return null;
  }
}
function refsOf(passages) {
  const groups = [];
  for (const p of passages || []) {
    const last = groups[groups.length - 1];
    if (last && last.book === p.book && last.to + 1 === p.chapter) last.to = p.chapter;
    else groups.push({ book: p.book, from: p.chapter, to: p.chapter });
  }
  return groups.map((g) => (g.from === g.to ? `${g.book} ${g.from}장` : `${g.book} ${g.from}-${g.to}장`)).join(' · ');
}
const chapterKeysOf = (passages) => (passages || []).map((p) => `${Number(p.bookId)}:${p.chapter}`);
/** 홈 화면용: 오늘 분량이 아직 없으면 가장 최근 날짜 */
async function pickDailyDate() {
  const today = localToday();
  const idx = await loadDailyIndex();
  if (!idx.length || idx.some((d) => d.date === today)) return today;
  const past = idx.find((d) => d.date <= today);
  return past ? past.date : today;
}

/* ---------- 카톡 메시지 ---------- */
function dailyShareUrl(date) {
  return `${location.origin}${location.pathname.replace(/index\.html$/, '')}#/r/${date}`;
}
function kakaoText(date, refs, data) {
  const lines = [`📖 오늘의 말씀 · ${dateLabel(date)}`, refs];
  const sums = (data && data.summaries) || [];
  if (sums.length) {
    lines.push('');
    sums.forEach((s) => lines.push(`▪ ${s.reference} — ${s.summary}`));
  }
  const kv = data && data.key_verse;
  if (kv && kv.text) lines.push('', '✝ 오늘의 구절', `"${kv.text}" (${kv.reference})`);
  const vids = (data && data.videos) || [];
  if (vids.length) {
    lines.push('', '🎧 공동체 성경읽기');
    vids.forEach((v) => lines.push(`${v.reference}  https://youtu.be/${v.video_id}`));
  }
  lines.push('', `말씀결에서 함께 읽기 ▶ ${dailyShareUrl(date)}`);
  return lines.join('\n');
}
function kakaoBox(date, refs, data, { open = false } = {}) {
  const text = kakaoText(date, refs, data);
  const pre = h('pre', { class: 'rd-kakao-text', text });
  const copy = h('button', { class: 'btn primary', type: 'button' }, '메시지 복사');
  copy.addEventListener('click', () => copyText(text));
  const share = navigator.share ? h('button', { class: 'btn', type: 'button' }, '바로 보내기') : null;
  if (share) share.addEventListener('click', () => navigator.share({ text }).catch(() => {}));
  const box = h('details', { class: 'rd-kakao', open }, h('summary', {}, h('span', { class: 'rd-kakao-ic', 'aria-hidden': 'true', text: 'K' }), h('span', {}, h('strong', { text: '카톡으로 보내기' }), h('span', { class: 'meta', text: '날짜 · 본문 · 요약 · 공동체 성경읽기 링크를 담은 메시지' }))), pre, h('div', { class: 'gm-row' }, copy, share), h('p', { class: 'meta', text: share ? '"바로 보내기"를 누르면 휴대폰의 공유 창에서 카카오톡을 고를 수 있어요.' : '복사한 뒤 카카오톡 대화방에 붙여 넣으세요.' }));
  return box;
}

/* ---------- 화면 ---------- */
async function renderDaily(dateArg, modeArg) {
  const date = isDate(dateArg) ? dateArg : localToday();
  const mode = READ_MODES.some(([k]) => k === modeArg) ? modeArg : 'read';
  const id = dailyIdOf(date);
  document.title = `오늘의 말씀 · ${dateLabel(date, false)} · 말씀결`;
  app.replaceChildren(h('div', { class: 'gm rd' }, h('p', { class: 'loading', text: '오늘의 말씀을 불러오는 중…' })));
  const [data, live] = await Promise.all([loadDaily(date), fetchReadingLive(date, 'KNKRV')]);
  if (!location.hash.startsWith('#/r') && location.hash !== '') return;
  let st = null;
  try {
    st = await ensureGameState();
  } catch {
    st = null;
  }
  const passages = live && live.length ? live : (data && data.passages) || [];
  const refs = (data && data.refs) || refsOf(passages);
  const today = localToday();
  const isToday = date === today;
  const readDone = !!(st && st.readDays && st.readDays[date]);
  const quizDone = st && st.quizzes && st.quizzes[id];

  const nav = h(
    'div',
    { class: 'rd-datenav' },
    h('a', { class: 'rd-navbtn', href: `#/r/${addDays(date, -1)}/${mode}`, 'aria-label': '전날' }, '‹', h('span', { text: '전날' })),
    h('div', { class: 'rd-date' }, h('span', { text: dateLabel(date) }), isToday ? h('em', { text: '오늘' }) : h('a', { href: `#/r/${today}/${mode}`, text: '오늘로' })),
    h('a', { class: 'rd-navbtn next', href: `#/r/${addDays(date, 1)}/${mode}`, 'aria-label': '다음날' }, h('span', { text: '다음날' }), '›'),
  );
  const head = h(
    'header',
    { class: 'rd-head' },
    nav,
    h('h1', { class: 'rd-refs', text: refs || '읽기 분량을 찾지 못했어요' }),
    data && data.key_verse && data.key_verse.text ? h('blockquote', { class: 'rd-verse' }, h('p', { text: data.key_verse.text }), h('cite', { text: data.key_verse.reference })) : null,
    h('div', { class: 'rd-status' }, readDone ? h('span', { class: 'gm-chip-soft ok', text: '말씀 읽기 완료' }) : null, quizDone ? h('span', { class: 'gm-chip-soft ok', text: `퀴즈 ${quizDone.s}/${quizDone.t}` }) : null),
  );
  if (!passages.length) {
    app.replaceChildren(h('div', { class: 'gm rd' }, head, h('div', { class: 'gm-card' }, h('p', { text: '이 날의 성경 읽기 분량을 아직 가져오지 못했어요. 교회 앱에 아직 올라오지 않았거나, 인터넷 연결을 확인해 주세요.' }))));
    return;
  }
  const tabs = h(
    'nav',
    { class: 'rd-tabs', 'aria-label': '오늘의 말씀 보기 방식' },
    READ_MODES.map(([k, label]) => h('a', { class: 'rd-tab', href: `#/r/${date}/${k}`, 'aria-current': k === mode ? 'page' : false, text: label })),
  );
  teardownMarks();
  const notes = NOTES_ENABLED && auth.user ? createNotes({ id, title: refs }) : null;
  currentNotes = notes;
  const body = h('div', { class: 'rd-body', id: 'mode-body' });
  const page = h('div', { class: 'gm rd' }, h('a', { class: 'back', href: '#/' }, icon('back'), '게임 홈'), head, kakaoBox(date, refs, data), tabs, body);
  app.replaceChildren(page);

  const dLike = { id, category: 'daily', title: refs, date, bible: false, qt: data && data.qt, study: data && data.study ? { ...data.study, quiz: null } : null, group: data && data.group };
  const notReady = (what) => h('div', { class: 'gm-card rd-wait' }, h('p', {}, h('strong', { text: `${what}은(는) 아직 준비 중이에요.` })), h('p', { class: 'meta', text: '매일 새벽 4시(토론토)에 오늘과 내일 분량이 자동으로 만들어져요. 말씀 탭에서 본문은 바로 읽을 수 있어요.' }));

  if (mode === 'read') body.append(renderReadingTab(date, id, passages, data, st, notes));
  else if (mode === 'qt') body.append(...(dLike.qt ? renderQtMode(dLike, notes) : [notReady('QT 묵상')]).filter(Boolean));
  else if (mode === 'study') body.append(...(dLike.study ? renderStudyMode(dLike) : [notReady('성경공부')]).filter(Boolean));
  else if (mode === 'group') body.append(...(dLike.group ? renderGroupMode(dLike, notes) : [notReady('소그룹 나눔')]).filter(Boolean));
  else if (mode === 'quiz') {
    const quiz = data && data.quiz;
    if (quiz && (quiz.multiple_choice || []).length) body.append(renderQuizCta({ id, study: { quiz } }), renderQuiz(quiz));
    else body.append(notReady('퀴즈'));
  }

  if (notes) {
    if (typeof notes.prune === 'function') notes.prune();
    const marks = createMarks(id, body, { enabled: true });
    notes.load().then((n) => {
      if (currentMarks === marks) marks.setAll(n ? n.marks : []);
    });
  } else createMarks(id, body, { enabled: false });
}

function renderReadingTab(date, id, basePassages, data, st, notes) {
  const wrap = h('div', { class: 'rd-read' });
  let version = savedReadVersion();
  const verBar = h('div', { class: 'gm-chips rd-vers', role: 'tablist', 'aria-label': '역본' });
  const text = h('div', { class: 'rd-text' });
  const videos = new Map(((data && data.videos) || []).map((v) => [`${v.book}|${v.chapter}`, v]));
  const draw = async () => {
    verBar.querySelectorAll('.gm-chip').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.v === version)));
    let passages = basePassages;
    if (version !== 'KNKRV') {
      text.replaceChildren(h('p', { class: 'loading', text: '본문을 불러오는 중…' }));
      const got = await fetchReadingLive(date, version);
      if (got && got.length) passages = got;
      else {
        text.replaceChildren(h('p', { class: 'note-hint', text: '이 역본을 불러오지 못했어요. 잠시 뒤 다시 시도하거나 개역개정으로 읽어 주세요.' }));
        return;
      }
    }
    text.replaceChildren(
      ...passages.map((p) => {
        const v = videos.get(`${p.book}|${p.chapter}`);
        const play = v
          ? h('button', { class: 'btn small rd-play', type: 'button', onclick: () => startPlayback(v.video_id, `${p.book} ${p.chapter}장 · 공동체 성경읽기`) }, icon('play'), '공동체 성경읽기')
          : h('a', { class: 'btn small', href: ytSearch(`공동체성경읽기 ${p.book} ${p.chapter}장`), target: '_blank', rel: 'noopener noreferrer' }, icon('external'), '공동체 성경읽기 찾기');
        const verses = [];
        p.verses.forEach((x) => {
          const m = /^<([^>]{1,40})>\s*(.*)$/.exec(x.text); // 표준새번역의 소제목 <…>
          if (m) verses.push(h('h4', { class: 'rd-subhead', text: m[1] }));
          verses.push(h('p', { class: 'rd-v' }, h('sup', { text: String(x.n) }), m ? m[2] : x.text));
        });
        return h('section', { class: 'rd-passage' }, h('div', { class: 'rd-passage-head' }, h('h2', {}, h('span', { text: p.book }), ` ${p.chapter}장`), play), verses);
      }),
    );
  };
  READ_VERSIONS.forEach(([vid, label]) => {
    const b = h('button', { class: 'gm-chip', type: 'button', role: 'tab', 'data-v': vid }, label);
    b.addEventListener('click', () => {
      version = vid;
      try {
        localStorage.setItem(READ_VER_KEY, vid);
      } catch {
        /* 괜찮습니다 */
      }
      draw();
    });
    verBar.append(b);
  });
  draw();

  // 맨 아래: 말씀 읽기 완료 (끝까지 내려 읽으면 켜집니다)
  const done = st && st.readDays && st.readDays[date];
  const btn = h('button', { class: 'btn gm-cta rd-done', type: 'button', disabled: !done && !!gameCanSave() }, icon('check'), done ? '말씀 읽기 완료' : '다 읽었어요', h('span', { class: 'gm-cta-sub', text: done ? '오늘 분량이 일독표에 체크되었어요' : `일독표 자동 체크 · +${GAME_RULES.xp.read} XP · 오늘의 도장` }));
  const out = h('p', { class: 'meta', role: 'status' });
  if (!gameCanSave()) {
    btn.disabled = true;
    out.textContent = '구글 로그인을 하면 읽은 날이 기록되고 일독표가 자동으로 체크돼요.';
  } else if (!done) {
    const sentinel = h('div', { class: 'rd-sentinel', 'aria-hidden': 'true' });
    wrap.append(sentinel);
    const enable = () => (btn.disabled = false);
    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver((ents) => {
        if (ents.some((e) => e.isIntersecting)) {
          enable();
          io.disconnect();
        }
      });
      setTimeout(() => io.observe(sentinel), 300);
    } else enable();
    setTimeout(enable, 60000); // 아주 짧은 분량 등을 위해 1분 뒤에는 켜 둡니다
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      out.textContent = '기록하는 중…';
      const r = await gameCall('game_read', { date, chapters: chapterKeysOf(basePassages) });
      if (!r.ok) {
        out.textContent = r.error || '기록하지 못했어요.';
        btn.disabled = false;
        return;
      }
      btn.replaceChildren(icon('check'), '말씀 읽기 완료', h('span', { class: 'gm-cta-sub', text: '오늘 분량이 일독표에 체크되었어요' }));
      const res = r.result || {};
      out.replaceChildren(h('span', { text: res.already ? '이미 기록된 날이에요. 일독표를 다시 맞췄어요. ' : `+${res.xp} XP · +${res.talents} 달란트${res.stamped ? ' · 오늘의 도장!' : ''} ` }), h('a', { href: `#/r/${date}/quiz`, text: '이어서 퀴즈 풀기' }), ' · ', h('a', { href: '#/g/plan', text: '일독표 보기' }));
      if (typeof confetti === 'function') confetti(wrap, 18);
    });
  }
  wrap.prepend(verBar, text);
  wrap.append(h('div', { class: 'rd-done-box' }, btn, out));
  return wrap;
}

/* ---------- 게임 홈 카드 ---------- */
function renderDailyCard(st) {
  const card = h('section', { class: 'gm-card rd-card' }, h('div', { class: 'gm-card-head' }, h('h2', {}, icon('book'), '오늘의 말씀 읽기'), h('span', { class: 'meta', text: dateLabel(localToday()) })), h('p', { class: 'loading', text: '불러오는 중…' }));
  (async () => {
    const date = await pickDailyDate();
    const [data, live] = await Promise.all([loadDaily(date), fetchReadingLive(date, 'KNKRV')]);
    const passages = live && live.length ? live : (data && data.passages) || [];
    const refs = (data && data.refs) || refsOf(passages);
    const id = dailyIdOf(date);
    const readDone = st && st.readDays && st.readDays[date];
    const quizDone = st && st.quizzes && st.quizzes[id];
    const body = [];
    if (date !== localToday()) body.push(h('p', { class: 'gm-practice', text: `오늘 분량은 아직 준비 중이라 ${dateLabel(date)} 말씀을 보여 드려요.` }));
    if (!refs) {
      body.push(h('p', { class: 'meta', text: '오늘의 읽기 분량을 불러오지 못했어요.' }));
    } else {
      body.push(h('p', { class: 'rd-card-refs', text: refs }));
      const sums = (data && data.summaries) || [];
      if (sums.length) body.push(h('ul', { class: 'rd-card-sums' }, sums.map((s) => h('li', {}, h('b', { text: s.reference }), h('span', { text: s.summary })))));
      body.push(
        h(
          'div',
          { class: 'rd-card-steps' },
          h('a', { class: `rd-step${readDone ? ' done' : ''}`, href: `#/r/${date}/read` }, h('span', { class: 'rd-step-ic' }, icon(readDone ? 'check' : 'book')), h('span', {}, h('b', { text: '말씀 읽기' }), h('em', { text: readDone ? '완료' : `+${GAME_RULES.xp.read} XP` }))),
          h('a', { class: 'rd-step', href: `#/r/${date}/qt` }, h('span', { class: 'rd-step-ic' }, icon('pencil')), h('span', {}, h('b', { text: '묵상 · 공부' }), h('em', { text: data && data.qt ? 'QT · 성경공부 · 소그룹' : '준비 중' }))),
          h('a', { class: `rd-step${quizDone ? ' done' : ''}`, href: data && data.quiz ? `#/q/${id}` : `#/r/${date}/quiz` }, h('span', { class: 'rd-step-ic' }, icon(quizDone ? 'check' : 'star')), h('span', {}, h('b', { text: '말씀 퀴즈' }), h('em', { text: quizDone ? `${quizDone.s}/${quizDone.t}` : data && data.quiz ? '도전!' : '준비 중' }))),
        ),
      );
      body.push(kakaoBox(date, refs, data));
    }
    card.lastChild.replaceWith(h('div', { class: 'rd-card-body' }, body));
  })();
  return card;
}

/* ---------- 성경일독표 ---------- */
function renderBiblePlan(st) {
  const read = new Set(st.bible || []);
  const count = (from, to) => BIBLE_BOOKS.slice(from, to).reduce((n, [bid, , chs]) => n + Array.from({ length: chs }, (_, i) => read.has(chapterKey(bid, i + 1))).filter(Boolean).length, 0);
  const ot = count(0, 39);
  const nt = count(39, 66);
  const total = ot + nt;
  const pct = (n, of) => (of ? Math.floor((n / of) * 1000) / 10 : 0);
  const ring = (n, of, size, label) => {
    const r = size / 2 - 7;
    const c = 2 * Math.PI * r;
    return svgNode(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="${label} ${pct(n, of)}%"><circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="#efe9da" stroke-width="7"/><circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="#c9a14a" stroke-width="7" stroke-linecap="round" stroke-dasharray="${((c * n) / of).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 ${size / 2} ${size / 2})"/></svg>`);
  };
  const canEdit = !!gameCanSave();
  const summary = h(
    'section',
    { class: 'gm-card bp-summary' },
    h('div', { class: 'bp-ring' }, ring(total, BIBLE_TOTAL, 150, '성경 전체'), h('div', { class: 'bp-ring-text' }, h('b', { text: `${pct(total, BIBLE_TOTAL)}%` }), h('span', { text: `${total} / ${BIBLE_TOTAL}장` }))),
    h(
      'div',
      { class: 'bp-sum-info' },
      h('h1', { text: '성경일독표' }),
      h('p', { class: 'meta', text: canEdit ? '오늘의 말씀을 "다 읽었어요"로 마치면 그날 장들이 자동으로 체크돼요. 다른 곳에서 읽은 장은 칸을 눌러 직접 체크할 수 있어요.' : '구글 로그인을 하면 읽은 장이 기록되고 직접 체크할 수 있어요.' }),
      h('div', { class: 'bp-testaments' }, h('div', {}, h('span', { text: '구약' }), h('b', { text: `${ot} / 929` }), progressBar(ot, 929, 'gm-bar-gold')), h('div', {}, h('span', { text: '신약' }), h('b', { text: `${nt} / 260` }), progressBar(nt, 260, 'gm-bar-gold'))),
    ),
  );
  const bookCard = ([bid, name, chs, short]) => {
    const done = Array.from({ length: chs }, (_, i) => read.has(chapterKey(bid, i + 1))).filter(Boolean).length;
    const countEl = h('span', { class: 'bp-count', text: `${done} / ${chs}` });
    const card = h('article', { class: `bp-book${done === chs ? ' full' : ''}` });
    const cells = h('div', { class: 'bp-cells' });
    for (let ch = 1; ch <= chs; ch++) {
      const key = chapterKey(bid, ch);
      const cell = h('button', { class: `bp-cell${read.has(key) ? ' on' : ''}`, type: 'button', 'aria-pressed': String(read.has(key)), title: `${name} ${ch}장`, disabled: !canEdit, text: String(ch) });
      cell.addEventListener('click', async () => {
        const on = !read.has(key);
        on ? read.add(key) : read.delete(key);
        cell.classList.toggle('on', on);
        cell.setAttribute('aria-pressed', String(on));
        const now = Array.from({ length: chs }, (_, i) => read.has(chapterKey(bid, i + 1))).filter(Boolean).length;
        countEl.textContent = `${now} / ${chs}`;
        card.classList.toggle('full', now === chs);
        const r = await gameCall('game_chapter', { key, on });
        if (!r.ok) {
          on ? read.delete(key) : read.add(key);
          cell.classList.toggle('on', !on);
          cell.setAttribute('aria-pressed', String(!on));
          toast(r.error || '저장하지 못했어요.', 3000);
        }
      });
      cells.append(cell);
    }
    card.append(h('div', { class: 'bp-book-head' }, h('h3', {}, name, h('span', { class: 'bp-short', text: short })), countEl), cells);
    return card;
  };
  return h(
    'div',
    { class: 'bp' },
    summary,
    h('section', { class: 'bp-section' }, h('h2', { class: 'bp-title' }, '구약', h('span', { text: '39권' })), h('div', { class: 'bp-grid' }, BIBLE_BOOKS.slice(0, 39).map(bookCard))),
    h('section', { class: 'bp-section' }, h('h2', { class: 'bp-title' }, '신약', h('span', { text: '27권' })), h('div', { class: 'bp-grid' }, BIBLE_BOOKS.slice(39).map(bookCard))),
  );
}
