// 잠언 묵상 / 성경공부 — 잠언 1~31장, 날짜의 "일"이 곧 장 (1일 = 1장 … 31일 = 31장, 매달 되풀이)
//   #/p              오늘의 장
//   #/p/9[/모드]      잠언 9장 · 모드: word(말씀) | qt | study | group | quiz
// 자료: data/proverbs/<장>.json (동기화가 Proverbs 탭에서 만들어 내보냄). 화면 틀은 "오늘의 말씀"과 같습니다.
// 이 파일은 app.js · detail.js · notes.js · marks.js · game.js · daily.js(localToday, dateLabel) 를 씁니다.

const PROV_MODES = [
  ['word', '말씀'],
  ['qt', 'QT 묵상'],
  ['study', '성경공부'],
  ['group', '소그룹 나눔'],
  ['quiz', '퀴즈'],
];
const PROV_GROUP_KEY = 'sn-prov-group-view';
const provCache = new Map();
const provPad = (n) => String(n).padStart(2, '0');
const provChapterOf = (date) => Math.min(31, Math.max(1, Number(String(date).slice(8, 10)) || 1));
const provId = (ch) => `prov-${provPad(ch)}`; // 노트 · 형광펜 · PDF
const provQuizId = (ch, date = localToday()) => `prov-${date.slice(0, 4)}${date.slice(5, 7)}-${provPad(ch)}`; // 게임 퀴즈 (달마다 새로)
const provChapterFromQuizId = (id) => {
  const m = /^prov-\d{6}-(\d{2})$/.exec(id);
  return m ? Number(m[1]) : 0;
};

async function loadProverb(ch) {
  if (provCache.has(ch)) return provCache.get(ch);
  let d = null;
  try {
    const r = await fetch(`${dataBase()}proverbs/${ch}.json?t=${Math.floor(Date.now() / 600000)}`);
    if (r.ok) d = await r.json();
  } catch {
    d = null;
  }
  provCache.set(ch, d);
  return d;
}

