// 새 양식(결과 v2), 성경 3역본, 찬양 영상·기도 배경음악, 선택 정리 흐름 점검: npm test
import assert from 'node:assert/strict';
import { normalizeResult } from './lib/gemini.mjs';
import { normalizePassages, toUsfm } from './lib/bible-books.mjs';
import { SYSTEM_PROMPT, buildUserMessage, dotDate, APPLICATION_COUNT, MEDITATION_COUNT } from './lib/prompt.mjs';
import { fetchBibleBlock, attachBible, listBibles, parseBibleVersions, cleanVerseText, needsBible } from './lib/bible.mjs';
import { attachSongVideos, findSongVideo, buildPrayerMusic, durationSeconds, musicIsStale, QuotaError } from './lib/media.mjs';
import { buildQueue } from './lib/queue.mjs';
import { processRow } from './lib/process.mjs';

let passed = 0;
const t = async (name, fn) => {
  await fn();
  passed++;
  console.log('✓', name);
};
const jres = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body, text: async () => JSON.stringify(body) });

// ---------- 프롬프트 / 결과 v2 ----------
await t('프롬프트: 사용자 양식의 핵심 항목이 모두 들어 있음', () => {
  for (const kw of ['개역개정', '표준새번역', '구속사', '3개의 주요 대지', '강조 박스', '복음과의 연결', '마음 열기', '기도와 결단', '추천 찬양', 'passages', 'worship_songs', 'key_summary']) {
    assert.ok(SYSTEM_PROMPT.includes(kw), `누락: ${kw}`);
  }
  assert.ok(SYSTEM_PROMPT.includes(`applications는 ${APPLICATION_COUNT}개`) && SYSTEM_PROMPT.includes(`meditation_questions는 ${MEDITATION_COUNT}개`));
  assert.ok(!SYSTEM_PROMPT.includes('undefined'));
});
await t('프롬프트: 제목 앞부분을 [YYYY.MM.DD] 예배이름 으로 만들어 전달', () => {
  assert.equal(dotDate('2026-10-01'), '2026.10.01');
  assert.match(buildUserMessage({ category: 'dawn', title: 'T', publishedAt: '2026-10-01', transcript: 'x' }), /\[제목 앞부분\] \[2026\.10\.01\] 새벽기도회/);
  assert.match(buildUserMessage({ category: 'sunday', title: 'T', publishedAt: '', transcript: 'x' }), /\[제목 앞부분\] 주일예배/);
});
const raw = () => ({
  title: '[2026.10.01] 새벽기도회 (열왕기상 4, 5장) - 윤정환 목사',
  scripture: ['열왕기상 4:20-34'],
  passages: [{ book: '1KI', chapter: 4, verse_from: 20, verse_to: 34 }, { book: 'xx', chapter: 1 }, { book: '1KI', chapter: 5, verse_from: null, verse_to: null }],
  outline: [{ heading: '대지1', scripture: '4:20', paragraphs: ['단락1', '단락2', '', '단락3'], key_summary: '핵심' }],
  gospel_connection: '복음',
  applications: [{ title: 'a', detail: 'b' }],
  meditation_questions: ['q1', '', 'q2'],
  small_group: { icebreaker: 'i', observation: ['o'], reflection: [], application: ['a'], prayer: ['p'] },
  worship_songs: [{ title: '주 은혜임을', artist: '찬송가', kind: '찬송가', reason: '이유' }, { title: '' }, { title: 'X'.repeat(300), artist: 'A', kind: 'CCM', reason: 'r' }],
});
await t('결과 v2: 새 항목 정규화 (제목·본문범위·단락·강조박스·찬양)', () => {
  const r = normalizeResult(raw());
  assert.equal(r.schema, 2);
  assert.match(r.title, /새벽기도회/);
  assert.deepEqual(r.passages, [{ book: '1KI', chapter: 4, verse_from: 20, verse_to: 34 }, { book: '1KI', chapter: 5, verse_from: null, verse_to: null }]);
  assert.deepEqual(r.outline[0].paragraphs, ['단락1', '단락2', '단락3']);
  assert.equal(r.outline[0].content, '단락1\n\n단락2\n\n단락3');
  assert.equal(r.outline[0].key_summary, '핵심');
  assert.deepEqual(r.meditation_questions, ['q1', 'q2']);
  assert.equal(r.worship_songs.length, 2);
  assert.equal(r.worship_songs[1].title.length, 100);
});
await t('결과 v2: 옛 형식(content/key_quote)도 받아 줌', () => {
  const r = normalizeResult({ outline: [{ heading: 'h', content: '가\n\n나', key_quote: '인용' }], applications: [{ title: 'a', detail: 'b' }], small_group: { application: ['x'] } });
  assert.deepEqual(r.outline[0].paragraphs, ['가', '나']);
  assert.equal(r.outline[0].key_summary, '인용');
  assert.deepEqual(r.passages, []);
  assert.deepEqual(r.worship_songs, []);
});
await t('본문 범위: 잘못된 책 코드·장·절·역순 범위는 버리고 3개까지만', () => {
  assert.deepEqual(normalizePassages([{ book: 'jhn', chapter: 3, verse_from: 16, verse_to: 16 }]), [{ book: 'JHN', chapter: 3, verse_from: 16, verse_to: 16 }]);
  assert.deepEqual(normalizePassages([{ book: 'JHN', chapter: 0 }, { book: 'JHN', chapter: 3, verse_from: 5, verse_to: 2 }, { book: 'JHN', chapter: 999 }, null, 'x']), []);
  assert.equal(normalizePassages(Array.from({ length: 6 }, () => ({ book: 'PSA', chapter: 23 }))).length, 3);
  assert.equal(normalizePassages('x').length, 0);
});
await t('USFM 변환: 절 범위 / 한 절 / 장 전체', () => {
  assert.equal(toUsfm({ book: '1KI', chapter: 10, verse_from: 1, verse_to: 10 }), '1KI.10.1-10');
  assert.equal(toUsfm({ book: 'JHN', chapter: 3, verse_from: 16, verse_to: 16 }), 'JHN.3.16');
  assert.equal(toUsfm({ book: 'PSA', chapter: 23, verse_from: null, verse_to: null }), 'PSA.23');
});

