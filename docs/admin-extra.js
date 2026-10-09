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

/* ---------- 설교 제목·설교자 직접 고치기 ---------- */
// 상세 화면 맨 아래의 "제목·설교자 고치기"에서 관리 비밀번호로 저장합니다. 저장하면 시트의 "수정값" 칸에 기록되고
// (AI로 다시 정리해도 유지됩니다) 사이트 반영을 요청합니다. 반영되기 전까지는 이 기기에서 먼저 고친 값으로 보여 줍니다.
const EDITS_KEY = 'sn-edits';
const EDIT_KEEP_MS = 3 * 24 * 3600 * 1000; // 오래된 임시 기록은 버립니다
const EDIT_GRACE_MS = 3 * 60 * 1000; // 수정 후 이 시간이 지나 다시 만들어진 데이터면 그 안에 수정이 들어 있다고 봅니다

function readLocalEdits() {
  try {
    const o = JSON.parse(localStorage.getItem(EDITS_KEY) || '{}');
    return o && typeof o === 'object' ? o : {};
  } catch {
    return {};
  }
}
function writeLocalEdits(all) {
  try {
    localStorage.setItem(EDITS_KEY, JSON.stringify(all));
  } catch {
    /* 저장 불가 환경: 이 기기 임시 표시만 건너뜁니다 */
  }
}
/** edit: { title?, preacher?, scripture?, date? } (직접 입력한 원래 문구). 빈 문자열은 "자동으로 되돌림"이라 임시 표시에서는 뺍니다. */
function saveLocalEdit(id, edit) {
  const all = readLocalEdits();
  const cur = { ...(all[id] || {}), at: Date.now() };
  for (const k of ['title', 'preacher', 'scripture', 'date']) {
    if (!(k in edit)) continue;
    if (edit[k]) cur[k] = edit[k];
    else delete cur[k];
  }
  if (cur.title || cur.preacher || cur.scripture || cur.date) all[id] = cur;
  else delete all[id];
  writeLocalEdits(all);
}
/** 목록·상세 항목에 이 기기에서 방금 고친 값을 덧씌웁니다. dataUpdated: 사이트 데이터가 만들어진 시각 */
function applyLocalEdit(item, dataUpdated) {
  const all = readLocalEdits();
  const e = all[item.id];
  if (!e) return item;
  const built = Date.parse(dataUpdated || '');
  if (Date.now() - (e.at || 0) > EDIT_KEEP_MS || (built && built > (e.at || 0) + EDIT_GRACE_MS)) {
    delete all[item.id];
    writeLocalEdits(all);
    return item;
  }
  const out = { ...item };
  if (e.scripture) {
    out.scripture = e.scripture;
    // 제목이 성경 본문이었던 경우(새벽기도 등)에는 제목도 새 본문으로
    if (!e.title && item.scripture && item.scripture !== e.scripture && item.title.endsWith(item.scripture)) out.title = item.title.slice(0, -item.scripture.length) + e.scripture;
  }
  if (e.title) out.title = displayTitle({ category: item.category, title: e.title, scripture: out.scripture });
  if (e.preacher) out.preacher = normalizePreacher(e.preacher);
  if (e.date) out.date = e.date;
  return out;
}

/** 구분 이름 머리말 ("주일예배 - "). 사용자 영상처럼 머리말이 없으면 '' */
function titlePrefixOf(category) {
  const probe = displayTitle({ category, title: '가' });
  return probe.endsWith('가') ? probe.slice(0, -1) : '';
}

/**
 * @param d        상세 데이터 (id, category, title, preacher)
 * @param onSaved  (d) => void  저장되어 d.title / d.preacher 가 바뀐 뒤 화면을 갱신하는 함수
 */
