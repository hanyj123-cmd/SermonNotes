// 자막 확보(YouTube 자막 · Supadata)와 Claude 호출 점검. 외부 서비스 없이 실행: npm test
import assert from 'node:assert/strict';
import { fetchSupadata, obtainMaterial } from './lib/transcript.mjs';
import { createClaude, DEFAULT_MODEL, isClaudeModel } from './lib/ai.mjs';

let passed = 0;
const t = async (name, fn) => {
  await fn();
  passed++;
  console.log('✓', name);
};
const quiet = async (fn) => {
  const w = console.warn;
  console.warn = () => {};
  try {
    return await fn();
  } finally {
    console.warn = w;
  }
};

const LONG = '하나님은 우리를 사랑하십니다. '.repeat(30); // 200자 이상
const res = (status, body = {}) => ({ status, ok: status >= 200 && status < 300, json: async () => body });
const noSleep = async () => {};

// ---------- Supadata ----------
function sequence(responses) {
  const calls = [];
  const fn = async (url, opts) => {
    calls.push({ url: String(url), headers: opts?.headers });
    const next = responses.shift();
    if (!next) throw new Error('예상보다 많은 요청');
    return next;
  };
  fn.calls = calls;
  return fn;
}
const sup = (responses, extra = {}) => {
  const f = sequence(responses);
  return { f, run: () => fetchSupadata('VID12345678', 'KEY', { fetchImpl: f, sleepImpl: noSleep, pollMs: 1, maxWaitMs: 5, ...extra }) };
};

await t('Supadata: 바로 받은 자막(텍스트)', async () => {
  const { f, run } = sup([res(200, { content: LONG, lang: 'ko' })]);
  const r = await run();
  assert.equal(r.text.startsWith('하나님은'), true);
  const u = new URL(f.calls[0].url);
  assert.equal(u.origin + u.pathname, 'https://api.supadata.ai/v1/transcript');
  assert.equal(u.searchParams.get('url'), 'https://www.youtube.com/watch?v=VID12345678');
  assert.equal(u.searchParams.get('text'), 'true');
  assert.equal(u.searchParams.get('mode'), 'auto');
  assert.equal(u.searchParams.get('lang'), 'ko');
  assert.equal(f.calls[0].headers['x-api-key'], 'KEY');
});

await t('Supadata: 구간 배열 형태도 하나의 텍스트로', async () => {
  const { run } = sup([res(200, { content: [{ text: LONG }, { text: '아멘' }] })]);
  assert.match((await run()).text, /아멘$/);
});

await t('Supadata: 긴 영상은 작업(202) 접수 후 끝날 때까지 확인', async () => {
  const { f, run } = sup([res(202, { jobId: 'job/1' }), res(200, { status: 'queued' }), res(200, { status: 'active' }), res(200, { status: 'completed', content: LONG })], { maxWaitMs: 50 });
  const r = await run();
  assert.ok(r.text.length > 200);
  assert.equal(f.calls.length, 4);
  assert.equal(f.calls[1].url, 'https://api.supadata.ai/v1/transcript/job%2F1');
  assert.equal(f.calls[1].headers['x-api-key'], 'KEY');
});

await t('Supadata: 작업 실패 / 시간 초과 / 작업번호 없음', async () => {
  await assert.rejects(sup([res(202, { jobId: 'j' }), res(200, { status: 'failed', error: { message: 'boom' } })]).run(), /음성 인식 실패.*boom/);
  await assert.rejects(sup([res(202, { jobId: 'j' }), res(200, { status: 'active' }), res(200, { status: 'active' }), res(200, { status: 'active' }), res(200, { status: 'active' }), res(200, { status: 'active' }), res(200, { status: 'active' })]).run(), /너무 오래/);
  await assert.rejects(sup([res(202, {})]).run(), /작업 번호/);
  await assert.rejects(sup([res(202, { jobId: 'j' }), res(500, { message: 'x' })]).run(), /작업 확인 실패 \(500\)/);
});

await t('Supadata: 빈 음성 / 너무 짧은 결과', async () => {
  await assert.rejects(sup([res(200, { content: '' })]).run(), /음성이 감지되지 않았습니다/);
  await assert.rejects(sup([res(200, { content: [] })]).run(), /음성이 감지되지 않았습니다/);
  await assert.rejects(sup([res(200, { content: '짧다' })]).run(), /너무 짧습니다/);
});

