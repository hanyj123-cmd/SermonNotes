// 핸드아웃: 설교 한 편을 쪽 단위(Letter / A4)로 미리 보고 인쇄·PDF로 저장합니다.
// 쪽 나누기는 paged.js(vendor/paged.polyfill.min.js)가 맡고, 모양은 handout.css 입니다.
// 이 파일은 app.js 의 h(), state, route() 와 content.js 의 도구를 함께 씁니다.

const HANDOUT_KEY = 'sn-handout';
const PAGE_SIZES = { letter: { label: 'Letter (8.5 × 11 in)', css: 'letter' }, a4: { label: 'A4 (210 × 297 mm)', css: 'A4' } };
// 한 역본의 본문이 이만큼(글자 수)보다 길면 맨 뒤 부록으로 보냅니다
const LONG_BIBLE_CHARS = 1800;
const HANDOUT_DEFAULTS = { size: 'letter', songs: true, bible: true, group: true, memo: true };

function loadHandoutPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem(HANDOUT_KEY) || '{}');
    return {
      size: PAGE_SIZES[p.size] ? p.size : HANDOUT_DEFAULTS.size,
      songs: p.songs !== false,
      bible: p.bible !== false,
      group: p.group !== false,
      memo: p.memo !== false,
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

/* ---------- 성경 본문: 절 단위로 나란히 맞추기 ---------- */
// "1 태초에 …\n2 …" 처럼 줄머리에 절 번호가 있고 번호가 차례로 늘어나면 절 단위로 나눕니다. 아니면 null.
function parseVerses(text) {
  const verses = [];
  let last = 0;
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^\[?(\d{1,3})\]?[.)]?\s+(.+)$/);
    if (m && Number(m[1]) > last) {
      last = Number(m[1]);
      verses.push({ n: last, text: m[2] });
    } else if (verses.length) {
      verses[verses.length - 1].text += ` ${line}`; // 앞 절에서 이어지는 줄
    } else {
      return null;
    }
  }
  return verses.length ? verses : null;
}

// 역본별 본문이 모두 절 단위로 나뉘면 [{reference, rows:[{n, cells:[…]}]}] 를, 아니면 null 을 돌려줍니다.
function parallelBible(bible) {
  const versions = (bible && bible.versions) || [];
  if (versions.length < 1) return null;
  const count = Math.max(...versions.map((v) => (v.passages || []).length));
  const groups = [];
  for (let i = 0; i < count; i++) {
    const parsed = versions.map((v) => {
      const p = (v.passages || [])[i];
      return p ? { p, verses: parseVerses(p.text) } : { p: null, verses: [] };
    });
    if (parsed.some((x) => x.p && !x.verses)) return null;
    const nums = [...new Set(parsed.flatMap((x) => x.verses.map((v) => v.n)))].sort((a, b) => a - b);
    const rows = nums.map((n) => ({ n, cells: parsed.map((x) => x.verses.find((v) => v.n === n)?.text || '') }));
    const ref = (parsed.find((x) => x.p)?.p || {}).reference || '';
    groups.push({ reference: ref, rows });
  }
  return groups;
}

