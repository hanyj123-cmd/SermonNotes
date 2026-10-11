// 말씀결 게임 화면
//   #/g            게임 홈 (내 캐릭터 · 오늘의 퀘스트 · 도장판 · 여정 · 가족 순위 미리보기)
//   #/g/journey    여정 (천로역정 순례길 · 전신갑주 · 시냇가에 심은 나무)
//   #/g/closet     옷장 (갈아입기)
//   #/g/shop       상점 (달란트로 구입)
//   #/g/rank       가족 순위 · 내 이름과 칭호
//   #/q/<영상ID>    말씀 퀘스트 (성경공부 퀴즈: 객관식 + 빈칸 타이핑)
// 점수 계산은 서버(Apps Script)가 다시 합니다. 이 파일은 app.js 의 h(), toast(), notesCall(), auth, state, loadDetail() 과
// game-data.js(규칙·아이템), game-art.js(그림)를 씁니다.

const GAME_LOOK_KEY = 'sn-game-look';
let gameState = null; // 서버에서 받은 내 기록
let gameStateAt = 0;

function gameLook() {
  if (gameState) return gameState.look;
  try {
    return { ...DEFAULT_LOOK, ...JSON.parse(localStorage.getItem(GAME_LOOK_KEY) || '{}') };
  } catch {
    return { ...DEFAULT_LOOK };
  }
}
function rememberLook(look) {
  try {
    localStorage.setItem(GAME_LOOK_KEY, JSON.stringify(look));
  } catch {
    /* 저장하지 못해도 괜찮습니다 */
  }
}
// 지금 주소가 게임 화면인지 (#/ 첫 화면 · #/g…)
const isGameHash = () => {
  const k = location.hash.split('/')[1];
  return !k || k === 'g';
};
// 말씀 퀘스트를 마친 퀴즈 (이 기기). 퀴즈 문제·정답 목록은 퀘스트를 한 번 풀어 본 뒤에만 보여 줍니다 (미리 보기 방지).
const QUEST_DONE_KEY = 'sn-quest-done';
function questDoneMap() {
  try {
    const o = JSON.parse(localStorage.getItem(QUEST_DONE_KEY) || '{}');
    return o && typeof o === 'object' ? o : {};
  } catch {
    return {};
  }
}
function markQuestDone(id, s, t) {
  try {
    const all = questDoneMap();
    all[id] = { s, t, at: Date.now() };
    const keys = Object.keys(all);
    if (keys.length > 300) keys.slice(0, keys.length - 300).forEach((k) => delete all[k]);
    localStorage.setItem(QUEST_DONE_KEY, JSON.stringify(all));
  } catch {
    /* 저장하지 못해도 이번 화면에서는 열려 있습니다 */
  }
}
/** 이 퀴즈의 말씀 퀘스트를 풀어 봤나요? (이 기기의 기록 또는 서버에 저장된 내 기록) */
function questUnlocked(id) {
  if (questDoneMap()[id]) return true;
  return !!(gameState && ((gameState.quizzes && gameState.quizzes[id]) || (gameState.records && gameState.records[id])));
}
const gameCanSave = () => typeof NOTES_ENABLED !== 'undefined' && NOTES_ENABLED && auth.user;

async function gameCall(action, payload = {}) {
  let r;
  try {
    r = await notesCall(action, payload);
  } catch (e) {
    return { ok: false, error: `연결하지 못했습니다: ${e.message || e}` };
  }
  if (r.ok && r.state) {
    gameState = r.state;
    gameStateAt = Date.now();
    rememberLook(r.state.look);
  }
  if (!r.ok && /알 수 없는 작업/.test(r.error || '')) r.error = 'Apps Script가 아직 옛 버전입니다. 새 Code.gs를 붙여 넣고 "배포 관리 → 새 버전"으로 다시 배포해 주세요.';
  return r;
}
async function ensureGameState(force = false) {
  if (!gameCanSave()) return null;
  if (gameState && !force && Date.now() - gameStateAt < 60_000) return gameState;
  const r = await gameCall('game_get');
  if (!r.ok) throw new Error(r.error || '게임 기록을 불러오지 못했습니다.');
  return gameState;
}

/* ---------- 작은 부품 ---------- */
const coin = (n, cls = '') => h('span', { class: `gm-coin ${cls}` }, icon('coin'), h('b', { text: Number(n || 0).toLocaleString('ko-KR') }));
const avatarNode = (look, opts) => svgNode(avatarSvg(look, opts));
const blankKeyClient = (s) => String(s || '').normalize('NFC').toLowerCase().replace(/[\s.,!?·~'"“”‘’()[\]{}<>「」『』:;\-_/]/g, '');
const itemLook = (id, base = DEFAULT_LOOK) => {
  const it = GAME_ITEMS[id];
  if (!it) return base;
  return { ...base, [it.slot]: id };
};
function itemThumb(id, size = 84) {
  const it = GAME_ITEMS[id];
  const base = { ...DEFAULT_LOOK, bg: it && it.slot === 'bg' ? id : '' };
  const crop = it && it.slot === 'head' ? '24 -6 152 140' : it && it.slot === 'hair' ? '14 -4 172 200' : it && it.slot === 'chest' && !/_(bronze|silver|gold)$/.test(id) ? '50 104 100 92' : '';
  return avatarNode(itemLook(id, base), { size: crop ? Math.round(size * 1.25) : size, frame: !!(it && it.slot === 'bg'), crop });
}
function rarityChip(r) {
  return h('span', { class: `gm-rarity gm-r-${r}`, text: RARITY_LABELS[r] || '' });
}
function progressBar(value, max, cls = '') {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return h('div', { class: `gm-bar ${cls}`, role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(max), 'aria-valuenow': String(value) }, h('span', { style: `width:${pct.toFixed(1)}%` }));
}
function confetti(host, n = 26) {
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const box = h('div', { class: 'gm-confetti', 'aria-hidden': 'true' });
  const colors = ['#ecd492', '#c9a14a', '#f4e2a6', '#a3243a', '#fbf8f1', '#8f6b22'];
  for (let i = 0; i < n; i++) {
    box.append(h('i', { style: `left:${Math.random() * 100}%;background:${colors[i % colors.length]};animation-delay:${(Math.random() * 0.4).toFixed(2)}s;transform:rotate(${Math.round(Math.random() * 360)}deg)` }));
  }
  host.append(box);
  setTimeout(() => box.remove(), 2600);
}
/** from → to 로 숫자가 올라가며 바뀝니다 (fmt 로 모양을 정함) */
function countTo(el, from, to, fmt = (n) => String(n), ms = 600) {
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce || from === to) {
    el.textContent = fmt(to);
    return;
  }
  const t0 = performance.now();
  const step = (t) => {
    const k = Math.min(1, (t - t0) / ms);
    el.textContent = fmt(Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3))));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
