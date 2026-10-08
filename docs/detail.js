// 설교 상세 화면: 공통 상단(한 줄 정리 · 영상 보기 · 핸드아웃 PDF · 4가지 모드 탭) + 모드별 내용
// 이 파일은 app.js 의 h(), state, app 과 content.js · notes.js 의 도구를 함께 씁니다.

const MODE_PREF_KEY = 'sn-mode';
const savedMode = () => {
  try {
    const v = localStorage.getItem(MODE_PREF_KEY);
    return MODES.some((m) => m.key === v) ? v : 'review';
  } catch {
    return 'review';
  }
};
const rememberMode = (m) => {
  try {
    localStorage.setItem(MODE_PREF_KEY, m);
  } catch {
    /* 저장하지 못해도 괜찮습니다 */
  }
};

const dataBase = () => (state.demo ? 'data/sample/' : 'data/');

async function loadDetail(id) {
  if (state.details.has(id)) return state.details.get(id);
  const res = await fetch(`${dataBase()}s/${encodeURIComponent(id)}.json?t=${Date.now()}`);
  if (!res.ok) throw new Error(`설교 내용을 불러오지 못했습니다 (${res.status})`);
  const d = await res.json();
  d.title = displayTitle({ category: d.category, title: tidyTitle(d.title), aiTitle: tidyTitle((d.result && d.result.title) || ''), scripture: d.scripture }); // "주일예배 - 설교제목"
  d.preacher = normalizePreacher(d.preacher || (d.result && d.result.preacher) || '');
  state.details.set(id, d);
  return d;
}

/** 어느 모드를 쓸 수 있는지 (review 는 항상) */
const availableModes = (d) => MODES.filter((m) => m.key === 'review' || d[m.key]).map((m) => m.key);

// 제목이 붙은 한 덩어리. navLabel 이 있으면 위쪽 "이 모드 안에서 이동" 링크에 나옵니다.
function block(id, navLabel, ...children) {
  const el = h('section', { class: 'block', id }, ...children);
  if (navLabel) el.dataset.nav = navLabel;
  return el;
}

const loginHint = () =>
  NOTES_ENABLED && !auth.user
    ? h('p', { class: 'note-hint', text: '구글 로그인을 하면 이 모드의 기록 칸이 열려서, 내 생각을 적어 두고 다음에 다시 볼 수 있어요.' })
    : null;

/* ---------- 설교리뷰 ---------- */
function renderReviewMode(d) {
  const r = d.result.review || {};
  return [
    block('outline', '설교 정리', h('h2', { text: '설교 정리' }), (r.outline || []).map((o) => renderPoint(o))),
    r.summary ? block('summary', 'Summary', h('h2', { text: 'Summary' }), h('div', { class: 'summary-box md' }, splitParas(r.summary).map((t) => h('p', {}, inlineMd(t))))) : null,
  ];
}

/* ---------- QT 묵상 ---------- */
function renderQtMode(d, notes) {
  const q = d.qt;
  return [
    loginHint(),
    renderPrayer('여는 기도', q.opening_prayer, 'open'),
    renderWorshipSection(q.songs, { title: '찬양', intro: '찬송가 한 곡과 CCM 한 곡으로 마음을 모아 보세요.' }),
    renderBibleViewer(d.bible),
    renderMusicSection(state.music, d.id),
    block('outline', 'QT 설교 정리', h('h2', { text: 'QT 설교 정리' }), (q.outline || []).map((o) => renderPoint(o))),
    block(
      'questions',
      '묵상 질문',
      h('h2', { text: '묵상 질문' }),
      h('ol', { class: 'q' }, (q.questions || []).map((t, i) => h('li', {}, h('span', {}, inlineMd(t)), notes ? notes.fieldBox(`qt.q.${i}`, { label: `묵상 질문 ${i + 1} 내 답` }) : null))),
    ),
    block(
      'apply',
      '삶의 적용',
      h('h2', { text: '삶의 적용' }),
      notes ? h('p', { class: 'meta', text: '아래 칸에 내가 실천할 것을 적어 두면, 다음에 이 설교를 열 때 그대로 보입니다.' }) : null,
      h(
        'div',
        { class: 'apps' },
        (q.applications || []).map((a, i) =>
          h(
            'div',
            { class: 'app-item' },
            h('h3', {}, inlineMd(a.title)),
            h('div', { class: 'md' }, mdBlocks(a.detail)),
            notes ? [h('label', { class: 'note-label', text: '나의 적용' }), notes.fieldBox(`qt.app.${i}`, { placeholder: '이번 주에 내가 구체적으로 할 일을 적어 보세요', label: `삶의 적용 ${i + 1} 나의 적용` }), notes.checkRow(a.title)] : null,
          ),
        ),
      ),
    ),
    renderPrayer('마치는 기도', q.closing_prayer, 'close'),
  ];
}

