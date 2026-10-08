// 핸드아웃: 설교 한 편을 쪽 단위(Letter / A4)로 미리 보고 인쇄·PDF로 저장합니다.
// 보기 방식(설교리뷰 · QT 묵상 · 성경공부 · 소그룹 나눔)마다 내용이 다르고, 성경 본문은 역본을 골라(기본 개역개정) 넣을 수 있습니다.
// 쪽 나누기는 paged.js(vendor/paged.polyfill.min.js)가 맡고, 모양은 handout.css 입니다.
// 이 파일은 app.js 의 h(), state, route() 와 content.js · detail.js 의 도구를 함께 씁니다.

const HANDOUT_KEY = 'sn-handout2';
const PAGE_SIZES = { letter: { label: 'Letter (8.5 × 11 in)', css: 'letter' }, a4: { label: 'A4 (210 × 297 mm)', css: 'A4' } };
// 성경 본문이 이만큼(글자 수)보다 길면 맨 뒤 부록으로 보냅니다
const LONG_BIBLE_CHARS = 2200;
const HANDOUT_DEFAULTS = { size: 'letter', songs: true, bible: 'GAE', lines: true, answers: false };
const BIBLE_ALL = 'ALL';

function loadHandoutPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem(HANDOUT_KEY) || '{}');
    const bibleOk = p.bible === BIBLE_ALL || p.bible === 'NONE' || BIBLE_VERSIONS.some((b) => b.id === p.bible);
    return {
      size: PAGE_SIZES[p.size] ? p.size : HANDOUT_DEFAULTS.size,
      songs: p.songs !== false,
      bible: bibleOk ? p.bible : HANDOUT_DEFAULTS.bible,
      lines: p.lines !== false,
      answers: p.answers === true,
    };
  } catch {
    return { ...HANDOUT_DEFAULTS };
  }
}
function saveHandoutPrefs(p) {
  try {
    localStorage.setItem(HANDOUT_KEY, JSON.stringify(p));
  } catch {
    /* 저장하지 못해도 괜찮습니다 */
  }
}

