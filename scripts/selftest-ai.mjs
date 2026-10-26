// Gemini 엔진 · 메뉴별 모델 길잡이 · 영상 직접 분석 점검. 외부 서비스 없이 실행: npm test
import assert from 'node:assert/strict';
import { isClaudeModel, isGeminiModel, isAiModel, createClaude, DEFAULT_MODEL } from './lib/ai.mjs';
import { createGemini, readGeminiText, thinkingLevelFor, GEMINI_DEFAULT_MODEL } from './lib/ai-gemini.mjs';
import { createAiRouter, resolveMenu, AI_MENUS, MENU_KEYS } from './lib/ai-router.mjs';
import { processRow } from './lib/process.mjs';
import { buildUserMessage } from './lib/prompt.mjs';

let passed = 0;
const t = async (name, fn) => {
  await fn();
  passed++;
  console.log('✓', name);
};
const quiet = async (fn) => {
  const w = console.warn;
  const l = console.log;
  console.warn = () => {};
  console.log = () => {};
  try {
    return await fn();
  } finally {
    console.warn = w;
    console.log = l;
  }
};
const noSleep = async () => {};

const REVIEW = { title: 't', summary_short: '한 줄', review: { outline: [{ heading: '대지', paragraphs: ['내용'] }], summary: 's' } };
const LONG = '하나님은 우리를 사랑하십니다. '.repeat(30);
const info = { date: '2026-10-11', title: 'T', scripture: '', preacher: '' };
const reply = (text, extra = {}) => ({ status: 200, ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: '생각 중…', thought: true }, { text }] }, finishReason: 'STOP', ...extra }] }) });
const fail = (status, message = 'x') => ({ status, ok: false, json: async () => ({ error: { message } }) });

/** 가짜 fetch: 요청을 모아 두고, handler(번호, 요청 본문) 이 돌려주는 응답을 줍니다 */
function fakeFetch(handler) {
  const calls = [];
  const fn = async (url, opts) => {
    const body = JSON.parse(opts.body);
    calls.push({ url: String(url), headers: opts.headers, body });
    return handler(calls.length, body);
  };
  fn.calls = calls;
  return fn;
}
const gem = (fetch, opts = {}) => createGemini('GKEY', 'gemini-3.8-flash', { fetch, sleep: noSleep, ...opts });
const review = (ai, extra = {}) => ai.generateMode('review', { category: 'sunday', title: 'T', publishedAt: '2026-10-11', info, ...extra });

/* ---------- 모델 이름 ---------- */
await t('모델 이름: claude- / gemini- 만 허용', () => {
  assert.ok(isGeminiModel('gemini-3.8-flash') && isGeminiModel('gemini-4-argon'));
  assert.ok(!isGeminiModel('claude-opus-5-5') && !isGeminiModel('gpt-5') && !isGeminiModel('') && !isGeminiModel('gemini-'));
  assert.ok(isAiModel('claude-opus-5-5') && isAiModel('gemini-3.8-flash') && !isAiModel('gpt-5') && !isAiModel('bad model; rm -rf'));
  assert.ok(isClaudeModel('claude-sonnet-5-5') && !isClaudeModel('gemini-3.8-flash'));
});

/* ---------- Gemini 응답 읽기 ---------- */
await t('Gemini 응답: 생각 과정은 빼고 답만 · 빈 응답 · 잘림 · 차단은 이유와 함께 오류', () => {
  const ok = { candidates: [{ content: { parts: [{ text: '속마음', thought: true }, { text: '{"a":' }, { text: '1}' }] }, finishReason: 'STOP' }] };
  assert.equal(readGeminiText(ok), '{"a":1}');
  assert.throws(() => readGeminiText({ candidates: [{ content: { parts: [{ text: '  ' }] }, finishReason: 'SAFETY' }] }), /빈 응답.*SAFETY/);
  assert.throws(() => readGeminiText({ candidates: [{ content: { parts: [{ text: '{"a"' }] }, finishReason: 'MAX_TOKENS' }] }), /잘렸/);
  assert.throws(() => readGeminiText({ promptFeedback: { blockReason: 'PROHIBITED_CONTENT' } }), /거절.*PROHIBITED_CONTENT/);
  assert.throws(() => readGeminiText({}), /빈 응답/);
});

