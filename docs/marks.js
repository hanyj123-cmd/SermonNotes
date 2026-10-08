// 형광펜 · 밑줄 · 메모 (구글 로그인했을 때, 나만 보이게 저장)
// 설교 화면의 글(설교 정리 · 성경 본문 · 묵상 · 질문 등)에서 글자를 고르면 작은 도구 막대가 뜹니다.
//   - 형광펜: 연한 노랑 · 연두 · 분홍 · 하늘 · 주황 · 보라
//   - 밑줄: 빨강 · 파랑 · 초록 · 보라 · 주황
//   - 메모: 고른 글에 내 생각을 따로 적어 둡니다
// 저장 형식 (Notes 탭 marks_json): [{ id, g, k, s, e, q, st, c, n, at }]
//   k = 그 문단 글자 전체의 지문(hash), s/e = 문단 안 글자 위치, q = 고른 글, st = 'hl'(형광펜) | 'ul'(밑줄), c = 색 이름, n = 메모
//   문단 글이 바뀌면(다시 정리 등) 지문이 달라져 그 표시는 화면에 나오지 않고 "내 표시" 목록에만 남습니다.
// 이 파일은 app.js 의 h(), toast(), notesCall(), auth 를 씁니다.

const MARK_HL = [
  ['yellow', '노랑'],
  ['green', '연두'],
  ['pink', '분홍'],
  ['sky', '하늘'],
  ['orange', '주황'],
  ['purple', '보라'],
];
const MARK_UL = [
  ['red', '빨강'],
  ['blue', '파랑'],
  ['green', '초록'],
  ['purple', '보라'],
  ['orange', '주황'],
];
const MARK_COLOR_NAMES = new Set([...MARK_HL, ...MARK_UL].map(([c]) => c));
const MARK_UNIT_SEL = 'p, li, h3, h4, blockquote, td, dd';
const MARK_SKIP_SEL = 'button, textarea, input, select, label, .actions, .note-hint, .mk-tool, .mk-pop, .bible-tabs, .mode-tabs, .secnav';
const MARK_MAX = 500;
const MARK_NOTE_MAX = 2000;

let currentMarks = null;

/** 다른 화면으로 넘어갈 때: 저장하고 도구 막대를 치웁니다 */
function teardownMarks() {
  if (!currentMarks) return;
  const m = currentMarks;
  currentMarks = null;
  m.flush();
  m.destroy();
}

