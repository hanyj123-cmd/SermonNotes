// 아침 자동 실행 시간, 실패 영상 재시도 순서, 예약 라이브 건너뛰기 점검: npm test
import assert from 'node:assert/strict';
import { shouldRun, torontoMinutes } from './gate.mjs';
import { classifyVideo, fetchVideoStates } from './lib/youtube.mjs';
import { buildQueue } from './lib/queue.mjs';

let passed = 0;
const t = async (name, fn) => {
  await fn();
  passed++;
  console.log('✓', name);
};
const at = (iso) => new Date(iso);

// ---------- 자동 실행 시간 (토론토 07:20~08:20) ----------
await t('여름(EDT): 11:30 UTC = 토론토 7:30 → 실행, 12:30 UTC = 8:30 → 건너뜀', () => {
  assert.equal(torontoMinutes(at('2026-10-08T11:30:00Z')), 7 * 60 + 30);
  assert.equal(shouldRun('schedule', at('2026-10-08T11:30:00Z')), true);
  assert.equal(shouldRun('schedule', at('2026-10-08T12:30:00Z')), false);
});
await t('겨울(EST): 12:30 UTC = 토론토 7:30 → 실행, 11:30 UTC = 6:30 → 건너뜀', () => {
  assert.equal(shouldRun('schedule', at('2026-12-01T12:30:00Z')), true);
  assert.equal(shouldRun('schedule', at('2026-12-01T11:30:00Z')), false);
});
await t('서머타임이 바뀌는 날에도 맞음 (2026-11-01 일요일 / 2027-03-14)', () => {
  // 11/1 새벽 2시에 EST로 바뀜 → 그날 7:30은 12:30 UTC
  assert.equal(shouldRun('schedule', at('2026-11-01T12:30:00Z')), true);
  assert.equal(shouldRun('schedule', at('2026-11-01T11:30:00Z')), false);
  // 3/14 새벽 2시에 EDT로 바뀜 → 그날 7:30은 11:30 UTC
  assert.equal(shouldRun('schedule', at('2027-03-14T11:30:00Z')), true);
  assert.equal(shouldRun('schedule', at('2027-03-14T12:30:00Z')), false);
});
await t('GitHub 예약이 조금 늦어져도(최대 약 50분) 실행, 그 이상은 건너뜀', () => {
  assert.equal(shouldRun('schedule', at('2026-10-08T12:10:00Z')), true); // 8:10
  assert.equal(shouldRun('schedule', at('2026-10-08T12:20:00Z')), true); // 8:20
  assert.equal(shouldRun('schedule', at('2026-10-08T12:21:00Z')), false); // 8:21
  assert.equal(shouldRun('schedule', at('2026-10-08T11:19:00Z')), false); // 7:19
});
await t('직접 실행(버튼·Run workflow)은 시간과 상관없이 항상 실행', () => {
  assert.equal(shouldRun('workflow_dispatch', at('2026-10-08T03:00:00Z')), true);
});

// ---------- 영상 상태 ----------
const vid = (over = {}) => ({ id: 'X', snippet: { liveBroadcastContent: 'none' }, status: { privacyStatus: 'public', uploadStatus: 'processed' }, contentDetails: { duration: 'PT45M10S' }, ...over });
await t('영상 상태: 정상 영상은 준비됨', () => assert.equal(classifyVideo(vid()).ready, true));
await t('영상 상태: 예약된 라이브/프리미어(upcoming)는 건너뜀', () => {
  const r = classifyVideo(vid({ snippet: { liveBroadcastContent: 'upcoming' }, contentDetails: { duration: 'P0D' } }));
  assert.equal(r.ready, false);
  assert.match(r.reason, /예정된 라이브/);
});
await t('영상 상태: 방송 중 / 처리 중 / 재생시간 0 / 비공개 / 삭제는 건너뜀', () => {
  assert.match(classifyVideo(vid({ snippet: { liveBroadcastContent: 'live' } })).reason, /라이브 중/);
  assert.match(classifyVideo(vid({ status: { privacyStatus: 'public', uploadStatus: 'uploaded' } })).reason, /처리 중/);
  assert.match(classifyVideo(vid({ contentDetails: { duration: 'P0D' } })).reason, /재생 시간/);
  assert.match(classifyVideo(vid({ status: { privacyStatus: 'private', uploadStatus: 'processed' } })).reason, /비공개/);
  assert.match(classifyVideo(vid({ status: { privacyStatus: 'public', uploadStatus: 'rejected' } })).reason, /사용할 수 없는/);
  assert.match(classifyVideo(undefined).reason, /찾을 수 없음/);
});
await t('영상 상태 조회: 50개씩 나눠 조회, 응답에 없는 영상은 건너뜀', async () => {
  const ids = Array.from({ length: 120 }, (_, i) => `v${i}`);
  const urls = [];
  const fakeFetch = async (url) => {
    urls.push(String(url));
    const q = new URL(url).searchParams.get('id').split(',');
    return { ok: true, json: async () => ({ items: q.filter((id) => id !== 'v7').map((id) => vid({ id, snippet: { liveBroadcastContent: id === 'v3' ? 'upcoming' : 'none' } })) }) };
  };
  const m = await fetchVideoStates(ids, 'KEY', fakeFetch);
  assert.equal(urls.length, 3);
  assert.ok(urls[0].includes('key=KEY') && urls[0].includes('part=snippet%2Cstatus%2CcontentDetails'));
  assert.equal(m.get('v0').ready, true);
  assert.equal(m.get('v3').ready, false);
  assert.equal(m.get('v7').ready, false); // 응답에 없음 = 삭제/비공개
  assert.equal(m.size, 120);
});
await t('영상 상태 조회: API가 실패하면 막지 않고 진행(빈 결과)', async () => {
  const w = console.warn;
  console.warn = () => {};
  try {
    const m = await fetchVideoStates(['a', 'b'], 'K', async () => ({ ok: false, status: 403, json: async () => ({}) }));
    assert.equal(m.size, 0);
    const m2 = await fetchVideoStates(['a'], 'K', async () => {
      throw new Error('network');
    });
    assert.equal(m2.size, 0);
  } finally {
    console.warn = w;
  }
});

