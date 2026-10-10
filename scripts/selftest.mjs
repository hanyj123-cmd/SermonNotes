#!/usr/bin/env node
// 서버 쪽(수집·AI 정리·성경 본문·예약) 로직 점검. 네트워크·API 키 없이 가짜 데이터로 돌립니다.   node scripts/selftest.mjs
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { parseTitle, parseScripture, preacherName, bookOf, tidyTitle, normalizePreacher, displayTitle } from './lib/title.mjs';
import { koReference, parseNumberedLines, parseNumberedFlow, parseBskorea, parseBibleGateway, fetchBibleBlock, bibleIsCurrent, bibleSignature, bskoreaUrl, bibleGatewayUrl, BIBLE_SOURCES } from './lib/bible-web.mjs';
import { normalizePassages, toUsfm } from './lib/bible-books.mjs';
import { extractJson, normalizeReview, normalizeQt, normalizeStudy, normalizeGroup, readResponseText, blankKey, normalizeDailyQt, normalizeDailyStudy, normalizeDailyQuiz } from './lib/gemini.mjs';
import { QUIZ_COUNTS, systemPromptForDaily, buildDailyMessage } from './lib/prompt.mjs';
import { MODES, systemPromptFor, buildUserMessage } from './lib/prompt.mjs';
import { buildQueue } from './lib/queue.mjs';
import { guessFromTitle, parseAnyTitle } from './lib/title.mjs';
import { fetchPublishDates } from './lib/youtube.mjs';
import { processRow, CELL_LIMIT, readExisting, knownInfo } from './lib/process.mjs';
import { RULES, torontoClock, dueCategories, decide, shouldRun } from './gate.mjs';
import { parseCategories, toExport, exportJson, exportDaily } from './sync.mjs';
import { parseReadingTitle, buildReadingIndex, readingIndexIsStale } from './lib/reading-index.mjs';
import { fitCommentary, DAILY_CELL_LIMIT } from './lib/daily.mjs';
import { dawnDateOf, findDawnUpdates, dawnPlaylistId } from './lib/dawn.mjs';
import { scheduledCategories } from './gate.mjs';
import { buildProverbChapter, proverbExport, proverbChaptersToBuild } from './lib/proverbs.mjs';
import { normalizeProverbGroup, normalizeProverbWord } from './lib/gemini.mjs';
import { systemPromptForProverb } from './lib/prompt.mjs';
import { parseYnResponse, readingRefs, passagesText, dailyId, fetchDailyReading, YN_BIBLE_API, torontoDate, scoreReadingTitle, buildDailyDay, dailyExport, findReadingVideos } from './lib/daily.mjs';
import { durationSeconds, musicIsStale, attachSongVideos, attachBibleAudio, scoreAudioTitle } from './lib/media.mjs';

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
await t('QT 묵상 질문: 길잡이·예시 답안이 붙은 새 형식과 글자만 온 옛 형식 모두 받음', () => {
  const q = normalizeQt({ ...rawQt(), questions: [{ question: '무엇을 내려놓을까요?', guide: '12:1을 다시 읽어 보세요', example: '저는…' }, '옛 질문'] });
  assert.deepEqual(q.questions[0], { question: '무엇을 내려놓을까요?', guide: '12:1을 다시 읽어 보세요', example: '저는…' });
  assert.deepEqual(q.questions[1], { question: '옛 질문', guide: '', example: '' });
});
await t('퀴즈 개수: 객관식 15 · 빈칸 5 · 주관식 5, 프롬프트에 헷갈리는 보기·키워드 규칙', () => {
  assert.deepEqual(QUIZ_COUNTS, { multiple_choice: 15, fill_blank: 5, short_answer: 5 });
  const p = systemPromptFor('study');
  assert.match(p, /오답 보기 3개는 모두 그럴듯/);
  assert.match(p, /짧은 단어 하나/);
  assert.match(p, /채점하지 않/);
  assert.match(systemPromptFor('qt'), /guide\(생각의 길잡이\)/);
  assert.match(systemPromptFor('group'), /guide\(생각의 길잡이\)/);
});
await t('빈칸: 정답 키워드·다른 표기(accept)·띄어쓰기 무시 비교', () => {
  const raw = rawStudy();
  raw.quiz.fill_blank = [{ question: '____ 안에서', answer: '하나님 나라', accept: ['천국', '  '], explanation: '' }, ...sa(4)];
  const s = normalizeStudy(raw);
  assert.deepEqual(s.quiz.fill_blank[0].accept, ['천국']);
  assert.equal(blankKey('하나님 나라'), blankKey('하나님나라'));
  assert.equal(blankKey(' "칭의." '), '칭의');
  assert.equal(blankKey('Grace'), blankKey('grace'));
});
await t('객관식 난이도 표시(쉬움·중간·어려움)를 받아 둠', () => {
  const raw = rawStudy();
  raw.quiz.multiple_choice = mcq(5).map((m, i) => ({ ...m, level: ['쉬움', '중간', '어려움', 'hard?', ''][i] }));
  const s = normalizeStudy(raw);
  assert.deepEqual(s.quiz.multiple_choice.map((m) => m.level), ['쉬움', '중간', '어려움', '', '']);
});
await t('소그룹 질문: 길잡이(guide) 받음', () => {
  const raw = rawGroup();
  raw.questions.observation = [{ question: '관찰', guide: '7절을 보세요', answer: '제단' }];
  const g = normalizeGroup(raw);
  assert.deepEqual(g.questions.observation[0], { question: '관찰', guide: '7절을 보세요', answer: '제단' });
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
  assert.deepEqual(parseCategories(''), ['sunday']); // 새벽기도·수요예배는 더 이상 자동으로 정리하지 않음
  assert.deepEqual(parseCategories('all'), ['sunday', 'dawn', 'wednesday', 'youth']);
  assert.deepEqual(parseCategories('youth, sunday'), ['youth', 'sunday']);
  assert.deepEqual(parseCategories('user'), []);
  assert.deepEqual(parseCategories('daily'), []);
  assert.deepEqual(parseCategories('엉뚱'), ['sunday']);
});

