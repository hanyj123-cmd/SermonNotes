// Gemini API 호출 + 결과 검증
import { GoogleGenAI } from '@google/genai';
import { SYSTEM_PROMPT, buildUserMessage, buildVideoMessage } from './prompt.mjs';

export const DEFAULT_MODEL = 'gemini-3.8-flash';
const MAX_TRANSCRIPT_CHARS = 150_000;
const MAX_ATTEMPTS = 3;
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

export function extractJson(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('응답에서 JSON을 찾지 못했습니다');
  return JSON.parse(text.slice(start, end + 1));
}

const asArray = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()) : []);
const asString = (v) => (typeof v === 'string' ? v : '');

/** 모델 응답을 앱이 기대하는 모양으로 정규화합니다. 필수 항목이 비어 있으면 오류. */
export function normalizeResult(raw) {
  const sg = raw.small_group || {};
  const result = {
    scripture: asArray(raw.scripture),
    preacher: asString(raw.preacher),
    theme: asString(raw.theme),
    summary_short: asString(raw.summary_short),
    outline: Array.isArray(raw.outline)
      ? raw.outline
          .map((o) => ({
            heading: asString(o?.heading),
            scripture: asString(o?.scripture),
            content: asString(o?.content),
            key_quote: asString(o?.key_quote),
          }))
          .filter((o) => o.heading || o.content)
      : [],
    gospel_connection: asString(raw.gospel_connection),
    applications: Array.isArray(raw.applications)
      ? raw.applications
          .map((a) => ({ title: asString(a?.title), detail: asString(a?.detail) }))
          .filter((a) => a.title || a.detail)
      : [],
    meditation_questions: asArray(raw.meditation_questions),
    small_group: {
      icebreaker: asString(sg.icebreaker),
      observation: asArray(sg.observation),
      reflection: asArray(sg.reflection),
      application: asArray(sg.application),
      prayer: asArray(sg.prayer),
    },
    caveats: asString(raw.caveats),
  };
  if (!result.outline.length) throw new Error('설교 정리(outline)가 비어 있습니다');
  if (!result.applications.length) throw new Error('삶의 적용(applications)이 비어 있습니다');
  if (!result.small_group.observation.length && !result.small_group.application.length) {
    throw new Error('소그룹 질문이 비어 있습니다');
  }
  return result;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 응답에서 텍스트를 꺼내고, 비어 있으면 이유를 설명하는 오류를 던집니다. */
export function readResponseText(response) {
  const cand = response?.candidates?.[0];
  const text = response?.text ?? '';
  if (!text.trim()) {
    const block = response?.promptFeedback?.blockReason;
    if (block) throw new Error(`요청이 차단되었습니다 (${block})`);
    throw new Error(`빈 응답입니다 (finishReason: ${cand?.finishReason || '알 수 없음'})`);
  }
  if (cand?.finishReason === 'MAX_TOKENS') throw new Error('응답이 길이 제한으로 잘렸습니다');
  return text;
}

// options.client / options.sleep 은 테스트에서 가짜로 바꿔 끼우기 위한 것입니다.
export function createGemini(apiKey, model = DEFAULT_MODEL, options = {}) {
  const ai = options.client || new GoogleGenAI({ apiKey });
  const wait = options.sleep || sleep;

  async function generate(contents, extraConfig = {}) {
    let lastError;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const response = await ai.models.generateContent({
          model,
          contents,
          config: {
            systemInstruction: SYSTEM_PROMPT,
            responseMimeType: 'application/json',
            maxOutputTokens: 32_768, // 사고(thinking) 토큰이 포함될 수 있어 넉넉하게
            temperature: 0.4,
            ...extraConfig,
          },
        });
        return normalizeResult(extractJson(readResponseText(response)));
      } catch (e) {
        lastError = e;
        console.warn(`   ↻ 시도 ${attempt}/${MAX_ATTEMPTS} 실패: ${String(e?.message || e).slice(0, 160)}`);
        if (attempt === MAX_ATTEMPTS) break;
        // 일시적 오류(429/5xx)는 잠시 기다렸다 재시도, 그 외는 바로 재시도
        await wait(RETRYABLE_STATUS.has(e?.status) ? 8000 * attempt : 1000);
      }
    }
    throw lastError;
  }

  return {
    model,

    /** 자막 텍스트를 정리합니다. */
    summarize({ category, title, publishedAt, transcript }) {
      const clipped =
        transcript.length > MAX_TRANSCRIPT_CHARS ? transcript.slice(0, MAX_TRANSCRIPT_CHARS) : transcript;
      return generate(buildUserMessage({ category, title, publishedAt, transcript: clipped }));
    },

    /**
     * 자막이 없는 영상: 유튜브 영상(공개 영상만)을 Gemini가 직접 듣고 정리합니다.
     * 화면 영상은 중요하지 않으므로 해상도를 낮춰 토큰(=사용량)을 줄입니다.
     */
    summarizeVideo({ category, title, publishedAt, videoUrl }) {
      const contents = [
        {
          role: 'user',
          parts: [{ fileData: { fileUri: videoUrl } }, { text: buildVideoMessage({ category, title, publishedAt }) }],
        },
      ];
      return generate(contents, {
        mediaResolution: 'MEDIA_RESOLUTION_LOW',
        httpOptions: { timeout: 15 * 60 * 1000 }, // 긴 영상은 처리에 몇 분 걸릴 수 있음
      });
    },
  };
}