// ---------- 처리 순서 ----------
const row = (id, status, published_at, extra = {}) => ({ video_id: id, status, published_at, title: id, ...extra });
const today = at('2026-10-08T12:00:00Z');

await t('순서: redo → 최근 실패 → pending(최신순)', () => {
  const rows = [
    row('p-new', 'pending', '2026-10-07'),
    row('p-old', 'pending', '2026-09-01'),
    row('e-recent', 'error', '2026-10-04'),
    row('n-recent', 'no_transcript', '2026-10-06'),
    row('r-old', 'redo', '2026-08-01'),
    row('done', 'done', '2026-10-07'),
  ];
  const { queue } = buildQueue(rows, { maxPerRun: 10, today });
  assert.deepEqual(queue.map((r) => r.video_id), ['r-old', 'n-recent', 'e-recent', 'p-new', 'p-old']);
});
await t('오래된 실패(7일 초과)는 자동 재시도하지 않음, retryDays로 조절', () => {
  const rows = [row('old-fail', 'error', '2026-09-20'), row('edge', 'error', '2026-10-01'), row('x', 'error', '2026-09-30')];
  assert.deepEqual(buildQueue(rows, { today }).queue.map((r) => r.video_id), ['edge']); // 10/1 = 정확히 7일 전
  assert.deepEqual(buildQueue(rows, { today, retryDays: 30 }).queue.map((r) => r.video_id), ['edge', 'x', 'old-fail']);
  assert.deepEqual(buildQueue(rows, { today, retryDays: 1 }).queue, []);
});
await t('최대 개수 제한: 실패한 영상이 먼저 자리를 차지함', () => {
  const rows = [row('p1', 'pending', '2026-10-07'), row('e1', 'error', '2026-10-05'), row('e2', 'error', '2026-10-06')];
  assert.deepEqual(buildQueue(rows, { today, maxPerRun: 2 }).queue.map((r) => r.video_id), ['e2', 'e1']);
});
await t('예약 라이브/방송 중인 영상은 건너뛰고 다음 영상으로 채움 (상태는 그대로)', () => {
  const rows = [row('live-sched', 'pending', '2026-10-11'), row('p2', 'pending', '2026-10-07'), row('p3', 'pending', '2026-10-06')];
  const states = new Map([['live-sched', { ready: false, reason: '예정된 라이브/프리미어 (아직 영상이 없음)' }]]);
  const { queue, skipped } = buildQueue(rows, { today, maxPerRun: 2, states });
  assert.deepEqual(queue.map((r) => r.video_id), ['p2', 'p3']);
  assert.equal(skipped.length, 1);
  assert.match(skipped[0].reason, /예정된 라이브/);
  assert.equal(rows[0].status, 'pending');
});
await t('상태를 모르는 영상(조회 실패)은 막지 않음', () => {
  const rows = [row('a', 'pending', '2026-10-07')];
  assert.equal(buildQueue(rows, { today, states: new Map() }).queue.length, 1);
});
await t('redo로 표시한 것도 아직 영상이 없으면 건너뜀', () => {
  const rows = [row('r', 'redo', '2026-10-07')];
  const { queue, skipped } = buildQueue(rows, { today, states: new Map([['r', { ready: false, reason: '방송 중' }]]) });
  assert.equal(queue.length, 0);
  assert.equal(skipped.length, 1);
});

console.log(`\n${passed}개 테스트 통과`);
