// 설교 내용을 확보하는 순서 (앞에서부터 시도하고, 성공하면 멈춤)
//   1) 시트의 transcript_manual 칸에 직접 붙여넣은 자막
//   2) YouTube 자막 (무료)
//   3) Gemini — GEMINI_API_KEY 를 등록했을 때만 (유튜브 영상을 직접 듣고 받아 적음. 자막 확보까지만 Gemini, 정리는 Claude)
//   4) Supadata — SUPADATA_API_KEY 를 등록했을 때만 (자막이 없으면 AI로 음성 인식, 유료 크레딧)
//   모두 안 되면 no_transcript 로 표시합니다. (Claude 는 유튜브 영상을 직접 들을 수 없습니다)
import { fetchTranscript } from './youtube.mjs';

const SUPADATA_URL = 'https://api.supadata.ai/v1/transcript';
const MIN_TEXT = 200;
const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function readBody(res) {
  try {
    return await res.json();
  } catch {
    return {};
  }
}

const reason = (body) => String(body?.message || body?.details || body?.error || '').slice(0, 160);

function contentToText(data) {
  const c = data?.content;
  const text = Array.isArray(c) ? c.map((s) => s?.text || '').join(' ') : String(c || '');
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) throw new Error('음성이 감지되지 않았습니다');
  if (clean.length < MIN_TEXT) throw new Error('자막이 너무 짧습니다');
  return clean;
}

/**
 * Supadata로 자막을 가져옵니다. 자막이 없는 영상은 Supadata가 AI로 음성을 인식합니다 (mode=auto).
 * 긴 영상은 작업(job)으로 접수되어, 끝날 때까지 주기적으로 확인합니다.
 * 실패하면 이유를 담은 Error를 던집니다.
 */
export async function fetchSupadata(videoId, apiKey, opts = {}) {
  const { fetchImpl = fetch, sleepImpl = defaultSleep, pollMs = 3000, maxWaitMs = 20 * 60 * 1000 } = opts;
  const headers = { 'x-api-key': apiKey };
  const params = new URLSearchParams({
    url: `https://www.youtube.com/watch?v=${videoId}`,
    text: 'true',
    mode: 'auto',
    lang: 'ko',
  });

  const res = await fetchImpl(`${SUPADATA_URL}?${params}`, { headers });
  const body = await readBody(res);

  if (res.status === 200) return { text: contentToText(body) };

  if (res.status === 202) {
    if (!body.jobId) throw new Error('작업 번호를 받지 못했습니다');
    const polls = Math.ceil(maxWaitMs / pollMs);
    for (let i = 0; i < polls; i++) {
      await sleepImpl(pollMs);
      const jr = await fetchImpl(`${SUPADATA_URL}/${encodeURIComponent(body.jobId)}`, { headers });
      const job = await readBody(jr);
      if (jr.status !== 200) throw new Error(`작업 확인 실패 (${jr.status}) ${reason(job)}`.trim());
      if (job.status === 'completed') return { text: contentToText(job) };
      if (job.status === 'failed') throw new Error(`음성 인식 실패 ${reason(job.error ? { message: job.error?.message || job.error } : job)}`.trim());
    }
    throw new Error('음성 인식이 너무 오래 걸립니다');
  }

  if (res.status === 206) throw new Error('이 영상에서 자막을 얻지 못했습니다');
  if (res.status === 401) throw new Error('API 키가 올바르지 않습니다');
  if (res.status === 402) throw new Error('크레딧이 부족합니다');
  if (res.status === 429) throw new Error('요청이 너무 많습니다 (잠시 후 다시 시도)');
  if (res.status === 404) throw new Error('영상을 찾을 수 없거나 비공개입니다');
  if (res.status === 403) throw new Error(`접근할 수 없는 영상입니다 ${reason(body)}`.trim());
  throw new Error(`응답 오류 (${res.status}) ${reason(body)}`.trim());
}

/* ---------- Gemini: 유튜브 영상을 직접 듣고 받아 적기 (자막 확보 전용) ---------- */
export const GEMINI_DEFAULT_MODEL = 'gemini-3.8-flash';
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
export const GEMINI_PROMPT = `이 유튜브 영상은 한국어 교회 설교(예배) 영상입니다. 영상에서 들리는 말을 한국어로 빠짐없이 그대로 받아 적어 주세요.
- 요약·해설·번역·의견을 절대 덧붙이지 말고, 말한 내용만 적습니다.
- 설교자가 읽는 성경 본문, 기도, 말씀 선포도 들리는 그대로 적습니다. 찬양·광고 등 설교가 아닌 부분도 들리면 적되, 소리가 없는 구간은 건너뜁니다.
- 시간 표시, 화자 표시, 제목, 머리말, 마크다운 서식 없이 문장 단위로 줄을 나눈 일반 텍스트만 출력합니다.
- 들리지 않거나 확실하지 않은 부분은 추측해서 지어내지 말고 건너뜁니다.`;

