// 관리 화면 추가 기능: AI 모델 선택 · 영상 선택 관리
// (app.js 보다 먼저 불러옵니다. 함수는 관리 화면이 열릴 때 app.js 의 도구(h, adminPost 등)를 가져다 씁니다.)

// 모델 이름은 Gemini API 공식 모델 문서(ai.google.dev/gemini-api/docs/models)에서 확인한 것입니다.
const GEMINI_MODELS = [
  { id: 'gemini-3.8-flash', hint: '기본 · 빠르고 균형이 좋음' },
  { id: 'gemini-3.7-flash', hint: '이전 버전' },
  { id: 'gemini-3.6-flash', hint: '이전 버전' },
  { id: 'gemini-3.5-flash', hint: '이전 버전' },
  { id: 'gemini-3.5-flash-lite', hint: '가장 가볍고 저렴 · 품질은 낮을 수 있음' },
  { id: 'gemini-3.1-flash-lite', hint: '가볍고 저렴' },
  { id: 'gemini-3.1-pro-preview', hint: '가장 정교함 · 미리보기 · 느리고 비쌀 수 있음' },
  { id: 'gemini-3-flash-preview', hint: '미리보기' },
];
const CUSTOM_MODEL = '__custom__';
const MAX_PER_RUN = 10; // 선택한 영상을 한 번에 정리하는 최대 편수 (한 번 실행은 최대 60분)

const VIDEO_STATUS = {
  pending: ['자동 대기', 'wait'],
  listed: ['선택 대기', 'wait'],
  redo: ['정리 예약', 'wait'],
  done: ['완료', 'ok'],
  error: ['실패', 'bad'],
  no_transcript: ['자막 없음', 'bad'],
  skip: ['제외', 'skip'],
};
const statusLabelOf = (s) => (VIDEO_STATUS[s] || [s || '대기', 'wait'])[0];
const statusClassOf = (s) => (VIDEO_STATUS[s] || [, 'wait'])[1];

const CATEGORY_RAW = { dawn: 'dawn', 새벽: 'dawn', 새벽기도: 'dawn', wednesday: 'wednesday', wed: 'wednesday', 수요: 'wednesday', 수요예배: 'wednesday', sunday: 'sunday', sun: 'sunday', 주일: 'sunday', 주일예배: 'sunday', youth: 'youth', 청년: 'youth', 청년부: 'youth', 청년부예배: 'youth', user: 'user', 사용자영상: 'user' };
// 영상 관리 탭: 교회 4구분 + 사용자 영상
const MANAGER_TABS = [...CATEGORIES, { key: 'user', label: '사용자 영상' }];
const categoryKeyOf = (raw) => CATEGORY_RAW[String(raw || '').trim().toLowerCase().replace(/\s+/g, '')] || '';

/* ---------- AI 모델 ---------- */
function renderModelSection(password, onPasswordRejected) {
  const info = h('p', { class: 'meta', role: 'status' });
  const select = h(
    'select',
    { class: 'search admin-model', 'aria-label': 'AI 모델' },
    GEMINI_MODELS.map((m) => h('option', { value: m.id, text: `${m.id} — ${m.hint}` })),
    h('option', { value: CUSTOM_MODEL, text: '직접 입력…' }),
  );
  const custom = h('input', { class: 'search', placeholder: '예: gemini-3.8-flash', 'aria-label': '모델 이름 직접 입력', hidden: true });
  custom.hidden = true;
  const save = h('button', { class: 'btn primary', type: 'button' }, '저장');
  const sync = () => {
    custom.hidden = select.value !== CUSTOM_MODEL;
  };
  select.addEventListener('change', sync);
  save.addEventListener('click', async () => {
    const model = select.value === CUSTOM_MODEL ? custom.value.trim() : select.value;
    if (!model) return (info.textContent = '모델 이름을 입력해 주세요.');
    info.textContent = '저장 중…';
    try {
      const r = await adminPost({ action: 'settings_set', password, gemini_model: model });
      if (onPasswordRejected(r)) return;
      if (!r.ok) throw new Error(r.error || '저장하지 못했습니다.');
      info.textContent = `저장했습니다. 다음 동기화부터 ${model} 모델을 씁니다.`;
    } catch (e) {
      info.textContent = `오류: ${e.message || e}`;
    }
  });
  // 저장된 값 불러오기
  adminPost({ action: 'settings_get', password })
    .then((r) => {
      if (onPasswordRejected(r) || !r.ok) return;
      const cur = r.settings.gemini_model;
      if (!cur) {
        select.value = GEMINI_MODELS[0].id;
        info.textContent = `지금은 기본 모델(${GEMINI_MODELS[0].id})을 씁니다.`;
      } else if (GEMINI_MODELS.some((m) => m.id === cur)) {
        select.value = cur;
        info.textContent = `지금 쓰는 모델: ${cur}`;
      } else {
        select.value = CUSTOM_MODEL;
        custom.value = cur;
        info.textContent = `지금 쓰는 모델: ${cur}`;
      }
      sync();
    })
    .catch(() => {});
  return h(
    'section',
    { class: 'point admin-model-box' },
    h('h2', { text: 'AI 모델' }),
    h('p', { class: 'meta', text: '설교 정리를 만드는 Gemini 모델입니다. 정교한 모델일수록 느리고 사용량이 많을 수 있습니다. 자동 정리와 "지금 동기화" 모두에 적용됩니다.' }),
    h('div', { class: 'admin-fields admin-fields-2' }, select, save),
    custom,
    info,
  );
}