// ---------- 성경 본문 ----------
const PASSAGES = [{ book: '1KI', chapter: 10, verse_from: 1, verse_to: 10 }];
function bibleFetch({ failIds = [], longText = false } = {}) {
  const calls = [];
  const fn = async (url, opts) => {
    calls.push({ url: String(url), headers: opts?.headers });
    const u = new URL(url);
    const m = /\/v1\/bibles\/(\d+)(?:\/passages\/(.+))?$/.exec(u.pathname);
    if (failIds.includes(m[1])) return jres(403, {});
    if (m[2]) return jres(200, { reference: `ref-${m[1]}`, content: longText ? 'v'.repeat(5000) + ' ' + 'w'.repeat(5000) : `<p>1 본문 ${m[1]}</p>\n\n\n<p>2 둘째&nbsp;절</p>` });
    return jres(200, { abbreviation: `AB${m[1]}`, copyright: `© ${m[1]}` });
  };
  fn.calls = calls;
  return fn;
}
await t('성경: 역본별로 가져와 저작권·역본 이름과 함께 묶음', async () => {
  const f = bibleFetch();
  const b = await fetchBibleBlock(PASSAGES, [{ id: '88', label: '개역한글' }, { id: '142', label: '새번역' }, { id: '111', label: 'NIV' }], 'KEY', { fetchImpl: f, now: () => 'NOW' });
  assert.deepEqual(b.versions.map((v) => v.label), ['개역한글', '새번역', 'NIV']);
  assert.equal(b.signature, '88,142,111');
  assert.equal(b.versions[0].copyright, '© 88');
  assert.equal(b.versions[0].passages[0].text, '1 본문 88\n\n2 둘째 절');
  const first = f.calls[0];
  assert.equal(new URL(first.url).pathname, '/v1/bibles/88/passages/1KI.10.1-10');
  assert.equal(new URL(first.url).searchParams.get('format'), 'text');
  assert.equal(first.headers['X-YVP-App-Key'], 'KEY');
});
await t('성경: 한 역본이 실패해도 나머지는 보여 줌, 모두 실패하면 null', async () => {
  const logs = [];
  const b = await fetchBibleBlock(PASSAGES, [{ id: '88', label: 'A' }, { id: '142', label: 'B' }], 'K', { fetchImpl: bibleFetch({ failIds: ['88'] }), log: (m) => logs.push(m) });
  assert.deepEqual(b.versions.map((v) => v.label), ['B']);
  assert.match(logs[0], /성경 본문 실패 \(A\)/);
  assert.equal(await fetchBibleBlock(PASSAGES, [{ id: '88', label: 'A' }], 'K', { fetchImpl: bibleFetch({ failIds: ['88'] }), log: () => {} }), null);
});
await t('성경: 키·역본·본문범위가 없으면 아무것도 하지 않음 (오류 아님)', async () => {
  const f = bibleFetch();
  assert.equal(await fetchBibleBlock(PASSAGES, [], 'K', { fetchImpl: f }), null);
  assert.equal(await fetchBibleBlock(PASSAGES, [{ id: '1', label: 'x' }], '', { fetchImpl: f }), null);
  assert.equal(await fetchBibleBlock([], [{ id: '1', label: 'x' }], 'K', { fetchImpl: f }), null);
  assert.equal(f.calls.length, 0);
  const r = { passages: [] };
  await attachBible(r, [{ id: '1', label: 'x' }], 'K', { fetchImpl: f });
  assert.equal(r.bible, undefined);
});
await t('성경: 너무 긴 본문은 잘라서 표시 (truncated)', async () => {
  const b = await fetchBibleBlock(PASSAGES, [{ id: '88', label: 'A' }], 'K', { fetchImpl: bibleFetch({ longText: true }) });
  const v = b.versions[0];
  assert.equal(v.truncated, true);
  assert.ok(v.passages.map((p) => p.text).join('').length <= 6100);
});
await t('성경: 역본 설정 검사(최대 3개, 숫자 ID만, 중복 제거) / 설정이 바뀌면 다시 가져옴', () => {
  assert.deepEqual(parseBibleVersions('[{"id":"88","label":"개역한글"},{"id":"88","label":"중복"},{"id":"abc","label":"x"},{"id":"142","label":"새번역"},{"id":"1","label":"a"},{"id":"2","label":"b"}]'), [{ id: '88', label: '개역한글' }, { id: '142', label: '새번역' }, { id: '1', label: 'a' }]);
  assert.deepEqual(parseBibleVersions('깨진 JSON'), []);
  assert.deepEqual(parseBibleVersions(''), []);
  const v = [{ id: '88', label: 'a' }];
  assert.equal(needsBible({ passages: [{}], bible: { signature: '88' } }, v), false);
  assert.equal(needsBible({ passages: [{}], bible: { signature: '1' } }, v), true);
  assert.equal(needsBible({ passages: [{}] }, v), true);
  assert.equal(needsBible({ passages: [] }, v), false);
  assert.equal(needsBible({ passages: [{}] }, []), false);
});
await t('성경 역본 목록: 한국어는 전부, 영어는 대표 역본만 / 다음 페이지 처리', async () => {
  const urls = [];
  const f = async (url) => {
    urls.push(String(url));
    const u = new URL(url);
    const lang = u.searchParams.get('language_ranges[]');
    if (lang === 'ko' && !u.searchParams.get('page_token')) return jres(200, { data: [{ id: 88, abbreviation: 'KRV', localized_title: '개역한글' }], next_page_token: 'p2' });
    if (lang === 'ko') return jres(200, { data: [{ id: 142, abbreviation: 'RNKSV', title: '새번역' }] });
    return jres(200, { data: [{ id: 111, abbreviation: 'NIV', title: 'New International Version' }, { id: 5, abbreviation: 'XYZ', title: 'Other' }] });
  };
  const list = await listBibles('K', { fetchImpl: f });
  assert.deepEqual(list.map((b) => `${b.id}:${b.abbreviation}:${b.language}`), ['88:KRV:ko', '142:RNKSV:ko', '111:NIV:en']);
  assert.ok(urls[0].includes('language_ranges%5B%5D=ko'));
});
await t('성경 API 오류 안내 (401 / 404 / 429)', async () => {
  for (const [code, re] of [[401, /키가 올바르지/], [404, /찾을 수 없습니다/], [429, /너무 많습니다/]]) {
    await assert.rejects(listBibles('K', { fetchImpl: async () => jres(code, {}) }), re);
  }
});
await t('본문 정리: HTML 조각·공백 정리', () => assert.equal(cleanVerseText('<b>1</b>  가&nbsp;나 \n\n\n\n 다'), '1 가 나\n\n다'));