await t('Supadata: 오류 코드별 안내', async () => {
  await assert.rejects(sup([res(206)]).run(), /얻지 못했습니다/);
  await assert.rejects(sup([res(401)]).run(), /API 키/);
  await assert.rejects(sup([res(402)]).run(), /크레딧/);
  await assert.rejects(sup([res(404)]).run(), /비공개/);
  await assert.rejects(sup([res(429)]).run(), /너무 많습니다/);
  await assert.rejects(sup([res(403, { message: '로그인 필요' })]).run(), /접근할 수 없는 영상.*로그인 필요/);
  await assert.rejects(sup([res(500, { error: 'internal' })]).run(), /응답 오류 \(500\).*internal/);
});

// ---------- 자막 확보 순서 ----------
const row = { video_id: 'VID12345678', transcript_manual: '' };
const spy = (impl) => {
  const fn = async (...a) => {
    fn.n++;
    return impl(...a);
  };
  fn.n = 0;
  return fn;
};

await t('확보 순서: 직접 붙여넣은 자막이 최우선 (다른 곳은 호출하지 않음)', async () => {
  const caps = spy(() => ({ text: 'x' }));
  const sd = spy(() => ({ text: 'y' }));
  const m = await obtainMaterial({ ...row, transcript_manual: '  내가 붙여넣은 자막  ' }, { fetchCaptions: caps, supadata: sd, supadataKey: 'K' });
  assert.deepEqual([m.kind, m.text, m.source], ['text', '내가 붙여넣은 자막', '직접 입력한 자막']);
  assert.equal(caps.n + sd.n, 0);
});

await t('확보 순서: YouTube 자막이 있으면 Supadata는 쓰지 않음', async () => {
  const sd = spy(() => ({ text: 'y' }));
  const m = await obtainMaterial(row, { fetchCaptions: async () => ({ text: LONG, error: '' }), supadata: sd, supadataKey: 'K' });
  assert.equal(m.source, 'YouTube 자막');
  assert.equal(sd.n, 0);
});

await t('확보 순서: YouTube 자막 실패 → Supadata 키가 있으면 Supadata', async () => {
  const sd = spy(() => ({ text: LONG }));
  const m = await obtainMaterial(row, { fetchCaptions: async () => ({ text: '', error: 'disabled' }), supadata: sd, supadataKey: 'K' });
  assert.deepEqual([m.kind, m.source], ['text', 'Supadata 자막']);
  assert.equal(sd.n, 1);
});

await t('확보 순서: Supadata 키가 없으면 호출하지 않고 none (사유 기록)', async () => {
  const sd = spy(() => ({ text: LONG }));
  const m = await obtainMaterial(row, { fetchCaptions: async () => ({ text: '', error: 'disabled' }), supadata: sd, supadataKey: '' });
  assert.equal(m.kind, 'none');
  assert.equal(sd.n, 0);
  assert.match(m.problems.join(' '), /YouTube 자막: disabled/);
  assert.match(m.problems.join(' '), /SUPADATA_API_KEY/);
});

await t('확보 순서: Supadata도 실패하면 none (실패 사유는 모두 기록)', async () => {
  const m = await obtainMaterial(row, {
    fetchCaptions: async () => ({ text: '', error: 'disabled' }),
    supadata: async () => {
      throw new Error('크레딧이 부족합니다');
    },
    supadataKey: 'K',
  });
  assert.equal(m.kind, 'none');
  assert.equal(m.problems.length, 2);
  assert.match(m.problems[1], /Supadata: 크레딧이 부족합니다/);
});

// ---------- Claude ----------
const REVIEW = { title: 't', summary_short: '한 줄', review: { outline: [{ heading: '대지', paragraphs: ['내용'] }], summary: 's' } };
const msg = (text, stop = 'end_turn') => ({ content: [{ type: 'thinking', thinking: '…' }, { type: 'text', text }], stop_reason: stop });
function fakeClient(handler) {
  const requests = [];
  return {
    requests,
    messages: {
      stream: (req) => {
        requests.push(req);
        const n = requests.length;
        return { finalMessage: async () => handler(n, req) };
      },
    },
  };
}
const info = { date: '2026-10-11', title: 'T', scripture: '', preacher: '' };

