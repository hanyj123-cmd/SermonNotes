// 오늘의 말씀 읽기: 토론토영락교회 앱(ynchurch.com/yn-app/#/bible)의 날짜별 성경 읽기 분량을 가져옵니다.
// 교회 서버에 날짜(YYYYMMDD)와 역본을 보내면 그날 읽을 장들의 본문이 절 단위로 옵니다. (교회 앱이 쓰는 것과 같은 요청)
// 이 파일은 본문 가져오기 · 공동체 성경읽기 영상 찾기 · 날짜 계산만 맡습니다. AI 정리는 sync.mjs 의 syncDaily 가 합니다.
import { searchVideos, QuotaError } from './media.mjs';

export const YN_BIBLE_API = 'https://ynchurch.com/ync/web/getBibleVerses/';
// 화면에서 고를 수 있는 역본 (교회 서버의 코드)
export const READ_VERSIONS = [
  { id: 'KNKRV', label: '개역개정' },
  { id: 'NIV', label: 'NIV' },
  { id: 'KSTNR', label: '표준새번역' },
];
export const DAILY_TIME_ZONE = 'America/Toronto';

/** 2026-10-08 → bible-20261008 (게임·개인 노트에서 쓰는 ID) */
export const dailyId = (date) => `bible-${String(date).replace(/-/g, '')}`;
export const isDailyDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));

/** 토론토 기준 오늘 날짜 (YYYY-MM-DD), offsetDays 만큼 더하거나 빼서 */
export function torontoDate(offsetDays = 0, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: DAILY_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const base = Date.UTC(Number(parts.slice(0, 4)), Number(parts.slice(5, 7)) - 1, Number(parts.slice(8, 10)));
  return new Date(base + offsetDays * 86400000).toISOString().slice(0, 10);
}

const cleanVerse = (t) => String(t || '').replace(/\s+/g, ' ').trim();

/** 교회 서버 응답 → [{ bookId, book, chapter, verses: [{ n, text }] }] */
export function parseYnResponse(data) {
  const out = [];
  for (const b of (data && data.bibleVerses) || []) {
    for (const c of b.chapters || []) {
      const verses = (c.verses || []).map((v) => ({ n: Number(v.verseNo), text: cleanVerse(v.verse) })).filter((v) => v.n > 0 && v.text);
      if (verses.length) out.push({ bookId: String(b.bookID || '').padStart(2, '0'), book: String(b.bookName || '').trim(), chapter: Number(c.chapterNo), verses });
    }
  }
  return out;
}

/** 그날 읽을 분량과 본문. 본문이 아직 없는 날(예: 내년)은 빈 배열 */
export async function fetchDailyReading(date, version = 'KNKRV', { fetchImpl = fetch, timeoutMs = 25_000 } = {}) {
  if (!isDailyDate(date)) throw new Error(`날짜 형식이 올바르지 않습니다: ${date}`);
  const body = JSON.stringify({ accessLevel: 'PUBLIC', forTodayVerses: false, readingDate: date.replace(/-/g, ''), queryList: [{}], languageCode: 'KR', version });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(YN_BIBLE_API, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body, signal: ctrl.signal });
    if (!res.ok) throw new Error(`교회 성경 서버 응답 오류 (${res.status})`);
    return parseYnResponse(await res.json());
  } finally {
    clearTimeout(timer);
  }
}

/** "열왕기상 11장 · 마가복음 10장" (같은 책의 연속된 장은 "11-12장"으로) */
export function readingRefs(passages) {
  const groups = [];
  for (const p of passages || []) {
    const last = groups[groups.length - 1];
    if (last && last.book === p.book && last.to + 1 === p.chapter) last.to = p.chapter;
    else groups.push({ book: p.book, from: p.chapter, to: p.chapter });
  }
  return groups.map((g) => (g.from === g.to ? `${g.book} ${g.from}장` : `${g.book} ${g.from}-${g.to}장`)).join(' · ');
}

/** AI 에게 줄 본문: "[열왕기상 11장]\n1 솔로몬 왕이 …" */
export function passagesText(passages) {
  return (passages || []).map((p) => `[${p.book} ${p.chapter}장]\n${p.verses.map((v) => `${v.n} ${v.text}`).join('\n')}`).join('\n\n');
}

/* ---------- 공동체 성경읽기 영상 ---------- */
const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, '');
/** 제목이 그 책·장을 가리키면 점수 (공동체성경읽기 영상이면 더 높게). 다른 장 번호만 있으면 0 */
export function scoreReadingTitle(title, book, chapter) {
  const t = norm(title);
  if (!t.includes(norm(book))) return 0;
  const after = t.slice(t.indexOf(norm(book)) + norm(book).length);
  const m = after.match(/^(\d{1,3})(?:[-~](\d{1,3}))?/) || t.match(new RegExp(`${norm(book)}[^\\d]{0,3}(\\d{1,3})(?:[-~](\\d{1,3}))?`));
  if (!m) return 0;
  const from = Number(m[1]);
  const to = m[2] ? Number(m[2]) : from;
  if (chapter < from || chapter > to) return 0;
  let score = 1;
  if (from === chapter && to === chapter) score += 1;
  if (t.includes('공동체성경읽기') || t.includes('공동체성경')) score += 3;
  if (t.includes('드라마바이블')) score += 1;
  return score;
}