function countUp(el, to, ms = 900) {
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce || to <= 0) {
    el.textContent = String(to);
    return;
  }
  const t0 = performance.now();
  const step = (t) => {
    const k = Math.min(1, (t - t0) / ms);
    el.textContent = String(Math.round(to * (1 - Math.pow(1 - k, 3))));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
// 붉은 밀랍 인장 (도장)
function stampSvg(size = 40) {
  const uid = `ws${Math.random().toString(36).slice(2, 7)}`;
  return svgNode(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="${size}" height="${size}" aria-hidden="true">
    <defs><radialGradient id="${uid}" cx="38%" cy="32%" r="70%"><stop offset="0" stop-color="#d4495a"/><stop offset=".55" stop-color="#a3243a"/><stop offset="1" stop-color="#6f1426"/></radialGradient></defs>
    <path d="M24 3.5c3 0 4.2 2.4 7 3.2s5.4-.4 7.2 1.8 .8 4.8 2 7.4 3.9 3.6 3.9 6.6-2.6 4.1-3.4 6.9.6 5.4-1.4 7.4-4.7 1-7.4 2.2-3.8 3.8-6.9 3.8-4.2-2.6-7-3.4-5.4.4-7.2-1.8-.8-4.8-2-7.4S3.4 27 3.4 24s2.6-4.1 3.4-6.9-.6-5.4 1.4-7.4 4.7-1 7.4-2.2S20.9 3.5 24 3.5z" fill="url(#${uid})"/>
    <circle cx="24" cy="24" r="13.5" fill="none" stroke="#f3c9a8" stroke-opacity=".55" stroke-width="1.2"/>
    <path d="M24 15.5v17M18 21.5h12" stroke="#f6dcc0" stroke-opacity=".9" stroke-width="2.6" stroke-linecap="round"/>
    <path d="M14 13q4-4 9-4.5" stroke="#fff" stroke-opacity=".35" stroke-width="2" fill="none" stroke-linecap="round"/></svg>`);
}

/* ---------- 게임 상단 탭 ---------- */
const GAME_TABS = [
  ['home', '홈', 'game'],
  ['plan', '일독표', 'book'],
  ['journey', '여정', 'map'],
  ['closet', '옷장', 'shirt'],
  ['shop', '상점', 'shop'],
  ['rank', '순위', 'trophy'],
];
function gameTabs(cur) {
  return h(
    'nav',
    { class: 'gm-tabs', 'aria-label': '말씀 게임 메뉴' },
    GAME_TABS.map(([k, label, ic]) => h('a', { class: 'gm-tab', href: k === 'home' ? '#/' : `#/g/${k}`, 'aria-current': k === cur ? 'page' : false }, icon(ic), h('span', { text: label }))),
  );
}
function gameTopStats(st) {
  return h(
    'div',
    { class: 'gm-top' },
    h('span', { class: 'gm-pill gm-pill-lv', title: '레벨' }, h('b', { text: `Lv.${st.level}` }), h('span', { text: st.title || st.levelTitle })),
    h('span', { class: `gm-pill gm-pill-fire${st.streak ? '' : ' off'}`, title: '연속 도장' }, icon('flame'), h('b', { text: `${st.streak}일` }), st.mult > 1 ? h('em', { text: `×${st.mult}` }) : null),
    h('span', { class: 'gm-pill gm-pill-coin', title: '달란트' }, coin(st.talents)),
  );
}

/* ---------- 라우트 ---------- */
async function renderGame(tab = 'home') {
  document.title = '말씀 게임 · 말씀결';
  if (!GAME_TABS.some(([k]) => k === tab)) tab = 'home';
  if (!gameCanSave()) {
    app.replaceChildren(renderGameIntro());
    if (tab === 'home') app.firstChild.after(h('div', { class: 'gm' }, renderDailyCard(null)));
    return;
  }
  app.replaceChildren(h('div', { class: 'gm' }, gameTabs(tab), h('p', { class: 'loading', text: '게임을 불러오는 중…' })));
  let st;
  try {
    st = await ensureGameState(tab === 'home');
  } catch (e) {
    app.replaceChildren(h('div', { class: 'gm' }, gameTabs(tab), h('div', { class: 'empty' }, h('p', { text: String(e.message || e) }))));
    return;
  }
  if (!isGameHash()) return;
  let firstTime = false;
  try {
    firstTime = !st.stats.quests && !st.stats.reflects && !localStorage.getItem('sn-game-made');
  } catch {
    firstTime = false;
  }
  if (firstTime && tab === 'home') {
    app.replaceChildren(h('div', { class: 'gm' }, renderMaker(st)));
    return;
  }
  const body = { home: renderGameHome, plan: renderBiblePlan, journey: renderJourneys, closet: renderCloset, shop: renderShop, rank: renderRank }[tab](st);
  app.replaceChildren(h('div', { class: `gm gm-page-${tab}` }, gameTabs(tab), tab === 'home' ? null : gameTopStats(st), body));
}

function renderGameIntro() {
  const look = { ...DEFAULT_LOOK, handR: 'staff', pet: 'pet_lamb', bg: 'bg_dawn' };
  return h(
    'div',
    { class: 'gm gm-intro' },
    h('div', { class: 'gm-intro-art' }, avatarNode(look, { size: 220, mood: 'cheer' })),
    h(
      'div',
      { class: 'gm-intro-text' },
      h('h1', { text: '말씀 게임' }),
      h('p', { text: '오늘의 말씀과 주일 설교를 읽고 퀴즈를 풀면 도장과 달란트를 받아요. 매일 이어서 하면 더 많이 받고, 모은 달란트로 내 캐릭터를 꾸밀 수 있어요.' }),
      h('ul', { class: 'gm-intro-list' }, h('li', {}, icon('stamp'), '하루 한 번 퀘스트를 마치면 도장 하나'), h('li', {}, icon('flame'), '연속으로 하면 달란트가 최대 2배'), h('li', {}, icon('map'), '천로역정 · 전신갑주 · 시냇가의 나무, 세 가지 여정'), h('li', {}, icon('trophy'), '가족끼리 이번 주 순위 겨루기')),
      gameCanSave() ? null : h('p', { class: 'note-hint', text: typeof NOTES_ENABLED !== 'undefined' && NOTES_ENABLED ? '화면 위쪽에서 구글 로그인을 하면 시작할 수 있어요. 로그인하지 않아도 퀘스트는 연습으로 풀어 볼 수 있어요.' : '로그인 기능이 연결되면 점수를 저장할 수 있어요. 지금은 퀘스트를 연습으로만 풀 수 있어요.' }),
      h('a', { class: 'btn primary', href: '#/r' }, '오늘의 말씀 읽기'),
    ),
  );
}

/* ---------- 처음: 캐릭터 만들기 ---------- */
function renderMaker(st) {
  const draft = { ...st.look };
  const preview = h('div', { class: 'gm-maker-art' });
  const draw = () => preview.replaceChildren(avatarNode(draft, { size: 210, mood: 'cheer' }));
  const nick = h('input', { class: 'search', type: 'text', maxlength: '12', placeholder: '게임에서 쓸 이름 (예: 윤종, 엄마)', 'aria-label': '게임 이름' });
  nick.value = st.nick || (auth.user && auth.user.name ? String(auth.user.name).split(' ')[0] : '');
  const pick = (slot, label, ids, labelOf) =>
    h(
      'div',
      { class: 'gm-maker-row' },
      h('span', { class: 'gm-maker-label', text: label }),
      h(
        'div',
        { class: 'gm-chips', role: 'radiogroup', 'aria-label': label },
        ids.map((id) => {
          const b = h('button', { class: 'gm-chip', type: 'button', role: 'radio', 'aria-checked': String(draft[slot] === id) }, labelOf(id));
          b.addEventListener('click', () => {
            draft[slot] = id;
            b.parentElement.querySelectorAll('.gm-chip').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
            draw();
          });
          return b;
        }),
      ),
    );
  const swatch = (c) => h('span', { class: 'gm-swatch', style: `background:${c}` });
  const status = h('p', { class: 'meta', role: 'status' });
  const start = h('button', { class: 'btn primary gm-big', type: 'button' }, '이 모습으로 시작하기');
  start.addEventListener('click', async () => {
    start.disabled = true;
    status.textContent = '저장하는 중…';
    const a = await gameCall('game_equip', { look: { skin: draft.skin, hair: draft.hair, hairColor: draft.hairColor } });
    const b = a.ok ? await gameCall('game_profile', { nick: nick.value.trim() }) : a;
    if (!b.ok) {
      status.textContent = b.error || '저장하지 못했습니다.';
      start.disabled = false;
      return;
    }
    try {
      localStorage.setItem('sn-game-made', '1');
    } catch {
      /* 괜찮습니다 */
    }
    location.hash = '#/g/journey';
  });
  draw();
  return h(
    'section',
    { class: 'gm-maker' },
    h('div', { class: 'gm-maker-head' }, h('h1', { text: '나의 순례자 만들기' }), h('p', { class: 'meta', text: '옷과 장식은 퀘스트로 모은 달란트와 여정 보상으로 더 늘어나요. 지금 고른 모습은 나중에 옷장에서 언제든 바꿀 수 있어요.' })),
    h(
      'div',
      { class: 'gm-maker-body' },
      preview,
      h(
        'div',
        { class: 'gm-maker-opts' },
        h('label', { class: 'gm-maker-row' }, h('span', { class: 'gm-maker-label', text: '이름' }), nick),
        pick('hair', '머리 모양', ['hair_short', 'hair_bob', 'hair_long', 'hair_bun'], (id) => GAME_ITEMS[id].name),
        pick('hairColor', '머리 색', ['black', 'brown'], (id) => [swatch(HAIR_COLOR[id]), GAME_ITEMS[id].name]),
        pick('skin', '피부', ['s1', 's2', 's3'], (id) => [swatch(SKIN[id][0]), GAME_ITEMS[id].name]),
        start,
        status,
      ),
    ),
  );
}

/* ---------- 홈 ---------- */
function quizSermons() {
  return (state.sermons || []).filter((s) => (s.modes || []).includes('study'));
}
/* ---------- 성경말씀 퀘스트: 주일 설교(그 주) → 오늘의 말씀 → 지난 며칠 말씀 ---------- */
const dayDiff = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000);
const shortDate = (d) => {
  const x = new Date(`${d}T12:00:00Z`);
  return `${x.getUTCMonth() + 1}/${x.getUTCDate()}`;
};
async function bibleQuestList(st) {
  const today = st.today;
  const sundays = quizSermons()
    .filter((s) => s.category === 'sunday' && s.date && s.date <= today)
    .sort((a, b) => b.date.localeCompare(a.date));
  let days = [];
  try {
    days = (await loadDailyIndex()).filter((d) => d.complete && d.date <= today).sort((a, b) => b.date.localeCompare(a.date));
  } catch {
    days = [];
  }
  const sun = (s) => ({ id: s.id, kind: '주일 설교', title: s.title, when: formatDate(s.date) });
  const day = (d) => ({ id: dailyIdOf(d.date), kind: d.date === today ? '오늘의 말씀' : `${shortDate(d.date)} 말씀`, title: d.refs, when: d.date === today ? '오늘' : shortDate(d.date) });
  const list = [];
  const thisWeek = sundays[0] && dayDiff(sundays[0].date, today) <= 6 ? sundays[0] : null;
  if (thisWeek && !st.quizzes[thisWeek.id]) list.push(sun(thisWeek)); // 주일 설교가 있는 주에는 주일 말씀부터
  const todayDay = days.find((d) => d.date === today) || days[0];
  if (todayDay) list.push(day(todayDay));
  if (thisWeek && st.quizzes[thisWeek.id]) list.push(sun(thisWeek));
  days.filter((d) => d !== todayDay && dayDiff(d.date, today) <= 6 && !st.quizzes[dailyIdOf(d.date)]).slice(0, 2).forEach((d) => list.push(day(d)));
  sundays.filter((s) => s !== thisWeek && !st.quizzes[s.id]).slice(0, 1).forEach((s) => list.push(sun(s)));
  return list.slice(0, 5);
}
function renderBibleQuests(st) {
  const card = h(
    'section',
    { class: 'gm-card gm-quest' },
    h('div', { class: 'gm-card-head' }, h('h2', {}, icon('star'), '성경말씀 퀘스트'), h('span', { class: 'gm-chip-soft', text: st.dailyLeft ? `점수 퀘스트 ${st.dailyLeft}개 남음` : '오늘 점수 퀘스트 완료 · 연습은 계속 OK' })),
    h('p', { class: 'meta', text: '주일 설교와 매일 성경 읽기 본문으로 만든 퀴즈예요. 주일 설교가 올라온 주에는 주일 말씀부터, 그다음 오늘의 말씀으로 이어져요. 객관식과 빈칸(직접 입력)을 풀고 절반 이상 맞히면 오늘의 도장을 받아요.' }),
    h('p', { class: 'loading', text: '퀘스트를 고르는 중…' }),
  );
  bibleQuestList(st).then((list) => {
    const slot = card.lastChild;
    if (!list.length) {
      slot.replaceWith(h('p', { class: 'empty', text: '아직 퀴즈가 준비된 말씀이 없어요. 오늘의 말씀이나 주일 설교가 정리되면 여기에 나타나요.' }));
      return;
    }
    const first = list.find((q) => !st.quizzes[q.id]) || list[0];
    const cta = h('a', { class: 'btn gm-cta', href: `#/q/${encodeURIComponent(first.id)}` }, icon('star'), st.quizzes[first.id] ? '다시 풀어 보기' : `${first.kind} 퀘스트 시작`, h('span', { class: 'gm-cta-sub', text: first.title }));
    const rest = list.filter((q) => q !== first);
    slot.replaceWith(
      h(
        'div',
        {},
        cta,
        rest.length
          ? h(
              'ul',
              { class: 'gm-quest-list' },
              rest.map((q) => {
                const done = st.quizzes[q.id];
                return h('li', {}, h('a', { class: 'gm-quest-item', href: `#/q/${encodeURIComponent(q.id)}` }, h('span', { class: 'gm-quest-date', text: q.kind }), h('span', { class: 'gm-quest-title', text: q.title }), done ? h('span', { class: 'gm-chip-soft ok', text: `${done.s}/${done.t} 완료` }) : h('span', { class: 'gm-go', text: '도전' })));
              }),
            )
          : null,
      ),
    );
  });
  return card;
}

