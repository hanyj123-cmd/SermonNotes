// 추천 찬양의 유튜브 영상 찾기 + 기도 배경음악 목록 만들기 (YouTube Data API v3)
//   search.list 는 1회에 100 할당량 단위를 쓰므로(하루 기본 1만), 곡 검색은 필요한 만큼만 합니다.

const API = 'https://www.googleapis.com/youtube/v3';

export class QuotaError extends Error {}

async function api(path, params, apiKey, fetchImpl) {
  const res = await fetchImpl(`${API}/${path}?${new URLSearchParams({ ...params, key: apiKey })}`);
  if (!res.ok) {
    let body = '';
    try {
      body = await res.text();
    } catch {
      /* ignore */
    }
    if (res.status === 403 && /quota/i.test(body)) throw new QuotaError('YouTube API 하루 사용량(할당량)을 다 썼습니다');
    throw new Error(`YouTube API 오류 (${res.status})`);
  }
  return res.json();
}

/** ISO 8601 길이(PT1H2M3S) → 초 */
export function durationSeconds(iso) {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(String(iso || ''));
  if (!m) return 0;
  return (Number(m[1] || 0) * 86400) + (Number(m[2] || 0) * 3600) + (Number(m[3] || 0) * 60) + Number(m[4] || 0);
}

const decode = (s) =>
  String(s || '')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');

/** 검색 → [{ video_id, title, channel }] (퍼가기 허용 영상만) */
export async function searchVideos(query, apiKey, { maxResults = 5, longOnly = false, fetchImpl = fetch } = {}) {
  const params = { part: 'snippet', type: 'video', q: query, maxResults: String(maxResults), videoEmbeddable: 'true', safeSearch: 'strict', relevanceLanguage: 'ko' };
  if (longOnly) params.videoDuration = 'long'; // 20분 이상
  const data = await api('search', params, apiKey, fetchImpl);
  return (data.items || [])
    .map((it) => ({ video_id: it.id?.videoId, title: decode(it.snippet?.title), channel: decode(it.snippet?.channelTitle) }))
    .filter((v) => v.video_id);
}

/** 영상들의 길이·퍼가기 가능 여부 */
export async function fetchDetails(ids, apiKey, fetchImpl = fetch) {
  const out = new Map();
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const data = await api('videos', { part: 'contentDetails,status,snippet', id: chunk.join(',') }, apiKey, fetchImpl);
    for (const it of data.items || []) {
      out.set(it.id, {
        seconds: durationSeconds(it.contentDetails?.duration),
        embeddable: it.status?.embeddable !== false && it.status?.privacyStatus !== 'private',
        title: decode(it.snippet?.title),
        channel: decode(it.snippet?.channelTitle),
      });
    }
  }
  return out;
}

const norm = (s) => String(s || '').toLowerCase().replace(/[\s\-_·.,!?'"()[\]]/g, '');

/** 곡 하나에 어울리는 영상을 찾습니다. 못 찾으면 null */
export async function findSongVideo(song, apiKey, fetchImpl = fetch) {
  const who = song.artist && song.artist !== '찬송가' ? song.artist : '찬송가';
  const found = await searchVideos(`${song.title} ${who} 찬양`, apiKey, { maxResults: 5, fetchImpl });
  if (!found.length) return null;
  const key = norm(song.title);
  const best = found.find((v) => key && norm(v.title).includes(key)) || null;
  return best; // 제목이 곡명을 담은 영상만 연결합니다 (엉뚱한 영상을 붙이지 않기 위해)
}

/**
 * result.worship_songs 의 각 곡에 video_id / video_title 을 붙입니다 (찾은 것만).
 * 할당량을 다 쓰면 나머지 곡은 건너뜁니다. 실패해도 설교 정리 자체에는 영향을 주지 않습니다.
 */
export async function attachSongVideos(result, apiKey, { fetchImpl = fetch, log = () => {}, state = {} } = {}) {
  if (!apiKey || !Array.isArray(result.worship_songs)) return result;
  for (const song of result.worship_songs) {
    if (song.video_id || state.quotaExhausted) continue;
    try {
      const v = await findSongVideo(song, apiKey, fetchImpl);
      if (v) {
        song.video_id = v.video_id;
        song.video_title = v.title;
      }
    } catch (e) {
      if (e instanceof QuotaError) state.quotaExhausted = true;
      log(`찬양 영상 검색 실패 (${song.title}): ${e.message}`);
    }
  }
  return result;
}

export const PRAYER_QUERIES = [
  '기도 배경음악 피아노 워십',
  '기도할 때 듣는 찬양 연주 묵상 피아노',
  '찬송가 피아노 연주 기도 묵상',
  'prayer instrumental worship piano soaking',
];
const MIN_MINUTES = 20;
const MAX_TRACKS = 12;

/** 기도 배경음악으로 쓸 긴 영상 목록을 만듭니다: { updated, tracks: [{ id, title, channel, minutes }] } */
export async function buildPrayerMusic(apiKey, { fetchImpl = fetch, now = () => new Date().toISOString(), log = () => {} } = {}) {
  const seen = new Set();
  const candidates = [];
  for (const q of PRAYER_QUERIES) {
    try {
      const rows = await searchVideos(q, apiKey, { maxResults: 8, longOnly: true, fetchImpl });
      for (const r of rows) {
        if (seen.has(r.video_id)) continue;
        seen.add(r.video_id);
        candidates.push(r);
      }
    } catch (e) {
      log(`배경음악 검색 실패 (${q}): ${e.message}`);
      if (e instanceof QuotaError) break;
    }
  }
  if (!candidates.length) throw new Error('배경음악 후보를 찾지 못했습니다');
  const details = await fetchDetails(candidates.map((c) => c.video_id), apiKey, fetchImpl);
  const tracks = [];
  // 검색어마다 번갈아 가며 고르기 위해 원래 순서(검색어 순)를 유지합니다
  for (const c of candidates) {
    const d = details.get(c.video_id);
    if (!d || !d.embeddable || d.seconds < MIN_MINUTES * 60) continue;
    tracks.push({ id: c.video_id, title: d.title || c.title, channel: d.channel || c.channel, minutes: Math.round(d.seconds / 60) });
    if (tracks.length >= MAX_TRACKS) break;
  }
  if (!tracks.length) throw new Error('쓸 수 있는 배경음악 영상이 없습니다');
  return { updated: now(), tracks };
}

/** music.json 이 없거나 maxAgeDays 보다 오래됐으면 true */
export function musicIsStale(current, maxAgeDays = 30, now = Date.now()) {
  const t = Date.parse(current?.updated || '');
  if (!Number.isFinite(t) || !Array.isArray(current?.tracks) || !current.tracks.length) return true;
  return now - t > maxAgeDays * 86400000;
}