await t('Gemini: 기본 모델 · 생각 깊이 값 (이상한 값은 medium)', () => {
  assert.equal(GEMINI_DEFAULT_MODEL, 'gemini-3.8-flash');
  assert.equal(thinkingLevelFor('high'), 'high');
  assert.equal(thinkingLevelFor('max'), 'medium');
  assert.equal(gem(fakeFetch(() => reply('{}')), { effort: 'max' }).effort, 'medium');
  assert.equal(gem(fakeFetch(() => reply('{}')), { effort: 'low' }).effort, 'low');
});

/* ---------- Gemini 요청 형식 ---------- */
await t('Gemini(영상 없이): 요청 형식 — 모델 주소 · 키 · 시스템 지침 · JSON · 생각 깊이, 영상 설정은 없음', async () => {
  const f = fakeFetch(() => reply(JSON.stringify(REVIEW)));
  const ai = gem(f, { effort: 'high' });
  const r = await review(ai, { transcript: LONG });
  assert.equal(r.review.outline[0].heading, '대지');
  const c = f.calls[0];
  assert.equal(c.url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent');
  assert.equal(c.headers['x-goog-api-key'], 'GKEY');
  assert.match(c.body.systemInstruction.parts[0].text, /JSON/);
  assert.equal(c.body.generationConfig.responseMimeType, 'application/json');
  assert.deepEqual(c.body.generationConfig.thinkingConfig, { thinkingLevel: 'high' });
  assert.equal(c.body.generationConfig.mediaResolution, undefined);
  assert.equal(c.body.contents[0].role, 'user');
  assert.equal(c.body.contents[0].parts.length, 1);
  assert.match(c.body.contents[0].parts[0].text, /하나님은 우리를/);
  assert.equal(ai.provider, 'gemini');
  assert.equal(ai.watchesVideo, true);
});

await t('Gemini(영상): 유튜브 영상 주소를 그대로 넘기고 자막 없이 영상을 듣고 정리하라고 요청', async () => {
  const f = fakeFetch(() => reply(JSON.stringify(REVIEW)));
  const r = await review(gem(f), { videoId: 'abc12345678', transcript: LONG });
  assert.equal(r.review.outline[0].heading, '대지');
  assert.equal(f.calls.length, 1);
  const parts = f.calls[0].body.contents[0].parts;
  assert.equal(parts.length, 2);
  assert.equal(parts[1].file_data.file_uri, 'https://www.youtube.com/watch?v=abc12345678');
  assert.match(parts[0].text, /첨부한 유튜브 영상/);
  assert.ok(!/\[자막 시작\]/.test(parts[0].text), '영상으로 정리할 때는 자막 본문을 보내지 않음');
  assert.ok(!parts[0].text.includes('하나님은 우리를'));
  assert.equal(f.calls[0].body.generationConfig.mediaResolution, 'MEDIA_RESOLUTION_LOW');
});

await t('Gemini(영상): 영상을 열 수 없으면(비공개 등) 자막 글로 대신 — 영상 없이 한 번 더 요청', async () => {
  const f = fakeFetch((n) => (n === 1 ? fail(400, 'Video is private') : reply(JSON.stringify(REVIEW))));
  const r = await quiet(() => review(gem(f), { videoId: 'abc12345678', transcript: LONG }));
  assert.equal(r.review.outline[0].heading, '대지');
  assert.equal(f.calls.length, 2);
  const second = f.calls[1].body.contents[0].parts;
  assert.equal(second.length, 1);
  assert.ok(!second[0].file_data);
  assert.match(second[0].text, /\[자막 시작\]/);
  assert.match(second[0].text, /하나님은 우리를/);
  assert.equal(f.calls[1].body.generationConfig.mediaResolution, undefined);
});

await t('Gemini(영상): 영상도 못 열고 자막도 없으면 바로 중단(재시도 없음) · 영상 주소가 없으면 자막 없이는 시작하지 않음', async () => {
  const f = fakeFetch(() => fail(403, 'Permission denied for video'));
  await assert.rejects(quiet(() => review(gem(f), { videoId: 'abc12345678' })), /403/);
  assert.equal(f.calls.length, 1);
  await assert.rejects(review(gem(fakeFetch(() => reply('{}')))), /정리할 설교 내용/);
});

await t('Gemini: API 키 문제는 영상 문제로 오해하지 않고 바로 중단 (자막으로 대신하지도 않음)', async () => {
  const f = fakeFetch(() => fail(400, 'API key not valid. Please pass a valid API key.'));
  await assert.rejects(quiet(() => review(gem(f), { videoId: 'abc12345678', transcript: LONG })), /API key/);
  assert.equal(f.calls.length, 1);
  const f2 = fakeFetch(() => fail(401, 'unauthorized'));
  await assert.rejects(quiet(() => review(gem(f2), { transcript: LONG })), /401/);
  assert.equal(f2.calls.length, 1);
});

await t('Gemini: 과부하(503)·한도(429)는 기다렸다가 재시도, 깨진 JSON 은 바로 다시', async () => {
  const waits = [];
  const f = fakeFetch((n) => (n === 1 ? fail(503, 'busy') : n === 2 ? fail(429, 'rate') : n === 3 ? reply('{"깨짐"') : reply(JSON.stringify(REVIEW))));
  const ai = createGemini('K', undefined, { fetch: f, sleep: async (ms) => waits.push(ms) });
  // 4번째 응답까지 가려면 시도가 4번 필요한데 최대 3번 → 마지막은 JSON 오류로 실패
  await assert.rejects(quiet(() => review(ai, { transcript: LONG })), /JSON/);
  assert.equal(f.calls.length, 3);
  assert.deepEqual(waits, [8000, 16000]);
  const f2 = fakeFetch((n) => (n === 1 ? fail(503, 'busy') : reply(JSON.stringify(REVIEW))));
  const r = await quiet(() => review(createGemini('K', undefined, { fetch: f2, sleep: noSleep }), { transcript: LONG }));
  assert.equal(r.review.outline[0].heading, '대지');
  assert.equal(f2.calls[1].url.includes(GEMINI_DEFAULT_MODEL), true);
});

await t('Gemini: 생각 깊이를 모르는 모델이면 그 설정만 빼고 다시 보냄 (한 번 알게 되면 다음부터 처음부터 뺌)', async () => {
  const f = fakeFetch((n, body) => (body.generationConfig.thinkingConfig ? fail(400, 'Thinking level is not supported for this model') : reply(JSON.stringify(REVIEW))));
  const ai = gem(f);
  const r = await quiet(() => review(ai, { transcript: LONG }));
  assert.equal(r.review.outline[0].heading, '대지');
  assert.equal(f.calls.length, 2);
  assert.ok(f.calls[0].body.generationConfig.thinkingConfig);
  assert.equal(f.calls[1].body.generationConfig.thinkingConfig, undefined);
  await quiet(() => review(ai, { transcript: LONG }));
  assert.equal(f.calls[2].body.generationConfig.thinkingConfig, undefined);
});

await t('Gemini: 영상 없는 메뉴(오늘의 말씀 · 잠언)도 같은 방식으로 만듦', async () => {
  const quizItem = (i) => ({ question: `문제${i}`, options: ['가', '나', '다', '라'], answer_index: i % 4, level: '중간', explanation: '근거', hint: '힌트' });
  const wa = (i) => ({ question: `단답${i}`, answer: '믿음', accept: [], level: '쉬움', explanation: 'e', hint: '힌트' });
  const quiz = { multiple_choice: Array.from({ length: 15 }, (_, i) => quizItem(i)), word_answer: Array.from({ length: 5 }, (_, i) => wa(i)) };
  const f = fakeFetch(() => reply(JSON.stringify({ quiz })));
  const r = await quiet(() => gem(f).generateDaily('quiz', { date: '2026-10-19', refs: '창 1', text: '본문' }));
  assert.equal(r.multiple_choice.length, 15);
  assert.equal(f.calls[0].body.contents[0].parts.length, 1);
  assert.equal(f.calls[0].body.generationConfig.mediaResolution, undefined);
});

/* ---------- 프롬프트 ---------- */
await t('설교 요청 글: 자막 모드는 예전과 같고, 영상 모드는 자막 칸이 없음', () => {
  const base = { category: 'sunday', title: 'T', publishedAt: '2026-10-11', info };
  const text = buildUserMessage('qt', { ...base, transcript: '자막 내용' });
  assert.match(text, /^다음은 교회 유튜브 영상의 자막입니다/);
  assert.match(text, /\[자막 시작\]\n자막 내용\n\[자막 끝\]$/);
  const video = buildUserMessage('qt', { ...base, video: true });
  assert.match(video, /첨부한 유튜브 영상/);
  assert.ok(!video.includes('[자막 시작]'));
  assert.match(video, /\[영상 제목\] T/);
});

await t('Claude 엔진: 영상은 보지 못하고 자막이 없으면 시작하지 않음', async () => {
  const claude = createClaude('k', DEFAULT_MODEL, { client: { messages: { stream: () => ({ finalMessage: async () => ({}) }) } } });
  assert.equal(claude.watchesVideo, false);
  assert.equal(claude.provider, 'claude');
  await assert.rejects(review(claude, { videoId: 'abc12345678' }), /정리할 설교 내용/);
});

/* ---------- 메뉴별 모델 길잡이 ---------- */
await t('메뉴: 설교 구분 5개 + 오늘의 말씀 · 잠언 묵상 · AI 문장 다듬기', () => {
  assert.deepEqual(MENU_KEYS, ['sunday', 'wednesday', 'dawn', 'youth', 'user', 'daily', 'proverbs', 'polish']);
  assert.deepEqual(AI_MENUS.filter((m) => m.video).map((m) => m.key), ['sunday', 'wednesday', 'dawn', 'youth', 'user']);
});

await t('메뉴별 모델: 따로 고르지 않으면 기본(없으면 Claude 기본 모델), 고른 메뉴만 다르게', () => {
  assert.deepEqual(resolveMenu('sunday', {}, {}), { model: DEFAULT_MODEL, effort: 'medium', provider: 'claude', custom: false });
  const settings = { ai_model: 'claude-opus-5-5', ai_effort: 'low', ai_model_sunday: 'gemini-3.8-flash', ai_effort_sunday: 'high', ai_model_daily: '', ai_effort_proverbs: 'high' };
  assert.deepEqual(resolveMenu('sunday', settings), { model: 'gemini-3.8-flash', effort: 'high', provider: 'gemini', custom: true });
  assert.deepEqual(resolveMenu('daily', settings), { model: 'claude-opus-5-5', effort: 'low', provider: 'claude', custom: false });
  assert.deepEqual(resolveMenu('proverbs', settings), { model: 'claude-opus-5-5', effort: 'high', provider: 'claude', custom: false });
});

await t('메뉴별 모델: 기본 모델도 Gemini 로 둘 수 있고, 이상한 이름·깊이는 무시', () => {
  assert.equal(resolveMenu('dawn', { ai_model: 'gemini-3.8-flash' }).provider, 'gemini');
  const bad = resolveMenu('dawn', { ai_model: 'gpt-5', ai_model_dawn: 'bad model', ai_effort: 'max', ai_effort_dawn: 'huge' }, { CLAUDE_MODEL: 'claude-haiku-5-5', CLAUDE_EFFORT: 'high' });
  assert.deepEqual(bad, { model: 'claude-haiku-5-5', effort: 'high', provider: 'claude', custom: false });
  // 환경변수 CLAUDE_MODEL 이 Claude 가 아니면 쓰지 않음
  assert.equal(resolveMenu('dawn', {}, { CLAUDE_MODEL: 'gemini-3.8-flash' }).model, DEFAULT_MODEL);
});

await t('길잡이: 메뉴마다 알맞은 회사의 엔진을 만들고, 같은 설정은 하나를 같이 씀', () => {
  const made = [];
  const router = createAiRouter({
    settings: { ai_model: 'claude-sonnet-5-5', ai_model_sunday: 'gemini-3.8-flash', ai_model_dawn: 'gemini-3.8-flash', ai_effort_sunday: 'low', ai_effort_dawn: 'low' },
    anthropicKey: 'AK',
    geminiKey: 'GK',
    factories: {
      claude: (key, model, o) => (made.push(['claude', key, model, o.effort]), { model, effort: o.effort, provider: 'claude', watchesVideo: false }),
      gemini: (key, model, o) => (made.push(['gemini', key, model, o.effort]), { model, effort: o.effort, provider: 'gemini', watchesVideo: true }),
    },
  });
  assert.equal(router.forMenu('sunday').provider, 'gemini');
  assert.equal(router.forMenu('dawn'), router.forMenu('sunday'), '같은 모델·깊이는 같은 엔진');
  assert.equal(router.forMenu('daily').model, 'claude-sonnet-5-5');
  assert.equal(router.forMenu('youth'), router.forMenu('daily'));
  assert.deepEqual(made, [['gemini', 'GK', 'gemini-3.8-flash', 'low'], ['claude', 'AK', 'claude-sonnet-5-5', 'medium']]);
  const lines = router.describe();
  assert.equal(lines.length, 7); // 다듬기는 Apps Script 가 하므로 동기화 안내에서는 뺌
  assert.match(lines[0], /주일예배: gemini-3\.8-flash.*영상 직접 분석/);
  assert.match(lines[5], /오늘의 말씀: claude-sonnet-5-5/);
  assert.ok(!/영상 직접 분석/.test(lines[5]));
});

await t('길잡이: 키가 없는 회사의 모델은 그 메뉴만 이유를 알려 주며 실패하고, 다른 메뉴는 정상', async () => {
  const router = createAiRouter({ settings: { ai_model: 'claude-sonnet-5-5', ai_model_sunday: 'gemini-3.8-flash' }, anthropicKey: 'AK', geminiKey: '', factories: { claude: (k, m, o) => ({ model: m, effort: o.effort, provider: 'claude', watchesVideo: false }) } });
  const g = router.forMenu('sunday');
  assert.equal(g.watchesVideo, false, '못 쓰는 엔진은 영상 모드로 가지 않음 (자막 확보 단계가 먼저 돌지 않게)');
  await assert.rejects(g.generateMode('review', {}), /GEMINI_API_KEY/);
  await assert.rejects(g.generateDaily('qt', {}), /GEMINI_API_KEY/);
  assert.equal(router.forMenu('daily').provider, 'claude');
  assert.match(router.describe()[0], /키 없음/);
  const noClaude = createAiRouter({ settings: {}, anthropicKey: '', geminiKey: 'GK' });
  await assert.rejects(noClaude.forMenu('daily').generateDaily('qt', {}), /ANTHROPIC_API_KEY/);
});

/* ---------- 영상 처리: Gemini 가 영상을 직접 분석 ---------- */
const silent = { info() {}, warn() {}, error() {} };
const sermonRow = (o = {}) => ({ video_id: 'abc12345678', category: 'sunday', title: '[2026.10.04] 믿음으로 걷는 길 (창세기 12:1-9) - 홍길동 목사', published_at: '2026-10-04', url: 'x', status: 'pending', result_json: '', note: '', ...o });
const watcher = (calls) => ({
  model: 'gemini-3.8-flash',
  provider: 'gemini',
  watchesVideo: true,
  async generateMode(mode, args) {
    calls.push({ mode, ...args });
    return { review: { schema: 3, title: 't', summary_short: 's', review: { outline: [{ heading: 'h', paragraphs: ['p'] }], summary: 's' } }, qt: { a: 1 }, study: { a: 1 }, group: { a: 1 } }[mode];
  },
});
const runRow = async (row, deps) => {
  const patches = [];
  const result = await processRow(row, { update: async (p) => patches.push(p), now: () => 'T', log: silent, ...deps });
  return { result, patch: Object.assign({}, ...patches) };
};

await t('영상 처리(Gemini): 음성 인식 키는 넘기지 않고(영상을 직접 보므로) 영상 주소를 모드마다 넘김 · 자막이 없어도 진행', async () => {
  const calls = [];
  let obtainOpts = null;
  const { result, patch } = await runRow(sermonRow(), {
    ai: watcher(calls),
    geminiKey: 'GK',
    supadataKey: 'SK',
    obtain: async (row, opts) => ((obtainOpts = opts), { kind: 'none', problems: ['YouTube 자막: 없음'] }),
  });
  assert.equal(result, 'done');
  assert.equal(obtainOpts.geminiKey, undefined);
  assert.equal(obtainOpts.supadataKey, undefined);
  assert.deepEqual(calls.map((c) => c.mode), ['review', 'qt', 'study', 'group']);
  assert.ok(calls.every((c) => c.videoId === 'abc12345678' && c.transcript === ''));
  assert.match(patch.note, /gemini-3\.8-flash 영상 직접 분석/);
});

await t('영상 처리(Gemini): YouTube 자막이 있으면 영상을 못 열 때를 대비한 보조로 함께 넘김', async () => {
  const calls = [];
  const { result } = await runRow(sermonRow(), { ai: watcher(calls), obtain: async () => ({ kind: 'text', text: '설교 자막 '.repeat(50), source: 'YouTube 자막', problems: [] }) });
  assert.equal(result, 'done');
  assert.ok(calls.every((c) => c.videoId === 'abc12345678' && c.transcript.length > 100));
});

await t('영상 처리(Gemini): 직접 붙여넣은 자막(transcript_manual)이 있으면 영상 대신 그 글로 정리', async () => {
  const calls = [];
  let obtainOpts = null;
  const { result, patch } = await runRow(sermonRow({ transcript_manual: '직접 붙여넣은 자막 '.repeat(30) }), {
    ai: watcher(calls),
    geminiKey: 'GK',
    obtain: async (row, opts) => ((obtainOpts = opts), { kind: 'text', text: row.transcript_manual, source: '직접 입력한 자막', problems: [] }),
  });
  assert.equal(result, 'done');
  assert.equal(obtainOpts.geminiKey, 'GK', '영상을 보지 않으므로 예전처럼 자막 확보 순서를 그대로 탐');
  assert.ok(calls.every((c) => c.videoId === undefined && c.transcript.includes('직접 붙여넣은')));
  assert.match(patch.note, /직접 입력한 자막/);
});

await t('영상 처리(Claude): 예전과 같음 — 자막이 없으면 no_transcript, 영상 주소는 넘기지 않음', async () => {
  const calls = [];
  const claudeLike = { ...watcher(calls), model: 'claude-sonnet-5-5', provider: 'claude', watchesVideo: false };
  const none = await runRow(sermonRow(), { ai: claudeLike, obtain: async () => ({ kind: 'none', problems: ['YouTube 자막: 없음'] }) });
  assert.equal(none.result, 'no_transcript');
  assert.equal(calls.length, 0);
  const ok = await runRow(sermonRow(), { ai: claudeLike, obtain: async () => ({ kind: 'text', text: '설교 자막 '.repeat(50), source: 'YouTube 자막', problems: [] }) });
  assert.equal(ok.result, 'done');
  assert.ok(calls.every((c) => c.videoId === undefined));
});

console.log(`\n${passed}개 테스트 통과`);