/* ---------- 영상 선택 관리 ---------- */
function renderVideoManager(password, onPasswordRejected, requestSync) {
  const status = h('p', { class: 'meta', role: 'status' });
  const list = h('ul', { class: 'vid-list' });
  const tabs = h('div', { class: 'vid-tabs', role: 'tablist', 'aria-label': '예배 구분' });
  const filter = h(
    'select',
    { class: 'search vid-filter', 'aria-label': '상태 필터' },
    [['all', '전체'], ['todo', '아직 안 한 것'], ['done', '완료'], ['fail', '실패·자막 없음'], ['skip', '제외']].map(([v, t]) => h('option', { value: v, text: t })),
  );
  const btnAi = h('button', { class: 'btn primary', type: 'button' }, 'AI로 정리');
  const btnSkip = h('button', { class: 'btn', type: 'button' }, '자동 정리에서 제외');
  const btnWait = h('button', { class: 'btn', type: 'button' }, '대기로 되돌리기');
  const btnAll = h('button', { class: 'btn small', type: 'button' }, '이 목록 모두 선택');
  const btnNone = h('button', { class: 'btn small', type: 'button' }, '선택 해제');
  let videos = [];
  let current = MANAGER_TABS[0].key;
  const selected = new Set();

  const matches = (v) => {
    if (categoryKeyOf(v.category) !== current) return false;
    const f = filter.value;
    if (f === 'todo') return ['pending', 'listed', 'redo'].includes(v.status);
    if (f === 'done') return v.status === 'done';
    if (f === 'fail') return v.status === 'error' || v.status === 'no_transcript';
    if (f === 'skip') return v.status === 'skip';
    return true;
  };
  const updateButtons = () => {
    const n = selected.size;
    btnAi.textContent = n ? `선택한 ${n}편 AI로 정리` : 'AI로 정리';
    [btnAi, btnSkip, btnWait].forEach((b) => (b.disabled = n === 0));
  };
  const drawTabs = () => {
    tabs.replaceChildren(
      ...MANAGER_TABS.map((c) => {
        const count = videos.filter((v) => categoryKeyOf(v.category) === c.key).length;
        const b = h('button', { class: 'vid-tab', type: 'button', role: 'tab', 'aria-selected': String(c.key === current) }, `${c.label} `, h('span', { class: 'count', text: String(count) }));
        b.addEventListener('click', () => {
          current = c.key;
          drawTabs();
          drawList();
        });
        return b;
      }),
    );
  };
  const drawList = () => {
    const rows = videos.filter(matches);
    if (!rows.length) {
      list.replaceChildren(h('li', { class: 'meta', text: videos.length ? '이 조건에 맞는 영상이 없습니다.' : '아직 영상이 없습니다. "지금 동기화"로 재생목록의 영상을 불러오세요.' }));
      return updateButtons();
    }
    list.replaceChildren(
      ...rows.map((v) => {
        const cb = h('input', { type: 'checkbox', 'aria-label': `${v.title} 선택` });
        cb.checked = selected.has(v.video_id);
        cb.addEventListener('change', () => {
          if (cb.checked) selected.add(v.video_id);
          else selected.delete(v.video_id);
          updateButtons();
        });
        return h(
          'li',
          { class: 'vid-item' },
          h(
            'label',
            { class: 'vid-row' },
            cb,
            h(
              'span',
              { class: 'vid-main' },
              h('span', { class: 'vid-title', text: v.title }),
              h('span', { class: 'vid-meta' }, h('span', { class: `vid-status ${statusClassOf(v.status)}`, text: statusLabelOf(v.status) }), ` ${v.published_at || ''}`, v.note ? ` · ${v.note}` : ''),
            ),
          ),
        );
      }),
    );
    updateButtons();
  };
  async function reload() {
    list.replaceChildren(h('li', { class: 'meta', text: '불러오는 중…' }));
    try {
      const r = await adminPost({ action: 'videos_list', password });
      if (onPasswordRejected(r)) return;
      if (!r.ok) throw new Error(r.error || '목록을 불러오지 못했습니다.');
      videos = r.videos || [];
      for (const id of [...selected]) if (!videos.some((v) => v.video_id === id)) selected.delete(id);
      drawTabs();
      drawList();
    } catch (e) {
      list.replaceChildren(h('li', { class: 'meta', text: `오류: ${e.message || e}` }));
    }
  }
  async function mark(statusValue, okText) {
    const ids = [...selected];
    status.textContent = '저장 중…';
    const r = await adminPost({ action: 'videos_mark', password, ids, status: statusValue });
    if (onPasswordRejected(r)) return false;
    if (!r.ok) throw new Error(r.error || '저장하지 못했습니다.');
    status.textContent = okText(r.changed);
    return true;
  }
  btnAi.addEventListener('click', async () => {
    const ids = [...selected];
    if (ids.length > MAX_PER_RUN) return (status.textContent = `한 번에 최대 ${MAX_PER_RUN}편까지 정리할 수 있습니다. 선택을 줄여 주세요.`);
    const doneCount = videos.filter((v) => selected.has(v.video_id) && v.status === 'done').length;
    if (doneCount && !confirm(`이미 정리된 ${doneCount}편이 포함되어 있습니다. 다시 정리하면 기존 결과가 새 결과로 바뀝니다. 계속할까요?`)) return;
    btnAi.disabled = true;
    try {
      if (!(await mark('redo', (n) => `${n}편을 정리 대상으로 표시했습니다. 동기화를 시작합니다…`))) return;
      const started = await requestSync(ids.length, ['none']); // 재생목록은 다시 훑지 않고 선택한 영상만 정리
      status.textContent = started ? `${ids.length}편 정리를 시작했습니다. 위의 "지금 동기화" 상태에서 진행을 볼 수 있습니다. (영상 1편에 몇 분 걸립니다)` : '정리 대상으로 표시는 했지만 동기화를 시작하지 못했습니다. 위 "지금 동기화"를 눌러 주세요.';
      selected.clear();
      await reload();
    } catch (e) {
      status.textContent = `오류: ${e.message || e}`;
    } finally {
      updateButtons();
    }
  });
  btnSkip.addEventListener('click', async () => {
    try {
      if (await mark('skip', (n) => `${n}편을 자동 정리에서 제외했습니다.`)) {
        selected.clear();
        await reload();
      }
    } catch (e) {
      status.textContent = `오류: ${e.message || e}`;
    }
  });
  btnWait.addEventListener('click', async () => {
    try {
      if (await mark('listed', (n) => `${n}편을 "선택 대기"로 되돌렸습니다.`)) {
        selected.clear();
        await reload();
      }
    } catch (e) {
      status.textContent = `오류: ${e.message || e}`;
    }
  });
  btnAll.addEventListener('click', () => {
    videos.filter(matches).forEach((v) => selected.add(v.video_id));
    drawList();
  });
  btnNone.addEventListener('click', () => {
    selected.clear();
    drawList();
  });
  filter.addEventListener('change', drawList);
  reload();
  return h(
    'section',
    { class: 'point admin-videos' },
    h('h2', { text: '영상 선택해서 정리하기' }),
    h('p', { class: 'meta', text: `예배별로 영상을 보고, 정리할 영상을 골라 AI로 돌립니다. 한 번에 최대 ${MAX_PER_RUN}편까지 가능합니다. 새로 올라온 영상은 자동으로 정리되고, 오래된 영상은 여기서 골라야 정리됩니다.` }),
    tabs,
    h('div', { class: 'vid-tools' }, filter, btnAll, btnNone),
    list,
    h('div', { class: 'admin-row' }, btnAi, btnSkip, btnWait),
    status,
  );
}
