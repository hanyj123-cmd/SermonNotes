// 새벽기도 영상 연결: 정해진 유튜브 재생목록에서 날짜별 새벽기도 영상을 찾아 "오늘의 말씀" 그 날짜에 1:1로 붙입니다.
//   · AI 정리 없이 영상 링크만 연결합니다 (Daily 탭의 dawn_json 열).
//   · 재생목록 주소는 관리 화면에서 바꿀 수 있습니다 (Settings 탭의 dawn_playlist). 없으면 기본 재생목록.
//   · 관리 화면에서 직접 넣은 영상(manual)은 자동 연결이 덮어쓰지 않습니다.
//   · 예약: 매일 07:20, 그때 오늘 영상이 없으면 08:00 에 다시 (scripts/gate.mjs). 오늘 영상이 이미 있으면 재생목록을 다시 읽지 않습니다.
import { extractPlaylistId, classifyVideo } from './youtube.mjs';
import { torontoDate, DAILY_TIME_ZONE } from './daily.mjs';

export const DAWN_DEFAULT_PLAYLIST = 'https://youtube.com/playlist?list=PLexqr1dnrjPzF_IXx_pR1YRKUx13rX7CT&si=sZADQZD6sK25peYz';
const API = 'https://www.googleapis.com/youtube/v3';

/** Settings 의 dawn_playlist → 재생목록 ID (잘못됐으면 기본값) */
export function dawnPlaylistId(setting) {
  return extractPlaylistId(setting) || extractPlaylistId(DAWN_DEFAULT_PLAYLIST);
}

/** ISO 시각 → 토론토 날짜 */
export function torontoDayOf(iso) {
  const t = new Date(iso);
  if (isNaN(t)) return '';
  return new Intl.DateTimeFormat('en-CA', { timeZone: DAILY_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(t);
}

/**
 * 영상이 어느 날의 새벽기도인지: 제목의 날짜("[2026.10.09]", "2026-10-09", "26.10.09", "10월 9일")가 있으면 그것,
 * 없으면 유튜브에 올라간(방송된) 시각의 토론토 날짜.
 */
export function dawnDateOf(title, publishedIso) {
  const t = String(title || '');
  const pub = torontoDayOf(publishedIso);
  let m = /(20\d{2})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})/.exec(t);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = /(?:^|[^\d])(\d{2})\.(\d{1,2})\.(\d{1,2})(?:[^\d]|$)/.exec(t);
  if (m) return `20${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = /(\d{1,2})\s*월\s*(\d{1,2})\s*일/.exec(t);
  if (m && pub) return `${pub.slice(0, 4)}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  return pub;
}

async function api(endpoint, params, apiKey, fetchImpl) {
  const res = await fetchImpl(`${API}/${endpoint}?${new URLSearchParams({ ...params, key: apiKey })}`);
  if (!res.ok) throw new Error(`YouTube API 오류 (${res.status}) ${(await res.text().catch(() => '')).slice(0, 200)}`);
  return res.json();
}

/** 재생목록 영상 전부(최대 maxPages×50) → 최근 것부터 [{ video_id, title, published }] */
export async function fetchDawnVideos(playlistId, apiKey, { fetchImpl = fetch, maxPages = 20 } = {}) {
  const out = [];
  let pageToken = '';
  for (let page = 0; page < maxPages; page++) {
    const data = await api('playlistItems', { part: 'snippet,contentDetails,status', playlistId, maxResults: '50', ...(pageToken ? { pageToken } : {}) }, apiKey, fetchImpl);
    for (const it of data.items || []) {
      const id = it.contentDetails?.videoId;
      const title = String(it.snippet?.title || '');
      if (!id || /^(Private|Deleted) video$/.test(title) || it.status?.privacyStatus === 'private') continue;
      out.push({ video_id: id, title, published: it.contentDetails?.videoPublishedAt || it.snippet?.publishedAt || '' });
    }
    pageToken = data.nextPageToken || '';
    if (!pageToken) break;
  }
  return out.sort((a, b) => String(b.published).localeCompare(String(a.published)));
}

/** 아직 볼 수 없는 영상(예정된 라이브, 방송 중, 처리 중)은 뺍니다 */
export async function readyOnly(videos, apiKey, fetchImpl = fetch) {
  if (!videos.length) return videos;
  const data = await api('videos', { part: 'snippet,status,contentDetails', id: videos.map((v) => v.video_id).join(',') }, apiKey, fetchImpl);
  const byId = new Map((data.items || []).map((it) => [it.id, it]));
  return videos.filter((v) => classifyVideo(byId.get(v.video_id)).ready);
}

/**
 * 날짜별 새벽기도 영상 찾기.
 * @param rows   Daily 탭 줄들 (date, dawn_json …)
 * @param dates  연결할 날짜들 (기본: 최근 7일)
 * @returns [{ date, dawn }]  새로 붙이거나 바꿀 것만 (직접 넣은 영상은 건드리지 않음)
 */
export async function findDawnUpdates({ rows, playlistId, apiKey, dates, force = false, fetchImpl = fetch, now = new Date(), log = () => {} }) {
  const want = dates && dates.length ? dates : Array.from({ length: 7 }, (_, i) => torontoDate(-i, now));
  const byDate = new Map((rows || []).map((r) => [r.date, r]));
  const current = (d) => {
    try {
      return JSON.parse(byDate.get(d)?.dawn_json || 'null');
    } catch {
      return null;
    }
  };
  const todo = want.filter((d) => {
    const cur = current(d);
    if (cur && cur.manual) return false; // 관리자가 직접 넣은 영상은 그대로
    return force || !cur || !cur.video_id;
  });
  if (!todo.length) {
    log(`🙏 새벽기도 영상: ${want[0]} 등 확인할 날이 모두 연결되어 있습니다.`);
    return [];
  }
  const all = await fetchDawnVideos(playlistId, apiKey, { fetchImpl });
  const cands = all.filter((v) => todo.includes(dawnDateOf(v.title, v.published))).slice(0, 40);
  const ready = await readyOnly(cands, apiKey, fetchImpl);
  const updates = [];
  for (const d of todo) {
    const v = ready.find((x) => dawnDateOf(x.title, x.published) === d); // 그 날 가장 나중에 올라온 영상
    const cur = current(d);
    if (!v) continue;
    if (cur && cur.video_id === v.video_id) continue;
    updates.push({ date: d, dawn: { video_id: v.video_id, title: v.title, published: v.published, manual: false, at: now.toISOString() } });
  }
  log(`🙏 새벽기도 영상: 재생목록 ${all.length}편 확인 → ${updates.length}일 연결 (${updates.map((u) => u.date).join(', ') || '새로 연결할 영상 없음'})`);
  return updates;
}