/* ---------- 성경공부 ---------- */
const CIRCLED = ['①', '②', '③', '④', '⑤'];

function renderQuiz(quiz) {
  const all = []; // 전체 [답보기] 토글 모음
  let n = 0;
  const groupBlock = (title, desc, items, build) => {
    if (!items.length) return null;
    return h('div', { class: 'qz-group' }, h('h3', { text: title }), h('p', { class: 'meta', text: desc }), h('ol', { class: 'qz-list' }, items.map((it) => build(it, ++n))));
  };
  const mc = groupBlock('객관식', '알맞은 답을 고른 뒤 [답보기]로 확인하세요.', quiz.multiple_choice || [], (it, no) => {
    const opts = h('ol', { class: 'qz-opts', type: 'A' }, it.options.map((o, i) => h('li', {}, h('button', { class: 'qz-opt', type: 'button', 'aria-pressed': 'false', 'data-i': String(i) }, h('span', { class: 'qz-mark', text: CIRCLED[i] || String(i + 1) }), h('span', { text: o })))));
    opts.addEventListener('click', (e) => {
      const b = e.target.closest('.qz-opt');
      if (!b) return;
      opts.querySelectorAll('.qz-opt').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    });
    const ans = h('div', { class: 'reveal-body' }, h('p', {}, h('strong', { text: `정답  ${CIRCLED[it.answer_index] || it.answer_index + 1}  ${it.options[it.answer_index]}` })), it.explanation ? h('p', { class: 'md' }, inlineMd(it.explanation)) : null);
    const { btn, box } = revealBox('답보기', ans);
    all.push({ btn, box });
    btn.addEventListener('click', () => {
      opts.querySelectorAll('.qz-opt').forEach((x, i) => x.classList.toggle('correct', !box.hidden && i === it.answer_index));
    });
    return h('li', { class: 'qz-item', value: no }, h('div', { class: 'qz-q' }, inlineMd(it.question)), opts, h('div', { class: 'qz-act' }, btn), box);
  });
  const fb = groupBlock('빈칸 채우기', '빈칸에 들어갈 말을 떠올려 본 뒤 [답보기]로 확인하세요.', quiz.fill_blank || [], (it, no) => {
    const ans = h('div', { class: 'reveal-body' }, h('p', {}, h('strong', { text: `정답  ${it.answer}` })), it.explanation ? h('p', { class: 'md' }, inlineMd(it.explanation)) : null);
    const { btn, box } = revealBox('답보기', ans);
    all.push({ btn, box });
    return h('li', { class: 'qz-item', value: no }, h('div', { class: 'qz-q' }, inlineMd(it.question)), h('div', { class: 'qz-act' }, btn), box);
  });
  const sa = groupBlock('주관식', '내 말로 답을 정리해 본 뒤 [답보기]로 모범 답안을 확인하세요.', quiz.short_answer || [], (it, no) => {
    const ans = h('div', { class: 'reveal-body' }, h('p', {}, h('strong', { text: '모범 답안' })), h('p', { class: 'md' }, inlineMd(it.answer)), it.explanation ? h('p', { class: 'md' }, inlineMd(it.explanation)) : null);
    const { btn, box } = revealBox('답보기', ans);
    all.push({ btn, box });
    return h('li', { class: 'qz-item', value: no }, h('div', { class: 'qz-q' }, inlineMd(it.question)), h('div', { class: 'qz-act' }, btn), box);
  });
  const toggleAll = h('button', { class: 'btn small', type: 'button' }, '모든 답 한꺼번에 보기');
  let open = false;
  toggleAll.addEventListener('click', () => {
    open = !open;
    all.forEach(({ btn, box }) => {
      if (box.hidden === open) btn.click();
    });
    toggleAll.textContent = open ? '모든 답 감추기' : '모든 답 한꺼번에 보기';
  });
  return block('quiz', '퀴즈', h('div', { class: 'block-head' }, h('h2', { text: `퀴즈 ${n}문제` }), toggleAll), mc, fb, sa);
}