function renderGameHome(st) {
  const lvStart = levelXp(st.level);
  const lvNext = levelXp(st.level + 1);
  const now = new Date(`${st.today}T12:00:00Z`);
  const dateLabel = `${now.getUTCMonth() + 1}월 ${now.getUTCDate()}일 ${['일', '월', '화', '수', '목', '금', '토'][now.getUTCDay()]}요일`;
  const stat = (label, value, cls = '') => h('div', { class: `gm-stat ${cls}` }, h('dt', { text: label }), h('dd', {}, value));
  const hero = h(
    'section',
    { class: 'gm-hero' },
    h('div', { class: 'gm-hero-stage' }, h('a', { class: 'gm-arch', href: '#/g/closet', title: '옷장에서 갈아입기' }, avatarNode(st.look, { size: 200, mood: st.stampedToday ? 'cheer' : 'smile' })), h('span', { class: 'gm-pedestal', 'aria-hidden': 'true' })),
    h(
      'div',
      { class: 'gm-hero-info' },
      h('p', { class: 'gm-date', text: dateLabel }),
      h('h1', { class: 'gm-hello', text: st.stampedToday ? `${st.nick || '순례자'}님, 오늘의 도장을 받았어요` : `${st.nick || '순례자'}님, 오늘의 말씀이 기다려요` }),
      h('div', { class: 'gm-lvline' }, h('span', { class: 'gm-lv', text: `Lv.${st.level}` }), h('span', { class: 'gm-lv-title', text: st.title || st.levelTitle }), h('span', { class: 'gm-lv-next', text: `다음 레벨까지 ${Math.max(0, lvNext - st.xp)} XP` })),
      progressBar(st.xp - lvStart, lvNext - lvStart, 'gm-bar-gold'),
      h('dl', { class: 'gm-hero-stats' }, stat('달란트', coin(st.talents)), stat('연속 도장', [icon('flame'), `${st.streak}일`], st.streak ? 'fire' : ''), stat('이번 주', `${st.weekXp} XP`)),
      st.mult > 1 ? h('p', { class: 'gm-mult' }, icon('flame'), `연속 ${st.streak}일 — 오늘 받는 달란트 ×${st.mult}`) : null,
    ),
  );

  const quest = renderBibleQuests(st);

  return h('div', { class: 'gm-home' }, hero, renderDailyCard(st), quest, renderStampBoard(st), renderJourneyMini(st), renderBadges(st), renderBoardMini());
}

function renderStampBoard(st) {
  const today = st.today;
  const set = new Set(st.stamps || []);
  const base = new Date(`${today}T12:00:00Z`);
  const dow = (base.getUTCDay() + 6) % 7;
  const start = new Date(base.getTime() - (dow + 21) * 86400000); // 4주 전 월요일
  const cells = [];
  for (let i = 0; i < 28; i++) {
    const d = new Date(start.getTime() + i * 86400000);
    const key = d.toISOString().slice(0, 10);
    const future = key > today;
    cells.push(h('div', { class: `gm-day${set.has(key) ? ' on' : ''}${key === today ? ' today' : ''}${future ? ' future' : ''}`, title: key }, h('span', { class: 'gm-day-n', text: String(d.getUTCDate()) }), set.has(key) ? stampSvg(34) : null));
  }
  const toWeek = 7 - (st.streak % 7 || (st.streak ? 7 : 0)) || 7;
  return h(
    'section',
    { class: 'gm-card gm-stamps' },
    h('div', { class: 'gm-card-head' }, h('h2', {}, icon('stamp'), '도장판'), h('span', { class: 'meta', text: `최고 연속 ${st.best}일 · 안식 쿠폰 ${st.freeze}장` })),
    h('div', { class: 'gm-week-labels' }, ['월', '화', '수', '목', '금', '토', '일'].map((d) => h('span', { text: d }))),
    h('div', { class: 'gm-days' }, cells),
    h('p', { class: 'gm-next-bonus' }, icon('gift'), st.streak ? `${toWeek}일 더 이어가면 7일 보너스 +${GAME_RULES.talent.week} 달란트` : '오늘 퀘스트로 연속 도장을 시작해 보세요'),
  );
}

function journeySteps(st, key) {
  const j = JOURNEYS[key];
  return Math.min(j.steps, Math.floor((st.journey.prog[key] || 0) / j.xpPerStep));
}
function renderJourneyMini(st) {
  const key = st.journey.cur;
  if (!key) {
    return h('a', { class: 'gm-card gm-journey-mini empty', href: '#/g/journey' }, icon('map'), h('div', {}, h('strong', { text: st.journey.done.length ? '다음 여정을 골라 주세요' : '여정을 골라 출발하세요' }), h('span', { class: 'meta', text: '천로역정 순례길 · 하나님의 전신갑주 · 시냇가에 심은 나무' })), h('span', { class: 'gm-go', text: '고르기' }));
  }
  const j = JOURNEYS[key];
  const steps = journeySteps(st, key);
  const into = (st.journey.prog[key] || 0) - steps * j.xpPerStep;
  return h(
    'a',
    { class: 'gm-card gm-journey-mini', href: '#/g/journey' },
    h('div', { class: 'gm-jm-art' }, journeyArt(st, key, true)),
    h('div', { class: 'gm-jm-text' }, h('strong', { text: j.name }), h('span', { class: 'meta', text: `${steps} / ${j.steps} 단계 · 다음까지 ${j.xpPerStep - into} XP` }), progressBar(steps, j.steps, 'gm-bar-journey')),
  );
}
function renderBadges(st) {
  return h(
    'section',
    { class: 'gm-card gm-badges' },
    h('div', { class: 'gm-card-head' }, h('h2', {}, icon('trophy'), '업적'), h('span', { class: 'meta', text: `${st.badges.length} / ${BADGES.length}` })),
    h(
      'ul',
      { class: 'gm-badge-list' },
      BADGES.map(([id, name, desc, reward]) => {
        const on = st.badges.includes(id);
        return h('li', { class: `gm-badge${on ? ' on' : ''}`, title: `${desc} · 보상 ${reward} 달란트` }, h('span', { class: 'gm-badge-ic' }, on ? icon('star') : icon('lock')), h('span', { class: 'gm-badge-name', text: name }), h('span', { class: 'gm-badge-desc', text: desc }));
      }),
    ),
  );
}
function renderBoardMini() {
  const box = h('section', { class: 'gm-card gm-board-mini' }, h('div', { class: 'gm-card-head' }, h('h2', {}, icon('trophy'), '이번 주 가족 순위'), h('a', { href: '#/g/rank', text: '전체 보기' })), h('p', { class: 'meta', text: '불러오는 중…' }));
  gameCall('game_board').then((r) => {
    if (!r.ok) return box.lastChild.replaceWith(h('p', { class: 'meta', text: r.error || '순위를 불러오지 못했습니다.' }));
    box.lastChild.replaceWith(boardList(r.players.slice(0, 4), true));
  });
  return box;
}