/**
 * Gemini 로 유튜브 영상(공개 영상만)을 직접 듣고 설교 내용을 글로 받아 적습니다. 실패하면 이유를 담은 Error 를 던집니다.
 * 받아 적기까지만 Gemini 가 하고, 설교 정리(리뷰·QT·성경공부·소그룹)는 그대로 Claude 가 합니다.
 */
export async function fetchGemini(videoId, apiKey, opts = {}) {
  const { fetchImpl = fetch, sleepImpl = defaultSleep, model = GEMINI_DEFAULT_MODEL, timeoutMs = 15 * 60 * 1000, retries = 2 } = opts;
  const body = JSON.stringify({
    contents: [{ parts: [{ text: GEMINI_PROMPT }, { file_data: { file_uri: `https://www.youtube.com/watch?v=${videoId}` } }] }],
    generationConfig: { temperature: 0, maxOutputTokens: 65536 },
  });
  let lastErr = '';
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt) await sleepImpl(attempt * 5000);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let res;
    try {
      res = await fetchImpl(`${GEMINI_URL}/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body,
        signal: ctrl.signal,
      });
    } catch (e) {
      lastErr = e?.name === 'AbortError' ? '응답이 너무 오래 걸립니다' : `네트워크 오류 ${String(e?.message || e).slice(0, 100)}`;
      continue;
    } finally {
      clearTimeout(timer);
    }
    const data = await readBody(res);
    if (res.status === 429 || res.status >= 500) {
      lastErr = `응답 오류 (${res.status}) ${String(data?.error?.message || '').slice(0, 120)}`.trim();
      continue; // 잠시 뒤 다시 시도
    }
    if (res.status === 400 || res.status === 403 || res.status === 404) {
      const msg = String(data?.error?.message || '').slice(0, 160);
      throw new Error(`${res.status === 404 ? '모델 이름 또는 영상을 찾을 수 없습니다' : res.status === 403 ? 'API 키 권한이 없거나 접근할 수 없는 영상입니다' : '요청이 거절되었습니다 (비공개·한정공개 영상이거나 키/모델 문제)'} ${msg}`.trim());
    }
    if (!res.ok) throw new Error(`응답 오류 (${res.status}) ${String(data?.error?.message || '').slice(0, 120)}`.trim());
    const cand = data?.candidates?.[0];
    const text = (cand?.content?.parts || []).map((p) => p?.text || '').join('\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    if (!text) throw new Error(`받아 적은 내용이 없습니다${cand?.finishReason ? ` (${cand.finishReason})` : data?.promptFeedback?.blockReason ? ` (${data.promptFeedback.blockReason})` : ''}`);
    if (text.length < MIN_TEXT) throw new Error('받아 적은 내용이 너무 짧습니다');
    return { text, truncated: cand?.finishReason === 'MAX_TOKENS' };
  }
  throw new Error(lastErr || '받아 적지 못했습니다');
}

/**
 * 한 영상의 설교 내용을 확보합니다.
 *   { kind: 'text',  text, source }     자막 텍스트를 얻음
 *   { kind: 'none',  problems }         모두 실패
 */
export async function obtainMaterial(row, opts = {}) {
  const {
    supadataKey = '',
    geminiKey = '',
    geminiModel = GEMINI_DEFAULT_MODEL,
    fetchCaptions = fetchTranscript,
    gemini = fetchGemini,
    supadata = fetchSupadata,
    log = () => {},
  } = opts;

  const manual = String(row.transcript_manual || '').trim();
  if (manual) return { kind: 'text', text: manual, source: '직접 입력한 자막' };

  const problems = [];

  const cap = await fetchCaptions(row.video_id);
  if (cap.text) return { kind: 'text', text: cap.text, source: 'YouTube 자막' };
  problems.push(`YouTube 자막: ${cap.error}`);
  log(`YouTube 자막 없음: ${cap.error}`);

  if (geminiKey) {
    try {
      const r = await gemini(row.video_id, geminiKey, { model: geminiModel });
      return { kind: 'text', text: r.text, source: r.truncated ? 'Gemini 받아쓰기 (길어서 뒷부분이 잘렸을 수 있음)' : 'Gemini 받아쓰기' };
    } catch (e) {
      problems.push(`Gemini: ${e.message}`);
      log(`Gemini 실패: ${e.message}`);
    }
  }

  if (supadataKey) {
    try {
      const r = await supadata(row.video_id, supadataKey);
      return { kind: 'text', text: r.text, source: 'Supadata 자막' };
    } catch (e) {
      problems.push(`Supadata: ${e.message}`);
      log(`Supadata 실패: ${e.message}`);
    }
  }

  if (!geminiKey && !supadataKey) problems.push('음성 인식 키(GEMINI_API_KEY 또는 SUPADATA_API_KEY)가 없어 건너뜀');
  return { kind: 'none', problems };
}