/* ---------- 핸드아웃 문서 만들기 ---------- */
function buildHandoutDoc(s, opts) {
  const r = s.result || {};
  const sg = r.small_group || {};
  const date = formatDate(s.published_at);
  const secs = [];
  const heading = (title) => h('h2', { class: 'ho-h2' }, h('span', { text: title }));
  // 소제목과 첫 덩어리는 한 쪽에 같이 있도록 묶습니다 (소제목만 쪽 끝에 남지 않게)
  const sec = (title, ...body) => {
    const items = body.flat(Infinity).filter(Boolean);
    const first = items.shift();
    return h('section', { class: 'ho-sec' }, first ? h('div', { class: 'ho-keep' }, heading(title), first) : heading(title), items);
  };
  const secPlain = (title, ...body) => h('section', { class: 'ho-sec' }, heading(title), ...body);
  const numbered = (arr) => h('ol', { class: 'ho-q' }, arr.map((q) => h('li', {}, inlineMd(q))));
  const lines = (n) => h('div', { class: 'ho-lines' }, Array.from({ length: n }, () => h('div', { class: 'ho-line' })));

  // 머리말
  const head = h(
    'header',
    { class: 'ho-head' },
    h('div', { class: 'ho-kicker' }, h('span', { text: '말씀 노트' }), h('span', { text: `${eventName(s.category)}${date ? `  ·  ${date}` : ''}` })),
    h('h1', { class: 'ho-title', text: r.title || s.title }),
    r.scripture?.length || r.preacher ? h('p', { class: 'ho-scripture' }, r.scripture?.length ? `본문  ${r.scripture.join(', ')}` : '', r.scripture?.length && r.preacher ? '   |   ' : '', r.preacher || '') : null,
    r.summary_short || r.theme ? h('p', { class: 'ho-summary', text: r.summary_short || r.theme }) : null,
  );
  secs.push(head);

  // 추천 찬양
  if (opts.songs && r.worship_songs?.length) {
    secs.push(
      sec(
        '추천 찬양',
        h(
          'ul',
          { class: 'ho-songs' },
          r.worship_songs.map((x) => h('li', {}, h('strong', { text: x.title }), x.artist ? ` — ${x.artist}` : '', x.kind ? h('span', { class: 'ho-tag', text: x.kind }) : null, x.reason ? h('div', { class: 'ho-note', text: x.reason }) : null)),
        ),
      ),
    );
  }

  // 성경 본문 (역본별 나란히). 아주 길면 맨 뒤 부록으로 보내 설교 정리가 먼저 나오게 합니다.
  const versions = (r.bible && r.bible.versions) || [];
  let bibleSec = null;
  let bibleAtEnd = false;
  if (opts.bible && versions.length) {
    const groups = parallelBible(r.bible);
    let body;
    if (groups) {
      // 8절씩 나눠 표마다 역본 이름 줄을 붙입니다 (쪽이 넘어가도 어느 역본인지 보이도록)
      body = groups.flatMap((g) => {
        const out = [];
        for (let i = 0; i < g.rows.length; i += 8) {
          const chunk = g.rows.slice(i, i + 8);
          out.push(
            h(
              'table',
              { class: 'ho-bible' },
              i === 0 && g.reference ? h('caption', { text: g.reference }) : null,
              h('thead', {}, h('tr', {}, h('th', { class: 'ho-vn', text: '' }), versions.map((v) => h('th', {}, v.label || v.abbreviation || '성경')))),
              h('tbody', {}, chunk.map((row) => h('tr', {}, h('td', { class: 'ho-vn', text: String(row.n) }), row.cells.map((c) => h('td', { text: c }))))),
            ),
          );
        }
        return out;
      });
    } else {
      body = versions.map((v) => h('div', { class: 'ho-ver' }, h('h3', { text: v.label || v.abbreviation }), (v.passages || []).map((p) => h('div', {}, p.reference ? h('p', { class: 'ho-ref', text: p.reference }) : null, h('p', { class: 'ho-verse', text: p.text })))));
    }
    const credits = versions.filter((v) => v.copyright).map((v) => `${v.label || v.abbreviation}: ${v.copyright}`);
    const chars = Math.max(...versions.map((v) => (v.passages || []).reduce((n, p) => n + String(p.text || '').length, 0)));
    bibleAtEnd = chars > LONG_BIBLE_CHARS;
    bibleSec = secPlain(bibleAtEnd ? '부록 · 성경 본문' : '성경 본문', body, credits.length ? h('p', { class: 'ho-credit', text: `${credits.join('  /  ')}  (YouVersion 성경 서비스)` }) : null);
    if (bibleAtEnd) bibleSec.classList.add('ho-appendix');
    else secs.push(bibleSec);
  }

  // 설교 정리: 대지 제목 · 본문 · 첫 문단은 한 쪽에 같이 있도록 묶습니다
  const gospel = r.gospel_connection ? h('div', { class: 'ho-gospel' }, h('h3', { text: '복음과의 연결' }), h('div', { class: 'ho-md' }, mdBlocks(r.gospel_connection))) : null;
  const outline = r.outline || [];
  const outlineSec = h('section', { class: 'ho-sec' });
  outline.forEach((o, i) => {
    const paras = outlineParas(o).map((t) => mdBlocks(t));
    const lead = h('div', { class: 'ho-keep' }, i === 0 ? heading('설교 정리') : null, h('h3', { class: 'ho-point-title', text: o.heading }), o.scripture ? h('p', { class: 'ho-ref', text: o.scripture }) : null, paras.length ? h('div', { class: 'ho-md' }, paras[0]) : null);
    outlineSec.append(h('div', { class: 'ho-point' }, lead, paras.length > 1 ? h('div', { class: 'ho-md' }, paras.slice(1)) : null, outlineSummary(o) ? h('div', { class: 'ho-key' }, h('strong', { class: 'ho-key-label', text: '핵심 요약' }), h('p', {}, inlineMd(outlineSummary(o)))) : null));
  });
  if (!outline.length) outlineSec.append(heading('설교 정리'));
  if (gospel) outlineSec.append(gospel);
  secs.push(outlineSec);

  // 삶의 적용
  if (r.applications?.length) {
    secs.push(
      sec(
        '삶의 적용',
        r.applications.map((a) => h('div', { class: 'ho-app' }, h('div', { class: 'ho-app-body' }, h('h3', {}, inlineMd(a.title)), h('div', { class: 'ho-md' }, mdBlocks(a.detail))), h('div', { class: 'ho-check' }, h('span', { class: 'ho-box' }), '실천했어요'))),
      ),
    );
  }

  // 묵상 질문 (쓸 수 있는 줄 포함)
  if (r.meditation_questions?.length) {
    secs.push(sec('묵상 질문', h('ol', { class: 'ho-q ho-q-lined' }, r.meditation_questions.map((q) => h('li', {}, h('div', { class: 'ho-q-text' }, inlineMd(q)), lines(2))))));
  }

  // 소그룹
  if (opts.group) {
    const groupBlock = (title, arr) => (arr?.length ? h('div', { class: 'ho-sg' }, h('h3', { text: title }), numbered(arr)) : null);
    secs.push(
      sec(
        '소그룹 나눔 질문',
        sg.icebreaker ? h('div', { class: 'ho-sg' }, h('h3', { text: '마음 열기' }), h('div', { class: 'ho-ice' }, inlineMd(sg.icebreaker))) : null,
        groupBlock('본문 관찰', sg.observation),
        groupBlock('묵상과 해석', sg.reflection),
        groupBlock('삶의 적용', sg.application),
        groupBlock('기도와 결단', sg.prayer),
      ),
    );
  }

  // 메모 칸
  if (opts.memo) {
    const memo = sec('나의 묵상 노트', lines(9));
    memo.classList.add('ho-keep');
    secs.push(memo);
  }

  // 각주 · 부록
  secs.push(h('footer', { class: 'ho-foot' }, h('p', { text: `참고: ${footnoteText(s.category)}` }), r.caveats ? h('p', { text: `유의: ${r.caveats}` }) : null, h('p', { text: AI_NOTICE })));

  if (bibleSec && bibleAtEnd) secs.push(bibleSec);
  return h('article', { class: 'ho-doc' }, secs);
}