async function renderProverbs(chArg, modeArg) {
  const today = localToday();
  const todayCh = provChapterOf(today);
  const ch = Number(chArg) >= 1 && Number(chArg) <= 31 ? Number(chArg) : todayCh;
  const mode = PROV_MODES.some(([k]) => k === modeArg) ? modeArg : 'word';
  const id = provId(ch);
  document.title = `잠언 ${ch}장 묵상 · 말씀결`;
  app.replaceChildren(h('div', { class: 'gm rd pv' }, h('p', { class: 'loading', text: `잠언 ${ch}장을 불러오는 중…` })));
  const d = await loadProverb(ch);
  if (!location.hash.startsWith('#/p')) return;
  let st = null;
  try {
    st = await ensureGameState();
  } catch {
    st = null;
  }
  const prev = ch === 1 ? 31 : ch - 1;
  const next = ch === 31 ? 1 : ch + 1;
  const nav = h(
    'div',
    { class: 'rd-datenav' },
    h('a', { class: 'rd-navbtn', href: `#/p/${prev}/${mode}`, 'aria-label': `잠언 ${prev}장` }, '‹', h('span', { text: `${prev}장` })),
    h('div', { class: 'rd-date' }, h('span', { text: ch === todayCh ? `${dateLabel(today)}의 잠언` : `매달 ${ch}일의 잠언` }), ch === todayCh ? h('em', { text: '오늘' }) : h('a', { href: `#/p/${todayCh}/${mode}`, text: '오늘의 장으로' })),
    h('a', { class: 'rd-navbtn next', href: `#/p/${next}/${mode}`, 'aria-label': `잠언 ${next}장` }, h('span', { text: `${next}장` }), '›'),
  );
  const word = d && d.word;
  const head = h(
    'header',
    { class: 'rd-head' },
    nav,
    h('p', { class: 'pv-kicker', text: '잠언 묵상 · 성경공부' }),
    h('h1', { class: 'rd-refs', text: `잠언 ${ch}장` }),
    word && word.theme ? h('p', { class: 'pv-theme', text: word.theme }) : null,
  );
  const chips = h(
    'nav',
    { class: 'pv-chapters', 'aria-label': '잠언 장 고르기' },
    Array.from({ length: 31 }, (_, i) => i + 1).map((n) => h('a', { class: `pv-ch${n === ch ? ' on' : ''}${n === todayCh ? ' today' : ''}`, href: `#/p/${n}/${mode}`, 'aria-current': n === ch ? 'page' : false, title: `잠언 ${n}장 (매달 ${n}일)`, text: String(n) })),
  );
  if (!d) {
    app.replaceChildren(h('div', { class: 'gm rd pv' }, h('a', { class: 'back', href: '#/' }, icon('back'), '게임 홈'), head, chips, h('div', { class: 'gm-card rd-wait' }, h('p', {}, h('strong', { text: `잠언 ${ch}장은 아직 준비 중이에요.` })), h('p', { class: 'meta', text: '매일 동기화 때 오늘 · 내일 장과 빠진 장을 몇 개씩 만들어요. 관리 화면의 "잠언 묵상"에서 지금 만들 수도 있어요.' }))));
    return;
  }
  const tabs = h('nav', { class: 'rd-tabs', 'aria-label': '잠언 묵상 보기 방식' }, PROV_MODES.map(([k, label]) => h('a', { class: 'rd-tab', href: `#/p/${ch}/${k}`, 'aria-current': k === mode ? 'page' : false, text: label })));
  const tools = h('div', { class: 'rd-tools' }, h('a', { class: 'btn', href: `#/h/${id}/${mode === 'group' ? provGroupView() : mode}` }, icon('file'), 'PDF 미리보기 · 다운로드'), h('a', { class: 'btn', href: sermonSearchUrl('잠언', ch), target: '_blank', rel: 'noopener noreferrer' }, icon('external'), '강해·설교 찾기'));
  teardownMarks();
  const notes = NOTES_ENABLED && auth.user ? createNotes({ id, title: `잠언 ${ch}장` }) : null;
  currentNotes = notes;
  const body = h('div', { class: 'rd-body', id: 'mode-body' });
  app.replaceChildren(h('div', { class: 'gm rd pv' }, h('a', { class: 'back', href: '#/' }, icon('back'), '게임 홈'), head, chips, tabs, tools, body));

  const dLike = { id, category: 'proverbs', title: `잠언 ${ch}장`, date: today, bible: false, qt: d.qt, study: d.study ? { ...d.study, quiz: null } : null, group: d.group };
  const notReady = (what) => h('div', { class: 'gm-card rd-wait' }, h('p', {}, h('strong', { text: `${what}은(는) 아직 준비 중이에요.` })), h('p', { class: 'meta', text: '다음 동기화 때 채워져요. 관리 화면의 "잠언 묵상"에서 이 장만 다시 만들 수도 있어요.' }));
  const add = (nodes) => body.append(...[nodes].flat(Infinity).filter(Boolean));
  if (mode === 'word') add(renderProverbWord(ch, d, st));
  else if (mode === 'qt') add(d.qt ? renderQtMode(dLike, notes) : notReady('QT 묵상'));
  else if (mode === 'study') add(d.study ? renderStudyMode(dLike) : notReady('성경공부'));
  else if (mode === 'group') add(d.group ? renderProverbGroup(ch, d.group, notes) : notReady('소그룹 나눔'));
  else if (mode === 'quiz') {
    const quiz = d.quiz;
    if (quiz && (quiz.multiple_choice || []).length) add([renderQuizCta({ id: provQuizId(ch), study: { quiz } }), renderQuiz(quiz)]);
    else add(notReady('퀴즈'));
  }
  if (notes) {
    notes.prune();
    const marks = createMarks(id, body, { enabled: true });
    notes.load().then((n) => {
      if (currentMarks === marks) marks.setAll(n ? n.marks : []);
    });
  } else createMarks(id, body, { enabled: false });
}

