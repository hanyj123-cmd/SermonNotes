// 핸드아웃: 설교 한 편을 쪽 단위(Letter / A4 / 디지털 태블릿 · 휴대폰)로 미리 보고 PDF 파일로 내려받습니다.
// 보기 방식(설교리뷰 · QT 묵상 · 성경공부 · 소그룹 나눔)마다 내용이 다르고, 성경 본문은 역본을 골라(기본 개역개정) 넣을 수 있습니다.
// 쪽 나누기는 paged.js(vendor/paged.polyfill.min.js)가 맡고, 모양은 handout.css 입니다.
// PDF 파일은 미리보기 쪽을 html2canvas(vendor/html2canvas.min.js)로 쪽마다 그림으로 찍어 PDF 로 묶어 만듭니다.
//   (아이폰·아이패드는 인쇄 창에 "PDF로 저장"이 없어서, 인쇄 방식은 쓰지 않고 파일을 직접 만들어 내려받게 합니다. 글자는 그림이라 선택·검색은 되지 않습니다.
//    글자가 살아 있는 PDF 가 필요하면 컴퓨터에서 "인쇄" 버튼으로 저장합니다.)
// 이 파일은 app.js 의 h(), state, route() 와 content.js · detail.js 의 도구를 함께 씁니다.

const HANDOUT_KEY = 'sn-handout2';
// 용지: print = 종이(Letter · A4), digital = 화면에서 읽는 PDF(태블릿 · 휴대폰)
//   w·h = 쪽 크기(in), m = 여백(in) [위, 오른쪽, 아래, 왼쪽], k = 글자·간격 배율(본문 12.5pt 기준), scale = PDF 그림 해상도 배율
const PAGE_SIZES = {
  letter: { label: 'Letter (8.5 × 11 in)', short: 'Letter', css: 'letter', w: 8.5, h: 11, m: [0.8, 0.85, 0.9, 0.85], k: 1, scale: 2, kind: 'print' },
  a4: { label: 'A4 (210 × 297 mm)', short: 'A4', css: 'A4', w: 8.2677, h: 11.6929, m: [0.8, 0.85, 0.9, 0.85], k: 1, scale: 2, kind: 'print' },
  tablet: { label: '디지털 · 태블릿 (3:4 화면)', short: '태블릿', css: '7.5in 10in', w: 7.5, h: 10, m: [0.55, 0.6, 0.75, 0.6], k: 0.95, scale: 2.5, kind: 'digital' },
  phone: { label: '디지털 · 휴대폰 (세로 화면)', short: '휴대폰', css: '4in 7.2in', w: 4, h: 7.2, m: [0.32, 0.3, 0.5, 0.3], k: 0.88, scale: 3, kind: 'digital' },
};
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
      h('div', { class: 'ho-kicker' }, h('span', { class: 'ho-brand' }, h('img', { class: 'ho-logo', src: 'icons/mark.svg?v=9.16', alt: '' }), h('strong', { text: '말씀결' }), h('span', { text: `  ·  ${modeLabel(mode)}` })), h('span', { text: `${eventName(d.category)}${date ? `  ·  ${date}` : ''}` })),
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
  const creditName = (window.APP_CONFIG && window.APP_CONFIG.CREDIT) || '';
  secs.push(h('div', { class: 'ho-made' }, h('img', { class: 'ho-logo-lg', src: 'icons/mark.svg?v=9.16', alt: '' }), h('div', {}, h('strong', { text: '말씀결' }), h('span', { text: '  말씀의 결을 따라 읽고 묵상하는 노트' }), creditName ? h('div', { class: 'ho-made-by', text: creditName }) : null)));
  secs.push(h('footer', { class: 'ho-foot' }, h('p', { text: `참고: ${footnoteText(d.category)}` }), d.result.caveats ? h('p', { text: `유의: ${d.result.caveats}` }) : null));
  answerPages.forEach((a) => {
    a.classList.add('ho-appendix');
    secs.push(a);
  });
  if (bibleSec && bibleAtEnd) secs.push(bibleSec);
  // 바깥에 빈 껍데기(.ho-root)를 한 겹 더 씌웁니다: paged.js 는 "쪽이 섹션과 섹션 사이에서 나뉘는" 쪽(첫 쪽·부록 첫 쪽 등)에서
  // 맨 바깥 요소를 다시 만들지 않아서, 그 쪽들만 .ho-doc 서식(글꼴·크기·줄 간격)이 빠지던 문제를 막습니다.
  return h('div', { class: 'ho-root' }, h('article', { class: `ho-doc ho-fmt-${opts.size}` }, secs.filter(Boolean)));
}