function renderSermonEditor(d, onSaved) {
  const prefix = titlePrefixOf(d.category);
  const titleOf = () => (prefix && d.title.startsWith(prefix) ? d.title.slice(prefix.length) : d.title);
  let initTitle = titleOf();
  let initPreacher = d.preacher || '';
  let initScripture = d.scripture || '';
  let initDate = String(d.date || '').slice(0, 10);

  const titleIn = h('input', { class: 'search', value: initTitle, maxlength: '120', 'aria-label': '설교 제목', placeholder: '설교 제목' });
  const preacherIn = h('input', { class: 'search', value: initPreacher, maxlength: '60', 'aria-label': '설교자', placeholder: '예: 전대혁 목사 (이름만 써도 "목사"가 붙습니다)' });
  const scriptureIn = h('input', { class: 'search', value: initScripture, maxlength: '80', 'aria-label': '성경 본문', placeholder: '예: 요한복음 3:16-21 · 열왕기상 4, 5장 · 시편 23편' });
  const dateIn = h('input', { class: 'search', type: 'date', value: initDate, 'aria-label': '설교 날짜' });
  const pwIn = h('input', { class: 'search', type: 'password', autocomplete: 'current-password', 'aria-label': '관리 비밀번호', placeholder: '관리 비밀번호' });
  const pwRow = h('label', { class: 'edit-field' }, h('span', { class: 'edit-label', text: '비밀번호' }), pwIn);
  const showPw = () => (pwRow.hidden = !!storedPassword());
  showPw();
  const status = h('p', { class: 'meta', role: 'status' });
  const saveBtn = h('button', { class: 'btn primary', type: 'button' }, '저장');
  const publishBtn = h('button', { class: 'btn', type: 'button', hidden: true }, '사이트에 반영');
  publishBtn.hidden = true;
  const password = () => storedPassword() || pwIn.value;

  const rejected = (r) => {
    if (r && r.ok === false && /비밀번호/.test(r.error || '')) {
      forgetPassword();
      showPw();
      status.textContent = '비밀번호가 맞지 않습니다. 다시 입력해 주세요.';
      return true;
    }
    return false;
  };

  let lastPayload = {};
  async function publish() {
    publishBtn.disabled = true;
    status.textContent = '사이트에 반영을 요청하는 중…';
    try {
      const r = await adminPost({ action: 'sync_run', password: password(), max_new: '1', categories: ['none'], export_only: true });
      if (rejected(r)) return;
      if (!r.ok) throw new Error(r.error || '요청하지 못했습니다.');
      publishBtn.hidden = true;
      if (r.workflow_old) {
        status.textContent = '저장했습니다. 사이트 반영을 시작했어요(2~5분 걸립니다). 참고: GitHub의 sync.yml 이 옛 버전이라 일반 방식으로 실행했습니다. 새 sync.yml 로 바꾸면 더 빠르고 정확하게 반영됩니다.';
        return;
      }
      status.textContent = ('scripture' in lastPayload ? '저장했습니다. 성경 본문(4역본)을 새로 가져오느라 다른 화면에는 2~4분 뒤에 반영됩니다.' : '저장했습니다. 다른 화면에는 1~2분 뒤에 반영됩니다.') + ' (이 기기에서는 이미 바뀌어 보입니다)';
    } catch (e) {
      publishBtn.hidden = false;
      status.textContent = `저장은 되었지만 사이트 반영을 시작하지 못했습니다: ${e.message || e} — 잠시 뒤 "사이트에 반영"을 누르거나, 다음 정기 동기화 때 자동으로 반영됩니다.`;
    } finally {
      publishBtn.disabled = false;
    }
  }

  saveBtn.addEventListener('click', async () => {
    const payload = { action: 'sermon_edit', password: password(), video_id: d.id };
    const title = titleIn.value.trim();
    const preacher = preacherIn.value.trim();
    // 바꾼 칸만 보냅니다 (건드리지 않은 칸은 자동 값이 계속 따라갑니다)
    if (title !== initTitle) payload.title = title;
    if (preacher !== initPreacher) payload.preacher = preacher;
    const scripture = scriptureIn.value.trim();
    if (scripture !== initScripture) payload.scripture = scripture;
    const date = dateIn.value;
    if (date !== initDate) payload.date = date;
    if (!('title' in payload) && !('preacher' in payload) && !('scripture' in payload) && !('date' in payload)) return (status.textContent = '바뀐 내용이 없습니다.');
    if (!payload.password) return (status.textContent = '관리 비밀번호를 입력해 주세요.');
    saveBtn.disabled = true;
    status.textContent = '저장 중…';
    try {
      const r = await adminPost(payload);
      if (rejected(r)) return;
      if (!r.ok) throw new Error(/알 수 없는 작업/.test(r.error || '') ? 'Apps Script가 아직 옛 버전입니다. Code.gs를 새 것으로 바꿔 붙이고 "배포 관리 → 새 버전"으로 다시 배포해 주세요.' : r.error || '저장하지 못했습니다.');
      rememberPassword(payload.password);
      lastPayload = payload;
      pwIn.value = '';
      showPw();
      const saved = r.saved || {};
      saveLocalEdit(d.id, saved);
      Object.assign(d, applyLocalEdit({ id: d.id, category: d.category, scripture: d.scripture, title: d.title, preacher: d.preacher, date: d.date }, null));
      if ('title' in payload) {
        initTitle = saved.title ? titleOf() : ''; // 비웠다면 자동 값으로 돌아가는 중 (사이트에 반영되면 채워집니다)
        if (saved.title) titleIn.value = initTitle;
      }
      if ('preacher' in payload) {
        initPreacher = saved.preacher ? d.preacher : '';
        if (saved.preacher) preacherIn.value = d.preacher;
      }
      if ('scripture' in payload) {
        initScripture = saved.scripture ? d.scripture : '';
        if (saved.scripture) scriptureIn.value = d.scripture;
      }
      if ('date' in payload) {
        initDate = saved.date ? String(d.date || '').slice(0, 10) : '';
        if (saved.date) dateIn.value = initDate;
      }
      if (onSaved) onSaved(d);
      await publish();
    } catch (e) {
      status.textContent = `오류: ${e.message || e}`;
    } finally {
      saveBtn.disabled = false;
    }
  });
  publishBtn.addEventListener('click', publish);

  return h(
    'details',
    { class: 'sermon-edit' },
    h('summary', { text: '제목·설교자·본문·날짜 고치기 (관리자)' }),
    h('p', { class: 'meta', text: '영상 제목에서 잘못 읽은 것을 직접 고칩니다. 구분 이름("주일예배 - ")은 자동으로 붙습니다. 성경 본문을 고치면 성경 본문(4역본)과 낭독도 새로 가져옵니다. 날짜를 지우고 저장하면 자동 값(제목의 날짜 → 유튜브 게시일)으로 돌아가고, 다른 칸도 비우고 저장하면 자동 값으로 돌아가고, AI로 다시 정리해도 고친 값은 유지됩니다.' }),
    h('label', { class: 'edit-field' }, h('span', { class: 'edit-label', text: '제목' }), h('span', { class: 'edit-title-row' }, prefix ? h('span', { class: 'edit-prefix', text: prefix.trim() }) : null, titleIn)),
    h('label', { class: 'edit-field' }, h('span', { class: 'edit-label', text: '설교자' }), preacherIn),
    h('label', { class: 'edit-field' }, h('span', { class: 'edit-label', text: '성경 본문' }), scriptureIn),
    h('label', { class: 'edit-field' }, h('span', { class: 'edit-label', text: '설교 날짜' }), dateIn),
    pwRow,
    h('div', { class: 'admin-row' }, saveBtn, publishBtn),
    status,
  );
}