/* ---------- 여정 ---------- */
function bestArmorLook(st) {
  const look = { ...st.look };
  const slotOf = { belt: 'belt', chest: 'chest', feet: 'feet', shield: 'handL', helmet: 'head', sword: 'handR' };
  ARMOR_ORDER.forEach(([piece]) => {
    for (const [tier] of [...TIER_NAMES].reverse()) {
      if (st.inv.includes(`${piece}_${tier}`)) {
        look[slotOf[piece]] = `${piece}_${tier}`;
        break;
      }
    }
  });
  return look;
}
function journeyArt(st, key, small = false) {
  const steps = journeySteps(st, key);
  if (key === 'pilgrim') return svgNode(pilgrimMapSvg(steps, st.look));
  if (key === 'tree') return svgNode(treeSvg(Math.min(4, steps), Math.max(0, steps - 4)));
  return avatarNode({ ...bestArmorLook(st), bg: small ? '' : 'bg_stars' }, { size: small ? 120 : 240, frame: !small });
}
function renderJourneys(st) {
  const cur = st.journey.cur;
  const wrap = h('div', { class: 'gm-journeys' });
  if (cur) wrap.append(renderJourneyDetail(st, cur));
  wrap.append(
    h('h2', { class: 'gm-sec-title', text: cur ? '다른 여정' : '여정을 골라 출발하세요' }),
    h('p', { class: 'meta', text: '퀘스트로 얻는 경험치만큼 지금 고른 여정이 나아가요. 여정을 바꿔도 각자의 진행은 그대로 남아요. 끝까지 가면 칭호와 특별한 아이템을 받아요.' }),
    h(
      'div',
      { class: 'gm-journey-cards' },
      JOURNEY_KEYS.map((key) => {
        const j = JOURNEYS[key];
        const steps = journeySteps(st, key);
        const done = st.journey.done.includes(key);
        const btn = h('button', { class: `btn ${done || key === cur ? '' : 'primary'}`, type: 'button', disabled: done || key === cur }, done ? '완주!' : key === cur ? '진행 중' : steps ? '이어 가기' : '출발하기');
        btn.addEventListener('click', async () => {
          btn.disabled = true;
          const r = await gameCall('game_journey', { key });
          if (!r.ok) {
            toast(r.error || '바꾸지 못했습니다.', 3000);
            btn.disabled = false;
            return;
          }
          toast(`${j.name}을(를) 시작합니다!`);
          renderGame('journey');
        });
        return h(
          'article',
          { class: `gm-jcard${done ? ' done' : ''}${key === cur ? ' cur' : ''}` },
          h('div', { class: 'gm-jcard-art' }, journeyArt(st, key, true)),
          h('h3', { text: j.name }),
          h('p', { class: 'gm-verse', text: j.verse }),
          h('p', { class: 'meta', text: j.desc }),
          progressBar(steps, j.steps, 'gm-bar-journey'),
          h('p', { class: 'meta', text: done ? `칭호 「${j.title}」을 받았어요` : `${steps} / ${j.steps} 단계 · 완주 칭호 「${j.title}」` }),
          btn,
        );
      }),
    ),
  );
  return wrap;
}
function renderJourneyDetail(st, key) {
  const j = JOURNEYS[key];
  const steps = journeySteps(st, key);
  const into = (st.journey.prog[key] || 0) - steps * j.xpPerStep;
  const head = h('div', { class: 'gm-jd-head' }, h('h2', { text: j.name }), h('p', { class: 'gm-verse', text: j.verse }), h('div', { class: 'gm-jd-next' }, h('span', { text: `다음 단계까지 ${j.xpPerStep - into} XP` }), progressBar(into, j.xpPerStep, 'gm-bar-xp')));
  let side = null;
  if (key === 'pilgrim') {
    const here = PILGRIM_STOPS[Math.min(steps, PILGRIM_STOPS.length - 1)];
    const next = PILGRIM_STOPS[steps + 1];
    side = h(
      'div',
      { class: 'gm-jd-side' },
      h('p', {}, h('strong', { text: '지금 있는 곳: ' }), here.name),
      next ? h('p', {}, h('strong', { text: '다음 목적지: ' }), next.name, j.rewards[steps + 1] ? h('span', { class: 'gm-chip-soft', text: `보상: ${GAME_ITEMS[j.rewards[steps + 1]].name}` }) : null) : h('p', { text: '천성에 도착했어요!' }),
      h('ul', { class: 'gm-reward-list' }, Object.entries(j.rewards).map(([s, id]) => h('li', { class: steps >= Number(s) ? 'on' : '' }, itemThumb(id, 46), h('span', {}, h('b', { text: PILGRIM_STOPS[Number(s)].name }), h('span', { class: 'meta', text: GAME_ITEMS[id].name }))))),
    );
  } else if (key === 'armor') {
    side = h(
      'div',
      { class: 'gm-armor-grid' },
      ARMOR_ORDER.map(([piece, name, ref]) => {
        const tiers = TIER_NAMES.map(([tier, tname]) => h('span', { class: `gm-tier gm-tier-${tier}${st.inv.includes(`${piece}_${tier}`) ? ' on' : ''}`, title: tname, text: tname }));
        const best = [...TIER_NAMES].reverse().find(([tier]) => st.inv.includes(`${piece}_${tier}`));
        return h('div', { class: `gm-armor-piece${best ? ' on' : ''}` }, best ? itemThumb(`${piece}_${best[0]}`, 52) : h('span', { class: 'gm-armor-lock' }, icon('lock')), h('div', {}, h('b', { text: name }), h('span', { class: 'meta', text: ref }), h('div', { class: 'gm-tiers' }, tiers)));
      }),
    );
  } else {
    side = h(
      'div',
      { class: 'gm-fruits' },
      h('p', { class: 'meta', text: steps < 4 ? `나무가 자라는 중이에요 (${['씨앗', '새싹', '어린나무', '나무', '큰 나무'][Math.min(4, steps)]})` : '“오직 성령의 열매는…” (갈 5:22-23)' }),
      h(
        'ul',
        {},
        FRUITS.map(([name, color], i) => h('li', { class: steps - 4 > i ? 'on' : '' }, h('span', { class: 'gm-fruit-dot', style: `background:${steps - 4 > i ? color : 'transparent'};border-color:${color}` }), name)),
      ),
    );
  }
  return h('section', { class: 'gm-card gm-jd' }, head, h('div', { class: 'gm-jd-body' }, h('div', { class: 'gm-jd-art' }, journeyArt(st, key)), side));
}

/* ---------- 옷장 ---------- */
const CLOSET_GROUPS = [
  ['hair', '머리', ['hair', 'hairColor']],
  ['robe', '옷', ['robe']],
  ['head', '머리 장식', ['head']],
  ['hands', '손', ['handR', 'handL']],
  ['armor', '갑옷', ['chest', 'belt', 'feet']],
  ['pet', '동물 친구', ['pet']],
  ['bg', '배경', ['bg']],
  ['skin', '피부', ['skin']],
];
const REQUIRED_SLOTS = ['skin', 'hair', 'hairColor', 'robe'];
function itemHint(it) {
  if (it.src === 'shop') return it.need ? `${itemNeedLabel(it.need)} · ${it.price} 달란트` : `상점 ${it.price} 달란트`;
  if (it.src === 'journey') {
    const armor = Object.keys(GAME_ITEMS).filter((id) => /_(bronze|silver|gold)$/.test(id));
    if (armor.includes(it.id)) return '전신갑주 여정';
    for (const k of JOURNEY_KEYS) {
      const s = Object.entries(JOURNEYS[k].rewards).find(([, id]) => id === it.id);
      if (s) return `${JOURNEYS[k].short} ${k === 'pilgrim' ? PILGRIM_STOPS[Number(s[0])].name : `${s[0]}단계`}`;
    }
    return '여정 보상';
  }
  return '';
}
function renderCloset(st, focusId) {
  const draft = { ...st.look };
  let group = 'hair';
  if (focusId && GAME_ITEMS[focusId]) {
    const slot = GAME_ITEMS[focusId].slot;
    group = (CLOSET_GROUPS.find(([, , slots]) => slots.includes(slot)) || CLOSET_GROUPS[0])[0];
    if (st.inv.includes(focusId)) draft[slot] = focusId;
  }
  const preview = h('div', { class: 'gm-closet-art' });
  const grid = h('div', { class: 'gm-closet-grid' });
  const tabs = h('div', { class: 'gm-chips gm-closet-tabs', role: 'tablist' });
  const status = h('p', { class: 'meta', role: 'status' });
  const save = h('button', { class: 'btn primary gm-big', type: 'button' }, '이렇게 입기');
  const reset = h('button', { class: 'btn', type: 'button' }, '되돌리기');
  const changed = () => JSON.stringify(draft) !== JSON.stringify(st.look);
  const drawPreview = () => {
    preview.replaceChildren(avatarNode(draft, { size: 230 }));
    save.disabled = !changed();
    reset.disabled = !changed();
  };
  const drawGrid = () => {
    const [, , slots] = CLOSET_GROUPS.find(([k]) => k === group);
    grid.replaceChildren(
      ...slots.map((slot) => {
        const items = GAME_ITEM_LIST.filter(([, s]) => s === slot).map(([id]) => GAME_ITEMS[id]);
        const cards = [];
        if (!REQUIRED_SLOTS.includes(slot)) {
          const none = h('button', { class: 'gm-item', type: 'button', 'aria-pressed': String(!draft[slot]) }, h('span', { class: 'gm-item-none', text: '없음' }), h('span', { class: 'gm-item-name', text: '벗기' }));
          none.addEventListener('click', () => {
            draft[slot] = '';
            drawGrid();
            drawPreview();
          });
          cards.push(none);
        }
        items.forEach((it) => {
          const own = st.inv.includes(it.id);
          const b = h('button', { class: `gm-item${own ? '' : ' locked'} gm-r-${it.rarity}`, type: 'button', 'aria-pressed': String(draft[slot] === it.id), disabled: !own, title: own ? it.name : `${it.name} · ${itemHint(it)}` }, slot === 'hairColor' || slot === 'skin' ? h('span', { class: 'gm-swatch big', style: `background:${slot === 'skin' ? SKIN[it.id][0] : HAIR_COLOR[it.id]}` }) : itemThumb(it.id, 64), h('span', { class: 'gm-item-name', text: it.name }), own ? null : h('span', { class: 'gm-item-lock' }, icon('lock'), itemHint(it)));
          b.addEventListener('click', () => {
            draft[slot] = it.id;
            drawGrid();
            drawPreview();
          });
          cards.push(b);
        });
        return h('div', { class: 'gm-closet-slot' }, h('h3', { text: SLOT_LABELS[slot] }), h('div', { class: 'gm-items' }, cards));
      }),
    );
  };
  CLOSET_GROUPS.forEach(([k, label]) => {
    const b = h('button', { class: 'gm-chip', type: 'button', role: 'tab', 'aria-selected': String(k === group) }, label);
    b.addEventListener('click', () => {
      group = k;
      tabs.querySelectorAll('.gm-chip').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
      drawGrid();
    });
    tabs.append(b);
  });
  save.addEventListener('click', async () => {
    save.disabled = true;
    status.textContent = '저장하는 중…';
    const r = await gameCall('game_equip', { look: draft });
    if (!r.ok) {
      status.textContent = r.error || '저장하지 못했습니다.';
      save.disabled = false;
      return;
    }
    Object.assign(st, gameState);
    status.textContent = '갈아입었어요!';
    drawPreview();
  });
  reset.addEventListener('click', () => {
    Object.assign(draft, st.look);
    drawGrid();
    drawPreview();
  });
  drawPreview();
  drawGrid();
  const got = collectedCount(st.inv);
  return h('div', { class: 'gm-closet' }, h('div', { class: 'gm-closet-left' }, preview, h('div', { class: 'gm-row' }, save, reset), status, h('div', { class: 'gm-collect mini' }, h('b', { text: `모은 아이템 ${got} / ${COLLECTIBLE_IDS.length}` }), progressBar(got, COLLECTIBLE_IDS.length, 'gm-bar-collect'))), h('div', { class: 'gm-closet-right' }, tabs, grid));
}