/* ===== 예약 시각 (토론토 시간, 서머타임) ===== */
const at = (iso) => new Date(iso);
await t('토론토 시각: 여름(EDT, UTC-4)·겨울(EST, UTC-5)', () => {
  assert.deepEqual(torontoClock(at('2026-10-08T11:00:00Z')), { day: 4, minutes: 7 * 60 }); // 목 07:00 EDT
  assert.deepEqual(torontoClock(at('2026-12-10T12:00:00Z')), { day: 4, minutes: 7 * 60 }); // 목 07:00 EST
});
await t('수요예배·새벽기도는 예약 없음', () => {
  assert.ok(!RULES.some((r) => r.category === 'wednesday' || r.category === 'dawn'));
  assert.deepEqual(dueCategories(at('2026-10-08T11:03:00Z')), ['daily']); // 옛 수요예배 시각 = 지금은 오늘의 말씀 07:00
  assert.deepEqual(dueCategories(at('2026-10-09T15:02:00Z')), []); // 옛 새벽기도 시각
});
await t('주일예배: 일요일 22:00 (UTC로는 월요일 02:00/03:00)', () => {
  assert.deepEqual(dueCategories(at('2026-10-05T02:05:00Z')), ['sunday']); // 일 22:05 EDT
  assert.deepEqual(dueCategories(at('2026-12-07T03:05:00Z')), ['sunday']); // 일 22:05 EST
  assert.deepEqual(dueCategories(at('2026-10-05T03:05:00Z')), []);
});
await t('오늘의 말씀: 매일 07:00 (여름/겨울) — 다음 날 분량', () => {
  assert.deepEqual(dueCategories(at('2026-10-09T11:02:00Z')), ['daily']);
  assert.deepEqual(dueCategories(at('2026-12-09T12:02:00Z')), ['daily']);
  assert.deepEqual(dueCategories(at('2026-10-09T13:02:00Z')), []); // 09:02 EDT
  assert.deepEqual(dueCategories(at('2026-10-09T08:02:00Z')), []); // 옛 04:00
});
await t('청년부는 예약 규칙 없음 · 직접 실행은 항상 실행', () => {
  assert.ok(!RULES.some((r) => r.category === 'youth'));
  assert.deepEqual(decide('workflow_dispatch', at('2026-10-09T03:00:00Z')), { run: true, categories: '' });
  assert.equal(shouldRun('schedule', at('2026-10-09T03:00:00Z')), false);
  assert.deepEqual(decide('schedule', at('2026-10-09T11:00:00Z')), { run: true, categories: 'daily' });
});

await t('예약: 울린 cron 의 "정해진 시각"으로 판단 (늦게 시작해도 헷갈리지 않음)', () => {
  assert.deepEqual(scheduledCategories('0 11 * * *', at('2026-10-09T11:25:00Z')), ['daily']); // 07:00 EDT 예약이 25분 늦게 시작
  assert.deepEqual(scheduledCategories('20 11 * * *', at('2026-10-09T11:31:00Z')), ['dawn_video']); // 07:20
  assert.deepEqual(scheduledCategories('0 12 * * *', at('2026-10-09T12:05:00Z')), ['dawn_video']); // 여름 08:00 다시 확인
  assert.deepEqual(scheduledCategories('0 13 * * *', at('2026-12-09T13:10:00Z')), ['dawn_video']); // 겨울 08:00
  assert.deepEqual(scheduledCategories('20 12 * * *', at('2026-10-09T12:25:00Z')), []); // 여름 08:20 — 해당 없음
  assert.deepEqual(scheduledCategories('0 12 * * *', at('2026-12-09T12:05:00Z')), ['daily']); // 겨울 07:00
  assert.equal(scheduledCategories('', at('2026-10-09T12:25:00Z')), null);
  assert.deepEqual(decide('schedule', at('2026-10-12T02:10:00Z'), '0 2 * * 1'), { run: true, categories: 'sunday' });
});