/* ---------- 핸드아웃 문서 만들기 ---------- */
function buildHandoutDoc(d, mode, opts) {
  const date = formatDate(d.date);
  const scripture = d.scripture || (d.result.scripture || []).join(', ');
  const preacher = d.preacher || d.result.preacher || '';
  const secs = [];
  const heading = (title) => h('h2', { class: 'ho-h2' }, h('span', { text: title }));
  // 소제목과 첫 덩어리는 한 쪽에 같이 있도록 묶습니다 (소제목만 쪽 끝에 남지 않게)
  const sec = (title, ...body) => {
    const items = body.flat(Infinity).filter(Boolean);
    const first = items.shift();
    return h('section', { class: 'ho-sec' }, first ? h('div', { class: 'ho-keep' }, heading(title), first) : heading(title), items);
  };
  const secPlain = (title, ...body) => h('section', { class: 'ho-sec' }, heading(title), ...body);
  const lines = (n) => h('div', { class: 'ho-lines' }, Array.from({ length: n }, () => h('div', { class: 'ho-line' })));
  const prayer = (title, text) => (text ? sec(title, h('div', { class: 'ho-prayer ho-md' }, splitParas(text).map((t) => h('p', {}, inlineMd(t))))) : null);
  const songsSec = (songs) =>
    opts.songs && songs?.length
      ? sec('찬양', h('ul', { class: 'ho-songs' }, songs.map((x) => h('li', {}, h('strong', { text: x.title }), x.artist ? ` — ${x.artist}` : '', x.kind ? h('span', { class: 'ho-tag', text: x.kind }) : null, x.reason ? h('div', { class: 'ho-note', text: x.reason }) : null))))
      : null;
  const pointsSec = (title, list, withWords) => {
    const sectionEl = h('section', { class: 'ho-sec' });
    (list || []).forEach((o, i) => {
      const paras = outlineParas(o).map((t) => mdBlocks(t));
      const lead = h('div', { class: 'ho-keep' }, i === 0 ? heading(title) : null, h('h3', { class: 'ho-point-title', text: o.heading }), o.scripture ? h('p', { class: 'ho-ref', text: o.scripture }) : null, paras.length ? h('div', { class: 'ho-md' }, paras[0]) : null);
      sectionEl.append(
        h(
          'div',
          { class: 'ho-point' },
          lead,
          paras.length > 1 ? h('div', { class: 'ho-md' }, paras.slice(1)) : null,
          outlineSummary(o) ? h('div', { class: 'ho-key' }, h('strong', { class: 'ho-key-label', text: '핵심 요약' }), h('p', {}, inlineMd(outlineSummary(o)))) : null,
          withWords && o.word_notes && o.word_notes.length ? h('div', { class: 'ho-words' }, h('strong', { class: 'ho-key-label', text: '원어 · 용어' }), h('ul', {}, o.word_notes.map((w) => h('li', {}, h('strong', { text: w.word }), w.original ? ` (${w.original})` : '', ` — ${w.meaning}`)))) : null,
        ),
      );
    });
    if (!(list || []).length) sectionEl.append(heading(title));
    return sectionEl;
  };
  const summarySec = (text) => (text ? sec('Summary', h('div', { class: 'ho-summary-box ho-md' }, splitParas(text).map((t) => h('p', {}, inlineMd(t))))) : null);
  const appsSec = (list, keyPrefix) =>
    list?.length
      ? sec(
          '삶의 적용',
          list.map((a) => h('div', { class: 'ho-app' }, h('div', { class: 'ho-app-body' }, h('h3', {}, inlineMd(a.title)), h('div', { class: 'ho-md' }, mdBlocks(a.detail)), opts.lines ? h('div', { class: 'ho-mine' }, h('span', { class: 'ho-mine-label', text: '나의 적용' }), lines(2)) : null), h('div', { class: 'ho-check' }, h('span', { class: 'ho-box' }), '실천했어요'))),
        )
      : null;

  // 머리말
  secs.push(
    h(
      'header',
      { class: 'ho-head' },
      h('div', { class: 'ho-kicker' }, h('span', { text: `말씀결  ·  ${modeLabel(mode)}` }), h('span', { text: `${eventName(d.category)}${date ? `  ·  ${date}` : ''}` })),
      h('h1', { class: 'ho-title', text: d.title }),
      scripture || preacher ? h('p', { class: 'ho-scripture' }, scripture ? `본문  ${scripture}` : '', scripture && preacher ? '   |   ' : '', preacher) : null,
      d.result.summary_short || d.result.theme ? h('p', { class: 'ho-summary', text: d.result.summary_short || d.result.theme }) : null,
    ),
  );

  // 성경 본문 (고른 역본 하나, 또는 4개 모두 차례로). 아주 길면 맨 뒤 부록으로 보냅니다.
  let bibleSec = null;
  let bibleAtEnd = false;
  const versions = (d.bible && d.bible.versions) || [];
  if (mode !== 'review' && opts.bible !== 'NONE' && versions.length) {
    const wanted = opts.bible === BIBLE_ALL ? versions : versions.filter((v) => v.id === opts.bible);
    const chosen = wanted.length ? wanted : [versions[0]]; // 고른 역본을 가져오지 못했다면 있는 첫 역본으로
    const body = chosen.map((v) =>
      h(
        'div',
        { class: 'ho-ver' },
        chosen.length > 1 || !wanted.length ? h('h3', { text: v.label }) : null,
        (v.passages || []).map((p) => h('div', { class: 'ho-passage' }, p.reference ? h('p', { class: 'ho-ref', text: p.reference }) : null, (p.verses || []).map((x) => h('p', { class: `ho-verse${v.lang === 'en' ? ' en' : ''}` }, h('sup', { class: 'ho-vn', text: String(x.n) }), ' ', x.text)))),
        v.truncated ? h('p', { class: 'ho-credit', text: '분량이 길어 앞부분만 실었습니다.' }) : null,
      ),
    );
    const credits = chosen.filter((v) => v.copyright).map((v) => `${v.label}: ${v.copyright}`);
    const chars = chosen.reduce((n, v) => n + (v.passages || []).reduce((m, p) => m + (p.verses || []).reduce((k, x) => k + String(x.text || '').length, 0), 0), 0);
    bibleAtEnd = chars > LONG_BIBLE_CHARS;
    bibleSec = secPlain(bibleAtEnd ? '부록 · 성경 본문' : '성경 본문', body, credits.length ? h('p', { class: 'ho-credit', text: credits.join('  /  ') }) : null);
    if (bibleAtEnd) bibleSec.classList.add('ho-appendix');
  }

  const answerPages = []; // 정답·모범 답안 (옵션을 켠 경우 맨 뒤에 모음)

  if (mode === 'review') {
    const r = d.result.review || {};
    secs.push(pointsSec('설교 정리', r.outline), summarySec(r.summary));
  } else if (mode === 'qt') {
    const q = d.qt || {};
    secs.push(prayer('여는 기도', q.opening_prayer), songsSec(q.songs));
    if (bibleSec && !bibleAtEnd) secs.push(bibleSec);
    secs.push(pointsSec('QT 설교 정리', q.outline));
    if (q.questions?.length) {
      secs.push(sec('묵상 질문', h('ol', { class: 'ho-q ho-q-lined' }, q.questions.map((t) => h('li', {}, h('div', { class: 'ho-q-text' }, inlineMd(t)), opts.lines ? lines(3) : null)))));
    }
    secs.push(appsSec(q.applications), prayer('마치는 기도', q.closing_prayer));
  } else if (mode === 'study') {
    const st = d.study || {};
    secs.push(prayer('여는 기도', st.opening_prayer), songsSec(st.songs));
    if (bibleSec && !bibleAtEnd) secs.push(bibleSec);
    secs.push(pointsSec('신학 깊이 보기', st.deep_dive, true), summarySec(st.summary));
    const quiz = st.quiz || {};
    let n = 0;
    const qItems = [];
    const ansItems = [];
    const group = (title, items, build) => {
      if (!items?.length) return;
      qItems.push(h('h3', { class: 'ho-sub', text: title }));
      items.forEach((it) => {
        n += 1;
        const [qEl, aEl] = build(it, n);
        qItems.push(qEl);
        ansItems.push(aEl);
      });
    };
    group('객관식', quiz.multiple_choice, (it, no) => [
      h('div', { class: 'ho-qz' }, h('div', { class: 'ho-qz-q' }, h('strong', { text: `${no}. ` }), inlineMd(it.question)), h('ol', { class: 'ho-opts' }, it.options.map((o, i) => h('li', {}, h('span', { class: 'ho-mark', text: CIRCLED[i] || String(i + 1) }), ` ${o}`)))),
      h('li', {}, h('strong', { text: `${no}. ${CIRCLED[it.answer_index] || it.answer_index + 1} ${it.options[it.answer_index]}` }), it.explanation ? h('div', { class: 'ho-note', text: it.explanation }) : null),
    ]);
    group('빈칸 채우기', quiz.fill_blank, (it, no) => [
      h('div', { class: 'ho-qz' }, h('div', { class: 'ho-qz-q' }, h('strong', { text: `${no}. ` }), inlineMd(it.question)), opts.lines ? lines(1) : null),
      h('li', {}, h('strong', { text: `${no}. ${it.answer}` }), it.explanation ? h('div', { class: 'ho-note', text: it.explanation }) : null),
    ]);
    group('주관식', quiz.short_answer, (it, no) => [
      h('div', { class: 'ho-qz' }, h('div', { class: 'ho-qz-q' }, h('strong', { text: `${no}. ` }), inlineMd(it.question)), opts.lines ? lines(3) : null),
      h('li', {}, h('strong', { text: `${no}. ` }), it.answer, it.explanation ? h('div', { class: 'ho-note', text: it.explanation }) : null),
    ]);
    if (qItems.length) secs.push(sec(`퀴즈 ${n}문제`, qItems));
    secs.push(prayer('마치는 기도', st.closing_prayer));
    if (opts.answers && ansItems.length) answerPages.push(secPlain('정답 및 해설', h('ol', { class: 'ho-answers' }, ansItems)));
  } else if (mode === 'group') {
    const g = d.group || {};
    const q = g.questions || {};
    secs.push(prayer('대표 기도', g.representative_prayer), songsSec(g.songs));
    if (bibleSec && !bibleAtEnd) secs.push(bibleSec);
    secs.push(pointsSec('소그룹을 위한 설교 정리', g.outline), appsSec(g.applications));
    const gblock = (title, arr) =>
      arr?.length
        ? h('div', { class: 'ho-sg' }, h('h3', { text: title }), h('ol', { class: 'ho-q ho-q-lined' }, arr.map((it) => h('li', {}, h('div', { class: 'ho-q-text' }, inlineMd(it.question)), opts.lines ? lines(3) : null, opts.answers && it.answer ? h('div', { class: 'ho-model' }, h('strong', { class: 'ho-key-label', text: '모범 답안' }), h('div', { class: 'ho-md' }, splitParas(it.answer).map((t) => h('p', {}, inlineMd(t))))) : null))))
        : null;
    secs.push(
      sec(
        '나눔 질문',
        q.icebreaker?.question ? h('div', { class: 'ho-sg' }, h('h3', { text: '마음 열기' }), h('div', { class: 'ho-ice' }, inlineMd(q.icebreaker.question)), opts.lines ? lines(2) : null, opts.answers && q.icebreaker.answer ? h('div', { class: 'ho-model' }, h('strong', { class: 'ho-key-label', text: '모범 답안' }), h('div', { class: 'ho-md' }, splitParas(q.icebreaker.answer).map((t) => h('p', {}, inlineMd(t))))) : null) : null,
        GROUP_SECTIONS.map(([key, , name]) => gblock(name, q[key])),
      ),
    );
    const guide = g.sharing_guide || {};
    if (guide.steps?.length || guide.intro) {
      secs.push(
        sec(
          '삶 나눔 · 기도제목 나눔 가이드',
          guide.intro ? h('div', { class: 'ho-md' }, mdBlocks(guide.intro)) : null,
          guide.steps?.length ? h('ol', { class: 'ho-steps' }, guide.steps.map((s) => h('li', {}, h('strong', { text: s.title }), s.minutes ? h('span', { class: 'ho-tag', text: `${s.minutes}분` }) : null, h('div', { class: 'ho-md' }, mdBlocks(s.detail))))) : null,
          guide.prayer_guide?.length ? h('div', { class: 'ho-sg' }, h('h3', { text: '기도제목 나누는 법' }), h('ul', { class: 'ho-plain' }, guide.prayer_guide.map((t) => h('li', {}, inlineMd(t))))) : null,
        ),
      );
    }
    if (opts.lines) {
      secs.push(sec('우리 모임 기도제목', lines(5)));
    }
    secs.push(prayer('마치는 기도', g.closing_prayer));
  }

  // 각주 · 부록
  secs.push(h('footer', { class: 'ho-foot' }, h('p', { text: `참고: ${footnoteText(d.category)}` }), d.result.caveats ? h('p', { text: `유의: ${d.result.caveats}` }) : null));
  answerPages.forEach((a) => {
    a.classList.add('ho-appendix');
    secs.push(a);
  });
  if (bibleSec && bibleAtEnd) secs.push(bibleSec);
  return h('article', { class: 'ho-doc' }, secs.filter(Boolean));
}