/* ---------- 잠언 묵상 (관리) ---------- */
// 31장 진행 상황 · 빠진 장 지금 만들기 · 장별(부분) 다시 만들기
function renderProverbsSection(password, onPasswordRejected) {
  const info = h('p', { class: 'meta', role: 'status' });
  const grid = h('div', { class: 'pv-admin-grid' }, h('p', { class: 'meta', text: '불러오는 중…' }));
  const chSel = h('select', { class: 'search ad-redo-sel', 'aria-label': '장' }, Array.from({ length: 31 }, (_, i) => h('option', { value: String(i + 1), text: `${i + 1}장` })));
  const partSel = h('select', { class: 'search ad-redo-sel', 'aria-label': '다시 만들 부분' }, [['', '전부'], ['word', '말씀'], ['qt', 'QT'], ['study', '성경공부'], ['group', '소그룹'], ['quiz', '퀴즈']].map(([v, l]) => h('option', { value: v, text: l })));
  const redo = h('button', { class: 'btn', type: 'button' }, '이 장 다시 만들기');
  const missing = h('button', { class: 'btn primary', type: 'button' }, '빠진 장 지금 만들기');
  const run = async (payload, okText) => {
    info.textContent = '실행을 요청하는 중…';
    try {
      const r = await adminPost({ action: 'sync_run', password, ...payload });
      if (onPasswordRejected(r)) return;
      if (!r.ok) throw new Error(r.error || '실행하지 못했습니다.');
      info.textContent = r.workflow_old ? '실행을 요청했지만 GitHub의 sync.yml 이 옛 버전입니다. 새 sync.yml 을 올려 주세요.' : okText;
      setTimeout(load, 60000);
    } catch (e) {
      info.textContent = `오류: ${e.message || e}`;
    }
  };
  missing.addEventListener('click', () => run({ proverbs: 'missing' }, '빠진 장을 6개까지 만드는 중입니다. 한 장에 몇 분씩 걸려요. 진행 상태는 위 "지금 동기화"에 보입니다.'));
  redo.addEventListener('click', () => {
    const part = partSel.options[partSel.selectedIndex].text;
    if (!confirm(`잠언 ${chSel.value}장 ${part === '전부' ? '전부' : `${part}만`} 새로 만들까요?`)) return;
    run({ proverbs: chSel.value, force: true, modes: partSel.value ? [partSel.value] : [] }, `잠언 ${chSel.value}장 ${part}을(를) 다시 만드는 중입니다.`);
  });
  async function load() {
    try {
      const r = await adminPost({ action: 'proverbs_status', password });
      if (onPasswordRejected(r)) return;
      if (!r.ok) throw new Error(/알 수 없는 작업/.test(r.error || '') ? 'Apps Script가 옛 버전입니다. 새 Code.gs로 다시 배포해 주세요.' : r.error || '');
      const list = r.chapters || [];
      const done = list.filter((c) => c.status === 'done').length;
      grid.replaceChildren(
        h('p', { class: 'meta', text: `${done} / 31장 완료` }),
        h(
          'div',
          { class: 'pv-admin-cells' },
          list.map((c) => {
            const parts = ['word', 'qt', 'study', 'group', 'quiz'].filter((k) => c[k]).length;
            const cls = c.status === 'done' ? 'ok' : c.status === 'running' ? 'run' : c.status ? 'err' : '';
            const cell = h('button', { class: `pv-admin-cell ${cls}`, type: 'button', title: `${c.chapter}장 · ${c.status || '아직 없음'}${c.note ? ` · ${c.note}` : ''}` }, h('b', { text: String(c.chapter) }), h('span', { text: c.status ? `${parts}/5` : '—' }));
            cell.addEventListener('click', () => {
              chSel.value = String(c.chapter);
              info.textContent = `${c.chapter}장: ${c.status === 'done' ? '완료' : c.status ? `일부 실패 — ${c.note || ''}` : '아직 없음'}`;
            });
            return cell;
          }),
        ),
      );
    } catch (e) {
      grid.replaceChildren(h('p', { class: 'meta', text: `진행 상황을 불러오지 못했습니다: ${e.message || e}` }));
    }
  }
  load();
  return h(
    'section',
    { class: 'point admin-sync admin-prov' },
    h('h2', { text: '잠언 묵상' }),
    h('p', { class: 'meta', text: '잠언 1~31장을 한 번씩 만들어 둡니다(화면에서 한 달에 한 장씩 골라 묵상). 매일 동기화 때 빠진 장을 3개씩 만들고, 아래 버튼으로 지금 만들거나 장별로 다시 만들 수 있습니다.' }),
    grid,
    h('div', { class: 'admin-row' }, missing),
    h('div', { class: 'admin-row' }, chSel, partSel, redo),
    info,
  );
}
