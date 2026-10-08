// 이번 실행에서 정리할 영상을 고르는 순서
//   1) status = redo            (사람이 직접 다시 하라고 표시한 것)
//   2) 최근 실패한 것           (status = error / no_transcript, 최근 RETRY_DAYS일 이내 영상)
//   3) status = pending         (새 영상, 최신순)
// status = listed(목록만) / skip(제외) 인 영상은 사람이 직접 고르기 전에는 자동으로 처리하지 않습니다.
// 라이브 예약·방송 중처럼 아직 정리할 수 없는 영상은 건너뛰고 상태는 그대로 둡니다.

export const FAILED_STATUSES = ['error', 'no_transcript'];

const byDateDesc = (a, b) => String(b.published_at).localeCompare(String(a.published_at));

const dayString = (date) => date.toISOString().slice(0, 10);

/**
 * @param sermons  Sermons 탭의 행들
 * @param opts     { maxPerRun, retryDays, today(Date), states(Map: video_id → {ready, reason}) }
 * @returns        { queue, skipped:[{row, reason}] }
 */
export function buildQueue(sermons, { maxPerRun = 5, retryDays = 7, today = new Date(), states = new Map() } = {}) {
  const cutoff = dayString(new Date(today.getTime() - retryDays * 86400000));
  const isRecent = (s) => String(s.published_at || '') >= cutoff;

  const ordered = [
    ...sermons.filter((s) => s.status === 'redo').sort(byDateDesc),
    ...sermons.filter((s) => FAILED_STATUSES.includes(s.status) && isRecent(s)).sort(byDateDesc),
    ...sermons.filter((s) => s.status === 'pending').sort(byDateDesc),
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