function renderStudyMode(d) {
  const st = d.study;
  return [
    renderPrayer('여는 기도', st.opening_prayer, 'open'),
    renderWorshipSection(st.songs, { title: '찬양', intro: '공부를 시작하기 전에 함께 부르면 좋은 찬양입니다.' }),
    renderBibleViewer(d.bible),
    block(
      'deep',
      '신학 깊이 보기',
      h('h2', { text: '신학 깊이 보기' }),
      h('p', { class: 'meta', text: '개혁주의(합동·통합) 신앙의 틀에서 본문의 뜻을 깊이 살펴봅니다. 주석과 원어 설명은 AI가 정리한 것이니, 공부할 때 주석서와 함께 확인해 주세요.' }),
      (st.deep_dive || []).map((o) =>
        renderPoint(
          o,
          o.word_notes && o.word_notes.length
            ? h('div', { class: 'word-notes' }, h('strong', { class: 'keybox-label', text: '원어 · 용어' }), h('ul', {}, o.word_notes.map((w) => h('li', {}, h('strong', { text: w.word }), w.original ? ` (${w.original})` : '', ` — ${w.meaning}`))))
            : null,
        ),
      ),
    ),
    st.summary ? block('summary', 'Summary', h('h2', { text: 'Summary' }), h('div', { class: 'summary-box md' }, splitParas(st.summary).map((t) => h('p', {}, inlineMd(t))))) : null,
    renderQuiz(st.quiz || {}),
    renderPrayer('마치는 기도', st.closing_prayer, 'close'),
  ];
}

/* ---------- 소그룹 나눔 ---------- */
const GROUP_SECTIONS = [
  ['observation', 'obs', '본문 관찰'],
  ['reflection', 'ref', '묵상과 해석'],
  ['application', 'app', '삶의 적용'],
  ['prayer', 'pray', '기도와 결단'],
];

function smallGroupText(d) {
  const g = d.group || {};
  const q = g.questions || {};
  const lines = [`[${catLabel(d.category)}] ${d.title}`];
  if (d.scripture) lines.push(`본문: ${d.scripture}`);
  lines.push('', '◆ 소그룹 나눔 질문', '');
  if (q.icebreaker?.question) lines.push('[마음 열기]', q.icebreaker.question, '');
  for (const [key, , name] of GROUP_SECTIONS) {
    const arr = q[key] || [];
    if (!arr.length) continue;
    lines.push(`[${name}]`);
    arr.forEach((x, i) => lines.push(`${i + 1}. ${x.question}`));
    lines.push('');
  }
  return lines.join('\n').trim();
}

function groupQuestion(item, noteKey, notes, label) {
  const parts = [h('div', { class: 'gq-text' }, inlineMd(item.question))];
  if (notes) parts.push(notes.fieldBox(noteKey, { placeholder: '내 생각이나 나눌 이야기를 적어 보세요', label }));
  if (item.answer) {
    const { btn, box } = revealBox('모범 답안 보기', h('div', { class: 'reveal-body md' }, h('p', {}, h('strong', { text: '모범 답안' })), splitParas(item.answer).map((t) => h('p', {}, inlineMd(t)))), { hiddenLabel: '모범 답안 보기', shownLabel: '모범 답안 감추기' });
    parts.push(h('div', { class: 'qz-act' }, btn), box);
  }
  return parts;
}