// ---------- 찬양 영상 / 기도 배경음악 ----------
function ytFetch(handler) {
  const calls = [];
  const f = async (url) => {
    const u = new URL(url);
    calls.push(u);
    return handler(u);
  };
  f.calls = calls;
  return f;
}
const searchItem = (id, title, channel = 'ch') => ({ id: { videoId: id }, snippet: { title, channelTitle: channel } });
await t('찬양 영상: 제목에 곡명이 있는 영상만 연결, 퍼가기 허용 영상으로 검색', async () => {
  const f = ytFetch(() => jres(200, { items: [searchItem('a1', '전혀 다른 노래'), searchItem('b2', '주 은혜임을 (Live) - 마커스')] }));
  const v = await findSongVideo({ title: '주 은혜임을', artist: '마커스워십' }, 'KEY', f);
  assert.equal(v.video_id, 'b2');
  const u = f.calls[0];
  assert.equal(u.pathname, '/youtube/v3/search');
  assert.equal(u.searchParams.get('videoEmbeddable'), 'true');
  assert.equal(u.searchParams.get('q'), '주 은혜임을 마커스워십 찬양');
  assert.equal(u.searchParams.get('key'), 'KEY');
  const none = await findSongVideo({ title: '없는 곡', artist: '찬송가' }, 'K', ytFetch(() => jres(200, { items: [searchItem('z', '엉뚱한 영상')] })));
  assert.equal(none, null);
});
await t('찬양 영상: 곡마다 video_id 붙임 / 못 찾아도 정리는 유지', async () => {
  const r = { worship_songs: [{ title: '곡A', artist: 'X' }, { title: '곡B', artist: 'Y' }] };
  const f = ytFetch((u) => (u.searchParams.get('q').startsWith('곡A') ? jres(200, { items: [searchItem('A1', '곡A 찬양')] }) : jres(200, { items: [] })));
  await attachSongVideos(r, 'K', { fetchImpl: f });
  assert.equal(r.worship_songs[0].video_id, 'A1');
  assert.equal(r.worship_songs[1].video_id, undefined);
  const r2 = { worship_songs: [{ title: 'Q' }] };
  await attachSongVideos(r2, '', { fetchImpl: f });
  assert.equal(r2.worship_songs[0].video_id, undefined);
});
await t('찬양 영상: 하루 사용량(할당량) 초과 시 나머지 곡 검색을 멈춤', async () => {
  const f = ytFetch(() => jres(403, { error: { errors: [{ reason: 'quotaExceeded' }] } }));
  const state = {};
  const r = { worship_songs: [{ title: 'A' }, { title: 'B' }, { title: 'C' }] };
  const logs = [];
  await attachSongVideos(r, 'K', { fetchImpl: f, state, log: (m) => logs.push(m) });
  assert.equal(f.calls.length, 1);
  assert.equal(state.quotaExhausted, true);
  assert.ok(new QuotaError('x') instanceof Error);
});
await t('영상 길이 계산', () => {
  assert.equal(durationSeconds('PT1H2M3S'), 3723);
  assert.equal(durationSeconds('PT45M'), 2700);
  assert.equal(durationSeconds('P0D'), 0);
  assert.equal(durationSeconds('이상한'), 0);
});
await t('기도 배경음악: 긴 영상 + 퍼가기 허용만, 중복 제거, 12곡까지', async () => {
  const f = ytFetch((u) => {
    if (u.pathname.endsWith('/search')) {
      const q = u.searchParams.get('q');
      assert.equal(u.searchParams.get('videoDuration'), 'long');
      const base = q.startsWith('기도 배경') ? 0 : 10;
      return jres(200, { items: Array.from({ length: 8 }, (_, i) => searchItem(`v${base + i}`, `제목 ${base + i}`)) });
    }
    const ids = u.searchParams.get('id').split(',');
    return jres(200, { items: ids.map((id) => ({ id, snippet: { title: `제목 ${id}`, channelTitle: 'ch' }, contentDetails: { duration: id === 'v1' ? 'PT5M' : 'PT1H5M' }, status: { embeddable: id !== 'v2' } })) });
  });
  const m = await buildPrayerMusic('K', { fetchImpl: f, now: () => 'NOW' });
  assert.equal(m.updated, 'NOW');
  assert.ok(m.tracks.length <= 12 && m.tracks.length >= 8);
  assert.ok(!m.tracks.some((x) => x.id === 'v1'), '짧은 영상 제외');
  assert.ok(!m.tracks.some((x) => x.id === 'v2'), '퍼가기 불가 제외');
  assert.equal(new Set(m.tracks.map((x) => x.id)).size, m.tracks.length);
  assert.equal(m.tracks[0].minutes, 65);
});
await t('기도 배경음악: 검색이 전부 실패하면 오류 (기존 목록을 덮어쓰지 않도록)', async () => {
  await assert.rejects(buildPrayerMusic('K', { fetchImpl: ytFetch(() => jres(500, {})), log: () => {} }), /후보를 찾지 못/);
});
await t('배경음악 목록 갱신 주기 (30일)', () => {
  const now = Date.parse('2026-10-08T00:00:00Z');
  assert.equal(musicIsStale(null, 30, now), true);
  assert.equal(musicIsStale({ updated: '2026-10-01T00:00:00Z', tracks: [] }, 30, now), true);
  assert.equal(musicIsStale({ updated: '2026-10-01T00:00:00Z', tracks: [{}] }, 30, now), false);
  assert.equal(musicIsStale({ updated: '2026-08-01T00:00:00Z', tracks: [{}] }, 30, now), true);
});

