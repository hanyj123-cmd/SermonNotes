// 자막이 없는 영상 처리(Supadata · Gemini 영상 분석)와 영상 한 편 처리 흐름 점검. 외부 서비스 없이 실행: npm test
import assert from 'node:assert/strict';
import { fetchSupadata, obtainMaterial } from './lib/transcript.mjs';
import { createGemini } from './lib/gemini.mjs';
import { buildVideoMessage } from './lib/prompt.mjs';
import { processRow, CELL_LIMIT } from './lib/process.mjs';

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

await t('확보 순서: YouTube 자막이 있으면 Supadata/Gemini는 쓰지 않음', async () => {
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

await t('확보 순서: Supadata 키가 없으면 호출하지 않고 바로 Gemini 영상 분석', async () => {
  const sd = spy(() => ({ text: LONG }));
  const m = await obtainMaterial(row, { fetchCaptions: async () => ({ text: '', error: 'disabled' }), supadata: sd, supadataKey: '' });
  assert.equal(m.kind, 'video');
  assert.equal(sd.n, 0);
  assert.match(m.problems.join(' '), /YouTube 자막: disabled/);
});

await t('확보 순서: Supadata도 실패하면 Gemini 영상 분석 (실패 사유는 모두 기록)', async () => {
  const m = await obtainMaterial(row, {
    fetchCaptions: async () => ({ text: '', error: 'disabled' }),
    supadata: async () => {
      throw new Error('크레딧이 부족합니다');
    },
    supadataKey: 'K',
  });
  assert.equal(m.kind, 'video');
  assert.equal(m.problems.length, 2);
  assert.match(m.problems[1], /Supadata: 크레딧이 부족합니다/);
});

await t('확보 순서: 영상 분석을 끄면(GEMINI_VIDEO=off) none', async () => {
  const m = await obtainMaterial(row, { fetchCaptions: async () => ({ text: '', error: 'disabled' }), geminiVideo: false });
  assert.equal(m.kind, 'none');
  assert.equal(m.problems.length, 1);
});

// ---------- Gemini ----------
const GOOD = { outline: [{ heading: '대지', content: '내용' }], applications: [{ title: '적용', detail: '상세' }], small_group: { observation: ['질문'] } };
const okResponse = { text: JSON.stringify(GOOD), candidates: [{ finishReason: 'STOP' }] };
function fakeClient(handler) {
  const requests = [];
  return {
    requests,
    models: {
      generateContent: async (req) => {
        requests.push(req);
        return handler(requests.length, req);
      },
    },
  };
}

await t('Gemini 영상 분석: 영상 주소·저해상도·긴 대기시간으로 요청', async () => {
  const client = fakeClient(() => okResponse);
  const g = createGemini('k', 'test-model', { client, sleep: noSleep });
  const r = await g.summarizeVideo({ category: 'sunday', title: '제목', publishedAt: '2026-10-04', videoUrl: 'https://www.youtube.com/watch?v=VID12345678' });
  assert.equal(r.outline[0].heading, '대지');
  const req = client.requests[0];
  assert.equal(req.model, 'test-model');
  const parts = req.contents[0].parts;
  assert.equal(req.contents[0].role, 'user');
  assert.equal(parts[0].fileData.fileUri, 'https://www.youtube.com/watch?v=VID12345678');
  assert.match(parts[1].text, /영상의 음성을 직접 듣고/);
  assert.match(parts[1].text, /주일예배/);
  assert.equal(req.config.mediaResolution, 'MEDIA_RESOLUTION_LOW');
  assert.ok(req.config.httpOptions.timeout >= 10 * 60 * 1000);
  assert.equal(req.config.responseMimeType, 'application/json');
  assert.match(req.config.systemInstruction, /웨스트민스터/);
});

await t('Gemini 자막 정리: 기존 방식(텍스트 입력)은 그대로', async () => {
  const client = fakeClient(() => okResponse);
  const g = createGemini('k', 'm', { client, sleep: noSleep });
  await g.summarize({ category: 'dawn', title: 'T', publishedAt: '2026-10-01', transcript: LONG });
  const req = client.requests[0];
  assert.equal(typeof req.contents, 'string');
  assert.match(req.contents, /\[자막 시작\]/);
  assert.equal(req.config.mediaResolution, undefined);
});

await t('Gemini: 한도 초과(429)는 기다렸다가 재시도, 성공하면 결과 반환', async () => {
  const waits = [];
  const client = fakeClient((n) => {
    if (n === 1) throw Object.assign(new Error('rate limit'), { status: 429 });
    return okResponse;
  });
  const g = createGemini('k', 'm', { client, sleep: async (ms) => waits.push(ms) });
  const r = await quiet(() => g.summarizeVideo({ category: 'dawn', title: 'T', videoUrl: 'u' }));
  assert.equal(client.requests.length, 2);
  assert.deepEqual(waits, [8000]);
  assert.ok(r.outline.length);
});

await t('Gemini: 깨진 JSON이어도 재시도하고, 계속 실패하면 3번 뒤 오류', async () => {
  const client = fakeClient(() => ({ text: '이건 JSON이 아님', candidates: [{ finishReason: 'STOP' }] }));
  const g = createGemini('k', 'm', { client, sleep: noSleep });
  await assert.rejects(quiet(() => g.summarizeVideo({ category: 'dawn', title: 'T', videoUrl: 'u' })), /JSON/);
  assert.equal(client.requests.length, 3);
});

await t('영상용 요청 문구: 설교만 정리 · 추측 금지 · 구분/제목 포함', () => {
  const m = buildVideoMessage({ category: 'wednesday', title: '기도의 자리', publishedAt: '2026-10-07' });
  assert.match(m, /설교 부분만/);
  assert.match(m, /추측하지/);
  assert.match(m, /수요예배/);
  assert.match(m, /기도의 자리/);
});

// ---------- 영상 한 편 처리 흐름 ----------
function harness({ material, ai }) {
  const updates = [];
  const logs = [];
  const deps = {
    ai,
    update: async (patch) => updates.push(patch),
    obtain: async () => material,
    now: () => 'NOW',
    log: { info: (m) => logs.push(m), warn: (m) => logs.push(m), error: (m) => logs.push(m) },
  };
  return { updates, logs, deps };
}
const fakeAi = (over = {}) => ({
  model: 'gemini-test',
  summarize: async () => GOOD,
  summarizeVideo: async () => GOOD,
  ...over,
});
const baseRow = () => ({ video_id: 'VID12345678', category: 'sunday', title: '제목', published_at: '2026-10-04', rowNumber: 7 });

await t('처리: 자막 텍스트 → done, 출처·모델을 note에 기록', async () => {
  const calls = [];
  const h = harness({ material: { kind: 'text', text: LONG, source: 'YouTube 자막' }, ai: fakeAi({ summarize: async (a) => (calls.push(a), GOOD) }) });
  const r = baseRow();
  assert.equal(await processRow(r, h.deps), 'done');
  assert.equal(calls[0].transcript, LONG);
  assert.equal(h.updates[0].status, 'done');
  assert.equal(h.updates[0].note, 'YouTube 자막 · gemini-test');
  assert.deepEqual(JSON.parse(h.updates[0].result_json).outline[0].heading, '대지');
  assert.equal(r.status, 'done');
});

await t('처리: 자막 없음 → 영상 직접 분석(summarizeVideo)에 영상 주소 전달', async () => {
  const calls = [];
  const h = harness({ material: { kind: 'video', source: 'Gemini 영상 직접 분석', problems: ['YouTube 자막: disabled'] }, ai: fakeAi({ summarizeVideo: async (a) => (calls.push(a), GOOD) }) });
  assert.equal(await processRow(baseRow(), h.deps), 'done');
  assert.equal(calls[0].videoUrl, 'https://www.youtube.com/watch?v=VID12345678');
  assert.equal(calls[0].category, 'sunday');
  assert.equal(h.updates[0].note, 'Gemini 영상 직접 분석 · gemini-test');
});

await t('처리: 모두 실패 → no_transcript + 사유 + 해결 안내', async () => {
  const h = harness({ material: { kind: 'none', problems: ['YouTube 자막: disabled'] }, ai: fakeAi() });
  assert.equal(await processRow(baseRow(), h.deps), 'no_transcript');
  assert.equal(h.updates[0].status, 'no_transcript');
  assert.match(h.updates[0].note, /disabled/);
  assert.match(h.updates[0].note, /transcript_manual/);
});

await t('처리: 영상 분석 실패 → error, 영상 분석이었음을 note에 표시', async () => {
  const h = harness({
    material: { kind: 'video', source: 'Gemini 영상 직접 분석', problems: ['YouTube 자막: disabled'] },
    ai: fakeAi({
      summarizeVideo: async () => {
        throw new Error('Video is too long');
      },
    }),
  });
  assert.equal(await processRow(baseRow(), h.deps), 'error');
  assert.equal(h.updates[0].status, 'error');
  assert.match(h.updates[0].note, /영상 직접 분석 실패/);
  assert.match(h.updates[0].note, /Video is too long/);
  assert.match(h.updates[0].note, /redo/);
});

await t('처리: 결과가 시트 셀 한도를 넘으면 error (시트에 저장하지 않음)', async () => {
  const huge = { ...GOOD, outline: [{ heading: 'a', content: 'x'.repeat(CELL_LIMIT) }] };
  const h = harness({ material: { kind: 'text', text: LONG, source: 'YouTube 자막' }, ai: fakeAi({ summarize: async () => huge }) });
  assert.equal(await processRow(baseRow(), h.deps), 'error');
  assert.equal(h.updates.length, 1);
  assert.equal(h.updates[0].result_json, undefined);
  assert.match(h.updates[0].note, /너무 깁니다/);
});

console.log(`\n${passed}개 테스트 통과`);