function renderGroupMode(d, notes) {
  const g = d.group;
  const q = g.questions || {};
  const guide = g.sharing_guide || {};
  const sections = [];
  if (q.icebreaker?.question) {
    sections.push(h('div', { class: 'sg-group' }, h('h3', { text: '마음 열기' }), h('div', { class: 'gq' }, groupQuestion(q.icebreaker, 'group.ice.0', notes, '마음 열기 내 기록'))));
  }
  for (const [key, short, name] of GROUP_SECTIONS) {
    const arr = q[key] || [];
    if (!arr.length) continue;
    sections.push(h('div', { class: 'sg-group' }, h('h3', { text: name }), h('ol', { class: 'q gq-list' }, arr.map((it, i) => h('li', { class: 'gq' }, groupQuestion(it, `group.${short}.${i}`, notes, `${name} ${i + 1} 내 기록`))))));
  }
  return [
    loginHint(),
    renderPrayer('대표 기도', g.representative_prayer, 'open'),
    renderWorshipSection(g.songs, { title: '찬양', intro: '모임을 열며 함께 부르면 좋은 찬양입니다.' }),
    renderBibleViewer(d.bible, { open: false }),
    block('outline', '설교 정리', h('h2', { text: '소그룹을 위한 설교 정리' }), (g.outline || []).map((o) => renderPoint(o))),
    block(
      'apply',
      '삶의 적용',
      h('h2', { text: '삶의 적용' }),
      h('div', { class: 'apps' }, (g.applications || []).map((a) => h('div', { class: 'app-item' }, h('h3', {}, inlineMd(a.title)), h('div', { class: 'md' }, mdBlocks(a.detail)), notes ? notes.checkRow(a.title) : null))),
    ),
    block('questions', '나눔 질문', h('div', { class: 'block-head' }, h('h2', { text: '나눔 질문' }), h('button', { class: 'btn small', type: 'button', onclick: () => copyText(smallGroupText(d)) }, '질문 복사')), sections),
    block(
      'guide',
      '나눔 가이드',
      h('h2', { text: '삶 나눔 · 기도제목 나눔 가이드' }),
      guide.intro ? h('div', { class: 'md' }, mdBlocks(guide.intro)) : null,
      guide.steps && guide.steps.length
        ? h('ol', { class: 'guide-steps' }, guide.steps.map((s) => h('li', {}, h('div', { class: 'guide-head' }, h('strong', { text: s.title }), s.minutes ? h('span', { class: 'chip', text: `${s.minutes}분` }) : null), h('div', { class: 'md' }, mdBlocks(s.detail)))))
        : null,
      guide.prayer_guide && guide.prayer_guide.length ? h('div', { class: 'sg-group' }, h('h3', { text: '기도제목 나누는 법' }), h('ul', { class: 'guide-prayer' }, guide.prayer_guide.map((t) => h('li', {}, inlineMd(t))))) : null,
    ),
    renderPrayer('마치는 기도', g.closing_prayer, 'close'),
  ];
}

/* ---------- 상세 화면 ---------- */
let detailToken = 0;