/* ---------- 쪽 규칙(용지 크기, 하단 머리말) ---------- */
const cssString = (t) => `"${String(t).replace(/[\\"]/g, '\\$&').replace(/[\r\n]+/g, ' ')}"`;
const px = (n) => +n.toFixed(2);
function pageRules(size, s, mode) {
  const f = PAGE_SIZES[size];
  const date = formatDate(s.date);
  // 휴대폰은 폭이 좁아서 하단 문구를 짧게 줄입니다
  const foot = size === 'phone' ? `말씀결  ·  ${modeLabel(mode)}` : `말씀결  ·  ${eventName(s.category)}${date ? `  ${date}` : ''}  ·  ${modeLabel(mode)}`;
  const pageNo = size === 'phone' ? 'counter(page) " / " counter(pages)' : '"Page " counter(page) " / " counter(pages)';
  const box = `font: ${px(9 * f.k)}pt 'Noto Sans KR', sans-serif; color: #4a5c72; vertical-align: top; padding-top: ${px(10 * f.k)}pt; border-top: ${px(0.75 * f.k)}pt solid #8fcf5a;`;
  return `@page { size: ${f.css}; margin: ${f.m[0]}in ${f.m[1]}in ${f.m[2]}in ${f.m[3]}in;
  @bottom-left { content: ${cssString(foot)}; ${box} }
  @bottom-right { content: ${pageNo}; ${box} }
}
@page :first { @bottom-left { content: ${cssString(foot)}; } }`;
}
// handout.css 의 pt 크기를 용지 배율(k)만큼 키우거나 줄입니다 (휴대폰은 작게, 태블릿은 조금 작게)
const scalePt = (css, k) => (k === 1 ? css : css.replace(/(-?\d*\.?\d+)pt\b/g, (_, n) => `${px(parseFloat(n) * k)}pt`));

// 쪽 중간에서 끊기지 않게 하려는 문단 중, 한 쪽의 절반이 넘게 긴 것에는 .ho-long 을 붙여 어쩔 수 없이 나눌 수 있게 합니다
function markLongBlocks(root, f) {
  const contentW = (f.w - f.m[1] - f.m[3]) * 72;
  const contentH = (f.h - f.m[0] - f.m[2]) * 72;
  const font = 12.5 * f.k;
  const perLine = Math.max(8, contentW / (font * 0.92)); // 한 줄에 들어가는 글자 수(대략)
  const pageLines = contentH / (font * 1.85);
  const maxLines = Math.max(5, Math.floor(pageLines * 0.55));
  root.querySelectorAll('p, li, blockquote, .ho-q-text, .ho-qz-q').forEach((el) => {
    if (Math.ceil((el.textContent || '').length / perLine) > maxLines) el.classList.add('ho-long');
  });
}

/* ---------- 미리보기 화면 ---------- */
let handoutState = null; // { previewer, onResize, pdf }

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

function dropPdf(st) {
  if (st.pdf && st.pdf.url) URL.revokeObjectURL(st.pdf.url);
  st.pdf = null;
}

function teardownHandout() {
  if (!handoutState) return;
  const st = handoutState;
  handoutState = null;
  st.token = -1;
  window.removeEventListener('resize', st.onResize);
  disposePreviewer(st.previewer);
  dropPdf(st);
}

const scriptLoads = {};
function loadScriptOnce(src, isReady, errorText) {
  if (isReady()) return Promise.resolve();
  if (scriptLoads[src]) return scriptLoads[src];
  scriptLoads[src] = new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = src;
    el.onload = () => resolve();
    el.onerror = () => {
      delete scriptLoads[src];
      reject(new Error(errorText));
    };
    document.head.append(el);
  });
  return scriptLoads[src];
}
function loadPaged() {
  window.PagedConfig = { auto: false }; // 자동으로 쪽 나누기를 시작하지 않게 (직접 시작합니다)
  return loadScriptOnce('vendor/paged.polyfill.min.js?v=9.16', () => window.Paged && window.Paged.Previewer, '쪽 나누기 도구를 불러오지 못했습니다. 인터넷 연결을 확인하고 다시 시도해 주세요.');
}
const loadHtml2Canvas = () => loadScriptOnce('vendor/html2canvas.min.js?v=9.16', () => typeof window.html2canvas === 'function', 'PDF 파일 도구를 불러오지 못했습니다. 인터넷 연결을 확인하고 다시 시도해 주세요.');