/* ---------- 상점 ---------- */
const SHOP_GROUPS = [
  ['deal', '이번 주 특가', []],
  ['robe', '옷', ['robe']],
  ['hair', '머리', ['hair', 'hairColor']],
  ['jewel', '보석 · 장식', ['head', 'chest', 'handR', 'handL', 'feet']],
  ['pet', '동물 친구', ['pet']],
  ['bg', '배경', ['bg']],
  ['special', '특별', []],
];
const RARITY_ORDER = { common: 0, rare: 1, epic: 2, legend: 3 };
/** 다음 월요일까지 남은 날 (특가가 바뀌는 날) */
function daysToMonday(today) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(today || ''));
  if (!m) return 7;
  const dow = (new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay() + 6) % 7;
  return 7 - dow;
}
function renderShop(st) {
  let group = 'deal';
  const grid = h('div', { class: 'gm-shop-grid' });
  const tabs = h('div', { class: 'gm-chips', role: 'tablist' });
  const deals = st.deals || weeklyDeals(weekKeyOf(st.today));
  const me = { level: st.level || levelOf(st.xp), badges: st.badges || [] };
  // opts: { orig: 할인 전 값, off: 할인율, need: 조건 }
  const buyCard = (title, thumb, desc, price, owned, onBuy, rarity = 'common', extra = null, opts = {}) => {
    const can = st.talents >= price;
    const needOk = itemNeedMet(opts.need, me);
    const act = h('div', { class: 'gm-shop-act' });
    const drawAct = () => {
      if (owned()) {
        act.replaceChildren(h('span', { class: 'gm-chip-soft ok', text: '가지고 있어요' }), extra ? extra() : null);
        return;
      }
      if (!needOk) {
        act.replaceChildren(h('span', { class: 'gm-need' }, icon('lock'), itemNeedLabel(opts.need)), h('span', { class: 'meta' }, coin(price)));
        return;
      }
      const b = h('button', { class: `btn ${can ? 'primary' : ''}`, type: 'button', disabled: !can }, coin(price), can ? ' 구입' : ` 부족 (${price - st.talents} 더)`);
      b.addEventListener('click', () => {
        const yes = h('button', { class: 'btn primary', type: 'button' }, '네, 살게요');
        const no = h('button', { class: 'btn', type: 'button' }, '취소');
        no.addEventListener('click', drawAct);
        yes.addEventListener('click', async () => {
          yes.disabled = true;
          no.disabled = true;
          const r = await onBuy();
          if (!r.ok) {
            toast(r.error || '구입하지 못했습니다.', 3000);
            drawAct();
            return;
          }
          Object.assign(st, gameState);
          const badge = (r.events || []).filter((e) => e.type === 'badge');
          toast(`${title}을(를) 샀어요!${badge.length ? ` 업적 「${(BADGES.find(([id]) => id === badge[0].id) || [, badge[0].id])[1]}」 달성!` : ''}`, badge.length ? 3500 : 2200);
          renderGame('shop').then(() => {
            const top = document.querySelector('.gm-pill-coin');
            if (top) top.classList.add('gm-pop');
          });
        });
        act.replaceChildren(h('span', { class: 'meta', text: `${price} 달란트를 쓸까요?` }), yes, no);
      });
      act.replaceChildren(b);
    };
    drawAct();
    return h(
      'article',
      { class: `gm-shop-card gm-r-${rarity}${opts.off ? ' deal' : ''}${needOk ? '' : ' gated'}` },
      opts.off ? h('span', { class: 'gm-deal-tag', text: `${opts.off}% 할인` }) : null,
      h('div', { class: 'gm-shop-thumb' }, thumb),
      h('div', { class: 'gm-shop-info' }, h('h3', {}, title, ' ', rarityChip(rarity)), desc ? h('p', { class: 'meta', text: desc }) : null, opts.off ? h('p', { class: 'gm-was' }, h('s', { text: `${opts.orig}` }), ` → ${price} 달란트`) : null),
      act,
    );
  };
  const itemCard = (it) => {
    const off = deals[it.id] || 0;
    const price = dealPrice(it.price, off);
    return buyCard(
      it.name,
      it.slot === 'hairColor' ? h('span', { class: 'gm-swatch huge', style: `background:${HAIR_COLOR[it.id]}` }) : itemThumb(it.id, 96),
      it.desc || SLOT_LABELS[it.slot],
      price,
      () => st.inv.includes(it.id),
      () => gameCall('game_buy', { item: it.id }),
      it.rarity,
      () => h('a', { class: 'btn small', href: `#/g/closet?${it.id}`, onclick: (e) => (e.preventDefault(), openCloset(it.id)) }, '입어 보기'),
      { off, orig: it.price, need: it.need },
    );
  };
  const draw = () => {
    if (group === 'special') {
      grid.replaceChildren(
        buyCard(
          `안식 쿠폰 (${st.freeze}/${GAME_RULES.freezeMax}장)`,
          h('span', { class: 'gm-coupon' }, icon('clock')),
          '하루를 쉬어도 연속 도장이 끊기지 않게 지켜 줘요. 쉬는 날이 생기면 자동으로 쓰여요.',
          GAME_RULES.freezePrice,
          () => st.freeze >= GAME_RULES.freezeMax,
          () => gameCall('game_buy', { item: 'freeze' }),
        ),
      );
      return;
    }
    if (group === 'deal') {
      const left = daysToMonday(st.today);
      const ids = Object.keys(deals).filter((id) => GAME_ITEMS[id]);
      grid.replaceChildren(
        h('div', { class: 'gm-deal-head' }, h('b', {}, icon('flame'), ' 이번 주에만 이 값!'), h('span', { class: 'meta', text: left <= 1 ? '오늘 밤이 지나면 바뀌어요' : `${left}일 뒤 월요일에 새 특가로 바뀌어요` })),
        ...ids.map((id) => itemCard(GAME_ITEMS[id])),
      );
      return;
    }
    const [, , slots] = SHOP_GROUPS.find(([k]) => k === group);
    const items = GAME_ITEM_LIST.map(([id]) => GAME_ITEMS[id])
      .filter((it) => it.src === 'shop' && slots.includes(it.slot))
      .sort((a, b) => RARITY_ORDER[a.rarity] - RARITY_ORDER[b.rarity] || a.price - b.price);
    grid.replaceChildren(...items.map(itemCard));
  };
  SHOP_GROUPS.forEach(([k, label]) => {
    const b = h('button', { class: `gm-chip${k === 'deal' ? ' gm-chip-deal' : ''}`, type: 'button', role: 'tab', 'aria-selected': String(k === group) }, label);
    b.addEventListener('click', () => {
      group = k;
      tabs.querySelectorAll('.gm-chip').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
      draw();
    });
    tabs.append(b);
  });
  draw();
  const got = collectedCount(st.inv);
  return h(
    'div',
    { class: 'gm-shop' },
    h('div', { class: 'gm-collect' }, h('div', {}, h('b', { text: `내 보물 창고 ${got} / ${COLLECTIBLE_IDS.length}` }), h('span', { class: 'meta', text: ' · 10 · 25 · 50개를 모으면 업적 달란트' })), progressBar(got, COLLECTIBLE_IDS.length, 'gm-bar-collect')),
    h('p', { class: 'meta', text: '달란트는 퀘스트 정답 · 도장 · 업적으로 모여요. 보물·전설 아이템은 레벨이나 업적을 이뤄야 살 수 있어요. 입으면 몸 주위가 반짝반짝!' }),
    tabs,
    grid,
  );
}
function openCloset(itemId) {
  history.replaceState(null, '', '#/g/closet');
  app.replaceChildren(h('div', { class: 'gm' }, gameTabs('closet'), gameTopStats(gameState), renderCloset(gameState, itemId)));
  window.scrollTo(0, 0);
}

/* ---------- 순위 ---------- */
function boardList(players, compact = false, metric = 'weekXp') {
  if (!players.length) return h('p', { class: 'meta', text: '아직 기록이 없어요.' });
  const val = (p) => Number(p[metric]) || 0;
  players = [...players].sort((a, b) => val(b) - val(a) || b.weekXp - a.weekXp || b.xp - a.xp);
  const top = Math.max(1, ...players.map(val));
  const unit = metric === 'weekScore' ? '점' : metric === 'collect' ? '개' : ' XP';
  return h(
    'ol',
    { class: `gm-board${compact ? ' compact' : ''}` },
    players.map((p, i) =>
      h(
        'li',
        { class: `gm-player${p.me ? ' me' : ''}` },
        h('span', { class: `gm-rank r${i + 1}`, text: String(i + 1) }),
        h('span', { class: 'gm-player-art' }, avatarNode(p.look, { size: compact ? 48 : 64, frame: false })),
        h('span', { class: 'gm-player-info' }, h('b', {}, p.name, p.me ? h('span', { class: 'gm-me', text: '나' }) : null, i === 0 && val(p) > 0 ? h('span', { class: 'gm-mvp', text: 'MVP' }) : null), h('span', { class: 'meta', text: `Lv.${p.level} ${p.title} · 연속 ${p.streak}일${p.stampedToday ? ' · 오늘 도장 ✓' : ''}` }), progressBar(val(p), top, 'gm-bar-week')),
        h('span', { class: 'gm-player-xp', text: `${val(p).toLocaleString('ko-KR')}${unit}` }),
      ),
    ),
  );
}
function renderRank(st) {
  const box = h('section', { class: 'gm-card' }, h('div', { class: 'gm-card-head' }, h('h2', {}, icon('trophy'), '이번 주 가족 순위'), h('span', { class: 'meta', text: '매주 월요일에 새로 시작해요' })));
  // 겨루는 방식: 경험치(XP) 순위 · 퀘스트 점수 순위 (이번 주 처음 푼 퀘스트 점수의 합)
  let metric = 'weekXp';
  let players = null;
  const tabs = h('div', { class: 'gm-board-tabs', role: 'tablist' });
  const holder = h('div', {}, h('p', { class: 'meta', text: '불러오는 중…' }));
  const draw = () => {
    tabs.replaceChildren(...[['weekXp', '경험치 순위'], ['weekScore', '퀘스트 점수 순위'], ['collect', '보물 수집 순위']].map(([k, label]) => {
      const b = h('button', { class: 'gm-board-tab', type: 'button', role: 'tab', 'aria-selected': String(metric === k), text: label });
      b.addEventListener('click', () => {
        metric = k;
        draw();
      });
      return b;
    }));
    if (players) holder.replaceChildren(boardList(players, false, metric), metric === 'weekScore' ? h('p', { class: 'meta', text: '이번 주에 처음 푼 퀘스트의 점수를 모두 더해요. 빨리 · 연속으로 맞힐수록 높아져요.' }) : metric === 'collect' ? h('p', { class: 'meta', text: `상점·여정에서 모은 아이템 수예요 (모두 ${COLLECTIBLE_IDS.length}개). 보물·전설 아이템을 입으면 캐릭터가 반짝여요.` }) : null);
  };
  box.append(tabs, holder);
  draw();
  gameCall('game_board').then((r) => {
    if (!r.ok) return holder.replaceChildren(h('p', { class: 'meta', text: r.error || '불러오지 못했습니다.' }));
    players = r.players;
    draw();
  });
  // 내 이름 · 칭호
  const nick = h('input', { class: 'search', type: 'text', maxlength: '12', 'aria-label': '게임 이름' });
  nick.value = st.nick || '';
  const titles = [st.levelTitle, ...st.titles];
  const titleSel = h('select', { class: 'search', 'aria-label': '보여 줄 칭호' }, titles.map((t) => h('option', { value: t === st.levelTitle ? '' : t, text: t === st.levelTitle ? `${t} (레벨 칭호)` : t })));
  titleSel.value = st.title || '';
  const status = h('p', { class: 'meta', role: 'status' });
  const save = h('button', { class: 'btn primary', type: 'button' }, '저장');
  save.addEventListener('click', async () => {
    save.disabled = true;
    const r = await gameCall('game_profile', { nick: nick.value.trim(), title: titleSel.value });
    save.disabled = false;
    status.textContent = r.ok ? '저장했어요.' : r.error || '저장하지 못했습니다.';
  });
  const me = h('section', { class: 'gm-card' }, h('h2', { text: '내 이름과 칭호' }), h('div', { class: 'gm-form' }, h('label', {}, h('span', { text: '이름' }), nick), h('label', {}, h('span', { text: '칭호' }), titleSel), save), status, h('p', { class: 'meta', text: `누적 ${st.xp} XP · 퀘스트 ${st.stats.quests}번 · 만점 ${st.stats.perfect}번 · 묵상 ${st.stats.reflects}번` }));
  return h('div', { class: 'gm-rankpage' }, box, me);
}

