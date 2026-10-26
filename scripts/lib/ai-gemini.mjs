// Gemini 로 설교 · 오늘의 말씀 · 잠언 묵상을 정리합니다 (Claude 와 같은 결과 형식)
//
// 설교 정리(주일·수요·새벽·청년부·사용자 영상)는 유튜브 영상 주소를 Gemini 에게 그대로 넘겨
// 영상의 음성을 직접 듣고 정리합니다. 영상을 열 수 없을 때(비공개 등)만 자막 텍스트로 대신합니다.
// 오늘의 말씀 · 잠언 묵상은 성경 본문(텍스트)만 쓰므로 영상이 필요 없습니다.
import { buildEngine, JSON_ONLY, DEFAULT_EFFORT, EFFORTS, retryDelay, MAX_CALL_ATTEMPTS } from './ai.mjs';

export const GEMINI_DEFAULT_MODEL = 'gemini-3.8-flash';
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const MAX_OUTPUT_TOKENS = 65_536; // 생각(thinking) + 답 전체 한도
const REQUEST_TIMEOUT_MS = 20 * 60 * 1000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 생각 깊이(low · medium · high)를 Gemini 의 thinkingLevel 로 옮깁니다 */
export const thinkingLevelFor = (effort) => (EFFORTS.includes(effort) ? effort : DEFAULT_EFFORT);

/** Gemini 응답(JSON)에서 답 글만 꺼냅니다. 비었거나 잘렸거나 막혔으면 이유를 설명하는 오류를 던집니다. */
export function readGeminiText(data) {
  const block = data?.promptFeedback?.blockReason;
  if (block) throw new Error(`요청이 거절되었습니다 (${block})`);
  const cand = data?.candidates?.[0];
  // 생각 과정(thought: true)은 빼고 답만 이어 붙입니다
  const text = (cand?.content?.parts || []).filter((p) => p && !p.thought).map((p) => p.text || '').join('');
  const finish = cand?.finishReason;
  if (finish === 'MAX_TOKENS') throw new Error('응답이 길이 제한으로 잘렸습니다');
  if (!text.trim()) throw new Error(`빈 응답입니다 (finishReason: ${finish || '알 수 없음'})`);
  return text;
}

const errMessage = (data) => String(data?.error?.message || '').slice(0, 200);

/**
 * @param apiKey   GEMINI_API_KEY
 * @param model    예: gemini-3.8-flash
 * @param options  { effort, fetch, sleep } — fetch / sleep 은 테스트에서 가짜로 바꿔 끼우기 위한 것입니다.
 */
export function createGemini(apiKey, model = GEMINI_DEFAULT_MODEL, options = {}) {
  const effort = EFFORTS.includes(options.effort) ? options.effort : DEFAULT_EFFORT;
  const fetchImpl = options.fetch || fetch;
  const wait = options.sleep || sleep;
  let thinkingSupported = true; // 이 모델이 thinkingLevel 을 받지 않으면 빼고 다시 보냅니다
  let mediaResSupported = true; // mediaResolution 도 마찬가지

  /** Gemini 에 한 번 요청해서 답 글을 돌려받습니다. parts = [{text}] 또는 [{text},{file_data}] */
  async function request(system, parts) {
    const hasVideo = parts.some((p) => p.file_data);
    for (let pass = 0; pass < 3; pass++) {
      const generationConfig = { maxOutputTokens: MAX_OUTPUT_TOKENS, responseMimeType: 'application/json' };
      if (thinkingSupported) generationConfig.thinkingConfig = { thinkingLevel: thinkingLevelFor(effort) };
      if (hasVideo && mediaResSupported) generationConfig.mediaResolution = 'MEDIA_RESOLUTION_LOW'; // 설교는 말이 핵심이라 화면은 낮은 해상도로 충분 (토큰 절약)
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
      let res;
      try {
        res = await fetchImpl(`${GEMINI_URL}/${encodeURIComponent(model)}:generateContent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
          body: JSON.stringify({ systemInstruction: { parts: [{ text: system + JSON_ONLY }] }, contents: [{ role: 'user', parts }], generationConfig }),
          signal: ctrl.signal,
        });
      } catch (e) {
        const err = new Error(e?.name === 'AbortError' ? '응답이 너무 오래 걸립니다' : `네트워크 오류 ${String(e?.message || e).slice(0, 100)}`);
        err.status = 503; // 일시적 오류로 보고 다시 시도
        throw err;
      } finally {
        clearTimeout(timer);
      }
      let data = {};
      try {
        data = await res.json();
      } catch {
        data = {};
      }
      if (res.ok) return readGeminiText(data);
      const msg = errMessage(data);
      if (res.status === 400 && thinkingSupported && /thinking/i.test(msg)) {
        thinkingSupported = false; // 생각 깊이를 지원하지 않는 모델: 설정 없이 다시
        continue;
      }
      if (res.status === 400 && hasVideo && mediaResSupported && /media[ _]?resolution/i.test(msg)) {
        mediaResSupported = false; // 영상 해상도 설정을 모르는 모델: 설정 없이 다시
        continue;
      }
      const err = new Error(`Gemini 응답 오류 (${res.status}) ${msg}`.trim());
      err.status = res.status;
      err.keyProblem = res.status === 401 || /api[ _]key/i.test(msg);
      // 영상을 열 수 없는 경우(비공개 · 한정공개 · 지역 제한 · 너무 긴 영상): 키 문제가 아닌 400/403/404
      err.videoAccess = hasVideo && !err.keyProblem && [400, 403, 404].includes(res.status);
      throw err;
    }
    throw new Error('Gemini 요청에 실패했습니다');
  }

  /** 영상이 있으면 영상으로, 영상을 열 수 없을 때만 자막 글로 요청합니다 */
  async function once(system, userText, media) {
    if (!media?.videoId) return request(system, [{ text: userText }]);
    try {
      return await request(system, [{ text: userText }, { file_data: { file_uri: `https://www.youtube.com/watch?v=${media.videoId}` } }]);
    } catch (e) {
      if (!e.videoAccess || !media.textFallback) throw e;
      console.warn(`   ↪ 영상을 직접 열지 못해 자막 글로 정리합니다 (${String(e.message).slice(0, 100)})`);
      return request(system, [{ text: media.textFallback }]);
    }
  }

  async function call(system, userText, parse, media = null) {
    let lastError;
    for (let attempt = 1; attempt <= MAX_CALL_ATTEMPTS; attempt++) {
      try {
        return await parse(await once(system, userText, media));
      } catch (e) {
        lastError = e;
        console.warn(`   ↻ 시도 ${attempt}/${MAX_CALL_ATTEMPTS} 실패: ${String(e?.message || e).slice(0, 160)}`);
        if (e?.keyProblem) break; // 키 · 크레딧 문제는 다시 해도 소용없음
        if (e?.videoAccess) break; // 영상을 열 수 없고 대신할 자막도 없음
        if (attempt === MAX_CALL_ATTEMPTS) break;
        await wait(retryDelay(e?.status, attempt));
      }
    }
    throw lastError;
  }

  return buildEngine({ call, model, effort, provider: 'gemini', watchesVideo: true });
}
