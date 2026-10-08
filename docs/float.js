// 떠 있는 재생 창 (끌어서 옮기기 · 크기 조절) + YouTube 앱으로 열기
// 설교 영상 · 찬양 · 묵상 음악 · 성경 낭독이 모두 이 창 하나에서 재생됩니다. 화면(주소)이 바뀌어도 창은 그대로 남아 계속 재생됩니다.
// content.js 의 startPlayback 이 부릅니다. (h, ytEmbed, ytWatch, setYtOpenPref, toast 는 다른 파일의 함수)

const FLOAT_KEY = 'sn-float';
const FLOAT_MIN_W = 220;
const FLOAT_BAR_H = 36;

const isAndroid = () => /Android/i.test(navigator.userAgent);
const isIos = () => /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isMobile = () => isAndroid() || isIos();

/** YouTube 앱이 있으면 앱으로, 없으면 YouTube 사이트로 엽니다 (프리미엄 광고 제거·백그라운드 재생은 앱/사이트에서 적용됩니다) */
function openYoutubeApp(id) {
  const web = ytWatch(id);
  if (isAndroid()) {
    location.href = `intent://www.youtube.com/watch?v=${id}#Intent;scheme=https;package=com.google.android.youtube;S.browser_fallback_url=${encodeURIComponent(web)};end`;
    return;
  }
  if (isIos()) {
    let left = false;
    const onHide = () => {
      if (document.hidden) left = true;
    };
    document.addEventListener('visibilitychange', onHide);
    location.href = `youtube://www.youtube.com/watch?v=${id}`;
    setTimeout(() => {
      document.removeEventListener('visibilitychange', onHide);
      if (!left && !document.hidden) {
        // 앱이 없거나 열리지 않은 경우: 사이트로 엽니다 (팝업 차단으로 안 열리면 안내)
        const w = window.open(web, '_blank', 'noopener');
        if (!w) toast('YouTube 앱이 열리지 않으면 재생 창의 "YouTube" 링크를 눌러 주세요', 3500);
      }
    }, 1600);
    return;
  }
  window.open(web, '_blank', 'noopener');
}

let floatEl = null;

function readFloatState() {
  try {
    const o = JSON.parse(localStorage.getItem(FLOAT_KEY) || '{}');
    return o && typeof o === 'object' ? o : {};
  } catch {
    return {};
  }
}
function saveFloatState(state) {
  try {
    localStorage.setItem(FLOAT_KEY, JSON.stringify(state));
  } catch {
    /* 저장 불가 환경: 이번 화면에서만 적용됩니다 */
  }
}

function floatLimits() {
  const maxW = Math.max(FLOAT_MIN_W, Math.min(window.innerWidth - 16, 720));
  return { maxW };
}
function floatHeight(w) {
  return FLOAT_BAR_H + Math.round((w * 9) / 16) + 34; // 제목줄 + 16:9 영상 + 아래 안내줄
}

/** 창이 화면 밖으로 나가지 않게 위치·너비를 맞춥니다 (높이는 실제로 그려진 높이를 읽어서 계산) */
function fitFloat(el, st) {
  const { maxW } = floatLimits();
  const w = Math.min(maxW, Math.max(FLOAT_MIN_W, st.w || 0));
  el.style.width = `${w}px`;
  const hgt = (el.isConnected && el.offsetHeight) || floatHeight(w);
  const left = Math.min(Math.max(8, st.x), Math.max(8, window.innerWidth - w - 8));
  const top = Math.min(Math.max(8, st.y), Math.max(8, window.innerHeight - hgt - 8));
  st.w = w;
  st.x = left;
  st.y = top;
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
  return st;
}

