// 설교 내용을 확보하는 순서 (앞에서부터 시도하고, 성공하면 멈춤)
//   1) 시트의 transcript_manual 칸에 직접 붙여넣은 자막
//   2) YouTube 자막 (무료)
//   3) Supadata — SUPADATA_API_KEY 를 등록했을 때만 (자막이 없으면 AI로 음성 인식, 유료 크레딧)
//   4) Gemini가 영상을 직접 듣고 정리 — 기본 켜짐, GEMINI_VIDEO=off 로 끌 수 있음
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

/**
 * 한 영상의 설교 내용을 확보합니다.
 *   { kind: 'text',  text, source }     자막 텍스트를 얻음
 *   { kind: 'video', source, problems } 자막은 못 얻었고, 영상 직접 분석으로 진행
 *   { kind: 'none',  problems }         모두 실패
 */
export async function obtainMaterial(row, opts = {}) {
  const {
    supadataKey = '',
    geminiVideo = true,
    fetchCaptions = fetchTranscript,
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

  if (supadataKey) {
    try {
      const r = await supadata(row.video_id, supadataKey);
      return { kind: 'text', text: r.text, source: 'Supadata 자막' };
    } catch (e) {
      problems.push(`Supadata: ${e.message}`);
      log(`Supadata 실패: ${e.message}`);
    }
  }

  if (geminiVideo) return { kind: 'video', source: 'Gemini 영상 직접 분석', problems };
  return { kind: 'none', problems };
}
