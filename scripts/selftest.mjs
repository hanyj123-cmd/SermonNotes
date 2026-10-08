#!/usr/bin/env node
// 서버 쪽(수집·AI 정리·성경 본문·예약) 로직 점검. 네트워크·API 키 없이 가짜 데이터로 돌립니다.   node scripts/selftest.mjs
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { parseTitle, parseScripture, preacherName, bookOf } from './lib/title.mjs';
import { koReference, parseNumberedLines, parseNumberedFlow, parseBskorea, parseBibleGateway, fetchBibleBlock, bibleIsCurrent, bibleSignature, bskoreaUrl, bibleGatewayUrl, BIBLE_SOURCES } from './lib/bible-web.mjs';
import { normalizePassages, toUsfm } from './lib/bible-books.mjs';
import { extractJson, normalizeReview, normalizeQt, normalizeStudy, normalizeGroup, readResponseText } from './lib/gemini.mjs';
import { MODES, systemPromptFor, buildUserMessage } from './lib/prompt.mjs';
import { buildQueue } from './lib/queue.mjs';
import { processRow, CELL_LIMIT, readExisting, knownInfo } from './lib/process.mjs';
import { RULES, torontoClock, dueCategories, decide, shouldRun } from './gate.mjs';
import { parseCategories, toExport, exportJson } from './sync.mjs';
import { durationSeconds, musicIsStale, attachSongVideos } from './lib/media.mjs';

let pass = 0;
let fail = 0;
async function t(name, fn) {
  try {
    await fn();
    pass++;
    console.log(`✓ ${name}`);
  } catch (e) {
    fail++;
    console.log(`✗ ${name}\n    ${String(e.message).split('\n').join('\n    ')}`);
  }
}
const silent = { info() {}, warn() {}, error() {} };

/* ===== 제목·본문 표기 ===== */
await t('제목 규칙: [날짜] 제목 (본문) - 설교자', () => {
  const p = parseTitle('[2026.10.4] 믿음으로 걷는 길 (창세기 12:1-9) - 홍길동 목사');
  assert.deepEqual(p, { date: '2026-10-04', title: '믿음으로 걷는 길', scripture: '창세기 12:1-9', preacher: '홍길동 목사' });
});
await t('제목 규칙: 본문 괄호가 성경이 아니면 제목에 남김', () => {
  const p = parseTitle('[2026.10.01] 은혜 (feat. 간증) - 김 목사');
  assert.equal(p.scripture, '');
  assert.equal(p.title, '은혜 (feat. 간증)');
});
await t('제목 규칙이 없어도 깨지지 않음', () => {
  assert.deepEqual(parseTitle('그냥 제목'), { date: '', title: '그냥 제목', scripture: '', preacher: '' });
});
await t('설교자 직함 떼기', () => {
  assert.equal(preacherName('윤정환 목사'), '윤정환');
  assert.equal(preacherName('홍 담임목사님'), '홍');
});
await t('책 이름: 줄임말·긴 이름 구분', () => {
  assert.equal(bookOf('요한일서 1:9').usfm, '1JN');
  assert.equal(bookOf('요 3:16').usfm, 'JHN');
  assert.equal(bookOf('롬8:1').usfm, 'ROM');
  assert.equal(bookOf('아무말'), null);
});
await t('본문 표기 해석', () => {
  assert.deepEqual(parseScripture('열왕기상 4, 5장').map((p) => [p.book, p.chapter, p.verse_from]), [['1KI', 4, null], ['1KI', 5, null]]);
  assert.deepEqual(parseScripture('요한복음 3:16-21'), [{ book: 'JHN', chapter: 3, verse_from: 16, verse_to: 21 }]);
  assert.deepEqual(parseScripture('시편 23편'), [{ book: 'PSA', chapter: 23, verse_from: null, verse_to: null }]);
  const m = parseScripture('마 5:1-12, 6:9-13');
  assert.deepEqual(m.map((p) => [p.chapter, p.verse_from, p.verse_to]), [[5, 1, 12], [6, 9, 13]]);
  const x = parseScripture('창세기 1:1~2:3');
  assert.deepEqual(x.map((p) => [p.chapter, p.verse_from, p.verse_to]), [[1, 1, null], [2, 1, 3]]);
  assert.deepEqual(parseScripture('모르는 본문 1장'), []);
});
await t('본문 범위 검사·USFM', () => {
  assert.equal(normalizePassages([{ book: 'xxx', chapter: 1 }, { book: 'jhn', chapter: 3, verse_from: 16, verse_to: 10 }]).length, 0);
  assert.equal(toUsfm({ book: 'JHN', chapter: 3, verse_from: 16, verse_to: 18 }), 'JHN.3.16-18');
  assert.equal(koReference({ book: 'PSA', chapter: 23, verse_from: null }), '시편 23편');
  assert.equal(koReference({ book: 'JHN', chapter: 3, verse_from: 16, verse_to: 18 }), '요한복음 3:16-18');
});

