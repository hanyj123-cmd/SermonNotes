// 이번 실행에서 정리할 영상을 고르는 순서
//   1) status = redo            (사람이 직접 다시 하라고 표시한 것 · 앱에서 고른 것) — 구분과 상관없이 항상
//   2) 사용자 영상(category = user) 중 대기·실패 — 앱에서 링크를 넣은 것이므로 구분과 상관없이 항상
//   3) 최근 실패한 것           (status = error / no_transcript, 최근 RETRY_DAYS일 이내 영상)
//   4) status = pending         (새 영상, 최신순)
// 3)·4)는 이번 실행의 대상 구분(categories)에 속한 것만 합니다. (예: 수요예배 실행은 수요예배 영상만)
// status = listed(목록만) / skip(제외) 인 영상은 사람이 직접 고르기 전에는 자동으로 처리하지 않습니다.
// 라이브 예약·방송 중처럼 아직 정리할 수 없는 영상은 건너뛰고 상태는 그대로 둡니다.

export const FAILED_STATUSES = ['error', 'no_transcript'];

const byDateDesc = (a, b) => String(b.published_at).localeCompare(String(a.published_at));

const dayString = (date) => date.toISOString().slice(0, 10);

/**
 * @param sermons  Sermons 탭의 행들
 * @param opts     { maxPerRun, retryDays, today(Date), states(Map: video_id → {ready, reason}), categories(Set|Array|null) }
 * @returns        { queue, skipped:[{row, reason}] }
 */
export function buildQueue(sermons, { maxPerRun = 5, retryDays = 7, today = new Date(), states = new Map(), categories = null } = {}) {
  const cutoff = dayString(new Date(today.getTime() - retryDays * 86400000));
  const isRecent = (s) => String(s.published_at || '') >= cutoff;
  const cats = categories ? new Set(categories) : null;
  const inScope = (s) => !cats || cats.has(s.category);
  const isUser = (s) => s.category === 'user';

  const taken = new Set();
  const pick = (list) => list.filter((s) => (taken.has(s.video_id) ? false : (taken.add(s.video_id), true)));
  const ordered = [
    ...pick(sermons.filter((s) => s.status === 'redo').sort(byDateDesc)),
    ...pick(sermons.filter((s) => isUser(s) && (s.status === 'pending' || FAILED_STATUSES.includes(s.status))).sort(byDateDesc)),
    ...pick(sermons.filter((s) => FAILED_STATUSES.includes(s.status) && isRecent(s) && inScope(s)).sort(byDateDesc)),
    ...pick(sermons.filter((s) => s.status === 'pending' && inScope(s)).sort(byDateDesc)),
  ];

  const queue = [];
  const skipped = [];
  for (const row of ordered) {
    const st = states.get(row.video_id);
    if (st && !st.ready) {
      skipped.push({ row, reason: st.reason });
      continue;
    }
    if (queue.length < maxPerRun) queue.push(row);
  }
  return { queue, skipped };
}