/* ===== 오늘의 말씀 ===== */
const ynSample = { bibleVerses: [
  { bookID: '11', bookName: '열왕기상', chapters: [{ chapterNo: 11, verses: [{ verseNo: 1, verse: ' 솔로몬 왕이  바로의 딸 외에 ' }, { verseNo: 2, verse: '여호와께서 일찍이 ' }] }] },
  { bookID: '41', bookName: '마가복음', chapters: [{ chapterNo: 10, verses: [{ verseNo: 1, verse: '예수께서 거기서 떠나' }] }] },
] };
await t('오늘의 말씀: 교회 서버 응답 읽기 · 분량 표시 · AI 용 본문', async () => {
  const ps = parseYnResponse(ynSample);
  assert.deepEqual(ps[0], { bookId: '11', book: '열왕기상', chapter: 11, verses: [{ n: 1, text: '솔로몬 왕이 바로의 딸 외에' }, { n: 2, text: '여호와께서 일찍이' }] });
  assert.equal(readingRefs(ps), '열왕기상 11장 · 마가복음 10장');
  assert.equal(readingRefs([{ book: '창세기', chapter: 1 }, { book: '창세기', chapter: 2 }, { book: '마태복음', chapter: 1 }]), '창세기 1-2장 · 마태복음 1장');
  assert.match(passagesText(ps), /\[열왕기상 11장\]\n1 솔로몬/);
  assert.equal(dailyId('2026-10-08'), 'bible-20261008');
  let sent = null;
  const fake = async (url, opts) => { sent = { url, body: JSON.parse(opts.body) }; return { ok: true, json: async () => ynSample }; };
  const got = await fetchDailyReading('2026-10-08', 'NIV', { fetchImpl: fake });
  assert.equal(sent.url, YN_BIBLE_API);
  assert.equal(sent.body.readingDate, '20261008');
  assert.equal(sent.body.version, 'NIV');
  assert.equal(got.length, 2);
  await assert.rejects(() => fetchDailyReading('2026/10/08'), /날짜/);
});
await t('오늘의 말씀: 토론토 날짜 (자정 넘어 UTC 와 다를 때)', () => {
  assert.equal(torontoDate(0, new Date('2026-10-09T02:00:00Z')), '2026-10-08'); // 토론토는 아직 8일 밤 10시
  assert.equal(torontoDate(1, new Date('2026-10-09T02:00:00Z')), '2026-10-09');
});
await t('공동체 성경읽기 영상 제목 점수', () => {
  assert.ok(scoreReadingTitle('[공동체성경읽기] 열왕기상 11장 | 드라마바이블', '열왕기상', 11) >= 4);
  assert.equal(scoreReadingTitle('열왕기상 12장', '열왕기상', 11), 0);
  assert.equal(scoreReadingTitle('열왕기하 11장', '열왕기상', 11), 0);
  assert.ok(scoreReadingTitle('공동체성경읽기 열왕기상 10-12장', '열왕기상', 11) > 0);
  assert.equal(scoreReadingTitle('마가복음 1장', '마가복음', 10), 0);
  assert.ok(scoreReadingTitle('[하루 20분 공동체성경읽기] 10/16 마가복음 10-11장', '마가복음', 11) >= 4);
});
await t('공동체 성경읽기 색인: 영상 제목에서 책·장 범위 읽기', () => {
  assert.deepEqual(parseReadingTitle('[하루 20분 공동체성경읽기] 4/20 열왕기상 11-12장'), [{ id: 11, from: 11, to: 12 }]);
  assert.deepEqual(parseReadingTitle('[2022년 하루 20분 공동체성경읽기] 10/17 마가복음 7장-9장'), [{ id: 41, from: 7, to: 9 }]);
  assert.deepEqual(parseReadingTitle('[하루 20분 공동체성경읽기] 3/1 예레미야애가 1-2장'), [{ id: 25, from: 1, to: 2 }]);
  assert.deepEqual(parseReadingTitle('[하루 20분 공동체성경읽기] 열왕기상 7장, 시편 50편').map((r) => r.id).sort((a, b) => a - b), [11, 19]);
  assert.deepEqual(parseReadingTitle('열왕기상 99장'), []);
});
await t('공동체 성경읽기 색인: @PRS 장별 영상 우선 → (개역개정) → CGN 묶음 · 색인에 있으면 검색 안 함', async () => {
  const items = {
    UUprs: ['열왕기상 11장 (개역개정)', '열왕기상 11장', '열왕기상 12장 (개역개정)', '공지: 새해 인사'],
    P1: ['[하루 20분 공동체성경읽기] 4/20 열왕기상 11-12장', '[하루 20분 공동체성경읽기] 10/16 마가복음 10-11장'],
  };
  const fetchImpl = async (url) => {
    const u = new URL(url);
    const ep = u.pathname.split('/').pop();
    let body;
    if (ep === 'channels') body = u.searchParams.get('forHandle') === '@PRS' ? { items: [{ snippet: { title: '공동체성경읽기' }, contentDetails: { relatedPlaylists: { uploads: 'UUprs' } } }] } : { items: [] };
    else if (ep === 'search') body = { items: [{ id: { playlistId: 'P1' }, snippet: { title: '2024 하루 20분 공동체성경읽기', channelTitle: 'CGN' } }, { id: { playlistId: 'PX' }, snippet: { title: '찬양 모음', channelTitle: 'x' } }] };
    else body = { items: (items[u.searchParams.get('playlistId')] || []).map((title, i) => ({ snippet: { title, resourceId: { videoId: `${u.searchParams.get('playlistId')}_v${i}` } } })) };
    return { ok: true, json: async () => body };
  };
  const idx = await buildReadingIndex('k', { fetchImpl });
  assert.equal(idx.playlists[0].channel, '@PRS');
  assert.equal(idx.map['11:11'].video_id, 'UUprs_v1'); // "열왕기상 11장" (채널 검색 첫 영상)
  assert.equal(idx.map['11:12'].video_id, 'UUprs_v2'); // 개역개정 판밖에 없으면 그것
  assert.equal(idx.map['41:10'].video_id, 'P1_v1'); // @PRS 에 없으면 CGN 묶음
  assert.equal(idx.map['11:11'].rank, undefined);
  assert.ok(readingIndexIsStale(idx)); // 300장 미만이면 다시 만듦
  assert.ok(readingIndexIsStale({ ...idx, count: 1189, version: 1 })); // 옛 색인(CGN만)도 다시 만듦
  let searched = 0;
  const got = await findReadingVideos([{ bookId: '11', book: '열왕기상', chapter: 11 }], 'k', { index: idx, search: async () => (searched++, []) });
  assert.equal(searched, 0);
  assert.equal(got[0].video_id, 'UUprs_v1');
});
await t('공동체 성경읽기 영상: 앞 장 검색에 나온 "10-11장" 영상은 다시 검색하지 않음', async () => {
  const queries = [];
  const search = async (q) => {
    queries.push(q);
    return [{ video_id: 'AAAAAAAAAAA', title: '[하루 20분 공동체성경읽기] 10/16 마가복음 10-11장', channel: '드라마바이블' }, { video_id: 'BBBBBBBBBBB', title: '마가복음 12장 강해', channel: 'x' }];
  };
  const got = await findReadingVideos([{ book: '마가복음', chapter: 10 }, { book: '마가복음', chapter: 11 }], 'key', { search });
  assert.equal(queries.length, 1);
  assert.deepEqual(got.map((v) => v.video_id), ['AAAAAAAAAAA', 'AAAAAAAAAAA']);
});
const dailyAi = (fail = []) => ({
  calls: [],
  async generateDaily(mode, { refs, text }) {
    this.calls.push(mode);
    if (fail.includes(mode)) throw new Error('일시 오류');
    assert.match(text, /솔로몬/);
    if (mode === 'quiz') return normalizeDailyQuiz({ quiz: { multiple_choice: mcq(15), fill_blank: sa(5), short_answer: sa(5) } });
    if (mode === 'qt') return normalizeDailyQt({ ...rawQt(), key_verse: { reference: '마가복음 10:45', text: '인자가 온 것은' }, summaries: [{ reference: '열왕기상 11장', summary: '솔로몬이 마음을 돌립니다' }] });
    if (mode === 'study') return normalizeDailyStudy({ ...rawStudy(), quiz: undefined });
    return normalizeGroup(rawGroup());
  },
});
await t('오늘의 말씀 하루치: 4가지 생성 · 영상 · 일부 실패하면 다음에 빠진 것만', async () => {
  const fetchReading = async () => parseYnResponse(ynSample);
  const ai = dailyAi(['group']);
  const row = await buildDailyDay('2026-10-08', null, { ai, fetchReading, findVideos: async () => [{ reference: '열왕기상 11장', video_id: 'vid12345678' }], now: () => 'T' });
  assert.equal(row.status, 'error');
  assert.equal(row.refs, '열왕기상 11장 · 마가복음 10장');
  assert.match(row.note, /group/);
  assert.equal(JSON.parse(row.quiz_json).multiple_choice.length, 15);
  const ai2 = dailyAi();
  const row2 = await buildDailyDay('2026-10-08', row, { ai: ai2, fetchReading: async () => { throw new Error('다시 가져오면 안 됨'); }, now: () => 'T' });
  assert.deepEqual(ai2.calls, ['group']);
  assert.equal(row2.status, 'done');
  const out = dailyExport(row2);
  assert.equal(out.id, 'bible-20261008');
  assert.equal(out.key_verse.reference, '마가복음 10:45');
  assert.equal(out.summaries[0].summary, '솔로몬이 마음을 돌립니다');
  assert.equal(out.videos[0].video_id, 'vid12345678');
  assert.equal(out.study.quiz, undefined);
  assert.equal(await buildDailyDay('2027-01-01', null, { ai: dailyAi(), fetchReading: async () => [] }), null);
});
await t('오늘의 말씀 성경공부: 절별 주석은 commentary_json 열에 따로 · 다른 부분만 다시 만들 때도 남아 있음', async () => {
  const fetchReading = async () => parseYnResponse(ynSample);
  const commentary = [{ passage: '열왕기상 11장', sections: [{ verses: '1-8', heading: 'h', paragraphs: ['p'], cross_refs: [], commentators: [{ name: '칼빈', view: 'v' }] }] }];
  const ai = { async generateDaily(mode, args) { const base = await dailyAi().generateDaily(mode, args); return mode === 'study' ? { ...base, commentary } : base; } };
  const row = await buildDailyDay('2026-10-08', null, { ai, fetchReading, now: () => 'T' });
  assert.equal(JSON.parse(row.study_json).commentary, undefined);
  assert.equal(JSON.parse(row.commentary_json)[0].sections[0].commentators[0].name, '칼빈');
  assert.equal(dailyExport(row).study.commentary[0].passage, '열왕기상 11장');
  // 퀴즈만 다시 만들기: 성경공부·주석은 그대로
  const again = await buildDailyDay('2026-10-08', { ...row, quiz_json: '' }, { ai: dailyAi(), fetchReading, now: () => 'T' });
  assert.equal(again.study_json, row.study_json);
  assert.equal(JSON.parse(again.commentary_json)[0].passage, '열왕기상 11장');
  // 아주 길면 셀 크기에 맞게 줄임
  const big = [{ passage: 'x', sections: Array.from({ length: 12 }, () => ({ verses: '1', heading: 'h', paragraphs: ['가'.repeat(2900), '나'.repeat(2900)], cross_refs: ['r'], commentators: [{ name: 'n', view: '다'.repeat(600) }] })) }];
  assert.ok(JSON.stringify(fitCommentary(big)).length <= DAILY_CELL_LIMIT);
});
await t('잠언 묵상: 만들 장 고르기 (1장부터 빠진 장, 직접 지정)', () => {
  const now = new Date('2026-10-09T15:00:00Z');
  assert.deepEqual(proverbChaptersToBuild([], { now }), [1, 2, 3]);
  assert.deepEqual(proverbChaptersToBuild([{ chapter: '1', status: 'done' }, { chapter: '3', status: 'error' }], { now }), [2, 3, 4]);
  assert.equal(proverbChaptersToBuild([], { want: 'missing', now }).length, 6);
  assert.deepEqual(proverbChaptersToBuild([{ chapter: '3', status: 'done' }], { want: '3,7,99', now }), [7]);
  assert.deepEqual(proverbChaptersToBuild([{ chapter: '3', status: 'done' }], { want: '3,7', force: true, now }), [3, 7]);
});
await t('잠언 묵상: 핵심 3구절 · 소그룹 부원용/인도자용 · 프롬프트', () => {
  const kv = (n) => ({ reference: `잠언 1:${n}`, text: '본문', title: 't', meaning: 'm', apply: 'a' });
  assert.equal(normalizeProverbWord({ summary: 's', key_verses: [kv(1), kv(2), kv(3), kv(4)] }).key_verses.length, 3);
  assert.throws(() => normalizeProverbWord({ summary: 's', key_verses: [kv(1)] }), /3개/);
  const qs = ['icebreaker', 'observation', 'reflection', 'application', 'prayer'].map((section, i) => ({ id: `q${i + 1}`, section, question: `질문${i}` }));
  const g = normalizeProverbGroup({ representative_prayer: 'p', closing_prayer: 'c', member: { summary: 's', questions: qs }, leader: { questions: qs.map((q) => ({ id: q.id, intent: '의도', guide: '가이드', answers: ['답'], follow_up: '심화' })), tips: ['팁'], closing_words: '마무리' } });
  assert.equal(g.member.questions[0].answers, undefined); // 부원용에는 답이 없음
  assert.equal(g.leader.questions[4].follow_up, '심화');
  assert.match(systemPromptForProverb('word'), /정확히 3개/);
  assert.match(systemPromptForProverb('group'), /인도자용/);
  assert.match(systemPromptForProverb('study'), /perspectives/);
});
await t('잠언 묵상: 한 장 만들기 — 본문(4역본) → 5가지, 실패한 것만 다시', async () => {
  const bible = { versions: [{ id: 'GAE', label: '개역개정', passages: [{ reference: '잠언 9장', verses: [{ n: 10, text: '여호와를 경외하는 것이 지혜의 근본이요' }] }] }] };
  const calls = [];
  const ai = (fail = []) => ({ async generateProverb(mode, { chapter, text }) {
    calls.push(mode);
    assert.equal(chapter, 9); assert.match(text, /경외/);
    if (fail.includes(mode)) throw new Error('일시 오류');
    return mode === 'study' ? { deep_dive: [], commentary: [{ passage: '잠언 9장', sections: [] }] } : { mode };
  } });
  const row = await buildProverbChapter(9, null, { ai: ai(['group']), fetchBible: async () => bible, now: () => 'T' });
  assert.equal(row.status, 'error');
  assert.match(row.note, /group/);
  assert.ok(row.commentary_json);
  calls.length = 0;
  const row2 = await buildProverbChapter(9, row, { ai: ai(), fetchBible: async () => { throw new Error('다시 가져오면 안 됨'); } });
  assert.deepEqual(calls, ['group']);
  assert.equal(row2.status, 'done');
  const out = proverbExport(row2);
  assert.equal(out.id, 'prov-09');
  assert.equal(out.study.commentary[0].passage, '잠언 9장');
});
await t('새벽기도 영상: 제목의 날짜 → 없으면 올라온 시각(토론토)', () => {
  assert.equal(dawnDateOf('[2026.10.09] 새벽기도 - 열왕기상 12장', '2026-10-10T01:00:00Z'), '2026-10-09');
  assert.equal(dawnDateOf('새벽기도회 26.10.08', ''), '2026-10-08');
  assert.equal(dawnDateOf('10월 7일 새벽기도', '2026-10-07T10:00:00Z'), '2026-10-07');
  assert.equal(dawnDateOf('새벽기도', '2026-10-09T03:30:00Z'), '2026-10-08'); // UTC 3:30 = 토론토 전날 밤
  assert.equal(dawnPlaylistId(''), 'PLexqr1dnrjPzF_IXx_pR1YRKUx13rX7CT');
  assert.equal(dawnPlaylistId('https://youtube.com/playlist?list=PLabcdefghijk'), 'PLabcdefghijk');
});
await t('새벽기도 영상: 날짜별 1:1 연결 · 예정된 라이브 제외 · 직접 넣은 영상은 그대로 · 이미 있으면 재생목록 안 읽음', async () => {
  let calls = 0;
  const fetchImpl = async (url) => {
    calls++;
    const u = new URL(url);
    const ep = u.pathname.split('/').pop();
    const item = (id, title, pub) => ({ snippet: { title }, contentDetails: { videoId: id, videoPublishedAt: pub }, status: { privacyStatus: 'public' } });
    const body = ep === 'playlistItems'
      ? { items: [item('vid0009aaaa', '[2026.10.09] 새벽기도', '2026-10-09T10:00:00Z'), item('vid0008aaaa', '[2026.10.08] 새벽기도', '2026-10-08T10:00:00Z'), item('vid0010live', '[2026.10.10] 새벽기도', '2026-10-10T10:00:00Z'), item('vid0007aaaa', '[2026.10.07] 새벽기도', '2026-10-07T10:00:00Z')] }
      : { items: u.searchParams.get('id').split(',').map((id) => ({ id, snippet: { liveBroadcastContent: id.includes('live') ? 'upcoming' : 'none' }, status: { privacyStatus: 'public', uploadStatus: 'processed' }, contentDetails: { duration: 'PT30M' } })) };
    return { ok: true, json: async () => body };
  };
  const rows = [{ date: '2026-10-08', dawn_json: JSON.stringify({ video_id: 'manualAAAAA', manual: true }) }, { date: '2026-10-07', dawn_json: '' }];
  const ups = await findDawnUpdates({ rows, playlistId: 'PLx', apiKey: 'k', dates: ['2026-10-10', '2026-10-09', '2026-10-08', '2026-10-07'], fetchImpl, now: new Date('2026-10-10T12:00:00Z') });
  assert.deepEqual(ups.map((u) => [u.date, u.dawn.video_id]), [['2026-10-09', 'vid0009aaaa'], ['2026-10-07', 'vid0007aaaa']]);
  calls = 0;
  const none = await findDawnUpdates({ rows: [{ date: '2026-10-09', dawn_json: JSON.stringify({ video_id: 'x' }) }], playlistId: 'PLx', apiKey: 'k', dates: ['2026-10-09'], fetchImpl });
  assert.equal(none.length, 0);
  assert.equal(calls, 0); // 08:00 다시 확인: 오늘 영상이 이미 있으면 재생목록을 읽지 않음
});
await t('새벽기도 영상: 오늘의 말씀을 다시 만들어도 연결은 남고, 내보내기에 들어감', async () => {
  const fetchReading = async () => parseYnResponse(ynSample);
  const prev = { date: '2026-10-08', dawn_json: JSON.stringify({ video_id: 'dawnVID1234', title: '새벽기도', manual: true }) };
  const row = await buildDailyDay('2026-10-08', prev, { ai: dailyAi(), fetchReading, now: () => 'T' });
  assert.equal(JSON.parse(row.dawn_json).video_id, 'dawnVID1234');
  assert.deepEqual(dailyExport(row).dawn, { video_id: 'dawnVID1234', title: '새벽기도', manual: true });
});
await t('오늘의 말씀 내보내기: 날짜별 파일 + 목록(최신순)', async () => {
  const fetchReading = async () => parseYnResponse(ynSample);
  const r1 = await buildDailyDay('2026-10-08', null, { ai: dailyAi(), fetchReading });
  const r2 = await buildDailyDay('2026-10-09', null, { ai: dailyAi(), fetchReading });
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sn-'));
  await exportDaily([r1, r2], { dataDir: dir, quiet: true });
  const idx = JSON.parse(await fs.readFile(path.join(dir, 'daily', 'index.json'), 'utf8'));
  assert.deepEqual(idx.days.map((d) => d.date), ['2026-10-09', '2026-10-08']);
  const one = JSON.parse(await fs.readFile(path.join(dir, 'daily', '2026-10-08.json'), 'utf8'));
  assert.equal(one.passages[0].book, '열왕기상');
  await fs.rm(dir, { recursive: true, force: true });
});
await t('오늘의 말씀 프롬프트: 본문에서만 출제 · 객관식 15 · 쉬움/중간/어려움 · CCM 한 곡', () => {
  const q = systemPromptForDaily('quiz');
  assert.match(q, /반드시 아래에 주어진 오늘의 성경 본문 내용에서만/);
  assert.match(q, /쉬움 4개, 중간 6개, 어려움 5개/);
  assert.match(q, /객관식 15개 · 빈칸 5개 · 주관식 5개/);
  for (const m of ['qt', 'study', 'group']) assert.match(systemPromptForDaily(m), /CCM을 정확히 1곡/);
  assert.match(systemPromptFor('qt'), /CCM을 정확히 1곡/); // 설교도 CCM 한 곡
  assert.match(systemPromptForDaily('qt'), /summaries/);
  assert.match(buildDailyMessage({ date: '2026-10-08', refs: '열왕기상 11장', text: '1 솔로몬' }), /2026\.10\.08 — 열왕기상 11장/);
});