/* ===== 성경 본문 (웹 읽기) ===== */
await t('대한성서공회 줄 읽기: 소제목·각주 제외', () => {
  const lines = ['요한복음 3장', '하나님의 사랑', '1 바리새인 중에 니고데모라 하는 사람이 있으니', '2 그가 밤에 예수께 와서', '1) 각주 내용', '3 예수께서 대답하여'];
  const v = parseNumberedLines(lines);
  assert.deepEqual(v.map((x) => x.n), ['1', '2', '3']);
  assert.ok(v[1].text.startsWith('그가 밤에'));
});
await t('대한성서공회: 한 덩어리 글도 절로 나눔', () => {
  const v = parseNumberedFlow('1 태초에 말씀이 계시니라 2 이 말씀이 하나님과 함께 계셨으니 3 만물이 그로 말미암아 지은 바 되었으니');
  assert.equal(v.length, 3);
  assert.equal(v[2].n, '3');
});
await t('대한성서공회 HTML 읽기', () => {
  const html = '<html><body><div id="tdBible1"><p>1 태초에 하나님이 천지를 창조하시니라</p><p>2 땅이 혼돈하고 공허하며</p><p>3 하나님이 이르시되 빛이 있으라 하시니</p></div></body></html>';
  assert.equal(parseBskorea(html).length, 3);
});
await t('BibleGateway HTML 읽기: 절 번호·각주·소제목', () => {
  const html = `<div class="passage-text"><div class="passage-content"><h3>For God So Loved the World</h3>
    <p><span class="text John-3-16"><sup class="versenum">16 </sup>For God so loved the world<sup class="footnote">[a]</sup> that he gave his one and only Son.</span>
    <span class="text John-3-17"><sup class="versenum">17 </sup>For God did not send his Son into the world to condemn the world.</span></p>
    <div class="footnotes"><p>a. note</p></div></div></div>`;
  const v = parseBibleGateway(html);
  assert.deepEqual(v.map((x) => x.n), ['16', '17']);
  assert.ok(!/\[a\]|note|For God So Loved the World/.test(v.map((x) => x.text).join(' ')));
});
await t('BibleGateway: 본문 영역이 없으면 오류', () => {
  assert.throws(() => parseBibleGateway('<html><body>nothing</body></html>'), /본문 영역/);
});
await t('성경 주소 만들기', () => {
  assert.ok(bskoreaUrl('GAE', 'JHN', 3).includes('version=GAE') && bskoreaUrl('GAE', 'JHN', 3).includes('book=jhn') && bskoreaUrl('GAE', 'JHN', 3).includes('chap=3'));
  assert.ok(decodeURIComponent(bibleGatewayUrl('NIV', { book: 'JHN', chapter: 3, verse_from: 16, verse_to: 18 })).includes('John 3:16-18'));
});