/* ---------- 말씀: 핵심 3구절 + 장의 흐름 + 본문 ---------- */
function renderProverbWord(ch, d, st) {
  const w = d.word || {};
  const out = [];
  if (w.summary) out.push(h('section', { class: 'gm-card pv-summary' }, h('h2', {}, icon('book'), `잠언 ${ch}장 한눈에`), h('p', { text: w.summary })));
  if ((w.key_verses || []).length)
    out.push(
      h(
        'section',
        { class: 'pv-keys', 'aria-label': '이 장의 핵심 구절 3' },
        h('h2', { class: 'pv-h2', text: '이 장의 핵심 구절' }),
        h(
          'ol',
          { class: 'pv-key-list' },
          w.key_verses.map((k) =>
            h(
              'li',
              { class: 'pv-key' },
              h('p', { class: 'pv-key-title', text: k.title }),
              h('blockquote', { class: 'pv-key-verse' }, h('p', { text: k.text }), h('cite', { text: k.reference })),
              k.meaning ? h('div', { class: 'md' }, h('p', {}, inlineMd(k.meaning))) : null,
              k.apply ? h('p', { class: 'pv-key-apply' }, h('b', { text: '오늘의 실천 ' }), inlineMd(k.apply)) : null,
            ),
          ),
        ),
      ),
    );
  if ((w.outline || []).length) out.push(h('section', { class: 'gm-card pv-outline' }, h('h2', { class: 'pv-h2', text: '장의 흐름' }), h('ul', {}, w.outline.map((o) => h('li', {}, h('span', { class: 'cm-verses', text: o.verses ? `${o.verses}절` : '' }), o.title)))));
  out.push(renderBibleViewer(d.bible, { open: true }));
  // 일독표: 잠언 N장 체크
  if (typeof gameCanSave === 'function' && gameCanSave()) {
    const key = chapterKey('20', ch);
    const on = !!(st && (st.bible || []).includes(key));
    const btn = h('button', { class: `btn gm-cta pv-read${on ? ' done' : ''}`, type: 'button', disabled: on }, icon('check'), on ? '일독표에 체크됨' : '다 읽었어요 · 일독표에 체크', h('span', { class: 'gm-cta-sub', text: on ? `잠언 ${ch}장이 성경일독표에 표시되어 있어요` : `성경일독표에 잠언 ${ch}장을 표시합니다` }));
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      const r = await gameCall('game_chapter', { key, on: true });
      if (!r.ok) {
        toast(r.error || '저장하지 못했어요.', 3000);
        btn.disabled = false;
        return;
      }
      btn.replaceChildren(icon('check'), '일독표에 체크됨', h('span', { class: 'gm-cta-sub', text: '이어서 퀴즈에 도전해 보세요' }));
    });
    out.push(h('div', { class: 'rd-done-box' }, btn));
  }
  return out;
}