await t('설교자 이름 통일: 무엇이 와도 "OOO 목사"', () => {
  for (const x of ['전대혁', '전대혁 담임목사', '전대혁 목사', '토론토영락교회 전대혁', '토론토영락교회 전대혁 담임목사님', '담임목사 전대혁', '설교자: 전대혁 목사', '영락교회 전대혁 목사', '전대혁목사', ' 전대혁  목사님 ']) assert.equal(normalizePreacher(x), '전대혁 목사', x);
  assert.equal(normalizePreacher('김철수 전도사'), '김철수 전도사'); // 목사가 아닌 직함은 그대로
  assert.equal(normalizePreacher('홍길동 목사, 김철수'), '홍길동 목사, 김철수 목사');
  assert.equal(normalizePreacher(''), '');
  assert.equal(normalizePreacher('Pastor Kim'), 'Pastor Kim');
});
await t('제목 통일: "주일예배 - 설교제목", 새벽기도는 제목이 없으면 성경 본문', () => {
  assert.equal(displayTitle({ category: 'sunday', title: '진리를 분별하는 삶', scripture: '요일 4:1-6' }), '주일예배 - 진리를 분별하는 삶');
  assert.equal(displayTitle({ category: 'dawn', title: '새벽기도회', scripture: '열왕기상 4, 5장', aiTitle: 'AI가 지은 제목' }), '새벽기도 - 열왕기상 4, 5장');
  assert.equal(displayTitle({ category: 'sunday', title: '주일예배', aiTitle: '믿음의 길', scripture: '창 12장' }), '주일예배 - 믿음의 길');
  assert.equal(displayTitle({ category: 'wednesday', title: '수요 예배', aiTitle: '', scripture: '시편 23편' }), '수요예배 - 시편 23편');
  assert.equal(displayTitle({ category: 'youth', title: '청년부예배 - 소명', scripture: '' }), '청년부예배 - 소명'); // 이미 통일된 형식은 그대로
  assert.equal(displayTitle({ category: 'user', title: '시편 23편 묵상' }), '시편 23편 묵상'); // 사용자 영상은 구분 이름을 붙이지 않음
  assert.equal(tidyTitle('은혜 - 감사'), '은혜 - 감사');
});
await t('제목 정돈: 유튜브 제목 → 깔끔한 제목, 규칙 밖은 그대로', () => {
  assert.equal(tidyTitle('[2026.10.04] 믿음으로 걷는 길 (창세기 12:1-9) - 홍길동 목사'), '믿음으로 걷는 길');
  assert.equal(tidyTitle('은혜 (feat. 간증)'), '은혜 (feat. 간증)');
  assert.equal(tidyTitle(''), '');
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
await t('사용자 영상 제목에서 제목·설교자·본문·날짜 읽기', async () => {
  const g = (x) => guessFromTitle(x);
  assert.deepEqual(g('진리를 분별하는 삶 | 전대혁 목사 | 요한복음 3:16-21'), { date: '', title: '진리를 분별하는 삶', scripture: '요한복음 3:16-21', preacher: '전대혁 목사', decomposed: true });
  const b = g('[주일설교] 믿음의 길 (창세기 12:1-9) - 홍길동 담임목사');
  assert.deepEqual([b.title, b.scripture, b.preacher], ['믿음의 길', '창세기 12:1-9', '홍길동 목사']);
  const c = g('2026.10.04 주일예배 열왕기상 4, 5장 윤정환 목사');
  assert.deepEqual([c.date, c.title, c.scripture, c.preacher], ['2026-10-04', '', '열왕기상 4, 5장', '윤정환 목사']);
  const d = g('하나님의 은혜 - 롬 8:1-11 | 토론토영락교회 전대혁 목사');
  assert.deepEqual([d.title, d.scripture, d.preacher], ['하나님의 은혜', '롬 8:1-11', '전대혁 목사']);
  const e = g('믿음의 길 홍길동 목사 #설교 #주일예배');
  assert.deepEqual([e.title, e.preacher], ['믿음의 길', '홍길동 목사']);
  const f = g('시편 23편 묵상 / 김철수 목사');
  assert.deepEqual([f.title, f.scripture, f.preacher], ['', '시편 23편', '김철수 목사']);
  for (const plain of ['예수님과 함께하는 40일 새벽기도', '다니엘 12명의 제자 이야기', 'The Power of Prayer - Pastor John']) {
    const x = g(plain);
    assert.equal(x.decomposed, false, plain);
    assert.equal(x.title, plain);
    assert.equal(x.scripture + x.preacher, '', plain);
  }
  // 교회 영상은 기존 형식대로, 사용자 영상만 자유 형식
  assert.equal(parseAnyTitle('sunday', '진리를 분별하는 삶 | 전대혁 목사').title, '');
  assert.equal(parseAnyTitle('user', '진리를 분별하는 삶 | 전대혁 목사').preacher, '전대혁 목사');
});
await t('사용자 영상: 제목에서 읽은 값이 정리 입력과 화면 데이터에 반영됨', async () => {
  const row = sermonRow({ category: 'user', title: '진리를 분별하는 삶 | 전대혁 목사 | 요한복음 3:16-21', published_at: '' });
  const info = knownInfo(row);
  assert.deepEqual([info.title, info.scripture, info.preacher], ['진리를 분별하는 삶', '요한복음 3:16-21', '전대혁 목사']);
  const done = await run(row, { ai: fakeAi() });
  assert.equal(done.patch.scripture, '요한복음 3:16-21');
  assert.equal(done.patch.preacher, '전대혁 목사');
  const ex = toExport({ ...row, ...done.patch, published_at: '2026-10-04' }).index;
  assert.equal(ex.title, '진리를 분별하는 삶'); // 사용자 영상은 구분 이름을 붙이지 않음
  assert.equal(ex.preacher, '전대혁 목사');
  assert.equal(ex.scripture, '요한복음 3:16-21');
  assert.equal(ex.book, '요한복음');
  // 직접 입력한 값은 제목에서 읽은 값보다 우선
  assert.equal(knownInfo({ ...row, preacher: '박은혜 목사', scripture: '시편 23편' }).preacher, '박은혜 목사');
});
await t('게시일 조회: 형식이 맞는 날짜만, 오류는 건너뜀', async () => {
  const ok = await fetchPublishDates(['a', 'b'], 'k', async () => ({ ok: true, json: async () => ({ items: [{ id: 'a', snippet: { publishedAt: '2026-09-28T14:00:00Z' } }, { id: 'b', snippet: {} }] }) }));
  assert.deepEqual([...ok], [['a', '2026-09-28']]);
  const fail = await fetchPublishDates(['a'], 'k', async () => ({ ok: false, status: 403 }));
  assert.equal(fail.size, 0);
});
await t('수정값: 앱에서 고친 제목·설교자가 자동 값보다 우선하고, 비우면 자동 값으로 돌아감', async () => {
  const done = await run(sermonRow(), { ai: fakeAi() });
  const auto = toExport(sermonRow({ ...done.patch })).index;
  assert.equal(auto.title, '주일예배 - 믿음으로 걷는 길');
  assert.equal(auto.preacher, '홍길동 목사');
  const fixed = toExport(sermonRow({ ...done.patch, title_override: '진리를 분별하는 삶', preacher_override: '전대혁 담임목사' })).index;
  assert.equal(fixed.title, '주일예배 - 진리를 분별하는 삶');
  assert.equal(fixed.preacher, '전대혁 목사');
  const onlyPreacher = toExport(sermonRow({ ...done.patch, preacher_override: '전대혁' })).index;
  assert.equal(onlyPreacher.title, auto.title);
  assert.equal(onlyPreacher.preacher, '전대혁 목사');
  const dawn = toExport(sermonRow({ ...done.patch, category: 'dawn', title: '[2026.10.01] 새벽기도회 (열왕기상 4, 5장) - 윤정환 목사', title_override: '솔로몬의 지혜' })).index;
  assert.equal(dawn.title, '새벽기도 - 솔로몬의 지혜');
  const blank = toExport(sermonRow({ ...done.patch, title_override: '   ', preacher_override: '' })).index;
  assert.equal(blank.title, auto.title);
  // 다시 정리해도 수정값은 시트에 그대로 남고(별도 칸), AI 결과의 설교자도 수정값을 따라감
  const again = await run(sermonRow({ status: 'redo', ...done.patch, preacher_override: '전대혁 목사' }), { ai: fakeAi() });
  assert.equal(again.patch.preacher, '전대혁 목사');
  assert.ok(!('title_override' in again.patch) && !('preacher_override' in again.patch));
  assert.equal(knownInfo(sermonRow({ title_override: '고친 제목' })).title, '고친 제목');
  // 날짜: 고친 날짜가 우선, 형식이 틀린 값은 무시
  assert.equal(auto.date, '2026-10-04');
  assert.equal(toExport(sermonRow({ ...done.patch, date_override: '2026-09-27' })).index.date, '2026-09-27');
  assert.equal(toExport(sermonRow({ ...done.patch, date_override: '어제' })).index.date, '2026-10-04');
  assert.equal(knownInfo(sermonRow({ date_override: '2026-09-27' })).date, '2026-09-27');
});
await t('수정값: 고친 성경 본문이 우선하고, 새 본문 것이 아닌 성경 본문은 화면 데이터에서 뺌', async () => {
  const done = await run(sermonRow(), { ai: fakeAi(), fetchBible: async (p) => ({ signature: bibleSignature(p), versions: [{ id: 'GAE' }] }) });
  const row = sermonRow({ ...done.patch });
  const auto = toExport(row);
  assert.equal(auto.index.scripture, '창세기 12:1-9');
  assert.ok(auto.detail.bible);
  const fixed = toExport({ ...row, scripture_override: '요한복음 3:16-21' });
  assert.equal(fixed.index.scripture, '요한복음 3:16-21');
  assert.equal(fixed.index.book, '요한복음');
  assert.equal(fixed.detail.bible, null); // 아직 이전 본문(창세기)의 성경 본문이므로 뺌
  const bad = toExport({ ...row, scripture_override: '알 수 없는 표기' });
  assert.equal(bad.detail.bible, null);
  const same = toExport({ ...row, scripture_override: '창세기 12:1-9' });
  assert.ok(same.detail.bible); // 같은 본문이면 그대로
  const dawn = toExport({ ...row, category: 'dawn', title: '새벽', scripture_override: '시편 23편' });
  assert.equal(dawn.index.title.startsWith('새벽기도 - '), true);
  assert.equal(knownInfo(sermonRow({ scripture: '창세기 1장', scripture_override: '시편 23편' })).scripture, '시편 23편');
});

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

await t('내보내기: 설교는 날짜 최신순으로 정렬 (같은 날은 제목 순, 날짜 없는 것은 맨 뒤)', async () => {
  const done = await run(sermonRow(), { ai: fakeAi() });
  const mk = (id, date, title) => sermonRow({ ...done.patch, video_id: id, date_override: date, title_override: title });
  const rows = [mk('aaa00000001', '2026-09-01', '나'), mk('aaa00000002', '2026-10-11', '다'), mk('aaa00000003', '2026-10-11', '가'), mk('aaa00000004', '2025-12-25', '라')];
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sn-'));
  await exportJson(rows, { dataDir: dir, quiet: true });
  const idx = JSON.parse(await fs.readFile(path.join(dir, 'sermons.json'), 'utf8'));
  assert.deepEqual(idx.sermons.map((x) => x.id), ['aaa00000003', 'aaa00000002', 'aaa00000001', 'aaa00000004']);
  await fs.rm(dir, { recursive: true, force: true });
});

await t('내보내기 제목: AI가 유튜브 제목을 그대로 베껴도 깔끔한 제목으로', () => {
  const raw = '[2026.10.04] 믿음으로 걷는 길 (창세기 12:1-9) - 홍길동 목사';
  const r = { ...normalizeReview(rawReview()), title: raw };
  const e = toExport(sermonRow({ title: raw, result_json: JSON.stringify(r) }));
  assert.equal(e.index.title, '주일예배 - 믿음으로 걷는 길');
  assert.equal(e.index.preacher, '홍길동 목사');
  const e2 = toExport(sermonRow({ title: '주일 설교 영상', result_json: JSON.stringify({ ...r, title: raw }) }));
  assert.equal(e2.index.title, '주일예배 - 믿음으로 걷는 길'); // 규칙이 없는 영상 제목이면 AI 제목을 정돈해서 사용
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

await t('개역개정 낭독 영상: 책 이름+장이 맞는 영상만, 드라마바이블 우선', async () => {
  const p = { book: 'GEN', chapter: 12, verse_from: 1, verse_to: 9 };
  assert.equal(scoreAudioTitle('창세기 112장 낭독', p), 0);
  assert.equal(scoreAudioTitle('출애굽기 12장 드라마바이블', p), 0);
  assert.equal(scoreAudioTitle('드라마바이블 창세기 10-12장', p), 0);
  assert.ok(scoreAudioTitle('[드라마바이블] 개역개정 창세기 12장', p) > scoreAudioTitle('창세기 12장 낭독', p));
  const items = [{ id: { videoId: 'bad00000001' }, snippet: { title: '시편 23편', channelTitle: 'x' } }, { id: { videoId: 'good0000001' }, snippet: { title: '[드라마바이블] 창세기 12장', channelTitle: 'ch' } }];
  const fetchImpl = async () => ({ ok: true, json: async () => ({ items }) });
  const block = await attachBibleAudio({ versions: [{ id: 'GAE' }] }, [p, { ...p, verse_from: 10 }], 'key', { fetchImpl });
  assert.equal(block.audio.length, 1); // 같은 장은 한 번만
  assert.equal(block.audio[0].video_id, 'good0000001');
  assert.equal(block.audio_checked, true);
  const none = await attachBibleAudio({ versions: [] }, [p], 'key', { fetchImpl: async () => ({ ok: true, json: async () => ({ items: [] }) }) });
  assert.deepEqual([none.audio, none.audio_checked], [[], true]); // 못 찾아도 다시 검색하지 않도록 표시
  const failed = await attachBibleAudio({ versions: [] }, [p], 'key', { fetchImpl: async () => ({ ok: false, status: 500, text: async () => '' }) });
  assert.ok(!failed.audio_checked); // 검색 오류면 다음 기회에 재시도
});

console.log(`\n${fail ? `❌ ${fail}개 실패, ` : '✅ '}${pass}개 통과`);
process.exit(fail ? 1 : 0);