const fakeFetch = (log = []) => async (url) => {
  log.push(url);
  const u = String(url);
  if (u.includes('bskorea')) {
    const body = Array.from({ length: 20 }, (_, i) => `<p>${i + 1} 한글 본문 ${i + 1}절 내용입니다</p>`).join('');
    return { ok: true, status: 200, text: async () => `<html><body>${body}</body></html>` };
  }
  if (u.includes('MSG')) return { ok: false, status: 503, text: async () => '' };
  return { ok: true, status: 200, text: async () => '<div class="passage-text"><p><sup class="versenum">16 </sup>English sixteen.<sup class="versenum">17 </sup>English seventeen.</p></div>' };
};
await t('성경 4역본 수집: 일부 실패해도 나머지 저장, 장 단위 캐시', async () => {
  const log = [];
  const logs = [];
  const block = await fetchBibleBlock([{ book: 'JHN', chapter: 3, verse_from: 16, verse_to: 17 }], { fetchImpl: fakeFetch(log), sleepImpl: async () => {}, log: (m) => logs.push(m), now: () => 'T' });
  assert.deepEqual(block.versions.map((v) => v.id), ['GAE', 'NIV', 'SAE']); // MSG 실패
  assert.equal(block.versions[0].passages[0].verses.length, 2); // 16~17절만
  assert.equal(block.versions[0].passages[0].verses[0].n, '16');
  assert.ok(logs.some((m) => /메시지 성경/.test(m)));
  assert.equal(block.signature, 'JHN.3.16-17');
  assert.ok(bibleIsCurrent(block, [{ book: 'JHN', chapter: 3, verse_from: 16, verse_to: 17 }]));
  assert.ok(!bibleIsCurrent(block, [{ book: 'JHN', chapter: 4, verse_from: 1, verse_to: 2 }]));
  assert.equal(BIBLE_SOURCES.length, 4);
});
await t('성경 4역본 모두 실패하면 null', async () => {
  const block = await fetchBibleBlock([{ book: 'JHN', chapter: 3, verse_from: 16, verse_to: 17 }], { fetchImpl: async () => ({ ok: false, status: 500, text: async () => '' }), sleepImpl: async () => {} });
  assert.equal(block, null);
});

