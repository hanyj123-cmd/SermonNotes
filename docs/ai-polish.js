// AI 문장 다듬기 — 앱의 모든 기록 칸(textarea.note-input: 묵상 · 나눔 · 소그룹 · 개인 메모 · 형광펜 메모) 아래에
// [AI 문장 다듬기] 버튼을 붙입니다. 누르면 맞춤법 · 띄어쓰기 · 문맥을 다듬은 제안을 보여 주고, [적용하기]로 그 칸에 바로 넣습니다.
// 서버: Apps Script 의 notes_polish (Gemini). 로그인한 가족만 쓸 수 있습니다.
// 이 파일은 app.js(h, auth, notesCall, toast, NOTES_ENABLED) · content.js(icon) 를 씁니다.

const POLISH_SEL = 'textarea.note-input';

/** 그 칸이 무엇을 쓰는 곳인지 (AI 에게 알려 줄 짧은 설명) */
function polishContext(ta) {
  const label = ta.getAttribute('aria-label') || '';
  const q = ta.closest('li, .point, .gq, .block, .mk-pop');
  const qText = q ? (q.querySelector('.gq-text, .qt-q, h3, .qz-q') || {}).textContent || '' : '';
  const page = (document.querySelector('.rd-refs, .detail-title, h1') || {}).textContent || '';
  return [page, label, qText].map((x) => x.trim()).filter(Boolean).join(' · ').slice(0, 120);
}

function attachPolish(ta) {
  if (ta.dataset.polish) return;
  ta.dataset.polish = '1';
  const btn = h('button', { class: 'ai-polish-btn', type: 'button', title: '맞춤법 · 띄어쓰기 · 문장을 매끄럽게 다듬어 제안합니다' }, h('span', { class: 'ai-polish-spark', 'aria-hidden': 'true', text: '✦' }), 'AI 문장 다듬기');
  const row = h('div', { class: 'ai-polish-row' }, btn);
  ta.insertAdjacentElement('afterend', row);
  let panel = null;
  const close = () => {
    if (panel) panel.remove();
    panel = null;
  };
  const run = async () => {
    const text = ta.value.trim();
    if (!text) return toast('먼저 글을 적어 주세요.', 2500);
    if (!(typeof NOTES_ENABLED !== 'undefined' && NOTES_ENABLED && auth.user)) return toast('AI 문장 다듬기는 구글 로그인 후 쓸 수 있어요.', 3000);
    close();
    btn.disabled = true;
    btn.classList.add('busy');
    const wait = h('div', { class: 'ai-polish-panel' }, h('p', { class: 'meta', text: '문장을 다듬는 중…' }));
    row.after(wait);
    panel = wait;
    let r;
    try {
      r = await notesCall('notes_polish', { text, context: polishContext(ta) });
    } catch (e) {
      r = { ok: false, error: `연결하지 못했습니다: ${e.message || e}` };
    }
    btn.disabled = false;
    btn.classList.remove('busy');
    if (panel !== wait) return;
    if (!r.ok) {
      wait.replaceChildren(h('p', { class: 'ai-polish-err', text: /알 수 없는 작업/.test(r.error || '') ? 'Apps Script가 옛 버전입니다. 새 Code.gs로 다시 배포해 주세요.' : r.error || '다듬지 못했어요.' }), h('div', { class: 'ai-polish-actions' }, h('button', { class: 'btn small', type: 'button', onclick: close }, '닫기')));
      return;
    }
    const suggestion = h('textarea', { class: 'ai-polish-text', rows: String(Math.min(12, Math.max(3, Math.ceil(r.text.length / 38)))), 'aria-label': 'AI가 다듬은 글 (고쳐 쓸 수 있어요)', 'data-no-polish': '1' });
    suggestion.value = r.text;
    const apply = h('button', { class: 'btn primary small', type: 'button' }, '적용하기');
    apply.addEventListener('click', () => {
      ta.value = suggestion.value;
      ta.dispatchEvent(new Event('input', { bubbles: true })); // 노트 자동 저장
      close();
      ta.focus();
      toast('다듬은 글을 적용했어요.', 2000);
    });
    wait.replaceChildren(
      h('div', { class: 'ai-polish-head' }, h('strong', {}, h('span', { class: 'ai-polish-spark', 'aria-hidden': 'true', text: '✦' }), ' 다듬은 글'), h('span', { class: 'meta', text: '필요하면 고친 뒤 적용하세요' })),
      suggestion,
      r.changes && r.changes.length ? h('ul', { class: 'ai-polish-changes' }, r.changes.map((c) => h('li', { text: c }))) : null,
      h('details', { class: 'ai-polish-orig' }, h('summary', { text: '원래 글 보기' }), h('p', { text })),
      h('div', { class: 'ai-polish-actions' }, apply, h('button', { class: 'btn small', type: 'button', onclick: run }, '다시 다듬기'), h('button', { class: 'btn small', type: 'button', onclick: close }, '닫기')),
    );
  };
  btn.addEventListener('click', run);
}

function scanPolish(root = document) {
  root.querySelectorAll(POLISH_SEL).forEach((ta) => {
    if (!ta.dataset.noPolish) attachPolish(ta);
  });
}

// 화면이 바뀔 때마다 새로 생긴 기록 칸에도 붙입니다
(function startPolish() {
  const go = () => {
    scanPolish();
    let queued = false;
    new MutationObserver(() => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        scanPolish();
      });
    }).observe(document.body, { childList: true, subtree: true });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go);
  else go();
})();