// 문단 글자의 지문 (FNV-1a 32bit). 공백 차이는 무시합니다.
function markHash(text) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  let x = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    x ^= s.charCodeAt(i);
    x = Math.imul(x, 0x01000193) >>> 0;
  }
  return `${x.toString(36)}${s.length.toString(36)}`;
}
const markId = () => `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

/**
 * @param videoId  설교 영상 ID
 * @param root     표시를 붙일 영역 (#mode-body)
 * @param enabled  로그인해서 저장할 수 있는지
 */
function createMarks(videoId, root, { enabled }) {
  let marks = [];
  let ready = false;
  let dirty = false;
  let timer = null;
  let saving = null;
  let alive = true;

  const countEl = h('span', { class: 'mk-count', text: '0' });
  const listBtn = h('button', { class: 'btn small mk-list-btn', type: 'button', hidden: !enabled, title: '이 설교에 남긴 형광펜·밑줄·메모 모아 보기' }, icon('highlighter'), '내 표시 ', countEl);
  listBtn.hidden = !enabled;

  /* ---------- 저장 ---------- */
  async function save() {
    if (!enabled || !ready || !dirty) return;
    if (saving) await saving;
    dirty = false;
    saving = (async () => {
      try {
        const res = await notesCall('notes_marks_save', { video_id: videoId, marks });
        if (!res.ok) throw new Error(res.error || '저장하지 못했습니다.');
        state.noteIds.add(videoId);
      } catch (e) {
        dirty = true;
        toast(`표시를 저장하지 못했습니다: ${e.message || e}`, 3500);
      }
    })();
    await saving;
    saving = null;
  }
  const touch = () => {
    dirty = true;
    countEl.textContent = String(groups().length);
    clearTimeout(timer);
    timer = setTimeout(save, 700);
  };
  const flush = () => {
    clearTimeout(timer);
    return save();
  };

  /* ---------- 문단 찾기 · 글자 위치 ---------- */
  const isUnit = (el) => el.matches(MARK_UNIT_SEL) && !el.closest(MARK_SKIP_SEL) && !el.querySelector(MARK_UNIT_SEL) && el.textContent.trim().length > 0;
  const units = () => [...root.querySelectorAll(MARK_UNIT_SEL)].filter(isUnit);
  const keyOf = (u) => {
    if (!u.dataset.mkKey) u.dataset.mkKey = markHash(u.textContent);
    return u.dataset.mkKey;
  };
  // (node, offset) 지점이 문단 첫 글자부터 몇 번째 글자인지
  function offsetIn(unit, node, offset) {
    const r = document.createRange();
    r.selectNodeContents(unit);
    try {
      r.setEnd(node, offset);
    } catch {
      return 0;
    }
    return r.toString().length;
  }

  /* ---------- 칠하기 ---------- */
  function unwrap(unit) {
    unit.querySelectorAll('.mk').forEach((el) => el.replaceWith(...el.childNodes));
    unit.normalize();
  }
  function wrapRange(unit, s, e, make) {
    const walker = document.createTreeWalker(unit, NodeFilter.SHOW_TEXT);
    const pieces = [];
    let pos = 0;
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const len = n.data.length;
      const a = Math.max(s, pos);
      const b = Math.min(e, pos + len);
      if (a < b) pieces.push([n, a - pos, b - pos]);
      pos += len;
      if (pos >= e) break;
    }
    for (const [node, a, b] of pieces) {
      let target = node;
      if (a > 0) target = target.splitText(a);
      if (b - a < target.data.length) target.splitText(b - a);
      if (!target.data.trim()) continue; // 줄바꿈·공백만 있는 조각은 칠하지 않습니다
      const el = make();
      target.replaceWith(el);
      el.append(target);
    }
  }
  function paintUnit(unit) {
    const key = keyOf(unit);
    unwrap(unit);
    const text = unit.textContent;
    const mine = marks.filter((m) => m.k === key);
    // 형광펜을 먼저, 밑줄을 나중에 칠해 밑줄이 형광펜 위에 보이게 합니다
    mine.sort((a, b) => (a.st === b.st ? 0 : a.st === 'hl' ? -1 : 1));
    for (const m of mine) {
      let s = m.s;
      let e = m.e;
      if (text.slice(s, e) !== m.q) {
        const i = text.indexOf(m.q);
        if (i < 0) continue;
        s = i;
        e = i + m.q.length;
      }
      wrapRange(unit, s, e, () => {
        const el = h(m.st === 'ul' ? 'span' : 'mark', { class: `mk mk-${m.st} mk-${m.st}-${m.c}${m.n ? ' mk-has-note' : ''}`, 'data-mg': m.g, tabindex: '0', title: m.n ? `메모: ${m.n.slice(0, 80)}` : '' });
        return el;
      });
    }
    // 메모가 있는 표시는 마지막 조각에만 메모 표시(✎)를 붙입니다
    const seen = new Set();
    [...unit.querySelectorAll('.mk-has-note')].reverse().forEach((el) => {
      if (seen.has(el.dataset.mg)) el.classList.add('mk-note-mid');
      seen.add(el.dataset.mg);
    });
  }
  function paintAll() {
    if (!alive) return;
    observer.disconnect();
    for (const u of units()) paintUnit(u);
    observe();
  }
  function paintKeys(keys) {
    observer.disconnect();
    for (const u of units()) if (keys.has(keyOf(u))) paintUnit(u);
    observe();
  }
  // 모드를 바꾸거나 성경 역본을 바꿔 글이 새로 그려지면, 새 문단에 표시를 다시 칠합니다
  let raf = 0;
  const observer = new MutationObserver(() => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      if (!alive || !marks.length) return;
      observer.disconnect();
      for (const u of units()) if (!u.dataset.mkKey) paintUnit(u);
      observe();
    });
  });
  const observe = () => alive && observer.observe(root, { childList: true, subtree: true });
  observe();

  /* ---------- 고르기 → 도구 막대 ---------- */
  const tool = h('div', { class: 'mk-tool', role: 'toolbar', 'aria-label': '형광펜 · 밑줄 · 메모', hidden: true });
  tool.hidden = true;
  const pop = h('div', { class: 'mk-pop', role: 'dialog', 'aria-label': '메모', hidden: true });
  pop.hidden = true;
  document.body.append(tool, pop);
  // 도구 막대를 눌러도 고른 글이 풀리지 않게 합니다
  tool.addEventListener('mousedown', (e) => e.preventDefault());
  // 막대를 누르는 동안(휴대폰에서 고른 글이 잠깐 풀려도) 막대가 사라지지 않게 합니다
  let pressingTool = false;
  tool.addEventListener('pointerdown', () => {
    pressingTool = true;
  });
  const releaseTool = () => setTimeout(() => (pressingTool = false), 400);

  function placeNear(el, rect) {
    el.hidden = false;
    const w = el.offsetWidth;
    const hgt = el.offsetHeight;
    let top = rect.bottom + 10; // 휴대폰의 기본 메뉴(복사 등)는 보통 위에 뜨므로 아래에 둡니다
    if (top + hgt > window.innerHeight - 8) top = rect.top - hgt - 10;
    top = Math.min(Math.max(8, top), Math.max(8, window.innerHeight - hgt - 8)); // 항상 화면 안에
    const left = Math.min(Math.max(8, rect.left + rect.width / 2 - w / 2), window.innerWidth - w - 8);
    el.style.top = `${top}px`;
    el.style.left = `${left}px`;
  }
  // 막대가 무엇 때문에 떠 있는지: 'sel' = 고른 글, 'mark' = 이미 칠한 표시를 눌렀을 때
  let toolMode = '';
  let toolScrollY = 0;
  const hideTool = () => {
    tool.hidden = true;
    toolMode = '';
  };
  const hidePop = () => {
    if (pop.contains(document.activeElement)) document.activeElement.blur(); // 키보드도 내립니다
    pop.hidden = true;
  };

  function swatches(list, kind, onPick, current) {
    return h(
      'div',
      { class: 'mk-row' },
      h('span', { class: 'mk-row-label', text: kind === 'hl' ? '형광펜' : '밑줄' }),
      list.map(([c, label]) =>
        h('button', {
          class: `mk-sw mk-sw-${kind} mk-${kind}-${c}${current === `${kind}:${c}` ? ' is-on' : ''}`,
          type: 'button',
          title: `${kind === 'hl' ? '형광펜' : '밑줄'} ${label}`,
          'aria-label': `${kind === 'hl' ? '형광펜' : '밑줄'} ${label}`,
          onclick: () => onPick(kind, c),
        }, kind === 'ul' ? '가' : ''),
      ),
    );
  }

  // 지금 고른 글 → 문단별 조각 [{unit, s, e}]
  function selectionSegments() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
    const range = sel.getRangeAt(0);
    if (!root.contains(range.commonAncestorContainer)) return null;
    const segs = [];
    for (const u of units()) {
      if (!range.intersectsNode(u)) continue;
      const s = u.contains(range.startContainer) ? offsetIn(u, range.startContainer, range.startOffset) : 0;
      const e = u.contains(range.endContainer) ? offsetIn(u, range.endContainer, range.endOffset) : u.textContent.length;
      const q = u.textContent.slice(s, e);
      if (e > s && q.trim()) segs.push({ unit: u, s, e, q });
    }
    return segs.length ? { segs, rect: range.getBoundingClientRect() } : null;
  }

  function showForSelection() {
    const got = selectionSegments();
    if (!got) {
      // 빈 곳을 눌러 고른 것이 풀리면 막대도 사라집니다.
      // 단, 칠한 표시를 눌러서 뜬 막대는 "고른 글이 없는 것"이 정상이므로 그대로 둡니다.
      if (!pressingTool && toolMode !== 'mark') hideTool();
      return;
    }
    hidePop();
    toolMode = 'sel';
    toolScrollY = window.scrollY;
    if (!enabled) {
      tool.replaceChildren(h('p', { class: 'mk-login', text: '구글 로그인을 하면 형광펜 · 밑줄 · 메모를 남길 수 있어요 (나만 보여요).' }));
      placeNear(tool, got.rect);
      return;
    }
    const add = (st, c, note) => {
      if (marks.length + got.segs.length > MARK_MAX) return toast(`표시는 설교 한 편에 ${MARK_MAX}개까지 남길 수 있습니다.`);
      const g = markId();
      const keys = new Set();
      got.segs.forEach((x, i) => {
        const k = keyOf(x.unit);
        keys.add(k);
        marks.push({ id: `${g}-${i}`, g, k, s: x.s, e: x.e, q: x.q.slice(0, 400), st, c, n: '', at: new Date().toISOString() });
      });
      paintKeys(keys);
      touch();
      window.getSelection().removeAllRanges();
      hideTool();
      if (note) openNote(g);
    };
    tool.replaceChildren(
      swatches(MARK_HL, 'hl', (st, c) => add(st, c)),
      swatches(MARK_UL, 'ul', (st, c) => add(st, c)),
      h('div', { class: 'mk-row' }, h('button', { class: 'btn small', type: 'button', onclick: () => add('hl', 'yellow', true) }, icon('pencil'), '메모 남기기')),
    );
    placeNear(tool, got.rect);
  }

  /* ---------- 이미 칠한 표시를 눌렀을 때 ---------- */
  const groupMarks = (g) => marks.filter((m) => m.g === g);
  function groups() {
    const seen = new Map();
    for (const m of marks) if (!seen.has(m.g)) seen.set(m.g, m);
    return [...seen.values()];
  }
  function changeGroup(g, patch) {
    const keys = new Set();
    for (const m of marks) if (m.g === g) Object.assign(m, patch), keys.add(m.k);
    paintKeys(keys);
    touch();
  }
  function removeGroup(g) {
    const keys = new Set(groupMarks(g).map((m) => m.k));
    marks = marks.filter((m) => m.g !== g);
    paintKeys(keys);
    touch();
  }
  function showForMark(el) {
    const g = el.dataset.mg;
    const first = groupMarks(g)[0];
    if (!first) return;
    hidePop();
    clearTimeout(selTimer); // 누를 때 생긴 "선택 풀림" 신호가 뒤늦게 와서 막대를 숨기지 않게 합니다
    toolMode = 'mark';
    toolScrollY = window.scrollY;
    const cur = `${first.st}:${first.c}`;
    tool.replaceChildren(
      swatches(MARK_HL, 'hl', (st, c) => (changeGroup(g, { st, c }), hideTool()), cur),
      swatches(MARK_UL, 'ul', (st, c) => (changeGroup(g, { st, c }), hideTool()), cur),
      h(
        'div',
        { class: 'mk-row' },
        h('button', { class: 'btn small', type: 'button', onclick: () => (hideTool(), openNote(g)) }, icon('pencil'), first.n ? '메모 보기·고치기' : '메모 남기기'),
        h('button', { class: 'btn small danger', type: 'button', onclick: () => (removeGroup(g), hideTool()) }, '지우기'),
      ),
    );
    placeNear(tool, el.getBoundingClientRect());
  }

  /* ---------- 메모 ---------- */
  // 메모 창: 화면 아래쪽에 붙는 시트. 휴대폰 키보드가 올라오면 키보드 바로 위로 따라 올라갑니다.
  function placeSheet() {
    if (pop.hidden) return;
    const vv = window.visualViewport;
    const keyboard = vv ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop) : 0;
    pop.style.left = '';
    pop.style.top = '';
    pop.style.bottom = `${keyboard + 12}px`;
    pop.style.maxHeight = `${Math.max(180, (vv ? vv.height : window.innerHeight) - 24)}px`;
  }
  const vv = window.visualViewport;
  if (vv) {
    vv.addEventListener('resize', placeSheet);
    vv.addEventListener('scroll', placeSheet);
  }
  // 버튼을 누르는 순간 실행합니다: 키보드가 내려가며 화면이 움직여 "닫기"가 안 눌리는 문제를 막습니다
  function sheetBtn(label, cls, fn) {
    const b = h('button', { class: `btn small ${cls}`, type: 'button' }, label);
    b.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      fn();
    });
    b.addEventListener('click', (e) => {
      if (e.detail === 0) fn(); // 키보드(Enter·Space)로 누른 경우
    });
    return b;
  }
  function openNote(g) {
    const list = groupMarks(g);
    if (!list.length) return;
    hideTool();
    const ta = h('textarea', { class: 'note-input', rows: '4', maxlength: String(MARK_NOTE_MAX), placeholder: '이 부분에 대한 내 생각, 기도, 적용을 적어 보세요', 'aria-label': '메모' });
    ta.value = list[0].n || '';
    const quote = list.map((m) => m.q).join(' … ');
    const saveBtn = sheetBtn('저장', 'primary', () => {
      changeGroup(g, { n: ta.value.trim().slice(0, MARK_NOTE_MAX) });
      hidePop();
      toast('메모를 저장했습니다');
    });
    const delBtn = sheetBtn('메모 지우기', '', () => {
      changeGroup(g, { n: '' });
      hidePop();
    });
    const cancel = sheetBtn('닫기', '', hidePop);
    pop.replaceChildren(
      h('div', { class: 'mk-sheet-head' }, h('strong', {}, icon('pencil'), ' 메모'), h('button', { class: 'mk-x', type: 'button', 'aria-label': '메모 창 닫기', onpointerdown: (e) => (e.preventDefault(), hidePop()), onclick: (e) => e.detail === 0 && hidePop() }, icon('close'))),
      h('p', { class: 'mk-quote', text: quote.length > 160 ? `${quote.slice(0, 160)}…` : quote }),
      ta,
      h('div', { class: 'admin-row' }, saveBtn, list[0].n ? delBtn : null, cancel),
    );
    pop.classList.add('mk-sheet');
    pop.hidden = false;
    placeSheet();
    ta.focus({ preventScroll: true });
    setTimeout(placeSheet, 350); // 키보드가 다 올라온 뒤 한 번 더 맞춥니다
  }

  /* ---------- 내 표시 모아 보기 ---------- */
  const panel = h('section', { class: 'mk-panel point', hidden: true });
  panel.hidden = true;
  function drawPanel() {
    const gs = groups();
    if (!gs.length) {
      panel.replaceChildren(h('p', { class: 'meta', text: '아직 남긴 표시가 없습니다. 글자를 길게 누르거나 끌어서 고르면 형광펜 · 밑줄 · 메모를 남길 수 있어요.' }));
      return;
    }
    panel.replaceChildren(
      h('h2', { text: `내 표시 ${gs.length}개` }),
      h(
        'ul',
        { class: 'mk-items' },
        gs.map((m) => {
          const quote = groupMarks(m.g).map((x) => x.q).join(' … ');
          const go = h('button', { class: 'btn small', type: 'button' }, '찾아가기');
          go.addEventListener('click', () => {
            const el = root.querySelector(`.mk[data-mg="${m.g}"]`);
            if (!el) return toast('지금 보기 방식(모드)에는 없는 표시입니다. 다른 탭에서 찾아 보세요.', 3000);
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            el.classList.add('mk-flash');
            setTimeout(() => el.classList.remove('mk-flash'), 1600);
          });
          const del = h('button', { class: 'btn small danger', type: 'button' }, '지우기');
          del.addEventListener('click', () => {
            removeGroup(m.g);
            drawPanel();
          });
          return h(
            'li',
            { class: 'mk-item' },
            h('p', {}, h(m.st === 'ul' ? 'span' : 'mark', { class: `mk mk-${m.st} mk-${m.st}-${m.c}`, text: quote.length > 200 ? `${quote.slice(0, 200)}…` : quote })),
            m.n ? h('p', { class: 'mk-item-note' }, icon('pencil'), h('span', { text: m.n })) : null,
            h('div', { class: 'admin-row' }, go, h('button', { class: 'btn small', type: 'button', onclick: () => openNote(m.g) }, m.n ? '메모 고치기' : '메모 남기기'), del),
          );
        }),
      ),
    );
  }
  listBtn.addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    if (!panel.hidden) {
      drawPanel();
      panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });

  /* ---------- 이벤트 ---------- */
  let selTimer = null;
  const onSelChange = () => {
    clearTimeout(selTimer);
    selTimer = setTimeout(showForSelection, 280);
  };
  const onPointerDown = (e) => {
    if (tool.hidden || tool.contains(e.target)) return;
    if (e.target.closest && e.target.closest('.mk') && root.contains(e.target)) return; // 칠한 곳을 누르면 그 표시의 막대가 뜹니다
    hideTool(); // 빈 곳을 누르면 사라지고, 글을 다시 고르면 다시 나옵니다
  };
  const onClick = (e) => {
    const el = e.target.closest && e.target.closest('.mk');
    if (el && root.contains(el) && enabled && window.getSelection().isCollapsed) {
      e.preventDefault();
      showForMark(el);
      return;
    }
    if (!tool.contains(e.target) && !pop.contains(e.target) && window.getSelection().isCollapsed) hideTool();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') {
      hideTool();
      hidePop();
    }
    if ((e.key === 'Enter' || e.key === ' ') && e.target.classList && e.target.classList.contains('mk') && root.contains(e.target)) {
      e.preventDefault();
      showForMark(e.target);
    }
  };
  const onScroll = () => {
    // 눌렀을 때 생기는 아주 작은 흔들림에는 반응하지 않고, 화면을 제대로 넘길 때만 숨깁니다
    if (!tool.hidden && Math.abs(window.scrollY - toolScrollY) > 40) hideTool();
  };
  document.addEventListener('selectionchange', onSelChange);
  document.addEventListener('click', onClick);
  document.addEventListener('pointerdown', onPointerDown, true);
  document.addEventListener('pointerup', releaseTool, true);
  document.addEventListener('keydown', onKey);
  window.addEventListener('scroll', onScroll, { passive: true });

  function destroy() {
    alive = false;
    observer.disconnect();
    document.removeEventListener('selectionchange', onSelChange);
    document.removeEventListener('click', onClick);
    document.removeEventListener('pointerdown', onPointerDown, true);
    document.removeEventListener('pointerup', releaseTool, true);
    if (vv) {
      vv.removeEventListener('resize', placeSheet);
      vv.removeEventListener('scroll', placeSheet);
    }
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('scroll', onScroll);
    tool.remove();
    pop.remove();
  }

  /** 서버에서 불러온 표시를 넣고 칠합니다 */
  function setAll(list) {
    marks = (Array.isArray(list) ? list : []).filter((m) => m && m.g && m.k && Number.isInteger(m.s) && Number.isInteger(m.e) && m.e > m.s && (m.st === 'hl' || m.st === 'ul') && MARK_COLOR_NAMES.has(m.c));
    ready = true;
    countEl.textContent = String(groups().length);
    paintAll();
  }

  const api = { setAll, flush, destroy, listBtn, panel, get count() { return groups().length; } };
  currentMarks = api;
  if (!enabled) ready = false;
  return api;
}