/* ---------- 말씀 퀘스트 (퀴즈 풀기) ---------- */
let questAbort = null;
// 퀘스트에서 돌아갈 곳: 설교는 성경공부 화면, 오늘의 말씀은 그날 말씀 화면
const questHome = (d) => (d.proverb ? `#/p/${d.proverb}/word` : d.daily ? `#/r/${d.date}/read` : `#/v/${encodeURIComponent(d.id)}/study`);
const questHomeLabel = (d) => (d.daily ? '말씀으로 돌아가기' : '설교로 돌아가기');
async function renderQuest(id) {
  if (questAbort) questAbort();
  document.title = '말씀 퀘스트 · 말씀결';
  app.replaceChildren(h('div', { class: 'gm' }, h('p', { class: 'loading', text: '퀘스트를 준비하는 중…' })));
  let d;
  try {
    const pch = typeof provChapterFromQuizId === 'function' ? provChapterFromQuizId(id) : 0;
    const bdate = typeof dateOfDailyId === 'function' ? dateOfDailyId(id) : '';
    if (pch) {
      const pv = await loadProverb(pch);
      if (!pv || !pv.quiz) throw new Error(`잠언 ${pch}장 퀴즈는 아직 준비 중이에요.`);
      d = { id, daily: true, proverb: pch, category: 'proverbs', title: `잠언 ${pch}장`, date: localToday(), study: { quiz: pv.quiz } };
    } else if (bdate) {
      const daily = await loadDaily(bdate);
      if (!daily) throw new Error('이 날의 말씀 퀴즈를 아직 찾지 못했어요.');
      d = { id, daily: true, category: 'daily', title: daily.refs, date: bdate, study: { quiz: daily.quiz || {} } };
    } else d = await loadDetail(id);
  } catch (e) {
    app.replaceChildren(h('div', { class: 'gm' }, h('div', { class: 'empty' }, h('p', { text: String(e.message || e) }))));
    return;
  }
  let st = null;
  try {
    st = await ensureGameState(true);
  } catch {
    st = null; // 저장 없이 연습으로
  }
  if (!location.hash.startsWith('#/q/')) return;
  const quiz = (d.study && d.study.quiz) || {};
  const items = [...(quiz.multiple_choice || []).map((q) => ({ kind: 'mc', q })), ...(quiz.fill_blank || []).map((q) => ({ kind: 'fb', q }))];
  const back = h('a', { class: 'back', href: questHome(d) }, icon('back'), questHomeLabel(d));
  if (!items.length) {
    app.replaceChildren(back, h('div', { class: 'empty' }, h('p', { text: d.daily ? '이 날의 말씀 퀴즈는 아직 준비 중이에요.' : '이 설교에는 아직 퀴즈가 없어요.' })));
    return;
  }
  const already = !!(st && st.quizzes[d.id]);
  const capped = !!(st && !already && st.dailyLeft === 0);
  const practice = !st || already || capped;
  const why = !gameCanSave() ? '로그인하지 않아 연습으로만 풀어요 (점수는 저장되지 않아요).' : !st ? '게임 기록을 불러오지 못해 연습으로 풀어요.' : already ? `이미 점수를 받은 퀘스트예요 (${st.quizzes[d.id].s}/${st.quizzes[d.id].t}). 다시 풀면 연습이지만, 절반 이상 맞히면 오늘 도장은 받을 수 있어요.` : capped ? `오늘 점수 퀘스트 2개를 모두 했어요. 지금은 연습이지만, 이 ${d.daily ? '퀴즈' : '설교'}는 내일 점수를 받을 수 있어요.` : '';

  const nMc = (quiz.multiple_choice || []).length;
  const nFb = (quiz.fill_blank || []).length;
  const maxXp = nMc * GAME_RULES.xp.mc + nFb * GAME_RULES.xp.blank + GAME_RULES.xp.perfect;
  const intro = h(
    'section',
    { class: 'gm-card gm-qintro' },
    h('div', { class: 'gm-qintro-art' }, avatarNode(gameLook(), { size: 150, mood: 'cheer' })),
    h(
      'div',
      {},
      h('p', { class: 'gm-kicker', text: d.proverb ? '잠언 묵상' : d.daily ? `오늘의 말씀 · ${dateLabel(d.date)}` : `${catLabel(d.category)} · ${formatDate(d.date)}` }),
      h('h1', { text: d.title }),
      h('p', { class: 'meta', text: `객관식 ${nMc}문제 · 빈칸 ${nFb}문제 (빈칸은 직접 입력, 띄어쓰기는 상관없어요)` }),
      h('p', { class: 'gm-rules' }, icon('flame'), ' 빨리 맞힐수록, 연속으로 맞힐수록 점수가 올라가요. 가족 순위에는 ', h('b', { text: '처음 푼 한 번' }), '의 점수가 올라가니 신중하게 도전하세요!'),
      h('div', { class: 'gm-qboard-slot' }),
      practice ? h('p', { class: 'gm-practice', text: why }) : h('p', { class: 'gm-stake' }, icon('star'), `모두 맞히면 최대 ${maxXp} XP · 달란트 ×${st.mult} (연속 ${st.streak}일)`),
      h('div', { class: 'gm-row' }, h('button', { class: 'btn primary gm-big', type: 'button', onclick: () => play() }, '퀘스트 시작'), h('a', { class: 'btn', href: questHome(d) }, d.daily ? '먼저 말씀 읽기' : '먼저 공부하기')),
    ),
  );
  app.replaceChildren(h('div', { class: 'gm gm-questwrap' }, back, intro));
  fillQuestBoard(intro.querySelector('.gm-qboard-slot'), d.id, { before: true });

  function play() {
    const answers = { mc: new Array(nMc).fill(null), fb: new Array(nFb).fill('') };
    const correct = [];
    const ms = []; // 문제마다 걸린 시간 (속도 보너스 · 순위용)
    const kinds = items.map((it) => it.kind);
    const liveScore = () => {
      const k = correct.length;
      const q = questScore(correct.slice(0, k).map(Boolean), ms.slice(0, k), kinds.slice(0, k));
      return q.total - (k < items.length ? q.perfect : 0); // 만점 보너스는 끝까지 맞혔을 때만
    };
    const scoreEl = h('span', { class: 'gm-score', 'aria-live': 'polite', text: '0점' });
    let shownScore = 0;
    let i = 0;
    let combo = 0;
    let bestCombo = 0;
    const stage = h('div', { class: 'gm-qstage' });
    const bar = h('div', { class: 'gm-qbar' }, items.map(() => h('span')));
    const counter = h('span', { class: 'gm-qcount' });
    const comboEl = h('span', { class: 'gm-combo', 'aria-live': 'polite' });
    const quit = h('button', { class: 'btn small', type: 'button' }, icon('close'), '그만하기');
    quit.addEventListener('click', () => {
      const sure = h('div', { class: 'gm-quit' }, h('span', { text: '그만두면 이번 기록은 저장되지 않아요.' }), h('button', { class: 'btn small danger', type: 'button', onclick: () => (location.hash = questHome(d)) }, '그만두기'), h('button', { class: 'btn small', type: 'button', onclick: () => sure.remove() }, '계속 풀기'));
      stage.prepend(sure);
    });
    const shell = h('div', { class: 'gm gm-questwrap' }, h('div', { class: 'gm-qhead' }, quit, counter, scoreEl, comboEl), bar, stage);
    app.replaceChildren(shell);
    let alive = true;
    questAbort = () => (alive = false);
    const onKey = (e) => {
      if (!alive || !location.hash.startsWith('#/q/')) return document.removeEventListener('keydown', onKey);
      if (/^[1-4]$/.test(e.key) && items[i] && items[i].kind === 'mc' && document.activeElement.tagName !== 'INPUT') {
        const b = stage.querySelectorAll('.gm-opt')[Number(e.key) - 1];
        if (b && !b.disabled) b.click();
      }
    };
    document.addEventListener('keydown', onKey);

    const showQ = () => {
      const it = items[i];
      counter.textContent = `${i + 1} / ${items.length}`;
      const lvl = it.kind === 'mc' ? it.q.level || '' : '';
      const limitMs = it.kind === 'fb' ? QUEST_SCORE.limitBlank : QUEST_SCORE.limitMc;
      const timerFill = h('span', { class: 'gm-timer-fill', style: `animation-duration:${limitMs}ms` });
      const timerTxt = h('span', { class: 'gm-timer-txt', text: '⚡ 빠를수록 보너스' });
      const timer = h('div', { class: 'gm-timer', 'aria-hidden': 'true' }, h('span', { class: 'gm-timer-track' }, timerFill), timerTxt);
      const t0 = performance.now();
      const card = h('section', { class: 'gm-qcard' }, h('div', { class: 'gm-qtags' }, h('span', { class: 'gm-chip-soft', text: it.kind === 'mc' ? '객관식' : '빈칸 채우기' }), lvl ? h('span', { class: `gm-chip-soft lv-${lvl}`, text: lvl }) : null), timer);
      timerFill.addEventListener('animationend', () => {
        timer.classList.add('out');
        timerTxt.textContent = '속도 보너스 끝 — 그래도 맞히면 점수!';
      });
      const feedback = h('div', { class: 'gm-feedback', hidden: true });
      feedback.hidden = true;
      const next = h('button', { class: 'btn primary gm-big', type: 'button' }, i + 1 < items.length ? '다음 문제' : '결과 보기');
      next.addEventListener('click', () => {
        i += 1;
        if (i < items.length) showQ();
        else finish();
      });
      const judge = (ok, rightText, explanation) => {
        ms[i] = Math.round(performance.now() - t0);
        timerFill.style.animationPlayState = 'paused';
        timer.classList.add('done');
        correct[i] = ok;
        combo = ok ? combo + 1 : 0;
        bestCombo = Math.max(bestCombo, combo);
        const pts = questPoints(ok, ms[i], it.kind, combo);
        const gained = pts.base + pts.speed + pts.combo;
        const nowScore = liveScore();
        countTo(scoreEl, shownScore, nowScore, (n) => `${n.toLocaleString('ko-KR')}점`);
        shownScore = nowScore;
        bar.children[i].className = ok ? 'ok' : 'no';
        comboEl.replaceChildren(combo >= 2 ? h('span', { class: 'gm-combo-in' }, icon('flame'), `${combo}연속 정답!`) : '');
        const xpTxt = ok && !practice ? `+${it.kind === 'mc' ? GAME_RULES.xp.mc : GAME_RULES.xp.blank} XP` : '';
        feedback.className = `gm-feedback ${ok ? 'ok' : 'no'}`;
        feedback.replaceChildren(
          h('div', { class: 'gm-fb-head' }, h('strong', { text: ok ? ['정답이에요!', '맞았어요!', '훌륭해요!'][i % 3] : '아쉬워요' }), ok ? h('span', { class: 'gm-pts sc', text: `+${gained}점` }) : null, xpTxt ? h('span', { class: 'gm-pts', text: xpTxt }) : null),
          ok ? h('p', { class: 'gm-ptsdetail', text: `정답 +${pts.base}${pts.speed ? ` · ⚡ 속도 +${pts.speed}` : ''}${pts.combo ? ` · 🔥 ${combo}연속 +${pts.combo}` : ''} (${(ms[i] / 1000).toFixed(1)}초)` }) : h('p', { class: 'gm-ptsdetail', text: `${(ms[i] / 1000).toFixed(1)}초 · 연속 정답이 끊겼어요` }),
          ok ? null : h('p', {}, '정답: ', h('b', { text: rightText })),
          explanation ? h('p', { class: 'md' }, inlineMd(explanation)) : null,
          next,
        );
        feedback.hidden = false;
        if (!ok && navigator.vibrate) navigator.vibrate(60);
        card.classList.add(ok ? 'gm-good' : 'gm-bad');
        setTimeout(() => next.focus({ preventScroll: true }), 60);
        feedback.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      };
      if (it.kind === 'mc') {
        const mi = items.slice(0, i).filter((x) => x.kind === 'mc').length;
        card.append(h('h2', { class: 'gm-qtext' }, inlineMd(it.q.question)));
        const opts = h('div', { class: 'gm-opts' });
        it.q.options.forEach((o, k) => {
          const b = h('button', { class: 'gm-opt', type: 'button' }, h('span', { class: 'gm-opt-key', text: String(k + 1) }), h('span', { text: o }));
          b.addEventListener('click', () => {
            answers.mc[mi] = k;
            opts.querySelectorAll('.gm-opt').forEach((x, j) => {
              x.disabled = true;
              if (j === it.q.answer_index) x.classList.add('right');
              else if (j === k) x.classList.add('wrong');
            });
            judge(k === it.q.answer_index, `${it.q.answer_index + 1}. ${it.q.options[it.q.answer_index]}`, it.q.explanation);
          });
          opts.append(b);
        });
        card.append(opts);
      } else {
        const fi = items.slice(0, i).filter((x) => x.kind === 'fb').length;
        const parts = String(it.q.question).split(/_{2,}/);
        const input = h('input', { class: 'gm-blank-input', type: 'text', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', enterkeyhint: 'done', 'aria-label': '빈칸에 들어갈 말' });
        const sentence = h('h2', { class: 'gm-qtext' }, parts.length > 1 ? [inlineMd(parts[0]), h('span', { class: 'gm-blank', text: '?' }), h('span', { class: 'gm-blank-len', text: blankHint(it.q.answer) }), inlineMd(parts.slice(1).join('____'))] : inlineMd(blankQuestionText({ question: it.q.question, answer: it.q.answer })));
        const check = h('button', { class: 'btn primary', type: 'button' }, '확인');
        const submit = () => {
          const v = input.value.trim();
          if (!v) {
            input.focus();
            return;
          }
          answers.fb[fi] = v;
          input.disabled = true;
          check.disabled = true;
          const accept = [it.q.answer, ...(it.q.accept || [])];
          const ok = accept.some((a) => blankKeyClient(a) === blankKeyClient(v));
          const blank = sentence.querySelector('.gm-blank');
          if (blank) {
            blank.textContent = it.q.answer;
            blank.classList.add(ok ? 'right' : 'wrong');
          }
          judge(ok, it.q.answer + (it.q.accept && it.q.accept.length ? ` (${it.q.accept.join(', ')}도 정답)` : ''), it.q.explanation);
        };
        check.addEventListener('click', submit);
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && !e.isComposing) {
            e.preventDefault();
            submit();
          }
        });
        card.append(sentence, h('div', { class: 'gm-blank-row' }, input, check), h('p', { class: 'meta', text: `핵심 단어 하나를 적어 주세요${blankHint(it.q.answer) ? ` ${blankHint(it.q.answer)}` : ''}. 띄어쓰기는 상관없어요.` }));
        setTimeout(() => input.focus({ preventScroll: true }), 80);
      }
      card.append(feedback);
      stage.replaceChildren(card);
      window.scrollTo({ top: 0 });
    };

    const finish = async () => {
      document.removeEventListener('keydown', onKey);
      const right = correct.filter(Boolean).length;
      stage.replaceChildren(h('p', { class: 'loading', text: '채점 결과를 저장하는 중…' }));
      let server = null;
      let events = [];
      let err = '';
      markQuestDone(d.id, right, items.length); // 이 퀴즈의 문제·해설 목록이 열립니다
      const localScore = questScore(correct.map(Boolean), ms, kinds);
      if (gameCanSave()) {
        const r = await gameCall('game_quiz', { video_id: d.id, mc: answers.mc.map((x) => (x == null ? -1 : x)), fb: answers.fb, ms: ms.map((x) => x || 0) });
        if (r.ok) {
          server = r.result;
          events = r.events || [];
        } else err = r.error || '저장하지 못했습니다.';
      }
      if (!alive) return;
      renderResult({ d, items, correct, answers, right, total: items.length, server, events, err, bestCombo, shell, score: (server && server.score) || localScore });
    };
    showQ();
  }
}