let handoutCss = null;
async function loadHandoutCss() {
  if (handoutCss) return handoutCss;
  const res = await fetch('handout.css?v=9.16');
  if (!res.ok) throw new Error(`핸드아웃 서식을 불러오지 못했습니다 (${res.status})`);
  handoutCss = await res.text();
  return handoutCss;
}

/* ---------- PDF 파일 만들기: 쪽마다 그림으로 찍어서 PDF 한 파일로 묶습니다 ---------- */
// 쪽 아래 문구(머리말·쪽 번호)는 paged.js 가 화면에서만 계산해 주는 값이라, 그림을 찍기 전에 글자로 미리 풀어 둡니다
function marginTexts(pageEl, no, total) {
  return [...pageEl.querySelectorAll('.pagedjs_margin-content')].map((el) => {
    let raw = '';
    for (const pseudo of ['::after', '::before']) {
      const c = getComputedStyle(el, pseudo).content;
      if (c && c !== 'none' && c !== 'normal') {
        raw = c;
        break;
      }
    }
    if (!raw) return null;
    let out = '';
    const re = /"((?:[^"\\]|\\.)*)"|counter\(\s*(pages?)\s*\)/g;
    for (let m = re.exec(raw); m; m = re.exec(raw)) out += m[2] ? String(m[2] === 'pages' ? total : no) : m[1].replace(/\\(.)/g, '$1');
    return out;
  });
}

const nextTick = () => new Promise((r) => setTimeout(r, 0));
const canvasToJpeg = (canvas) =>
  new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? b.arrayBuffer().then((buf) => resolve(new Uint8Array(buf)), reject) : reject(new Error('쪽 그림을 만들지 못했습니다. 기기의 메모리가 부족할 수 있어요.'))), 'image/jpeg', 0.92);
  });

async function capturePage(pageEl, texts, f) {
  const width = Math.round(f.w * 96);
  const height = Math.round(f.h * 96);
  const canvas = await window.html2canvas(pageEl, {
    scale: f.scale,
    backgroundColor: '#ffffff',
    useCORS: true,
    logging: false,
    width,
    height,
    windowWidth: Math.max(window.innerWidth, width + 80),
    onclone: async (doc, el) => {
      // 미리보기 화면용 확대·그림자·가림을 걷어내고 쪽을 원래 크기로 찍습니다
      const style = doc.createElement('style');
      style.textContent = '.ho-stage{zoom:1!important;width:max-content!important}.ho-stage-wrap{overflow:visible!important}.pagedjs_page{box-shadow:none!important;margin:0!important}.ho-nopseudo::before,.ho-nopseudo::after{content:none!important}';
      doc.head.append(style);
      el.querySelectorAll('.pagedjs_margin-content').forEach((m, i) => {
        if (texts[i] != null) {
          m.textContent = texts[i];
          m.classList.add('ho-nopseudo');
        }
      });
      await new Promise((r) => setTimeout(r, 60)); // 새로 쓴 글자의 글꼴 조각이 내려오게 잠깐 기다립니다
      if (doc.fonts && doc.fonts.ready) await doc.fonts.ready;
    },
  });
  try {
    return { jpeg: await canvasToJpeg(canvas), w: canvas.width, h: canvas.height };
  } finally {
    canvas.width = 1; // 메모리를 바로 돌려줍니다 (아이폰은 그림 메모리 한도가 작습니다)
    canvas.height = 1;
  }
}

