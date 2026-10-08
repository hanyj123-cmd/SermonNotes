// 외부 서비스 없이 핵심 로직만 점검하는 간단한 테스트: npm test
import assert from 'node:assert/strict';
import { extractJson, normalizeResult, readResponseText } from './lib/gemini.mjs';
import { extractPlaylistId, cleanTranscript } from './lib/youtube.mjs';
import { normalizeCategory } from './lib/sheets.mjs';
import { SYSTEM_PROMPT, buildUserMessage } from './lib/prompt.mjs';

let passed = 0;
const t = (name, fn) => {
  fn();
  passed++;
  console.log('✓', name);
};

t('재생목록 ID 추출', () => {
  assert.equal(extractPlaylistId('https://www.youtube.com/playlist?list=PLabcdefghijklmno'), 'PLabcdefghijklmno');
  assert.equal(extractPlaylistId('https://www.youtube.com/watch?v=xyz&list=PLabcdefghijklmno'), 'PLabcdefghijklmno');
  assert.equal(extractPlaylistId('PLabcdefghijklmno'), 'PLabcdefghijklmno');
  assert.equal(extractPlaylistId('https://example.com'), null);
});

t('구분(카테고리) 정규화', () => {
  assert.equal(normalizeCategory('새벽기도'), 'dawn');
  assert.equal(normalizeCategory(' 수요 예배 '), 'wednesday');
  assert.equal(normalizeCategory('Sunday'), 'sunday');
  assert.equal(normalizeCategory('금요기도회'), null);
});

t('자막 정리: 엔티티·잡음 제거', () => {
  const out = cleanTranscript([
    { text: '[음악]' },
    { text: '하나님이 우리를 사랑하&amp;#39;십니다' },
    { text: '  아멘   ' },
  ]);
  assert.equal(out, "하나님이 우리를 사랑하'십니다 아멘");
});

t('JSON 추출: 앞뒤 잡문/코드블록 허용', () => {
  const obj = extractJson('여기 결과입니다\n```json\n{"a":1,"b":{"c":"d"}}\n```\n끝');
  assert.deepEqual(obj, { a: 1, b: { c: 'd' } });
  assert.throws(() => extractJson('JSON 없음'));
});

t('결과 정규화: 정상 입력', () => {
  const r = normalizeResult({
    scripture: ['로마서 8:1-4'],
    theme: '정죄함이 없다',
    summary_short: '요약',
    outline: [{ heading: '1. 대지', content: '내용' }],
    applications: [{ title: '적용', detail: '상세' }],
    meditation_questions: ['질문', 123, ''],
    small_group: { icebreaker: '시작', observation: ['관찰'], application: ['적용'] },
  });
  assert.equal(r.meditation_questions.length, 1);
  assert.equal(r.small_group.reflection.length, 0);
  assert.equal(r.preacher, '');
});

t('결과 정규화: 필수 항목 누락 시 오류', () => {
  assert.throws(() => normalizeResult({ outline: [], applications: [] }));
  assert.throws(() =>
    normalizeResult({ outline: [{ heading: 'a', content: 'b' }], applications: [] }),
  );
});

t('Gemini 응답 읽기: 정상/차단/빈 응답/길이 초과', () => {
  assert.equal(readResponseText({ text: '{"a":1}', candidates: [{ finishReason: 'STOP' }] }), '{"a":1}');
  assert.throws(() => readResponseText({ text: '', promptFeedback: { blockReason: 'SAFETY' } }), /차단/);
  assert.throws(() => readResponseText({ text: undefined, candidates: [{ finishReason: 'OTHER' }] }), /빈 응답/);
  assert.throws(() => readResponseText({ text: '{"a":', candidates: [{ finishReason: 'MAX_TOKENS' }] }), /잘렸/);
});

t('프롬프트에 핵심 신학 기준과 JSON 지시 포함', () => {
  assert.match(SYSTEM_PROMPT, /웨스트민스터/);
  assert.match(SYSTEM_PROMPT, /JSON 객체 하나만/);
  const m = buildUserMessage({ category: 'dawn', title: 'T', publishedAt: '2026-10-01', transcript: 'X' });
  assert.match(m, /새벽기도/);
  assert.match(m, /\[자막 시작\]\nX\n\[자막 끝\]/);
});

console.log(`\n${passed}개 테스트 통과`);