await t('Claude: 기본 모델 · 모델 이름 검사 (예전 Gemini 설정은 무시)', () => {
  assert.equal(DEFAULT_MODEL, 'claude-sonnet-5-5');
  assert.ok(isClaudeModel('claude-opus-5-5'));
  assert.ok(!isClaudeModel('gemini-3.8-flash'));
  assert.ok(!isClaudeModel(''));
});

await t('Claude: 요청 형식 (모델 · 시스템 지침 · 자막 · effort · 넉넉한 길이)', async () => {
  const client = fakeClient(() => msg(JSON.stringify(REVIEW)));
  const ai = createClaude('k', 'claude-opus-5-5', { client, sleep: noSleep, effort: 'high' });
  const r = await ai.generateMode('review', { category: 'sunday', title: 'T', publishedAt: '2026-10-11', transcript: LONG, info });
  assert.equal(r.review.outline[0].heading, '대지');
  const req = client.requests[0];
  assert.equal(req.model, 'claude-opus-5-5');
  assert.deepEqual(req.output_config, { effort: 'high' });
  assert.ok(req.max_tokens >= 32000);
  assert.match(req.system, /JSON/);
  assert.equal(req.messages[0].role, 'user');
  assert.match(req.messages[0].content, /하나님은 우리를/);
  assert.equal(req.temperature, undefined);
});

await t('Claude: 이상한 effort 는 medium 으로', () => {
  assert.equal(createClaude('k', DEFAULT_MODEL, { client: fakeClient(() => ({})), effort: 'max' }).effort, 'medium');
});

await t('Claude: 과부하(529)·한도(429)는 기다렸다가 재시도', async () => {
  const waits = [];
  const client = fakeClient((n) => {
    if (n === 1) throw Object.assign(new Error('overloaded'), { status: 529 });
    return msg(JSON.stringify(REVIEW));
  });
  const ai = createClaude('k', DEFAULT_MODEL, { client, sleep: async (ms) => waits.push(ms) });
  await quiet(() => ai.generateMode('review', { category: 'sunday', title: 'T', transcript: LONG, info }));
  assert.equal(client.requests.length, 2);
  assert.deepEqual(waits, [8000]);
});

await t('Claude: 깨진 JSON·잘린 답은 3번까지 다시, 키 오류·크레딧 소진은 바로 중단', async () => {
  let client = fakeClient(() => msg('JSON 아님'));
  await assert.rejects(quiet(() => createClaude('k', DEFAULT_MODEL, { client, sleep: noSleep }).generateMode('review', { category: 'sunday', title: 'T', transcript: LONG, info })), /JSON/);
  assert.equal(client.requests.length, 3);
  client = fakeClient(() => msg('{"a":', 'max_tokens'));
  await assert.rejects(quiet(() => createClaude('k', DEFAULT_MODEL, { client, sleep: noSleep }).generateDaily('qt', { date: '2026-10-16', refs: 'r', text: 't' })), /잘렸/);
  client = fakeClient(() => {
    throw Object.assign(new Error('invalid x-api-key'), { status: 401 });
  });
  await assert.rejects(quiet(() => createClaude('k', DEFAULT_MODEL, { client, sleep: noSleep }).generateProverb('word', { chapter: 3, text: 't' })), /api-key/);
  assert.equal(client.requests.length, 1);
  client = fakeClient(() => {
    throw Object.assign(new Error('Your credit balance is too low to access the Anthropic API.'), { status: 400 });
  });
  await assert.rejects(quiet(() => createClaude('k', DEFAULT_MODEL, { client, sleep: noSleep }).generateDaily('quiz', { date: '2026-10-16', refs: 'r', text: 't' })), /credit/);
  assert.equal(client.requests.length, 1);
});

