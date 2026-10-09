// 공동체 성경읽기 영상 색인: CGN 의 "하루 20분 공동체성경읽기" 재생목록들을 한 번 훑어서
// 성경 각 장 → 그 장을 읽어 주는 유튜브 영상 하나를 docs/data/reading-videos.json 에 저장합니다.
//   · 검색(search.list)은 1회 100 할당량이라 매일 장마다 검색하면 금방 바닥나고 결과도 들쭉날쭉합니다.
//   · 재생목록 읽기(playlistItems)는 50개에 1 할당량이라, 1년 분량(365편)을 다 읽어도 10 남짓입니다.
// 색인은 30일마다 새로 만들고, 화면도 이 파일을 직접 읽어 영상이 없는 날을 채웁니다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const API = 'https://www.googleapis.com/youtube/v3';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const READING_INDEX_PATH = path.resolve(__dirname, '../../docs/data/reading-videos.json');
export const READING_INDEX_MAX_AGE_DAYS = 30;
export const READING_QUERY = '하루 20분 공동체성경읽기';

/** 66권 [번호, 이름] — 화면(docs/game-data.js)과 같은 목록을 씁니다 */
export function bibleBookNames() {
  const src = fs.readFileSync(path.resolve(__dirname, '../../docs/game-data.js'), 'utf8');
  return [...src.matchAll(/\['(\d{2})', '([^']+)', (\d+), '[^']*'\]/g)].map((m) => ({ id: Number(m[1]), name: m[2], chapters: Number(m[3]) }));
}

const squash = (s) => String(s || '').replace(/\s+/g, '');

/**
 * 영상 제목에서 읽는 범위를 찾습니다.
 * "[하루 20분 공동체성경읽기] 4/20 열왕기상 11-12장" → [{ id: 11, from: 11, to: 12 }]
 * "마가복음 7장-9장", "시편 50편", "열왕기상 22장-열왕기하 1장"(앞 책만) 도 읽습니다.
 */
export function parseReadingTitle(title, books = bibleBookNames()) {
  let t = squash(title).replace(/^\[[^\]]*\]/, ''); // 머리 [하루 20분 …] 은 빼고
  t = t.replace(/\d{1,2}\/\d{1,2}/g, ' '); // 날짜 4/20
  const out = [];
  const sorted = [...books].sort((a, b) => b.name.length - a.name.length); // 예레미야애가가 예레미야보다 먼저
  for (const b of sorted) {
    const re = new RegExp(`${b.name}(\\d{1,3})(?:장|편)?(?:[-~](?:${b.name})?(\\d{1,3})(?:장|편)?)?`, 'g');
    let m;
    while ((m = re.exec(t))) {
      const from = Number(m[1]);
      const to = m[2] ? Number(m[2]) : from;
      if (from >= 1 && to >= from && to <= b.chapters) out.push({ id: b.id, from, to });
      t = t.slice(0, m.index) + '#'.repeat(m[0].length) + t.slice(m.index + m[0].length); // 짧은 책 이름이 다시 잡지 않게
      re.lastIndex = m.index + m[0].length;
    }
  }
  return out;
}

async function api(endpoint, params, apiKey, fetchImpl) {
  const res = await fetchImpl(`${API}/${endpoint}?${new URLSearchParams({ ...params, key: apiKey })}`);
  if (!res.ok) throw new Error(`YouTube API 오류 (${res.status}) ${(await res.text().catch(() => '')).slice(0, 200)}`);
  return res.json();
}

/** 재생목록 찾기 → 영상 제목 읽기 → 장별 색인 */
export async function buildReadingIndex(apiKey, { fetchImpl = fetch, log = () => {}, books = bibleBookNames(), maxPlaylists = 6, maxPerPlaylist = 450, now = () => new Date().toISOString() } = {}) {
  const found = await api('search', { part: 'snippet', type: 'playlist', q: READING_QUERY, maxResults: '20', relevanceLanguage: 'ko' }, apiKey, fetchImpl);
  const year = (t) => Number((/(20\d\d)/.exec(t) || [])[1] || 0);
  const playlists = (found.items || [])
    .map((it) => ({ id: it.id?.playlistId, title: String(it.snippet?.title || ''), channel: String(it.snippet?.channelTitle || '') }))
    .filter((p) => p.id && squash(p.title).includes('공동체성경읽기'))
    .sort((a, b) => (b.channel === 'CGN') - (a.channel === 'CGN') || year(b.title) - year(a.title))
    .slice(0, maxPlaylists);
  const map = {};
  const span = (e) => e.to - e.from;
  for (const p of playlists) {
    let pageToken = '';
    let seen = 0;
    do {
      const data = await api('playlistItems', { part: 'snippet,status', playlistId: p.id, maxResults: '50', ...(pageToken ? { pageToken } : {}) }, apiKey, fetchImpl);
      for (const it of data.items || []) {
        const vid = it.snippet?.resourceId?.videoId;
        const title = String(it.snippet?.title || '');
        if (!vid || /^(Private|Deleted) video$/.test(title) || it.status?.privacyStatus === 'private') continue;
        for (const r of parseReadingTitle(title, books)) {
          for (let ch = r.from; ch <= r.to; ch++) {
            const key = `${r.id}:${ch}`;
            const entry = { video_id: vid, title, from: r.from, to: r.to };
            if (!map[key] || span(entry) < span(map[key])) map[key] = entry; // 범위가 좁은(그 장에 더 가까운) 영상을 고릅니다
          }
        }
      }
      seen += (data.items || []).length;
      pageToken = data.nextPageToken || '';
    } while (pageToken && seen < maxPerPlaylist);
    log(`   공동체 성경읽기 재생목록 "${p.title}" ${seen}편 확인`);
  }
  return { updated: now(), query: READING_QUERY, playlists: playlists.map((p) => ({ id: p.id, title: p.title, channel: p.channel })), count: Object.keys(map).length, map };
}

export function readReadingIndex(file = READING_INDEX_PATH) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}
export function readingIndexIsStale(idx, nowMs = Date.now()) {
  if (!idx || !idx.map || (idx.count || 0) < 300) return true;
  return nowMs - Date.parse(idx.updated || 0) > READING_INDEX_MAX_AGE_DAYS * 86400000;
}

/** 색인이 없거나 오래됐으면 새로 만들어 저장. 실패하면 있던 색인(없으면 null)을 그대로 씁니다 */
export async function ensureReadingIndex(apiKey, { file = READING_INDEX_PATH, log = () => {}, fetchImpl = fetch } = {}) {
  const current = readReadingIndex(file);
  if (!apiKey || !readingIndexIsStale(current)) return current;
  try {
    const idx = await buildReadingIndex(apiKey, { log, fetchImpl });
    if (idx.count >= (current?.count || 1)) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(idx) + '\n', 'utf8');
      log(`🎧 공동체 성경읽기 색인: ${idx.count}장 (${idx.playlists.length}개 재생목록)`);
      return idx;
    }
    log(`⚠️  공동체 성경읽기 색인이 전보다 작아서(${idx.count}장) 이전 색인을 씁니다.`);
  } catch (e) {
    log(`⚠️  공동체 성경읽기 색인을 만들지 못했습니다: ${e.message}`);
  }
  return current;
}
