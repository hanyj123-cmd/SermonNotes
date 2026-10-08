// YouTube 재생목록 조회(Data API v3) + 자막 수집
import { YoutubeTranscript } from 'youtube-transcript';

export function extractPlaylistId(input) {
  const s = String(input || '').trim();
  if (/^(PL|UU|OL|FL|LL)[\w-]{10,}$/.test(s)) return s;
  try {
    const u = new URL(s);
    const list = u.searchParams.get('list');
    if (list) return list;
  } catch {
    /* not a URL */
  }
  return null;
}

/** 재생목록의 영상 목록을 가져옵니다 (공개/일부공개 영상만). */
export async function fetchPlaylistVideos(playlistId, apiKey, maxVideos = 30) {
  const videos = [];
  let pageToken = '';
  while (videos.length < maxVideos) {
    const params = new URLSearchParams({
      part: 'snippet,contentDetails,status',
      playlistId,
      maxResults: String(Math.min(50, maxVideos - videos.length)),
      key: apiKey,
    });
    if (pageToken) params.set('pageToken', pageToken);
    const res = await fetch(`https://www.googleapis.com/youtube/v3/playlistItems?${params}`);
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`YouTube API 오류 (${res.status}): ${body.slice(0, 300)}`);
    }
    const data = await res.json();
    for (const item of data.items || []) {
      const id = item.contentDetails?.videoId;
      const title = item.snippet?.title;
      if (!id || !title) continue;
      if (title === 'Private video' || title === 'Deleted video') continue;
      if (item.status?.privacyStatus && item.status.privacyStatus === 'private') continue;
      videos.push({
        video_id: id,
        title,
        published_at: (item.contentDetails?.videoPublishedAt || item.snippet?.publishedAt || '').slice(0, 10),
        url: `https://www.youtube.com/watch?v=${id}`,
      });
    }
    pageToken = data.nextPageToken || '';
    if (!pageToken) break;
  }
  return videos;
}

function decodeEntities(s) {
  return s
    .replace(/&amp;#39;|&#39;/g, "'")
    .replace(/&amp;quot;|&quot;/g, '"')
    .replace(/&amp;amp;|&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

/** 자막 세그먼트를 읽기 좋은 텍스트로 정리합니다. */
export function cleanTranscript(segments) {
  const text = segments
    .map((s) => decodeEntities(String(s.text || '')))
    .join(' ')
    .replace(/\[(음악|박수|웃음|Music|Applause|Laughter)\]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text;
}

/** 한국어 자막을 우선으로 가져옵니다. 실패하면 null과 사유를 돌려줍니다. */
export async function fetchTranscript(videoId) {
  const attempts = [{ lang: 'ko' }, {}];
  let lastErr = '';
  for (const opts of attempts) {
    try {
      const segments = await YoutubeTranscript.fetchTranscript(videoId, opts);
      const text = cleanTranscript(segments);
      if (text.length > 200) return { text, error: '' };
      lastErr = '자막이 너무 짧습니다';
    } catch (e) {
      lastErr = String(e?.message || e).slice(0, 200);
    }
  }
  return { text: '', error: lastErr || '자막을 가져오지 못했습니다' };
}