/* ---------- 이 퀘스트의 가족 순위 ---------- */
const fmtSec = (ms) => {
  const t = Math.round(ms / 1000);
  return t >= 60 ? `${Math.floor(t / 60)}분 ${t % 60}초` : `${t}초`;
};
const MEDALS = ['🥇', '🥈', '🥉'];
function questBoardList(players) {
  return h(
    'ol',
    { class: 'gm-qb' },
    players.slice(0, 5).map((p, i) =>
      h(
        'li',
        { class: `gm-qb-row${p.me ? ' me' : ''}` },
        h('span', { class: 'gm-qb-rank', text: MEDALS[i] || String(i + 1) }),
        h('span', { class: 'gm-qb-art' }, avatarNode(p.look, { size: 40, frame: false })),
        h('span', { class: 'gm-qb-name' }, h('b', { text: p.name }), p.me ? h('span', { class: 'gm-me', text: '나' }) : null, h('span', { class: 'meta', text: `${p.s}/${p.t} · ${fmtSec(p.ms)}` })),
        h('span', { class: 'gm-qb-score', text: `${p.sc.toLocaleString('ko-KR')}점` }),
      ),
    ),
  );
}
/** slot 안에 이 퀘스트의 가족 순위를 채웁니다. before = 풀기 전(도전 의욕용), 아니면 결과 화면 */
async function fillQuestBoard(slot, id, { before = false, myScore = null } = {}) {
  if (!slot || !gameCanSave()) return;
  const r = await gameCall('game_quest_board', { video_id: id });
  if (!slot.isConnected) return;
  if (!r.ok) return; // 옛 Apps Script 이거나 연결 실패면 조용히 건너뜁니다
  const list = r.players || [];
  if (!list.length) {
    slot.replaceChildren(h('div', { class: 'gm-qboard' }, h('b', { text: before ? '아직 아무도 도전하지 않았어요' : '이 퀘스트의 첫 번째 기록이에요!' }), h('span', { class: 'meta', text: before ? '1등 자리를 먼저 차지해 보세요.' : '' })));
    return;
  }
  const top = list[0];
  const mineIdx = list.findIndex((p) => p.me);
  let msg = '';
  if (before) msg = mineIdx === 0 ? '지금은 내가 1등이에요! 아무도 못 넘게 지켜요.' : mineIdx > 0 ? `내 기록은 ${mineIdx + 1}위예요. 1등 ${top.name}님은 ${top.sc.toLocaleString('ko-KR')}점!` : `1등 ${top.name}님의 ${top.sc.toLocaleString('ko-KR')}점을 넘어 보세요!`;
  else if (mineIdx === 0) msg = list.length > 1 ? `🎉 이 퀘스트 1등! 2위 ${list[1].name}님과 ${(top.sc - list[1].sc).toLocaleString('ko-KR')}점 차이예요.` : '🎉 이 퀘스트의 첫 번째 기록이에요!';
  else if (mineIdx > 0) msg = `${mineIdx + 1}위예요. 1등 ${top.name}님까지 ${(top.sc - list[mineIdx].sc).toLocaleString('ko-KR')}점 남았어요.`;
  slot.replaceChildren(h('div', { class: 'gm-qboard' }, h('div', { class: 'gm-qboard-head' }, icon('trophy'), h('b', { text: before ? '가족 기록' : '이 퀘스트 가족 순위' }), h('span', { class: 'meta', text: `${r.count}명 도전` })), msg ? h('p', { class: 'gm-qboard-msg', text: msg }) : null, questBoardList(list)));
}