/** 각 장마다 공동체 성경읽기 영상 하나를 찾습니다 (못 찾으면 빼고). YouTube 할당량이 바닥나면 멈춥니다. */
export async function findReadingVideos(passages, apiKey, { fetchImpl = fetch, log = () => {} } = {}) {
  const out = [];
  if (!apiKey) return out;
  for (const p of passages || []) {
    const reference = `${p.book} ${p.chapter}장`;
    try {
      let best = null;
      for (const q of [`공동체성경읽기 ${p.book} ${p.chapter}장`, `${p.book} ${p.chapter}장 성경읽기 드라마바이블`]) {
        const found = await searchVideos(q, apiKey, { maxResults: 8, fetchImpl });
        const ranked = found.map((v) => ({ v, s: scoreReadingTitle(v.title, p.book, p.chapter) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s);
        if (ranked.length) best = best && best.s >= ranked[0].s ? best : ranked[0];
        if (best && best.s >= 4) break; // 공동체성경읽기 영상을 찾았으면 더 찾지 않습니다
      }
      if (best) out.push({ reference, book: p.book, chapter: p.chapter, video_id: best.v.video_id, title: best.v.title, channel: best.v.channel });
    } catch (e) {
      log(`공동체 성경읽기 영상 검색 실패 (${reference}): ${e.message}`);
      if (e instanceof QuotaError) break;
    }
  }
  return out;
}

/* ---------- 하루치 만들기 (본문 → AI 4가지 → 영상) ---------- */
const parseJson = (s) => {
  try {
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
};
export const DAILY_CELL_LIMIT = 49_000;

/**
 * 하루치를 만들거나(처음) 빠진 부분만 채웁니다(이전에 일부 실패).
 * @returns Daily 탭에 쓸 한 줄 객체, 또는 null (교회 앱에 그날 본문이 아직 없을 때)
 */
export async function buildDailyDay(date, existing, { ai, modes = ['qt', 'study', 'group', 'quiz'], fetchReading = fetchDailyReading, findVideos = null, now = () => new Date().toISOString(), log = () => {} }) {
  const prev = existing || {};
  let passages = parseJson(prev.passages_json);
  if (!Array.isArray(passages) || !passages.length) passages = await fetchReading(date, 'KNKRV');
  if (!passages.length) return null;
  const refs = readingRefs(passages);
  const text = passagesText(passages);
  const cols = { qt: 'qt_json', study: 'study_json', group: 'group_json', quiz: 'quiz_json' };
  const results = Object.fromEntries(modes.map((m) => [m, parseJson(prev[cols[m]])]));
  const failures = [];
  for (const mode of modes) {
    if (results[mode]) continue;
    log(`   ▷ ${date} ${mode} 만드는 중…`);
    try {
      results[mode] = await ai.generateDaily(mode, { date, refs, text });
    } catch (e) {
      failures.push(`${mode}: ${String(e.message || e).slice(0, 120)}`);
      log(`   ❌ ${date} ${mode} 실패: ${e.message}`);
    }
  }
  let videos = parseJson(prev.videos_json);
  if ((!Array.isArray(videos) || !videos.length) && findVideos) {
    try {
      videos = await findVideos(passages);
    } catch (e) {
      log(`   공동체 성경읽기 영상을 찾지 못했습니다: ${e.message}`);
    }
  }
  const row = { date, refs, status: failures.length ? 'error' : 'done', updated_at: now(), note: failures.join(' / ').slice(0, 500) };
  const put = (col, value) => {
    const j = value == null ? '' : JSON.stringify(value);
    if (j.length > DAILY_CELL_LIMIT) {
      row.status = 'error';
      row.note = `${row.note} ${col} 이(가) 너무 깁니다`.trim();
    } else row[col] = j;
  };
  put('passages_json', passages);
  for (const m of modes) put(cols[m], results[m]);
  put('videos_json', Array.isArray(videos) ? videos : []);
  return row;
}

/** 시트 한 줄 → 화면용 JSON */
export function dailyExport(row) {
  const qt = parseJson(row.qt_json);
  return {
    id: dailyId(row.date),
    date: row.date,
    refs: row.refs,
    complete: row.status === 'done',
    passages: parseJson(row.passages_json) || [],
    key_verse: qt?.key_verse || null,
    summaries: qt?.summaries || [],
    qt,
    study: parseJson(row.study_json),
    group: parseJson(row.group_json),
    quiz: parseJson(row.quiz_json),
    videos: parseJson(row.videos_json) || [],
  };
}