/* ---------- 쪽 규칙(용지 크기, 하단 머리말) ---------- */
const cssString = (t) => `"${String(t).replace(/[\\"]/g, '\\$&').replace(/[\r\n]+/g, ' ')}"`;
function pageRules(size, s) {
  const date = formatDate(s.published_at);
  const foot = `말씀 노트  ·  ${eventName(s.category)}${date ? `  ${date}` : ''}`;
  return `@page { size: ${PAGE_SIZES[size].css}; margin: 0.8in 0.85in 0.9in;
  @bottom-left { content: ${cssString(foot)}; font: 8pt 'Noto Sans KR', sans-serif; color: #6b6558; vertical-align: top; padding-top: 10pt; border-top: 0.5pt solid #b8995a; }
  @bottom-right { content: "Page " counter(page) " / " counter(pages); font: 8pt 'Noto Sans KR', sans-serif; color: #6b6558; vertical-align: top; padding-top: 10pt; border-top: 0.5pt solid #b8995a; }
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
  const res = await fetch('handout.css');
  if (!res.ok) throw new Error(`핸드아웃 서식을 불러오지 못했습니다 (${res.status})`);
  handoutCss = await res.text();
  return handoutCss;
}

function renderHandout(id) {
  teardownHandout();
  const s = state.sermons.find((x) => x.id === id);
  if (!s || !s.result) {
    app.replaceChildren(h('a', { class: 'back', href: '#/', text: '← 목록으로' }), h('div', { class: 'empty' }, h('p', { text: '해당 설교를 찾을 수 없습니다.' })));
    return;
  }
  document.title = `핸드아웃 · ${(s.result && s.result.title) || s.title}`;
  const prefs = loadHandoutPrefs();
  const st = { token: 0, previewer: null, onResize: null };
  handoutState = st;

  const status = h('p', { class: 'meta ho-status', role: 'status' });
  const stage = h('div', { class: 'ho-stage' });
  const wrap = h('div', { class: 'ho-stage-wrap' }, stage);

  const sizeSel = h('select', { class: 'search ho-size', 'aria-label': '용지 크기' }, Object.entries(PAGE_SIZES).map(([k, v]) => h('option', { value: k, text: v.label })));
  sizeSel.value = prefs.size;
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
  const printBtn = h('button', { class: 'btn primary', type: 'button', disabled: true }, '인쇄 / PDF로 저장');
  printBtn.addEventListener('click', () => window.print());
  sizeSel.addEventListener('change', () => {
    prefs.size = sizeSel.value;
    saveHandoutPrefs(prefs);
    draw();
  });

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
      const css = (await loadHandoutCss()) + '\n' + pageRules(prefs.size, s);
      if (document.fonts && document.fonts.ready) await document.fonts.ready;
      if (token !== st.token) return;
      const previewer = new window.Paged.Previewer();
      st.previewer = previewer;
      const flow = await previewer.preview(buildHandoutDoc(s, prefs), [{ [location.href]: css }], stage);
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
      status.textContent = `${flow.total || stage.querySelectorAll('.pagedjs_page').length}쪽 · ${PAGE_SIZES[prefs.size].label}`;
      printBtn.disabled = false;
    } catch (e) {
      if (token !== st.token) return;
      status.textContent = `오류: ${e.message || e}`;
    }
  }

  app.replaceChildren(
    h('a', { class: 'back', href: `#/v/${encodeURIComponent(s.id)}`, text: '← 설교로 돌아가기' }),
    h(
      'div',
      { class: 'ho-toolbar glass' },
      h('div', { class: 'ho-controls' }, h('label', { class: 'ho-opt' }, '용지 ', sizeSel), toggle('songs', '추천 찬양'), toggle('bible', '성경 본문'), toggle('group', '소그룹 질문'), toggle('memo', '메모 칸')),
      h('div', { class: 'ho-actions' }, printBtn, status),
      h('p', { class: 'meta ho-hint', text: '인쇄 창에서 "PDF로 저장"을 고르면 파일로 저장됩니다. 여백은 "없음(또는 기본)", "배경 그래픽"은 켜 주세요.' }),
    ),
    wrap,
  );
  draw();
}