async function renderDetail(id, modeArg) {
  const token = ++detailToken;
  const item = state.sermons.find((x) => x.id === id);
  const back = (cat) => h('a', { class: 'back', href: cat === 'user' ? '#/u' : `#/c/${cat || 'sunday'}`, text: `← ${cat === 'user' ? '사용자 영상' : catLabel(cat || 'sunday')} 목록` });
  if (!item) {
    app.replaceChildren(back(), h('div', { class: 'empty' }, h('p', { text: '해당 설교를 찾을 수 없습니다.' })));
    return;
  }
  document.title = `${item.title} · 말씀결`;
  app.replaceChildren(back(item.category), h('p', { class: 'loading', text: '불러오는 중…' }));
  let d;
  try {
    d = await loadDetail(id);
  } catch (e) {
    if (token !== detailToken) return;
    app.replaceChildren(back(item.category), h('div', { class: 'empty' }, h('p', {}, h('strong', { text: '설교 내용을 불러오지 못했습니다.' })), h('p', { text: String(e.message || e) })));
    return;
  }
  if (token !== detailToken) return;

  const modes = availableModes(d);
  let mode = MODES.some((m) => m.key === modeArg) && modes.includes(modeArg) ? modeArg : modes.includes(savedMode()) ? savedMode() : 'review';

  const notes = NOTES_ENABLED && auth.user ? createNotes(item) : null;
  currentNotes = notes;

  const ytUrl = safeYoutube(d.url, d.id);
  const vid = ytId(d.id);
  const scripture = d.scripture || (d.result.scripture || []).join(', ');
  const preacher = d.preacher || d.result.preacher || '';

  // 영상 보기: 이 화면 안에서 재생하고, YouTube에서 열기 링크를 함께 둡니다
  const playerBox = h('div', { class: 'player-box', hidden: true });
  playerBox.hidden = true;
  const watchBtn = h('button', { class: 'btn primary', type: 'button', 'aria-expanded': 'false' }, '▶ 영상 보기');
  watchBtn.addEventListener('click', () => {
    const open = playerBox.hidden;
    playerBox.hidden = !open;
    watchBtn.setAttribute('aria-expanded', String(open));
    watchBtn.textContent = open ? '영상 닫기' : '▶ 영상 보기';
    if (open) {
      if (vid) playerBox.replaceChildren(embedPlayer(vid, d.title), h('p', { class: 'meta', text: PLAYER_HELP }), h('a', { class: 'btn small', href: ytUrl, target: '_blank', rel: 'noopener noreferrer' }, 'YouTube에서 열기'));
      else playerBox.replaceChildren(h('a', { class: 'btn', href: ytUrl, target: '_blank', rel: 'noopener noreferrer' }, 'YouTube에서 열기'));
    } else {
      playerBox.replaceChildren();
    }
  });

  const handoutBtn = h('a', { class: 'btn', href: `#/h/${encodeURIComponent(d.id)}/${mode}` }, '핸드아웃 PDF');
  const body = h('div', { class: 'mode-body', id: 'mode-body', role: 'tabpanel' });
  const nav = h('nav', { class: 'secnav', 'aria-label': '이 모드 안에서 이동' });
  const tabs = h('div', { class: 'mode-tabs', role: 'tablist', 'aria-label': '보기 방식' });

  function drawMode() {
    const renderers = { review: () => renderReviewMode(d), qt: () => renderQtMode(d, notes), study: () => renderStudyMode(d), group: () => renderGroupMode(d, notes) };
    const nodes = renderers[mode]().flat(Infinity).filter(Boolean);
    body.replaceChildren(...nodes);
    if (notes) notes.prune();
    nav.replaceChildren(
      ...nodes
        .filter((el) => el.dataset && el.dataset.nav)
        .map((el) =>
          h('a', {
            href: `#${el.id}`,
            text: el.dataset.nav,
            onclick: (e) => {
              e.preventDefault();
              el.scrollIntoView({ behavior: 'smooth' });
            },
          }),
        ),
    );
    nav.hidden = nav.children.length < 3;
    handoutBtn.setAttribute('href', `#/h/${encodeURIComponent(d.id)}/${mode}`);
    tabs.querySelectorAll('.mode-tab').forEach((b) => {
      b.setAttribute('aria-selected', String(b.dataset.mode === mode));
      b.tabIndex = b.dataset.mode === mode ? 0 : -1;
    });
    body.className = `mode-body mode-${mode}`;
    document.title = `${d.title} · ${modeLabel(mode)} · 말씀결`;
  }

  MODES.forEach((m) => {
    const ok = modes.includes(m.key);
    const b = h('button', { class: 'mode-tab', type: 'button', role: 'tab', 'data-mode': m.key, disabled: !ok, title: ok ? '' : '아직 준비되지 않았습니다 (영상 관리에서 다시 정리하면 만들어집니다)' }, m.label);
    b.addEventListener('click', () => {
      if (mode === m.key) return;
      mode = m.key;
      rememberMode(mode);
      try {
        history.replaceState(null, '', `#/v/${encodeURIComponent(d.id)}/${mode}`); // 화면을 다시 불러오지 않고 주소만 바꿉니다
      } catch {
        /* 주소를 못 바꿔도 화면은 바뀝니다 */
      }
      drawMode();
    });
    tabs.append(b);
  });

  app.replaceChildren(
    back(d.category),
    h(
      'div',
      { class: 'detail-head' },
      h('div', { class: 'meta' }, h('span', { class: 'chip', text: catLabel(d.category) }), formatDate(d.date), preacher ? ` · ${preacher}` : ''),
      h('h1', { text: d.title }),
      scripture ? h('p', { class: 'scripture', text: `본문  ${scripture}` }) : null,
      d.result.summary_short || d.result.theme ? h('div', { class: 'detail-theme' }, h('strong', { class: 'theme-label', text: '한 줄 정리' }), h('p', { text: d.result.summary_short || d.result.theme })) : null,
      h('div', { class: 'actions' }, watchBtn, handoutBtn, h('a', { class: 'btn', href: ytUrl, target: '_blank', rel: 'noopener noreferrer' }, 'YouTube에서 열기')),
      playerBox,
    ),
    h('div', { class: 'mode-bar' }, tabs, notes ? notes.status : null),
    nav,
    body,
    h('footer', { class: 'sermon-foot' }, h('p', { text: `참고: ${footnoteText(d.category)}` }), d.result.caveats ? h('p', { class: 'caveats', text: `유의: ${d.result.caveats}` }) : null),
  );
  drawMode();
  if (notes) {
    // 기록 칸은 불러오기가 끝나야 열립니다. 불러온 뒤에는 로그인 여부에 따라 모드 화면이 달라지지 않으므로 칸만 채웁니다.
    notes.load();
  }
}