/* ---------- 소그룹 나눔: 부원용 / 인도자용 해설서 ---------- */
const PROV_SECTIONS = [
  ['icebreaker', '마음 열기'],
  ['observation', '본문 관찰'],
  ['reflection', '묵상과 해석'],
  ['application', '삶의 적용'],
  ['prayer', '기도와 결단'],
];
function provGroupView() {
  try {
    return localStorage.getItem(PROV_GROUP_KEY) === 'leader' ? 'leader' : 'group';
  } catch {
    return 'group';
  }
}
function renderProverbGroup(ch, g, notes) {
  const wrap = h('div', { class: 'pv-group' });
  const switcher = h('div', { class: 'gm-chips pv-group-switch', role: 'tablist', 'aria-label': '소그룹 자료 종류' });
  const body = h('div', {});
  const views = [
    ['group', '부원용 (프린트·공유)'],
    ['leader', '인도자용 해설서'],
  ];
  const draw = () => {
    const v = provGroupView();
    switcher.querySelectorAll('.gm-chip').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.v === v)));
    const pdf = document.querySelector('.rd-tools a[href^="#/h/"]');
    if (pdf) pdf.setAttribute('href', `#/h/${provId(ch)}/${v}`);
    body.replaceChildren(...(v === 'leader' ? provLeaderView(g) : provMemberView(g, notes)).flat(Infinity).filter(Boolean));
    if (notes) notes.prune();
  };
  views.forEach(([v, label]) => {
    const b = h('button', { class: 'gm-chip', type: 'button', role: 'tab', 'data-v': v }, label);
    b.addEventListener('click', () => {
      try {
        localStorage.setItem(PROV_GROUP_KEY, v);
      } catch {
        /* 괜찮습니다 */
      }
      draw();
    });
    switcher.append(b);
  });
  wrap.append(switcher, body);
  draw();
  return wrap;
}
function provMemberView(g, notes) {
  const m = g.member || {};
  const bySection = PROV_SECTIONS.map(([key, name]) => [name, (m.questions || []).filter((q) => q.section === key)]).filter(([, list]) => list.length);
  let n = 0;
  return [
    renderPrayer('대표 기도', g.representative_prayer, 'open'),
    m.summary ? block('pv-sum', '요약', h('h2', { text: '오늘 말씀 요약' }), h('div', { class: 'summary-box md' }, splitParas(m.summary).map((t) => h('p', {}, inlineMd(t))))) : null,
    m.key_verse && m.key_verse.text ? h('blockquote', { class: 'rd-verse pv-group-verse' }, h('p', { text: m.key_verse.text }), h('cite', { text: m.key_verse.reference })) : null,
    block(
      'pv-questions',
      '나눔 질문',
      h('h2', { text: '나눔 질문' }),
      loginHint(),
      bySection.map(([name, list]) =>
        h(
          'div',
          { class: 'sg-group' },
          h('h3', { text: name }),
          h(
            'ol',
            { class: 'q gq-list', start: String(n + 1) },
            list.map((q) => {
              n += 1;
              return h('li', { class: 'gq' }, h('div', { class: 'gq-text' }, inlineMd(q.question)), notes ? notes.fieldBox(`pv-${q.id}`, { placeholder: '나눌 이야기를 적어 보세요', label: `질문 ${n} 내 기록` }) : null);
            }),
          ),
        ),
      ),
    ),
    renderPrayer('마치는 기도', g.closing_prayer, 'close'),
  ];
}
function provLeaderView(g) {
  const m = g.member || {};
  const l = g.leader || {};
  const byId = new Map((l.questions || []).map((q) => [q.id, q]));
  let n = 0;
  return [
    h('p', { class: 'gm-practice', text: '인도자용 해설서예요. 질문 의도와 예상 답변이 들어 있으니 부원들과 공유할 때는 "부원용"을 쓰세요.' }),
    l.overview ? block('pv-ov', '모임 목표', h('h2', { text: '모임 목표와 흐름' }), h('div', { class: 'md' }, splitParas(l.overview).map((t) => h('p', {}, inlineMd(t))))) : null,
    (l.flow || []).length ? block('pv-flow', '진행표', h('h2', { text: '진행표' }), h('ol', { class: 'pv-flow' }, l.flow.map((f) => h('li', {}, h('b', { text: f.title }), f.minutes ? h('span', { class: 'gm-chip-soft', text: `${f.minutes}분` }) : null, h('div', { class: 'md' }, inlineMd(f.detail)))))) : null,
    block(
      'pv-lq',
      '질문 해설',
      h('h2', { text: '질문별 해설' }),
      PROV_SECTIONS.map(([key, name]) => {
        const list = (m.questions || []).filter((q) => q.section === key);
        if (!list.length) return null;
        return h(
          'div',
          { class: 'sg-group' },
          h('h3', { text: name }),
          list.map((q) => {
            n += 1;
            const x = byId.get(q.id) || {};
            return h(
              'div',
              { class: 'point pv-lq-item' },
              h('p', { class: 'pv-lq-q' }, h('b', { text: `${n}. ` }), inlineMd(q.question)),
              x.intent ? h('p', {}, h('strong', { class: 'keybox-label', text: '질문 의도 ' }), inlineMd(x.intent)) : null,
              x.guide ? h('p', {}, h('strong', { class: 'keybox-label', text: '진행 가이드 ' }), inlineMd(x.guide)) : null,
              (x.answers || []).length ? h('div', { class: 'cm-refs' }, h('strong', { class: 'keybox-label', text: '예상 답변' }), h('ul', {}, x.answers.map((a) => h('li', {}, inlineMd(a))))) : null,
              x.follow_up ? h('p', { class: 'pv-follow' }, h('strong', { class: 'keybox-label', text: '심화 질문 ' }), inlineMd(x.follow_up)) : null,
            );
          }),
        );
      }),
    ),
    (l.tips || []).length ? block('pv-tips', '진행 팁', h('h2', { text: '모임을 매끄럽게 이끄는 팁' }), h('ul', { class: 'pv-tips' }, l.tips.map((t) => h('li', {}, inlineMd(t))))) : null,
    l.closing_words ? block('pv-close', '마무리', h('h2', { text: '마무리 정리 문구' }), h('div', { class: 'summary-box md' }, splitParas(l.closing_words).map((t) => h('p', {}, inlineMd(t))))) : null,
    renderPrayer('대표 기도', g.representative_prayer, 'open'),
    renderPrayer('마치는 기도', g.closing_prayer, 'close'),
  ];
}

/* ---------- PDF (handout.js 가 씁니다) ---------- */
async function proverbHandoutDetail(id) {
  const ch = Number(/^prov-(\d{2})$/.exec(id)[1]);
  const d = await loadProverb(ch);
  if (!d) throw new Error(`잠언 ${ch}장은 아직 준비 중이에요.`);
  const w = d.word || {};
  return {
    id,
    proverb: true,
    category: 'proverbs',
    date: '',
    title: `잠언 ${ch}장`,
    scripture: `잠언 ${ch}장`,
    preacher: '',
    result: { summary_short: w.theme || '' },
    word: w,
    qt: d.qt,
    study: d.study ? { ...d.study, quiz: null } : null,
    group: d.group,
    leader: d.group,
    quiz: d.quiz,
    bible: d.bible || { versions: [] },
  };
}