function eventCard(ev) {
  const card = (cls, art, title, sub) => h('div', { class: `gm-ev ${cls}` }, h('div', { class: 'gm-ev-art' }, art), h('div', {}, h('strong', { text: title }), sub ? h('span', { class: 'meta', text: sub }) : null));
  switch (ev.type) {
    case 'stamp':
      return card('stamp', stampSvg(56), '오늘의 도장 쾅!', `연속 ${ev.streak}일째 · +${ev.talents} 달란트 · +${ev.xp} XP`);
    case 'week':
      return card('gift', h('span', { class: 'gm-ev-ic' }, icon('gift')), `${ev.streak}일 연속 보너스!`, `+${ev.talents} 달란트`);
    case 'level':
      return card('level', h('span', { class: 'gm-ev-lv', text: `Lv.${ev.level}` }), '레벨 업!', `이제 「${ev.title}」 등급이에요`);
    case 'badge': {
      const b = BADGES.find(([id]) => id === ev.id) || [ev.id, ev.id, ''];
      return card('badge', h('span', { class: 'gm-ev-ic' }, icon('trophy')), `업적 달성: ${b[1]}`, `${b[2]} · +${ev.talents} 달란트`);
    }
    case 'step': {
      const j = JOURNEYS[ev.journey];
      const what = ev.journey === 'pilgrim' ? `${PILGRIM_STOPS[ev.step].name}에 도착!` : ev.journey === 'tree' ? (ev.step <= 4 ? ['', '새싹이 돋았어요', '어린나무가 되었어요', '나무가 자랐어요', '큰 나무가 되었어요'][ev.step] : `「${FRUITS[ev.step - 5][0]}」 열매가 맺혔어요`) : `${GAME_ITEMS[ev.item] ? GAME_ITEMS[ev.item].name : '장비'}를 얻었어요`;
      const gift = ev.item || ev.reward;
      return card('step', gift ? itemThumb(gift, 64) : h('span', { class: 'gm-ev-ic' }, icon('map')), `${j.short}: ${what}`, `${ev.step} / ${ev.steps} 단계${ev.reward ? ` · 보상 「${GAME_ITEMS[ev.reward].name}」` : ''}`);
    }
    case 'journey':
      return card('journey', h('span', { class: 'gm-ev-ic' }, icon('trophy')), `${JOURNEYS[ev.journey].name} 완주!`, `칭호 「${ev.title}」을 받았어요. 여정 화면에서 다음 여정을 골라 보세요.`);
    case 'comeback':
      return card('gift', h('span', { class: 'gm-ev-ic' }, icon('gift')), '다시 오신 것을 환영해요!', `+${ev.talents} 달란트`);
    case 'freeze':
      return card('gift', h('span', { class: 'gm-ev-ic' }, icon('clock')), '안식 쿠폰이 연속 기록을 지켰어요', `${ev.used}장 사용`);
    default:
      return null;
  }
}

function renderResult({ d, items, correct, answers, right, total, server, events, err, bestCombo, shell, score }) {
  const pct = right / total;
  const grade = pct === 1 ? '만점! 말씀을 꼭 붙드셨네요' : pct >= 0.8 ? '훌륭해요!' : pct >= 0.5 ? '잘했어요! 오늘의 도장 조건 달성' : '조금 아쉬워요. 설교를 다시 보고 도전해 보세요';
  const ring = svgNode(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="150" height="150" aria-hidden="true"><circle cx="60" cy="60" r="50" fill="none" stroke="#efe9da" stroke-width="9"/><circle cx="60" cy="60" r="50" fill="none" stroke="${pct >= 0.5 ? '#c9a14a' : '#b9a98a'}" stroke-width="9" stroke-linecap="round" stroke-dasharray="${(314 * pct).toFixed(1)} 314" transform="rotate(-90 60 60)" class="gm-ring"/></svg>`);
  const xpEl = h('b', { text: '0' });
  const talEl = h('b', { text: '0' });
  const head = h(
    'section',
    { class: 'gm-card gm-result' },
    h('div', { class: 'gm-result-ring' }, ring, h('div', { class: 'gm-result-score' }, h('b', { text: String(right) }), h('span', { text: `/ ${total}` }))),
    h(
      'div',
      { class: 'gm-result-text' },
      h('h1', { text: grade }),
      bestCombo >= 3 ? h('p', { class: 'meta' }, icon('flame'), ` 최고 ${bestCombo}연속 정답`) : null,
      server && server.scored
        ? h('div', { class: 'gm-gains' }, h('span', { class: 'gm-gain xp' }, '+', xpEl, ' XP'), h('span', { class: 'gm-gain tal' }, icon('coin'), '+', talEl), server.mult > 1 ? h('span', { class: 'gm-chip-soft', text: `연속 보너스 ×${server.mult}` }) : null)
        : h('p', { class: 'gm-practice', text: err ? `저장하지 못했어요: ${err}` : !gameCanSave() ? '연습 모드였어요. 로그인하면 점수와 도장이 저장돼요.' : server && server.already ? '이미 점수를 받은 퀘스트라 연습으로 기록했어요.' : server && server.capped ? '오늘 점수 퀘스트를 다 해서 연습으로 기록했어요. 이 설교는 내일 점수를 받을 수 있어요.' : '연습으로 기록했어요.' }),
    ),
  );
  // 퀘스트 점수 카드: 등급 · 점수 · 보너스 내역 · 걸린 시간 · 가족 순위
  const sc = score || questScore(correct.map(Boolean), [], items.map((x) => x.kind));
  const grade2 = questGrade(sc.total, total);
  const scoreEl = h('b', { class: 'gm-sc-num', text: '0' });
  const rows = [['정답', sc.base, '✔'], ['빠른 정답', sc.speed, '⚡'], ['연속 정답', sc.combo, '🔥'], ['만점 보너스', sc.perfect, '★']].filter(([, v]) => v > 0);
  const counted = server && server.record && server.firstRecord === false ? server.record : null;
  const scoreCard = h(
    'section',
    { class: `gm-card gm-scorecard g-${grade2}` },
    h('div', { class: 'gm-grade', 'aria-label': `등급 ${grade2}` }, h('b', { text: grade2 }), h('span', { text: '등급' })),
    h(
      'div',
      { class: 'gm-sc-main' },
      h('p', { class: 'gm-sc-line' }, scoreEl, h('span', { text: '점' })),
      h('ul', { class: 'gm-sc-break' }, rows.map(([k, v, ic]) => h('li', {}, h('span', { text: `${ic} ${k}` }), h('b', { text: `+${v.toLocaleString('ko-KR')}` })))),
      sc.ms ? h('p', { class: 'meta', text: `총 ${fmtSec(sc.ms)} · 평균 ${(sc.ms / total / 1000).toFixed(1)}초` }) : null,
      counted ? h('p', { class: 'gm-sc-note', text: `가족 순위에는 처음 푼 기록(${counted.sc.toLocaleString('ko-KR')}점)이 올라가 있어요. 이번 점수는 연습이에요.` }) : null,
      !gameCanSave() ? h('p', { class: 'gm-sc-note', text: '로그인하면 이 점수로 가족과 순위를 겨룰 수 있어요.' }) : null,
    ),
    h('div', { class: 'gm-qboard-slot gm-sc-board' }),
  );
  setTimeout(() => countTo(scoreEl, 0, sc.total, (n) => n.toLocaleString('ko-KR'), 1100), 250);
  if (gameCanSave() && !err) fillQuestBoard(scoreCard.querySelector('.gm-sc-board'), d.id, { before: false });
  const evs = events.map(eventCard).filter(Boolean);
  const evBox = evs.length ? h('section', { class: 'gm-events' }, evs) : null;
  const wrong = items.map((it, k) => ({ it, k })).filter(({ k }) => !correct[k]);
  const review = wrong.length
    ? h(
        'section',
        { class: 'gm-card gm-review' },
        h('h2', { text: `틀린 문제 다시 보기 (${wrong.length})` }),
        h(
          'ol',
          {},
          wrong.map(({ it }) => {
            const q = it.q;
            return h('li', {}, h('p', { class: 'gm-review-q' }, inlineMd(q.question)), h('p', {}, '정답: ', h('b', { text: it.kind === 'mc' ? q.options[q.answer_index] : q.answer })), q.explanation ? h('p', { class: 'meta md' }, inlineMd(q.explanation)) : null);
          }),
        ),
      )
    : null;
  const actions = h('div', { class: 'gm-row gm-result-actions' }, h('a', { class: 'btn primary gm-big', href: '#/' }, '게임 홈으로'), h('a', { class: 'btn', href: questHome(d) }, questHomeLabel(d)), h('a', { class: 'btn', href: `#/q/${encodeURIComponent(d.id)}`, onclick: (e) => (e.preventDefault(), renderQuest(d.id)) }, '다시 풀기'));
  const page = h('div', { class: 'gm gm-questwrap' }, head, scoreCard, evBox, review, actions);
  shell.replaceWith(page);
  app.replaceChildren(page);
  window.scrollTo(0, 0);
  if (server && server.scored) {
    countUp(xpEl, server.xp);
    countUp(talEl, server.talents);
  }
  if (pct === 1 || grade2 === 'S' || events.some((e) => e.type === 'level' || e.type === 'journey')) confetti(head, 34);
  else if (events.some((e) => e.type === 'stamp')) confetti(head, 16);
}

/* ---------- 묵상 퀘스트 (QT 묵상 화면의 버튼) ---------- */
function gameReflectButton(videoId, notes) {
  if (!gameCanSave()) return null;
  const done = gameState && gameState.reflects && gameState.reflects[videoId];
  const btn = h('button', { class: 'btn primary gm-reflect', type: 'button', disabled: !!done }, icon('stamp'), done ? '묵상 퀘스트 완료' : '묵상 퀘스트 완료하기');
  const out = h('p', { class: 'meta', role: 'status' });
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    out.textContent = '확인하는 중…';
    try {
      if (notes && notes.flush) await notes.flush();
    } catch {
      /* 저장은 아래 확인에서 다시 걸러집니다 */
    }
    const r = await gameCall('game_reflect', { video_id: videoId });
    if (!r.ok) {
      out.textContent = r.error || '완료하지 못했습니다.';
      btn.disabled = false;
      return;
    }
    if (r.result.already) {
      out.textContent = '이 설교의 묵상 퀘스트는 이미 완료했어요.';
      return;
    }
    btn.replaceChildren(icon('stamp'), '묵상 퀘스트 완료');
    out.replaceChildren(h('span', { text: `+${r.result.xp} XP · +${r.result.talents} 달란트${r.result.stamped ? ' · 오늘의 도장 쾅!' : ''} ` }), h('a', { href: '#/', text: '게임 홈 보기' }));
    if (r.result.stamped) confetti(btn.parentElement, 16);
  });
  return h('div', { class: 'gm-reflect-box' }, h('p', { class: 'meta', text: '묵상 질문에 내 답을 적고 이 버튼을 누르면 경험치와 달란트를 받아요 (설교마다 한 번, 오늘의 도장도 받아요).' }), btn, out);
}