// JPEG 그림 여러 장을 쪽마다 한 장씩 넣은 PDF 로 묶습니다 (외부 도구 없이 직접 씁니다)
function buildPdf(images, wPt, hPt, title) {
  const enc = new TextEncoder();
  const chunks = [];
  const offsets = [];
  let size = 0;
  const put = (d) => {
    const u = typeof d === 'string' ? enc.encode(d) : d;
    chunks.push(u);
    size += u.length;
  };
  const begin = (n) => {
    offsets[n] = size;
    put(`${n} 0 obj\n`);
  };
  const hex16 = (s) => `<FEFF${[...s].map((ch) => ch.codePointAt(0).toString(16).padStart(4, '0')).join('')}>`; // 한글 제목은 UTF-16 으로
  const n = images.length;
  const pageObj = (i) => 6 + i * 3;
  put(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a])); // %PDF-1.4 + 바이너리 표시
  begin(1);
  put('<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  begin(2);
  put(`<< /Type /Pages /Count ${n} /Kids [${images.map((_, i) => `${pageObj(i)} 0 R`).join(' ')}] >>\nendobj\n`);
  begin(3);
  put(`<< /Title ${hex16(title)} /Producer (Malsseumgyeol) >>\nendobj\n`);
  const W = px(wPt);
  const H = px(hPt);
  images.forEach((im, i) => {
    const img = 4 + i * 3;
    const content = 5 + i * 3;
    begin(img);
    put(`<< /Type /XObject /Subtype /Image /Width ${im.w} /Height ${im.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${im.jpeg.length} >>\nstream\n`);
    put(im.jpeg);
    put('\nendstream\nendobj\n');
    const draw = `q ${W} 0 0 ${H} 0 0 cm /Im0 Do Q`;
    begin(content);
    put(`<< /Length ${draw.length} >>\nstream\n${draw}\nendstream\nendobj\n`);
    begin(pageObj(i));
    put(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /XObject << /Im0 ${img} 0 R >> /ProcSet [/PDF /ImageC] >> /Contents ${content} 0 R >>\nendobj\n`);
  });
  const total = 4 + n * 3;
  const xrefAt = size;
  put(`xref\n0 ${total}\n0000000000 65535 f \n`);
  for (let i = 1; i < total; i++) put(`${String(offsets[i]).padStart(10, '0')} 00000 n \n`);
  put(`trailer\n<< /Size ${total} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`);
  return new Blob(chunks, { type: 'application/pdf' });
}

async function makePdfFromStage(stage, f, title, onProgress, alive) {
  await loadHtml2Canvas();
  const pages = [...stage.querySelectorAll('.pagedjs_page')];
  if (!pages.length) throw new Error('미리보기 쪽이 없습니다.');
  const texts = pages.map((pg, i) => marginTexts(pg, i + 1, pages.length));
  const images = [];
  for (let i = 0; i < pages.length; i++) {
    if (!alive()) return null;
    onProgress(i + 1, pages.length);
    await nextTick(); // 진행 표시가 화면에 보이도록 한 숨 쉽니다
    images.push(await capturePage(pages[i], texts[i], f));
  }
  if (!alive()) return null;
  return buildPdf(images, f.w * 72, f.h * 72, title);
}

/* ---------- 내려받기 ---------- */
const isIOS = () => /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isTouchPrimary = () => !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);

function anchorDownload(url, name) {
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  document.body.append(a);
  a.click();
  setTimeout(() => a.remove(), 1000);
}
// 아이폰·아이패드는 공유 창의 "파일에 저장"이 가장 확실합니다. 안 되는 기기는 일반 다운로드로 내려받습니다.
function downloadPdf(pdf) {
  const file = new File([pdf.blob], pdf.name, { type: 'application/pdf' });
  if (isIOS() && navigator.canShare && navigator.share) {
    let ok = false;
    try {
      ok = navigator.canShare({ files: [file] });
    } catch {
      ok = false;
    }
    if (ok) {
      navigator.share({ files: [file], title: pdf.name }).catch((e) => {
        if (e && e.name === 'AbortError') return; // 사용자가 공유 창을 닫은 것
        anchorDownload(pdf.url, pdf.name);
      });
      return;
    }
  }
  anchorDownload(pdf.url, pdf.name);
}

async function renderHandout(id, modeArg) {
  teardownHandout();
  const item = state.sermons.find((x) => x.id === id);
  const back = (href, text) => h('a', { class: 'back', href }, icon('back'), text.replace(/^←\s*/, ''));
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
  const fileTitle = (m) => `말씀결_${(d.date || '').replace(/-/g, '.')}_${d.title}_${modeLabel(m)}`.replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim(); // PDF 파일 이름
  const pdfName = (o) => `${fileTitle(o.mode)}_${PAGE_SIZES[o.size].short}.pdf`;
  document.title = fileTitle(mode);
  const prefs = loadHandoutPrefs();
  const st = { token: 0, previewer: null, onResize: null, pdf: null };
  handoutState = st;
  let drawn = null; // 지금 미리보기에 그려진 옵션 (옵션을 바꾸면 달라져서 "새로고침 필요"가 됩니다)
  let busy = false;

  const status = h('p', { class: 'meta ho-status', role: 'status' });
  const stage = h('div', { class: 'ho-stage' });
  const wrap = h('div', { class: 'ho-stage-wrap' }, stage);

  // 지금 고른 옵션이 미리보기와 같은지
  const sameAsDrawn = () => !!drawn && drawn.mode === mode && drawn.size === prefs.size && drawn.bible === prefs.bible && drawn.songs === prefs.songs && drawn.lines === prefs.lines && drawn.answers === prefs.answers;
  const refreshBtn = h('button', { class: 'btn primary', type: 'button' }, '미리보기 새로고침');
  const dlBtn = h('button', { class: 'btn primary ho-dl', type: 'button', disabled: true }, icon('file'), 'PDF 다운로드');
  const openLink = h('a', { class: 'ho-open', href: '#', target: '_blank', rel: 'noopener', hidden: true, text: '새 창에서 열기' });
  const printBtn = h('button', { class: 'btn', type: 'button', disabled: true, title: '컴퓨터에서 글자가 살아 있는 PDF 로 저장할 때' }, '인쇄');
  printBtn.hidden = isIOS() || isTouchPrimary();
  printBtn.addEventListener('click', () => window.print());
  dlBtn.addEventListener('click', () => {
    if (st.pdf && sameAsDrawn()) downloadPdf(st.pdf);
  });
  refreshBtn.addEventListener('click', () => draw());

  // 옵션이 바뀌면 지금 미리보기·PDF 는 옛 옵션이라, 새로고침을 누르게 안내합니다
  const syncButtons = () => {
    const stale = !!drawn && !sameAsDrawn();
    wrap.classList.toggle('is-stale', stale);
    refreshBtn.classList.toggle('primary', !drawn || stale || !st.pdf);
    refreshBtn.disabled = busy;
    dlBtn.disabled = busy || stale || !st.pdf;
    printBtn.disabled = busy || stale || !drawn;
    openLink.hidden = !(st.pdf && !stale);
    if (!busy && stale) status.textContent = '옵션이 바뀌었어요. "미리보기 새로고침"을 누르면 새 옵션으로 다시 만듭니다.';
  };
  const optionChanged = () => {
    saveHandoutPrefs(prefs);
    syncButtons();
  };

  const modeSel = h('select', { class: 'search ho-size', 'aria-label': '보기 방식' }, MODES.map((m) => h('option', { value: m.key, text: m.label, disabled: !modes.includes(m.key) })));
  modeSel.value = mode;
  modeSel.addEventListener('change', () => {
    mode = modeSel.value;
    document.title = fileTitle(mode);
    rememberMode(mode);
    try {
      history.replaceState(null, '', `#/h/${encodeURIComponent(id)}/${mode}`);
    } catch {
      /* 주소를 못 바꿔도 화면은 바뀝니다 */
    }
    syncVisibility();
    syncButtons();
  });
  const sizeSel = h('select', { class: 'search ho-size', 'aria-label': '용지 크기' }, [
    h('optgroup', { label: '종이 (인쇄용)' }, ['letter', 'a4'].map((k) => h('option', { value: k, text: PAGE_SIZES[k].label }))),
    h('optgroup', { label: '디지털 (화면으로 읽기)' }, ['tablet', 'phone'].map((k) => h('option', { value: k, text: PAGE_SIZES[k].label }))),
  ]);
  sizeSel.value = prefs.size;
  sizeSel.addEventListener('change', () => {
    prefs.size = sizeSel.value;
    optionChanged();
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
    optionChanged();
  });
  const bibleLabel = h('label', { class: 'ho-opt ho-opt-sel' }, '성경 본문 ', bibleSel);
  const toggle = (key, label) => {
    const cb = h('input', { type: 'checkbox' });
    cb.checked = prefs[key];
    cb.addEventListener('change', () => {
      prefs[key] = cb.checked;
      optionChanged();
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

  // 미리보기를 새로 만들고, 이어서 PDF 파일을 만듭니다
  async function draw() {
    const token = ++st.token;
    const f = PAGE_SIZES[prefs.size];
    const now = { mode, size: prefs.size, bible: prefs.bible, songs: prefs.songs, lines: prefs.lines, answers: prefs.answers };
    busy = true;
    dropPdf(st);
    drawn = null;
    wrap.classList.remove('is-stale');
    refreshBtn.disabled = true;
    dlBtn.disabled = true;
    printBtn.disabled = true;
    openLink.hidden = true;
    status.textContent = '미리보기를 만드는 중입니다… (잠시만 기다려 주세요)';
    // 이전 미리보기 정리
    disposePreviewer(st.previewer);
    st.previewer = null;
    stage.replaceChildren();
    stage.style.zoom = '1';
    try {
      await loadPaged();
      const css = scalePt(await loadHandoutCss(), f.k) + '\n' + pageRules(prefs.size, d, mode);
      if (document.fonts && document.fonts.ready) await document.fonts.ready;
      if (token !== st.token) return;
      const previewer = new window.Paged.Previewer();
      st.previewer = previewer;
      const doc = buildHandoutDoc(d, mode, prefs);
      markLongBlocks(doc, f);
      const flow = await previewer.preview(doc, [{ [location.href]: css }], stage);
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
      drawn = now;
      const pageCount = flow.total || stage.querySelectorAll('.pagedjs_page').length;
      const label = `${modeLabel(mode)} · ${pageCount}쪽 · ${f.label}`;
      printBtn.disabled = false;
      status.textContent = `${label} — PDF 파일을 만드는 중…`;
      try {
        const blob = await makePdfFromStage(stage, f, fileTitle(mode), (i, n) => (status.textContent = `${label} — PDF 파일 만드는 중… ${i}/${n}쪽`), () => token === st.token);
        if (token !== st.token || !blob) return;
        st.pdf = { blob, url: URL.createObjectURL(blob), name: pdfName(now) };
        openLink.href = st.pdf.url;
        status.textContent = `${label} · PDF 준비 완료 (${(blob.size / 1048576).toFixed(1)}MB)`;
      } catch (e) {
        if (token !== st.token) return;
        status.textContent = `미리보기는 만들었지만 PDF 파일을 만들지 못했습니다: ${e.message || e}${printBtn.hidden ? '' : ' — 위의 "인쇄" 버튼으로 저장할 수 있어요.'}`;
      }
    } catch (e) {
      if (token !== st.token) return;
      status.textContent = `오류: ${e.message || e}`;
    } finally {
      if (token === st.token) {
        busy = false;
        syncButtons();
      }
    }
  }

  const hintText = isIOS()
    ? '아래 옵션을 고르고 "미리보기 새로고침"을 누르세요. 미리보기와 PDF 파일이 함께 만들어지고, "PDF 다운로드"를 누르면 나오는 공유 창에서 "파일에 저장"(또는 GoodNotes 같은 필기 앱)을 고르면 됩니다.'
    : '옵션을 고르고 "미리보기 새로고침"을 누르면 미리보기와 PDF 파일이 만들어지고, "PDF 다운로드"로 저장합니다. 옵션을 바꾸면 다시 새로고침해 주세요.';
  app.replaceChildren(
    back(`#/v/${encodeURIComponent(d.id)}/${mode}`, '← 설교로 돌아가기'),
    h(
      'div',
      { class: 'ho-toolbar' },
      h('div', { class: 'ho-controls' }, h('label', { class: 'ho-opt ho-opt-sel' }, '보기 방식 ', modeSel), h('label', { class: 'ho-opt ho-opt-sel' }, '용지 ', sizeSel), bibleLabel, songsOpt, linesOpt, answersOpt),
      h('div', { class: 'ho-actions' }, refreshBtn, dlBtn, openLink, printBtn),
      status,
      h('p', { class: 'meta ho-hint', text: hintText }),
    ),
    wrap,
  );
  syncButtons();
  draw();
}