await t('Claude 퀴즈: 정답이 가장 긴 보기인 문제가 많으면 오답 보기만 다시 써서 저장 (정답 글은 그대로)', async () => {
  const mcq = (i) => ({ question: `문제${i}`, options: ['짧음', `정답 ${i} 길고 자세한 설명이 붙은 보기`, '오답', '틀림'], answer_index: 1, level: '중간', explanation: '근거' });
  const sw = (i) => ({ question: `빈칸${i}`, answer: '믿음', accept: [], level: '쉬움', explanation: 'e' });
  const quiz = { multiple_choice: Array.from({ length: 20 }, (_, i) => mcq(i)), fill_blank: Array.from({ length: 5 }, (_, i) => sw(i)), word_answer: Array.from({ length: 5 }, (_, i) => sw(i)), short_answer: [] };
  const client = fakeClient((n, req) => {
    if (n === 1) return msg(JSON.stringify({ quiz }));
    const items = JSON.parse(req.messages[0].content).items;
    // 한 문제는 정답을 바꿔 버린 잘못된 답 → 쓰지 않아야 함
    return msg(JSON.stringify({ items: items.map((it, k) => ({ i: it.i, options: k === 0 ? ['a', 'b', 'c', 'd'] : it.options.map((o, j) => (j === it.answer_index ? o : `${o} — 그럴듯하지만 본문과 다른 아주 긴 설명이 붙은 오답`)) })) }));
  });
  const ai = createClaude('k', DEFAULT_MODEL, { client, sleep: noSleep });
  const r = await quiet(() => ai.generateDaily('quiz', { date: '2026-10-17', refs: 'r', text: 't' }));
  assert.equal(client.requests.length, 2);
  assert.match(client.requests[1].system, /정답 보기.*그대로/);
  assert.equal(r.multiple_choice.length, 15); // 오늘의 말씀은 15문제까지
  assert.equal(client.requests.length, 2);
  const stillLongest = r.multiple_choice.filter((q) => { const l = q.options.map((o) => o.length); return l[q.answer_index] === Math.max(...l); }).length;
  assert.ok(stillLongest <= 1, String(stillLongest)); // 정답을 바꾼 한 문제만 원래대로 (섞여서 잘렸을 수 있음)
  for (const q of r.multiple_choice) assert.match(q.options[q.answer_index], /^정답 \d+ 길고/);
});

await t('오늘의 말씀 퀴즈: 힌트를 저장하고 객관식 15 + 단답식 5 로 자름 (빈칸은 없음)', async () => {
  const mcq = (i) => ({ question: `문제${i}`, options: ['짧음', '정답', '조금 긴 오답 보기입니다', '틀림'], answer_index: 1, level: '쉬움', hint: `${i}절을 다시 읽어 보세요`, explanation: '근거' });
  const wa = (i) => ({ question: `질문${i}`, answer: '믿음', accept: [], level: '쉬움', hint: '힌트', explanation: 'e' });
  const quiz = { multiple_choice: Array.from({ length: 18 }, (_, i) => mcq(i)), word_answer: Array.from({ length: 6 }, (_, i) => wa(i)) };
  const r = await createClaude('k', DEFAULT_MODEL, { client: fakeClient(() => msg(JSON.stringify({ quiz }))), sleep: noSleep }).generateDaily('quiz', { date: '2026-10-19', refs: 'r', text: 't' });
  assert.equal(r.multiple_choice.length, 15);
  assert.equal(r.word_answer.length, 5);
  assert.equal(r.fill_blank.length, 0);
  assert.match(r.multiple_choice[0].hint, /절을 다시 읽어/);
  assert.equal(r.word_answer[0].hint, '힌트');
  await assert.rejects(quiet(() => createClaude('k', DEFAULT_MODEL, { client: fakeClient(() => msg(JSON.stringify({ quiz: { multiple_choice: quiz.multiple_choice.slice(0, 10), word_answer: quiz.word_answer } }))), sleep: noSleep }).generateDaily('quiz', { date: '2026-10-19', refs: 'r', text: 't' })), /부족/);
});

await t('Claude 퀴즈: 이미 고르게 섞여 있으면 다시 쓰지 않음', async () => {
  const mcq = (i) => ({ question: `문제${i}`, options: ['짧음', i < 5 ? `정답 ${i} 아주 긴 보기 설명` : '정답', '조금 긴 오답 보기입니다', '틀림'], answer_index: 1, level: '중간', explanation: '근거' });
  const sw = () => ({ question: 'q', answer: '믿음', accept: [], level: '쉬움', explanation: 'e' });
  const quiz = { multiple_choice: Array.from({ length: 20 }, (_, i) => mcq(i)), fill_blank: Array.from({ length: 5 }, sw), word_answer: Array.from({ length: 5 }, sw), short_answer: [] };
  const client = fakeClient(() => msg(JSON.stringify(quiz)));
  await createClaude('k', DEFAULT_MODEL, { client, sleep: noSleep }).generateProverb('quiz', { chapter: 3, text: 't' });
  assert.equal(client.requests.length, 1);
});

console.log(`\n${passed}개 테스트 통과`);
