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
  return FLOAT_BAR_H + Math.round((w * 9) / 16) + 84; // 제목줄 + 16:9 영상 + 조절 막대
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

/* ---------- YouTube 재생기 API (앞뒤 15초 · 배속 · 볼륨을 앱에서 조절) ---------- */
let ytApiPromise = null;
function loadYtApi() {
  if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
  if (ytApiPromise) return ytApiPromise;
  ytApiPromise = new Promise((resolve, reject) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      if (typeof prev === 'function') prev();
      resolve(window.YT);
    };
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    tag.async = true;
    tag.onerror = () => reject(new Error('YouTube 재생기를 불러오지 못했습니다'));
    document.head.append(tag);
    setTimeout(() => reject(new Error('YouTube 재생기 응답이 늦습니다')), 8000);
  });
  ytApiPromise.catch(() => {
    ytApiPromise = null; // 다음에 다시 시도
  });
  return ytApiPromise;
}

const SPEEDS = [1, 1.25, 1.5, 1.75, 2, 0.75];
const fmtTime = (t) => {
  t = Math.max(0, Math.floor(t || 0));
  const hh = Math.floor(t / 3600);
  const mm = Math.floor((t % 3600) / 60);
  const ss = String(t % 60).padStart(2, '0');
  return hh ? `${hh}:${String(mm).padStart(2, '0')}:${ss}` : `${mm}:${ss}`;
};

function buildFloat() {
  const saved = readFloatState();
  const defW = isMobile() ? Math.min(window.innerWidth - 16, 360) : 420;
  const st = { w: saved.w || defW, x: 0, y: 0 };
  st.x = typeof saved.x === 'number' ? saved.x : window.innerWidth - st.w - 16;
  st.y = typeof saved.y === 'number' ? saved.y : window.innerHeight - floatHeight(st.w) - 16;

  const titleEl = h('span', { class: 'fp-title' });
  const link = h('a', { class: 'fp-btn', target: '_blank', rel: 'noopener noreferrer', title: 'YouTube 앱·사이트에서 열기' }, icon('external'), 'YouTube');
  const closeBtn = h('button', { class: 'fp-btn fp-close', type: 'button', 'aria-label': '재생 창 닫기', title: '닫기' }, icon('close'));
  const bar = h('div', { class: 'fp-bar', title: '끌어서 옮기기' }, h('span', { class: 'fp-grip', 'aria-hidden': 'true' }, icon('grip')), titleEl, link, closeBtn);
  const body = h('div', { class: 'fp-body' });

  // 조절 막대: 진행 막대 / 뒤로 15초 · 재생 · 앞으로 15초 · 배속 · 볼륨
  const seek = h('input', { class: 'fp-seek', type: 'range', min: '0', max: '1000', value: '0', step: '1', 'aria-label': '재생 위치' });
  const timeEl = h('span', { class: 'fp-time', text: '0:00 / 0:00' });
  const back15 = h('button', { class: 'fp-ctl', type: 'button', title: '15초 뒤로', 'aria-label': '15초 뒤로' }, icon('back15'));
  const playBtn = h('button', { class: 'fp-ctl fp-play', type: 'button', title: '재생/일시정지', 'aria-label': '재생' }, icon('play'));
  const fwd15 = h('button', { class: 'fp-ctl', type: 'button', title: '15초 앞으로', 'aria-label': '15초 앞으로' }, icon('fwd15'));
  const speedBtn = h('button', { class: 'fp-ctl fp-speed', type: 'button', title: '재생 속도', 'aria-label': '재생 속도 1배' }, '1x');
  const muteBtn = h('button', { class: 'fp-ctl', type: 'button', title: '소리 끄기/켜기', 'aria-label': '소리 끄기' }, icon('volume'));
  const vol = h('input', { class: 'fp-vol', type: 'range', min: '0', max: '100', value: String(saved.vol ?? 100), step: '1', 'aria-label': '볼륨' });
  const controls = h(
    'div',
    { class: 'fp-controls' },
    h('div', { class: 'fp-row' }, seek, timeEl),
    h('div', { class: 'fp-row' }, back15, playBtn, fwd15, speedBtn, h('span', { class: 'fp-volwrap' }, muteBtn, vol)),
  );
  const grip = h('div', { class: 'fp-resize', title: '끌어서 크기 조절', 'aria-hidden': 'true' });
  const el = h('div', { class: 'float-player', role: 'dialog', 'aria-label': '재생 창' }, bar, body, controls, grip);
  el._st = st;
  el._els = { titleEl, link, body, controls };
  el._speed = 1;

  const persist = () => saveFloatState({ x: st.x, y: st.y, w: st.w, vol: Number(vol.value) });

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
    const p = el._player;
    if (p && p.pauseVideo) p.pauseVideo();
    openYoutubeApp(el._vid);
  });

  // 조절 버튼 → 재생기
  const P = () => (el._player && el._player.getPlayerState ? el._player : null);
  const jump = (sec) => {
    const p = P();
    if (!p) return;
    const t = Math.max(0, (p.getCurrentTime() || 0) + sec);
    p.seekTo(Math.min(t, Math.max(0, (p.getDuration() || t) - 0.5)), true);
    tick();
  };
  back15.addEventListener('click', () => jump(-15));
  fwd15.addEventListener('click', () => jump(15));
  playBtn.addEventListener('click', () => {
    const p = P();
    if (!p) return;
    if (p.getPlayerState() === 1) p.pauseVideo();
    else p.playVideo();
  });
  speedBtn.addEventListener('click', () => {
    const p = P();
    el._speed = SPEEDS[(SPEEDS.indexOf(el._speed) + 1) % SPEEDS.length];
    if (p) p.setPlaybackRate(el._speed);
    paintSpeed();
  });
  const paintSpeed = () => {
    speedBtn.textContent = `${el._speed}x`;
    speedBtn.setAttribute('aria-label', `재생 속도 ${el._speed}배`);
  };
  const paintVol = (muted) => {
    muteBtn.replaceChildren(icon(muted || Number(vol.value) === 0 ? 'mute' : 'volume'));
    muteBtn.setAttribute('aria-label', muted ? '소리 켜기' : '소리 끄기');
  };
  vol.addEventListener('input', () => {
    const p = P();
    if (p) {
      p.setVolume(Number(vol.value));
      if (Number(vol.value) > 0 && p.isMuted()) p.unMute();
    }
    paintVol(false);
  });
  vol.addEventListener('change', persist);
  muteBtn.addEventListener('click', () => {
    const p = P();
    if (!p) return;
    if (p.isMuted()) p.unMute();
    else p.mute();
    setTimeout(() => paintVol(p.isMuted()), 60);
  });
  let seeking = false;
  seek.addEventListener('input', () => {
    seeking = true;
    const p = P();
    const d = p ? p.getDuration() || 0 : 0;
    timeEl.textContent = `${fmtTime((Number(seek.value) / 1000) * d)} / ${fmtTime(d)}`;
  });
  seek.addEventListener('change', () => {
    const p = P();
    if (p) p.seekTo((Number(seek.value) / 1000) * (p.getDuration() || 0), true);
    seeking = false;
  });
  function tick() {
    const p = P();
    if (!p || seeking) return;
    const d = p.getDuration() || 0;
    const t = p.getCurrentTime() || 0;
    seek.value = d ? String(Math.round((t / d) * 1000)) : '0';
    seek.style.setProperty('--fp-progress', `${d ? (t / d) * 100 : 0}%`);
    timeEl.textContent = `${fmtTime(t)} / ${fmtTime(d)}`;
  }
  el._tick = tick;
  el._paintPlay = (playing) => {
    playBtn.replaceChildren(icon(playing ? 'pause' : 'play'));
    playBtn.setAttribute('aria-label', playing ? '일시정지' : '재생');
  };
  el._paintSpeed = paintSpeed;
  el._paintVol = paintVol;
  el._timer = setInterval(tick, 500);
  return el;
}

