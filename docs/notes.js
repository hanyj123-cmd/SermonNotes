// 설교 한 편에 대한 "내 기록" (로그인했을 때만): 메모 · 모드별 답/적용/나눔 메모 · 적용 체크
// 입력하면 잠시 뒤 자동 저장하고, 다시 들어오면 그대로 불러옵니다. 이 파일은 app.js 의 h(), notesCall(), state 를 씁니다.
//
//   fields: { "qt.q.0": "…", "qt.app.1": "…", "group.obs.2": "…" } — 칸마다 고정된 이름(키)으로 저장
//   checks: 삶의 적용 "실천했어요" 체크 (제목으로 짝을 맞춥니다)

const localDate = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

function createNotes(s) {
  const values = { memo: '', fields: {}, checks: {} }; // checks: { 제목: {done, date} }
  const registry = new Set(); // 입력 칸들 (불러오기가 끝나기 전에는 막아 두어, 기존 기록을 빈 값으로 덮어쓰지 않게 합니다)
  const status = h('span', { class: 'meta note-status', role: 'status' });
  let ready = false;
  let dirty = false;
  let timer = null;
  let saving = null;

  const setStatus = (t) => {
    status.textContent = t;
  };

  async function save() {
    if (!ready || !dirty) return;
    if (saving) await saving;
    dirty = false;
    setStatus('저장 중…');
    saving = (async () => {
      try {
        const res = await notesCall('notes_save', {
          video_id: s.id,
          memo: values.memo,
          fields: values.fields,
          checks: Object.entries(values.checks).map(([t, c]) => ({ t, done: c.done, date: c.date })),
        });
        if (!res.ok) throw new Error(res.error || '저장하지 못했습니다.');
        state.noteIds.add(s.id);
        setStatus(`저장됨 ${new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}`);
      } catch (e) {
        dirty = true;
        setStatus(`저장 실패: ${e.message || e}`);
      }
    })();
    await saving;
    saving = null;
  }

  const touch = () => {
    dirty = true;
    setStatus('입력 중…');
    clearTimeout(timer);
    timer = setTimeout(save, 1200);
  };
  const flush = () => {
    clearTimeout(timer);
    return save();
  };
  const track = (el) => {
    registry.add(el);
    el.disabled = !ready;
    return el;
  };

  // 화면에서 사라진 칸 정리 (모드를 바꿔 다시 그린 뒤에 부릅니다)
  const prune = () => {
    for (const x of registry) if (!x.isConnected) registry.delete(x);
  };

  /** 기록 칸 (이름 key 로 저장). rows: 줄 수 */
  function fieldBox(key, { placeholder = '내 생각을 적어 보세요', rows = 3, label = '내 기록' } = {}) {
    const ta = h('textarea', { class: 'note-input', rows: String(rows), placeholder, 'aria-label': label });
    ta.dataset.key = key;
    ta.value = values.fields[key] || '';
    ta.addEventListener('input', () => {
      if (ta.value.trim()) values.fields[key] = ta.value;
      else delete values.fields[key];
      touch();
    });
    return track(ta);
  }

  function memoBox() {
    const ta = h('textarea', {
      class: 'note-input note-memo',
      rows: '6',
      placeholder: '이 설교를 들으며 떠오른 생각, 기도 제목, 나누고 싶은 말을 자유롭게 적어 보세요.',
      'aria-label': '내 메모',
    });
    ta.value = values.memo;
    ta.addEventListener('input', () => {
      values.memo = ta.value;
      touch();
    });
    return track(ta);
  }

  /** "실천했어요" 체크 (삶의 적용 항목 제목으로 구분) */
  function checkRow(title) {
    const cb = h('input', { type: 'checkbox', 'aria-label': '실천했어요' });
    const dateEl = h('span', { class: 'meta check-date' });
    const paint = () => {
      const c = values.checks[title] || { done: false, date: '' };
      cb.checked = c.done;
      dateEl.textContent = c.done && c.date ? `${c.date} 실천` : '';
    };
    cb.addEventListener('change', () => {
      const prev = values.checks[title] || { done: false, date: '' };
      values.checks[title] = { done: cb.checked, date: cb.checked ? prev.date || localDate() : '' };
      paint();
      touch();
    });
    paint();
    track(cb);
    cb._paint = paint;
    return h('label', { class: 'check' }, cb, h('span', { text: ' 실천했어요' }), dateEl);
  }

  async function load() {
    setStatus('기록 불러오는 중…');
    try {
      const res = await notesCall('notes_get', { video_id: s.id });
      if (!res.ok) throw new Error(res.error || '기록을 불러오지 못했습니다.');
      const n = res.note;
      if (n) {
        values.memo = n.memo || '';
        values.fields = { ...(n.fields || {}) };
        values.checks = {};
        for (const c of n.checks || []) values.checks[c.t] = { done: !!c.done, date: c.date || '' };
        // 예전 형식(묵상 질문 답변)이 있으면 QT 묵상 칸으로 옮겨 보여 줍니다
        (n.answers || []).forEach((a, i) => {
          if (a && a.a && !values.fields[`qt.q.${i}`]) values.fields[`qt.q.${i}`] = a.a;
        });
      }
      ready = true;
      for (const el of registry) {
        if (!el.isConnected) {
          registry.delete(el);
          continue;
        }
        el.disabled = false;
        if (el._paint) el._paint();
      }
      fillAll();
      setStatus('');
    } catch (e) {
      setStatus(`오류: ${e.message || e}`);
    }
  }

  // 불러온 값으로 화면의 칸을 채웁니다 (칸 이름은 data-key 로 찾음)
  function fillAll() {
    for (const el of registry) {
      if (el.tagName !== 'TEXTAREA') continue;
      const key = el.dataset.key;
      if (key) el.value = values.fields[key] || '';
      else if (el.classList.contains('note-memo')) el.value = values.memo;
    }
  }

  return { fieldBox, memoBox, checkRow, status, load, flush, prune, get ready() { return ready; } };
}