// ---------- 정리 흐름: 부가 정보 / 선택 정리 ----------
await t('정리 흐름: 찬양·성경 부가 정보가 결과에 붙어 저장됨, 부가 정보가 실패해도 정리는 done', async () => {
  const mk = (enrich) => {
    const updates = [];
    return {
      updates,
      deps: { ai: { model: 'm', summarize: async () => normalizeResult(raw()) }, update: async (p) => updates.push(p), obtain: async () => ({ kind: 'text', text: 'x'.repeat(300), source: 'S' }), now: () => 'N', log: { info() {}, warn() {}, error() {} }, enrich },
    };
  };
  const row = { video_id: 'V1234567890', category: 'dawn', title: 't', published_at: '2026-10-01' };
  const ok = mk(async (r) => { r.bible = { signature: '1' }; r.worship_songs[0].video_id = 'abc'; });
  assert.equal(await processRow({ ...row }, ok.deps), 'done');
  const saved = JSON.parse(ok.updates[0].result_json);
  assert.equal(saved.bible.signature, '1');
  assert.equal(saved.worship_songs[0].video_id, 'abc');
  const bad = mk(async () => { throw new Error('API 장애'); });
  assert.equal(await processRow({ ...row }, bad.deps), 'done');
  assert.equal(bad.updates[0].status, 'done');
});
await t('선택 정리: listed/skip 은 자동 처리 대상이 아니고, redo 로 바꾸면 처리됨', () => {
  const today = new Date('2026-10-08T12:00:00Z');
  const rows = [
    { video_id: 'a', status: 'listed', published_at: '2026-01-01' },
    { video_id: 'b', status: 'skip', published_at: '2026-10-07' },
    { video_id: 'c', status: 'pending', published_at: '2026-10-07' },
    { video_id: 'd', status: 'redo', published_at: '2026-01-02' },
  ];
  assert.deepEqual(buildQueue(rows, { today, maxPerRun: 10 }).queue.map((r) => r.video_id), ['d', 'c']);
});

console.log(`\n${passed}개 테스트 통과`);