function buildFloat() {
  const saved = readFloatState();
  const defW = isMobile() ? Math.min(window.innerWidth - 16, 340) : 380;
  const st = { w: saved.w || defW, x: 0, y: 0 };
  st.x = typeof saved.x === 'number' ? saved.x : window.innerWidth - st.w - 16;
  st.y = typeof saved.y === 'number' ? saved.y : window.innerHeight - floatHeight(st.w) - 16;

  const titleEl = h('span', { class: 'fp-title' });
  const link = h('a', { class: 'fp-btn', target: '_blank', rel: 'noopener noreferrer', title: 'YouTube에서 열기' }, icon('external'), 'YouTube');
  const closeBtn = h('button', { class: 'fp-btn fp-close', type: 'button', 'aria-label': '재생 창 닫기', title: '닫기' }, icon('close'));
  const bar = h('div', { class: 'fp-bar', title: '끌어서 옮기기' }, h('span', { class: 'fp-grip', 'aria-hidden': 'true' }, icon('grip')), titleEl, link, closeBtn);
  const body = h('div', { class: 'fp-body' });
  const adBtn = h('button', { class: 'fp-ad', type: 'button' }, '광고가 나와요 → 앞으로 항상 YouTube에서 열기');
  const foot = h('div', { class: 'fp-foot' }, adBtn);
  const grip = h('div', { class: 'fp-resize', title: '끌어서 크기 조절', 'aria-hidden': 'true' });
  const el = h('div', { class: 'float-player', role: 'dialog', 'aria-label': '재생 창' }, bar, body, foot, grip);
  el._st = st;
  el._els = { titleEl, link, body };

  const persist = () => saveFloatState({ x: st.x, y: st.y, w: st.w });

  // 끌어서 옮기기 (마우스 · 터치 공통)
  bar.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.fp-btn')) return;
    e.preventDefault();
    const sx = e.clientX - st.x;
    const sy = e.clientY - st.y;
    bar.setPointerCapture(e.pointerId);
    el.classList.add('is-dragging');
    const move = (ev) => {
      st.x = ev.clientX - sx;
      st.y = ev.clientY - sy;
      fitFloat(el, st);
    };
    const up = () => {
      bar.removeEventListener('pointermove', move);
      bar.removeEventListener('pointerup', up);
      bar.removeEventListener('pointercancel', up);
      el.classList.remove('is-dragging');
      persist();
    };
    bar.addEventListener('pointermove', move);
    bar.addEventListener('pointerup', up);
    bar.addEventListener('pointercancel', up);
  });
  // 크기 조절 (오른쪽 아래 모서리)
  grip.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const sx = e.clientX;
    const startW = st.w;
    grip.setPointerCapture(e.pointerId);
    el.classList.add('is-dragging');
    const move = (ev) => {
      st.w = startW + (ev.clientX - sx);
      fitFloat(el, st);
    };
    const up = () => {
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', up);
      grip.removeEventListener('pointercancel', up);
      el.classList.remove('is-dragging');
      persist();
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
    grip.addEventListener('pointercancel', up);
  });
  closeBtn.addEventListener('click', closeFloatPlayer);
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeFloatPlayer();
  });
  link.addEventListener('click', (e) => {
    if (!isMobile() || !el._vid) return; // 휴대폰에서는 YouTube 앱으로 바로 엽니다
    e.preventDefault();
    openYoutubeApp(el._vid);
  });
  adBtn.addEventListener('click', () => {
    const vid = el._vid;
    setYtOpenPref(true);
    toast('앞으로 재생 버튼은 YouTube를 바로 엽니다 (화면 맨 아래에서 바꿀 수 있어요)');
    closeFloatPlayer();
    if (vid) openYoutubeApp(vid);
  });
  return el;
}

/** 떠 있는 창에서 재생합니다. 이미 열려 있으면 영상만 바꿉니다. */
function openFloatPlayer(id, title) {
  if (!ytId(id)) return;
  if (!floatEl) {
    floatEl = buildFloat();
    document.body.append(floatEl);
    fitFloat(floatEl, floatEl._st); // 화면에 붙인 뒤에 실제 높이로 위치를 맞춥니다
  }
  const { titleEl, link, body } = floatEl._els;
  floatEl._vid = id;
  titleEl.textContent = title || '재생 중';
  link.setAttribute('href', ytWatch(id));
  body.replaceChildren(embedPlayer(id, title));
  floatEl.hidden = false;
  fitFloat(floatEl, floatEl._st);
}

function closeFloatPlayer() {
  if (!floatEl) return;
  floatEl.remove(); // iframe 이 사라지므로 재생도 멈춥니다
  floatEl = null;
}

window.addEventListener('resize', () => {
  if (floatEl) fitFloat(floatEl, floatEl._st);
});