/* ---------- 쪽 규칙(용지 크기, 하단 머리말) ---------- */
const cssString = (t) => `"${String(t).replace(/[\\"]/g, '\\$&').replace(/[\r\n]+/g, ' ')}"`;
function pageRules(size, s, mode) {
  const date = formatDate(s.date);
  const foot = `말씀결  ·  ${eventName(s.category)}${date ? `  ${date}` : ''}  ·  ${modeLabel(mode)}`;
  return `@page { size: ${PAGE_SIZES[size].css}; margin: 0.8in 0.85in 0.9in;
  @bottom-left { content: ${cssString(foot)}; font: 9pt 'Noto Sans KR', sans-serif; color: #4a5c72; vertical-align: top; padding-top: 10pt; border-top: 0.75pt solid #8fcf5a; }
  @bottom-right { content: "Page " counter(page) " / " counter(pages); font: 9pt 'Noto Sans KR', sans-serif; color: #4a5c72; vertical-align: top; padding-top: 10pt; border-top: 0.75pt solid #8fcf5a; }
}
@page :first { @bottom-left { content: ${cssString(foot)}; } }`;
}

/* ---------- 미리보기 화면 ---------- */
let handoutState = null; // { previewer, onResize }

// paged.js 가 만든 쪽과 서식을 모두 치웁니다. (쪽의 감시 장치를 먼저 끄지 않으면 지운 뒤에 오류가 납니다)
function disposePreviewer(previewer) {
  if (!previewer) return;
  try {
    (previewer.chunker?.pages || []).forEach((pg) => {
      try {
        pg.destroy();
      } catch {
        /* 이미 정리됨 */
      }
    });
    previewer.polisher?.destroy();
    previewer.chunker?.destroy();
  } catch {
    /* 이미 정리됨 */
  }
}