/** 재생기 API로 영상을 띄웁니다. API를 못 쓰면 일반 퍼가기 화면으로 대신합니다(조절 막대는 숨김). */
function mountPlayer(id, title) {
  const el = floatEl;
  const { body, controls } = el._els;
  controls.hidden = false;
  if (el._player && el._player.loadVideoById) {
    el._player.loadVideoById(id);
    return;
  }
  const holder = h('div', { class: 'fp-holder' });
  body.replaceChildren(holder);
  loadYtApi()
    .then((YT) => {
      if (floatEl !== el || el._vid !== id || !holder.isConnected) return;
      el._player = new YT.Player(holder, {
        videoId: id,
        host: 'https://www.youtube.com',
        playerVars: { autoplay: 1, playsinline: 1, rel: 0, modestbranding: 1 },
        events: {
          onReady: (e) => {
            const vol = el.querySelector('.fp-vol');
            e.target.setVolume(Number(vol.value));
            e.target.setPlaybackRate(el._speed);
            e.target.playVideo();
            el._paintVol(false);
          },
          onStateChange: (e) => {
            el._paintPlay(e.data === 1 || e.data === 3);
            if (e.data === 1) e.target.setPlaybackRate(el._speed); // 새 영상도 같은 배속으로
            el._tick();
          },
        },
      });
      const frame = body.querySelector('iframe');
      if (frame) frame.setAttribute('title', title || '유튜브 영상');
    })
    .catch(() => {
      if (floatEl !== el || el._vid !== id) return;
      controls.hidden = true; // 조절 기능 없이 기본 재생
      body.replaceChildren(embedPlayer(id, title));
      fitFloat(el, el._st);
    });
}

/** 떠 있는 창에서 재생합니다. 이미 열려 있으면 영상만 바꿉니다. */
function openFloatPlayer(id, title) {
  if (!ytId(id)) return;
  if (!floatEl) {
    floatEl = buildFloat();
    document.body.append(floatEl);
  }
  const { titleEl, link } = floatEl._els;
  floatEl._vid = id;
  titleEl.textContent = title || '재생 중';
  link.setAttribute('href', ytWatch(id));
  mountPlayer(id, title);
  floatEl.hidden = false;
  fitFloat(floatEl, floatEl._st); // 화면에 붙인 뒤 실제 높이로 위치를 맞춥니다
}

function closeFloatPlayer() {
  if (!floatEl) return;
  clearInterval(floatEl._timer);
  try {
    if (floatEl._player && floatEl._player.destroy) floatEl._player.destroy();
  } catch {
    /* 이미 정리됨 */
  }
  floatEl.remove(); // 재생도 멈춥니다
  floatEl = null;
}

window.addEventListener('resize', () => {
  if (floatEl) fitFloat(floatEl, floatEl._st);
});