/* ===== Gemini 결과 검사 ===== */
const rawReview = () => ({
  title: '제목', scripture: ['창세기 12:1-9'], preacher: '홍길동 목사', theme: '주제', summary_short: '한 줄',
  passages: [{ book: 'GEN', chapter: 12, verse_from: 1, verse_to: 9 }],
  review: { outline: [{ heading: '1. 부르심', scripture: '창 12:1', paragraphs: ['문단1', '문단2'], key_summary: '핵심' }], summary: '요약' },
});
const rawQt = () => ({ opening_prayer: '여는 기도', closing_prayer: '맺는 기도', songs: [{ title: '곡', artist: '가수', kind: 'ccm' }], outline: [{ heading: 'h', paragraphs: ['p'] }], questions: ['질문?'], applications: [{ title: 't', detail: 'd' }] });
const mcq = (n) => Array.from({ length: n }, (_, i) => ({ question: `q${i}`, options: ['a', 'b', 'c', 'd'], answer_index: 1, explanation: 'e' }));
const sa = (n) => Array.from({ length: n }, (_, i) => ({ question: `q${i}`, answer: `a${i}`, explanation: 'e' }));
const rawStudy = () => ({ opening_prayer: '여', closing_prayer: '맺', songs: [], deep_dive: [{ heading: 'h', paragraphs: ['p'], word_notes: [{ word: '믿음', original: 'pistis', meaning: '신뢰' }] }], summary: 's', quiz: { multiple_choice: mcq(5), fill_blank: sa(5), short_answer: sa(5) } });
const rawGroup = () => ({
  representative_prayer: '대표 기도', closing_prayer: '맺는 기도', songs: [], outline: [{ heading: 'h', paragraphs: ['p'] }], applications: [{ title: 't', detail: 'd' }],
  questions: { icebreaker: { question: '아이스브레이크', answer: '예' }, observation: [{ question: '관찰', answer: '답' }], reflection: ['묵상'], application: [], prayer: [] },
  sharing_guide: { intro: '안내', steps: [{ title: '나눔', detail: '상세', minutes: '10' }], prayer_guide: ['기도제목'] },
});
await t('JSON 추출: 코드블록·앞뒤 잡글', () => {
  assert.deepEqual(extractJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.throws(() => extractJson('없음'), /JSON/);
});
await t('설교리뷰 정리: schema 3, 본문 범위 포함', () => {
  const r = normalizeReview(rawReview());
  assert.equal(r.schema, 3);
  assert.equal(r.review.outline[0].key_summary, '핵심');
  assert.equal(r.passages.length, 1);
});
await t('설교리뷰: 개요/한줄정리가 비면 거부', () => {
  assert.throws(() => normalizeReview({ ...rawReview(), review: { outline: [] } }), /outline/);
  assert.throws(() => normalizeReview({ ...rawReview(), summary_short: '' }), /summary_short/);
});
await t('QT 묵상: 찬양 종류 CCM 통일, 필수 항목 검사', () => {
  const q = normalizeQt(rawQt());
  assert.equal(q.songs[0].kind, 'CCM');
  assert.throws(() => normalizeQt({ ...rawQt(), questions: [] }), /질문/);
  assert.throws(() => normalizeQt({ ...rawQt(), opening_prayer: '' }), /기도/);
});
await t('성경공부: 퀴즈 15문제(5·5·5), 정답 번호가 잘못된 객관식은 걸러냄', () => {
  const s = normalizeStudy(rawStudy());
  assert.deepEqual([s.quiz.multiple_choice.length, s.quiz.fill_blank.length, s.quiz.short_answer.length], [5, 5, 5]);
  const bad = rawStudy();
  bad.quiz.multiple_choice = mcq(5).map((m, i) => (i < 3 ? { ...m, answer_index: 9 } : m));
  assert.throws(() => normalizeStudy(bad), /퀴즈가 부족/);
});
await t('소그룹 나눔: 질문+모범답안, 글자만 온 질문도 받음, 진행 가이드 필수', () => {
  const g = normalizeGroup(rawGroup());
  assert.equal(g.questions.icebreaker.answer, '예');
  assert.equal(g.questions.reflection[0].question, '묵상');
  assert.equal(g.sharing_guide.steps[0].minutes, 10);
  assert.throws(() => normalizeGroup({ ...rawGroup(), sharing_guide: { steps: [] } }), /가이드/);
});
await t('Gemini 응답: 빈 응답·차단·잘림 설명', () => {
  assert.throws(() => readResponseText({ text: '', promptFeedback: { blockReason: 'SAFETY' } }), /차단/);
  assert.throws(() => readResponseText({ text: '{}', candidates: [{ finishReason: 'MAX_TOKENS' }] }), /잘렸/);
  assert.equal(readResponseText({ text: '{"a":1}', candidates: [{ finishReason: 'STOP' }] }), '{"a":1}');
});
await t('프롬프트: 모드마다 따로 있고, 개혁주의 관점·분량 규칙 포함', () => {
  assert.deepEqual(MODES, ['review', 'qt', 'study', 'group']);
  for (const m of MODES) assert.ok(systemPromptFor(m).includes('개혁'), m);
  const msg = JSON.stringify(buildUserMessage('review', { category: 'sunday', title: 'T', publishedAt: '2026-10-04', transcript: '자막', info: { date: '2026-10-04', title: 'T', scripture: '창 1', preacher: 'P' } }));
  assert.ok(msg.includes('자막'));
});

/* ===== 대기열 ===== */
const row = (o) => ({ video_id: 'v', category: 'sunday', status: 'pending', published_at: '2026-10-01', ...o });
await t('대기열: 구분 필터 · 사용자 영상·redo 는 구분과 무관하게 항상', () => {
  const rows = [
    row({ video_id: 'a', category: 'sunday', published_at: '2026-10-04' }),
    row({ video_id: 'b', category: 'wednesday', published_at: '2026-10-07' }),
    row({ video_id: 'u', category: 'user', published_at: '2026-09-01' }),
    row({ video_id: 'r', category: 'youth', status: 'redo', published_at: '2026-08-01' }),
    row({ video_id: 'y', category: 'youth', published_at: '2026-10-05' }),
    row({ video_id: 'l', category: 'sunday', status: 'listed' }),
    row({ video_id: 'k', category: 'sunday', status: 'skip' }),
  ];
  const { queue } = buildQueue(rows, { maxPerRun: 10, categories: ['wednesday'], today: new Date('2026-10-08') });
  assert.deepEqual(queue.map((r) => r.video_id), ['r', 'u', 'b']);
  const all = buildQueue(rows, { maxPerRun: 10, today: new Date('2026-10-08') }).queue.map((r) => r.video_id);
  assert.deepEqual(all, ['r', 'u', 'b', 'y', 'a']);
});
await t('대기열: 최근 실패 재시도는 7일 이내만, 개수 제한, 라이브 건너뜀', () => {
  const rows = [
    row({ video_id: 'e1', status: 'error', published_at: '2026-10-06' }),
    row({ video_id: 'e2', status: 'error', published_at: '2026-08-01' }),
    row({ video_id: 'p1', published_at: '2026-10-05' }),
    row({ video_id: 'p2', published_at: '2026-10-04' }),
    row({ video_id: 'live', published_at: '2026-10-07' }),
  ];
  const states = new Map([['live', { ready: false, reason: '방송 예정' }]]);
  const { queue, skipped } = buildQueue(rows, { maxPerRun: 2, today: new Date('2026-10-08'), states });
  assert.deepEqual(queue.map((r) => r.video_id), ['e1', 'p1']);
  assert.deepEqual(skipped.map((s) => s.row.video_id), ['live']);
});
await t('구분 입력값 해석 (ONLY_CATEGORIES)', () => {
  assert.deepEqual(parseCategories(''), ['sunday', 'dawn', 'wednesday']);
  assert.deepEqual(parseCategories('all'), ['sunday', 'dawn', 'wednesday', 'youth']);
  assert.deepEqual(parseCategories('youth, sunday'), ['youth', 'sunday']);
  assert.deepEqual(parseCategories('user'), []);
  assert.deepEqual(parseCategories('엉뚱'), ['sunday', 'dawn', 'wednesday']);
});

/* ===== 예약 시각 (토론토 시간, 서머타임) ===== */
const at = (iso) => new Date(iso);
await t('토론토 시각: 여름(EDT, UTC-4)·겨울(EST, UTC-5)', () => {
  assert.deepEqual(torontoClock(at('2026-10-08T11:00:00Z')), { day: 4, minutes: 7 * 60 }); // 목 07:00 EDT
  assert.deepEqual(torontoClock(at('2026-12-10T12:00:00Z')), { day: 4, minutes: 7 * 60 }); // 목 07:00 EST
});
await t('수요예배: 목요일 07:00 에만 (여름/겨울 예약 둘 다 등록하되 맞는 쪽만 통과)', () => {
  assert.deepEqual(dueCategories(at('2026-10-08T11:03:00Z')), ['wednesday']);
  assert.deepEqual(dueCategories(at('2026-10-08T12:03:00Z')), []); // 여름에 겨울 예약이 먼저 도는 경우 08:03 → 아님
  assert.deepEqual(dueCategories(at('2026-12-10T12:03:00Z')), ['wednesday']);
  assert.deepEqual(dueCategories(at('2026-12-10T11:03:00Z')), []);
});
await t('주일예배: 일요일 22:00 (UTC로는 월요일 02:00/03:00)', () => {
  assert.deepEqual(dueCategories(at('2026-10-05T02:05:00Z')), ['sunday']); // 일 22:05 EDT
  assert.deepEqual(dueCategories(at('2026-12-07T03:05:00Z')), ['sunday']); // 일 22:05 EST
  assert.deepEqual(dueCategories(at('2026-10-05T03:05:00Z')), []);
});
await t('새벽기도회: 매일 11:00', () => {
  assert.deepEqual(dueCategories(at('2026-10-09T15:02:00Z')), ['dawn']);
  assert.deepEqual(dueCategories(at('2026-12-09T16:02:00Z')), ['dawn']);
  assert.deepEqual(dueCategories(at('2026-10-09T16:02:00Z')), []);
});
await t('청년부는 예약 규칙 없음 · 직접 실행은 항상 실행', () => {
  assert.ok(!RULES.some((r) => r.category === 'youth'));
  assert.deepEqual(decide('workflow_dispatch', at('2026-10-09T03:00:00Z')), { run: true, categories: '' });
  assert.equal(shouldRun('schedule', at('2026-10-09T03:00:00Z')), false);
  assert.deepEqual(decide('schedule', at('2026-10-08T11:00:00Z')), { run: true, categories: 'wednesday' });
});

/* ===== 영상 처리(processRow) ===== */
function fakeAi({ failModes = [], calls = [] } = {}) {
  return {
    model: 'fake-model',
    async generateMode(mode, args) {
      calls.push(mode);
      if (failModes.includes(mode)) throw new Error('가짜 실패');
      return { review: normalizeReview(rawReview()), qt: normalizeQt(rawQt()), study: normalizeStudy(rawStudy()), group: normalizeGroup(rawGroup()) }[mode];
    },
    async transcribeVideo() {
      return '가짜 자막 '.repeat(100);
    },
  };
}
const sermonRow = (o = {}) => ({ video_id: 'abc12345678', category: 'sunday', title: '[2026.10.04] 믿음으로 걷는 길 (창세기 12:1-9) - 홍길동 목사', published_at: '2026-10-04', url: 'x', status: 'pending', result_json: '', note: '', ...o });
const run = async (rowObj, deps) => {
  const patches = [];
  const result = await processRow(rowObj, { update: async (p) => patches.push(p), now: () => 'T', log: silent, obtain: async () => ({ kind: 'text', text: '설교 자막 '.repeat(50), source: '테스트 자막', problems: [] }), ...deps });
  return { result, patch: Object.assign({}, ...patches) };
};
await t('처리: 4개 모드 + 성경 → done, 시트 칸에 저장', async () => {
  const calls = [];
  const { result, patch } = await run(sermonRow(), { ai: fakeAi({ calls }), fetchBible: async (p) => ({ signature: bibleSignature(p), versions: [{ id: 'GAE' }] }), enrichSongs: async () => {} });
  assert.equal(result, 'done');
  assert.deepEqual(calls, MODES);
  for (const c of ['result_json', 'mode_qt', 'mode_study', 'mode_group', 'bible_json']) assert.ok(patch[c], c);
  assert.equal(patch.status, 'done');
  assert.equal(patch.preacher, '홍길동 목사'); // 제목에서 읽은 값이 우선
  assert.equal(patch.scripture, '창세기 12:1-9');
});
await t('처리: 일부 모드 실패 → error, 성공한 모드는 저장, 재시도 때는 빠진 모드만', async () => {
  const first = await run(sermonRow(), { ai: fakeAi({ failModes: ['study'] }) });
  assert.equal(first.result, 'error');
  assert.ok(first.patch.mode_qt && first.patch.mode_group && !first.patch.mode_study);
  assert.match(first.patch.note, /성경공부/);
  const calls = [];
  const retry = await run(sermonRow({ status: 'error', ...first.patch }), { ai: fakeAi({ calls }) });
  assert.deepEqual(calls, ['study']);
  assert.equal(retry.result, 'done');
});
await t('처리: redo 는 처음부터 다시 만듦', async () => {
  const done = await run(sermonRow(), { ai: fakeAi() });
  const calls = [];
  await run(sermonRow({ status: 'redo', ...done.patch }), { ai: fakeAi({ calls }) });
  assert.deepEqual(calls, MODES);
});
await t('처리: 자막을 못 구하면 no_transcript + 안내', async () => {
  const { result, patch } = await run(sermonRow(), { ai: fakeAi(), obtain: async () => ({ kind: 'none', problems: ['자막 없음'] }) });
  assert.equal(result, 'no_transcript');
  assert.match(patch.note, /transcript_manual/);
});
await t('처리: 성경 본문 수집이 실패해도 정리는 완료', async () => {
  const { result, patch } = await run(sermonRow(), { ai: fakeAi(), fetchBible: async () => { throw new Error('사이트 오류'); } });
  assert.equal(result, 'done');
  assert.ok(!patch.bible_json);
});
await t('처리: 셀 글자 수 한도(49,000자) 초과 → 그 모드는 저장 안 하고 error', async () => {
  const ai = fakeAi();
  const orig = ai.generateMode;
  ai.generateMode = async (mode, a) => {
    const out = await orig(mode, a);
    if (mode === 'study') out.deep_dive[0].paragraphs = ['가'.repeat(CELL_LIMIT + 10)];
    return out;
  };
  const { result, patch } = await run(sermonRow(), { ai });
  assert.equal(result, 'error');
  assert.ok(!patch.mode_study);
  assert.match(patch.note, /너무 깁니다/);
});
await t('처리: 사용자가 직접 입력한 본문·설교자가 AI 값보다 우선', async () => {
  const info = knownInfo(sermonRow({ title: '그냥 제목', preacher: '김철수 목사', scripture: '요한복음 3:16' }));
  assert.equal(info.preacher, '김철수 목사');
  assert.equal(info.scripture, '요한복음 3:16');
  const { patch } = await run(sermonRow({ title: '그냥 제목', preacher: '김철수 목사', scripture: '요한복음 3:16' }), { ai: fakeAi() });
  assert.equal(patch.preacher, '김철수 목사');
  assert.equal(patch.scripture, '요한복음 3:16');
});
await t('처리: 시트에서 기존 모드 읽기', async () => {
  const done = await run(sermonRow(), { ai: fakeAi() });
  const ex = readExisting({ ...done.patch });
  assert.ok(ex.review && ex.qt && ex.study && ex.group);
});

/* ===== 내보내기 ===== */
await t('내보내기: 새 형식만 화면용 JSON 으로, 예전 형식은 건너뛰고 경고 대상', async () => {
  const done = await run(sermonRow(), { ai: fakeAi() });
  const rowDone = sermonRow({ ...done.patch });
  const legacy = sermonRow({ video_id: 'old00000001', status: 'done', result_json: JSON.stringify({ schema: 2, outline: [] }) });
  const e = toExport(rowDone);
  assert.deepEqual(e.index.modes, ['review', 'qt', 'study', 'group']);
  assert.equal(e.index.complete, true);
  assert.equal(e.index.date, '2026-10-04');
  assert.equal(e.index.book, '창세기');
  assert.equal(toExport(legacy), null);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sn-'));
  await exportJson([rowDone, legacy, sermonRow({ video_id: 'pend0000001' })], { dataDir: dir, quiet: true });
  const idx = JSON.parse(await fs.readFile(path.join(dir, 'sermons.json'), 'utf8'));
  assert.equal(idx.count, 1);
  assert.ok(!('owner' in idx.sermons[0]));
  const detail = JSON.parse(await fs.readFile(path.join(dir, 's', 'abc12345678.json'), 'utf8'));
  assert.ok(detail.qt && detail.study && detail.group && detail.result);
  await fs.rm(dir, { recursive: true, force: true });
});

/* ===== 찬양 영상·배경음악 ===== */
await t('길이 계산 · 배경음악 갱신 시점', () => {
  assert.equal(durationSeconds('PT1H2M3S'), 3723);
  assert.equal(durationSeconds('PT45M'), 2700);
  assert.ok(musicIsStale(null));
  assert.ok(!musicIsStale({ updated: new Date().toISOString(), tracks: [{ id: 'x' }] }));
  assert.ok(musicIsStale({ updated: '2020-01-01T00:00:00Z', tracks: [{ id: 'x' }] }));
});
await t('찬양 영상: 제목이 곡명을 담은 영상만 연결, 같은 곡은 한 번만 검색', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    return { ok: true, json: async () => ({ items: [{ id: { videoId: 'zzz' }, snippet: { title: '엉뚱한 영상', channelTitle: 'c' } }, { id: { videoId: 'vid1' }, snippet: { title: '주 은혜임을 - 찬양', channelTitle: 'c' } }] }) };
  };
  const songs = [{ title: '주 은혜임을', artist: '소망', kind: 'CCM' }, { title: '주 은혜임을', artist: '소망', kind: 'CCM' }];
  await attachSongVideos(songs, 'key', { fetchImpl });
  assert.equal(songs[0].video_id, 'vid1');
  assert.equal(songs[1].video_id, 'vid1');
  assert.equal(calls, 1);
});

console.log(`\n${fail ? `❌ ${fail}개 실패, ` : '✅ '}${pass}개 통과`);
process.exit(fail ? 1 : 0);