function teardownHandout() {
  if (!handoutState) return;
  const st = handoutState;
  handoutState = null;
  st.token = -1;
  window.removeEventListener('resize', st.onResize);
  disposePreviewer(st.previewer);
}

let pagedLoading = null;
function loadPaged() {
  if (window.Paged && window.Paged.Previewer) return Promise.resolve();
  if (pagedLoading) return pagedLoading;
  window.PagedConfig = { auto: false }; // 자동으로 쪽 나누기를 시작하지 않게 (직접 시작합니다)
  pagedLoading = new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = 'vendor/paged.polyfill.min.js';
    el.onload = () => resolve();
    el.onerror = () => {
      pagedLoading = null;
      reject(new Error('쪽 나누기 도구를 불러오지 못했습니다. 인터넷 연결을 확인하고 다시 시도해 주세요.'));
    };
    document.head.append(el);
  });
  return pagedLoading;
}

let handoutCss = null;
async function loadHandoutCss() {
  if (handoutCss) return handoutCss;
  const res = await fetch('handout.css?v=9.1');
  if (!res.ok) throw new Error(`핸드아웃 서식을 불러오지 못했습니다 (${res.status})`);
  handoutCss = await res.text();
  return handoutCss;
}

async function renderHandout(id, modeArg) {
  teardownHandout();
  const item = state.sermons.find((x) => x.id === id);
  const back = (href, text) => h('a', { class: 'back', href, text });
  if (!item) {
    app.replaceChildren(back('#/', '← 목록으로'), h('div', { class: 'empty' }, h('p', { text: '해당 설교를 찾을 수 없습니다.' })));
    return;
  }
  app.replaceChildren(back(`#/v/${encodeURIComponent(id)}`, '← 설교로 돌아가기'), h('p', { class: 'loading', text: '불러오는 중…' }));
  let d;
  try {
    d = await loadDetail(id);
  } catch (e) {
    app.replaceChildren(back(`#/v/${encodeURIComponent(id)}`, '← 설교로 돌아가기'), h('div', { class: 'empty' }, h('p', { text: String(e.message || e) })));
    return;
  }
  if (!location.hash.startsWith('#/h/')) return; // 불러오는 사이 다른 화면으로 옮겼다면 그리지 않습니다
  const modes = availableModes(d);
  let mode = MODES.some((m) => m.key === modeArg) && modes.includes(modeArg) ? modeArg : modes.includes(savedMode()) ? savedMode() : 'review';
  document.title = `핸드아웃 · ${d.title}`;
  const prefs = loadHandoutPrefs();
  const st = { token: 0, previewer: null, onResize: null };
  handoutState = st;

  const status = h('p', { class: 'meta ho-status', role: 'status' });
  const stage = h('div', { class: 'ho-stage' });
  const wrap = h('div', { class: 'ho-stage-wrap' }, stage);

  const modeSel = h('select', { class: 'search ho-size', 'aria-label': '보기 방식' }, MODES.map((m) => h('option', { value: m.key, text: m.label, disabled: !modes.includes(m.key) })));
  modeSel.value = mode;
  modeSel.addEventListener('change', () => {
    mode = modeSel.value;
    rememberMode(mode);
    try {
      history.replaceState(null, '', `#/h/${encodeURIComponent(id)}/${mode}`);
    } catch {
      /* 주소를 못 바꿔도 화면은 바뀝니다 */
    }
    syncVisibility();
    draw();
  });
  const sizeSel = h('select', { class: 'search ho-size', 'aria-label': '용지 크기' }, Object.entries(PAGE_SIZES).map(([k, v]) => h('option', { value: k, text: v.label })));
  sizeSel.value = prefs.size;
  sizeSel.addEventListener('change', () => {
    prefs.size = sizeSel.value;
    saveHandoutPrefs(prefs);
    draw();
  });
  // 성경 본문: 한 역본(기본 개역개정) 또는 4개 모두 또는 넣지 않기
  const bibleSel = h(
    'select',
    { class: 'search ho-size', 'aria-label': '성경 본문 역본' },
    BIBLE_VERSIONS.map((b) => h('option', { value: b.id, text: b.label })),
    h('option', { value: BIBLE_ALL, text: '4개 역본 모두' }),
    h('option', { value: 'NONE', text: '넣지 않음' }),
  );
  bibleSel.value = prefs.bible;
  bibleSel.addEventListener('change', () => {
    prefs.bible = bibleSel.value;
    saveHandoutPrefs(prefs);
    draw();
  });
  const bibleLabel = h('label', { class: 'ho-opt' }, '성경 본문 ', bibleSel);
  const toggle = (key, label) => {
    const cb = h('input', { type: 'checkbox' });
    cb.checked = prefs[key];
    cb.addEventListener('change', () => {
      prefs[key] = cb.checked;
      saveHandoutPrefs(prefs);
      draw();
    });
    return h('label', { class: 'ho-opt' }, cb, label);
  };
  const songsOpt = toggle('songs', '찬양');
  const linesOpt = toggle('lines', '쓰는 줄');
  const answersOpt = toggle('answers', '정답·모범 답안 포함');
  const syncVisibility = () => {
    bibleLabel.hidden = mode === 'review';
    songsOpt.hidden = mode === 'review';
    linesOpt.hidden = mode === 'review';
    answersOpt.hidden = !(mode === 'study' || mode === 'group');
  };
  syncVisibility();
  const printBtn = h('button', { class: 'btn primary', type: 'button', disabled: true }, '인쇄 / PDF로 저장');
  printBtn.addEventListener('click', () => window.print());

  const fit = () => {
    const page = stage.querySelector('.pagedjs_page');
    if (!page) return;
    stage.style.zoom = '1';
    const w = page.getBoundingClientRect().width;
    const avail = wrap.clientWidth;
    if (w > 0 && avail > 0) stage.style.zoom = String(Math.min(1, avail / w));
  };
  st.onResize = fit;
  window.addEventListener('resize', fit);

  async function draw() {
    const token = ++st.token;
    printBtn.disabled = true;
    status.textContent = '미리보기를 만드는 중입니다… (잠시만 기다려 주세요)';
    // 이전 미리보기 정리
    disposePreviewer(st.previewer);
    st.previewer = null;
    stage.replaceChildren();
    stage.style.zoom = '1';
    try {
      await loadPaged();
      const css = (await loadHandoutCss()) + '\n' + pageRules(prefs.size, d, mode);
      if (document.fonts && document.fonts.ready) await document.fonts.ready;
      if (token !== st.token) return;
      const previewer = new window.Paged.Previewer();
      st.previewer = previewer;
      const flow = await previewer.preview(buildHandoutDoc(d, mode, prefs), [{ [location.href]: css }], stage);
      if (token !== st.token) return;
      // 쪽 나누기가 끝났으니 paged.js 의 크기 감시를 꺼서, 창 크기가 바뀌어도 쪽 내용이 다시 나뉘지 않게 합니다
      (previewer.chunker?.pages || []).forEach((pg) => {
        try {
          pg.removeListeners();
        } catch {
          /* 무시 */
        }
      });
      fit();
      status.textContent = `${modeLabel(mode)} · ${flow.total || stage.querySelectorAll('.pagedjs_page').length}쪽 · ${PAGE_SIZES[prefs.size].label}`;
      printBtn.disabled = false;
    } catch (e) {
      if (token !== st.token) return;
      status.textContent = `오류: ${e.message || e}`;
    }
  }

  app.replaceChildren(
    back(`#/v/${encodeURIComponent(d.id)}/${mode}`, '← 설교로 돌아가기'),
    h(
      'div',
      { class: 'ho-toolbar' },
      h('div', { class: 'ho-controls' }, h('label', { class: 'ho-opt' }, '보기 방식 ', modeSel), h('label', { class: 'ho-opt' }, '용지 ', sizeSel), bibleLabel, songsOpt, linesOpt, answersOpt),
      h('div', { class: 'ho-actions' }, printBtn, status),
      h('p', { class: 'meta ho-hint', text: '인쇄 창에서 "PDF로 저장"을 고르면 파일로 저장됩니다. 여백은 "없음(또는 기본)", "배경 그래픽"은 켜 주세요.' }),
    ),
    wrap,
  );
  draw();
}
