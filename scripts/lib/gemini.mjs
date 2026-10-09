// Gemini API 호출 + 결과 검증 (설교 한 편을 4가지 모드로 따로 정리)
import { GoogleGenAI } from '@google/genai';
import { MODES, systemPromptFor, buildUserMessage, buildTranscribeMessage, DAILY_MODES, systemPromptForDaily, buildDailyMessage } from './prompt.mjs';
import { normalizePassages } from './bible-books.mjs';

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

const asArray = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim()) : []);
const asString = (v) => (typeof v === 'string' ? v.trim() : '');
const clip = (v, n) => asString(v).slice(0, n);
const splitParagraphs = (text) => asString(text).split(/\n{2,}/).map((x) => x.trim()).filter(Boolean);

function outlineItems(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map((o) => {
      // 새 형식(paragraphs) 우선, 한 덩어리(content)도 받아 줍니다
      const paragraphs = Array.isArray(o?.paragraphs) ? asArray(o.paragraphs) : splitParagraphs(o?.content);
      return {
        heading: asString(o?.heading),
        scripture: asString(o?.scripture),
        paragraphs,
        key_summary: asString(o?.key_summary) || asString(o?.key_quote),
      };
    })
    .filter((o) => o.heading || o.paragraphs.length);
}

function applicationItems(list) {
  if (!Array.isArray(list)) return [];
  return list.map((a) => ({ title: asString(a?.title), detail: asString(a?.detail) })).filter((a) => a.title || a.detail);
}

function songItems(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map((x) => {
      const kind = /ccm|씨씨엠|복음성가|워십/i.test(asString(x?.kind)) ? 'CCM' : asString(x?.kind) || '찬송가';
      return { title: clip(x?.title, 100), artist: clip(x?.artist, 80), kind: clip(kind, 20), reason: clip(x?.reason, 300) };
    })
    .filter((x) => x.title)
    .slice(0, 3);
}

// 질문 + 모범 답안 (글자만 온 질문도 받아 줍니다)
function qaItems(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map((x) => (typeof x === 'string' ? { question: x.trim(), guide: '', answer: '' } : { question: asString(x?.question), guide: asString(x?.guide), answer: asString(x?.answer) || asString(x?.example) }))
    .filter((x) => x.question);
}

// QT 묵상 질문: { question, guide(생각의 길잡이), example(예시 답안) } — 예전처럼 글자만 와도 받아 줍니다
function meditationItems(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map((x) => (typeof x === 'string' ? { question: x.trim(), guide: '', example: '' } : { question: asString(x?.question), guide: asString(x?.guide), example: asString(x?.example) || asString(x?.answer) }))
    .filter((x) => x.question);
}

// 빈칸 정답 비교용: 띄어쓰기·문장부호·따옴표를 모두 지우고 소문자로
export const blankKey = (s) => String(s || '').normalize('NFC').toLowerCase().replace(/[\s.,!?·~'"“”‘’()\[\]{}<>「」『』:;\-_/]/g, '');

const need = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

/** 설교리뷰 → 결과의 중심(result_json)이 됩니다. 제목·본문·설교자 같은 공통 정보를 함께 담습니다. */
export function normalizeReview(raw) {
  const r = raw.review || {};
  const result = {
    schema: 3,
    title: clip(raw.title, 200),
    scripture: asArray(raw.scripture),
    passages: normalizePassages(raw.passages),
    preacher: asString(raw.preacher),
    theme: asString(raw.theme),
    summary_short: asString(raw.summary_short),
    review: {
      outline: outlineItems(r.outline ?? raw.outline),
      summary: asString(r.summary ?? raw.summary),
      gospel_connection: asString(r.gospel_connection ?? raw.gospel_connection),
    },
    caveats: asString(raw.caveats),
  };
  need(result.review.outline.length, '설교 정리(outline)가 비어 있습니다');
  need(result.summary_short, '한 줄 정리(summary_short)가 비어 있습니다');
  return result;
}

export function normalizeQt(raw) {
  const out = {
    opening_prayer: asString(raw.opening_prayer),
    songs: songItems(raw.songs),
    outline: outlineItems(raw.outline),
    questions: meditationItems(raw.questions),
    applications: applicationItems(raw.applications),
    closing_prayer: asString(raw.closing_prayer),
  };
  need(out.outline.length, 'QT 설교 정리(outline)가 비어 있습니다');
  need(out.questions.length, 'QT 묵상 질문이 비어 있습니다');
  need(out.applications.length, '삶의 적용(applications)이 비어 있습니다');
  need(out.opening_prayer && out.closing_prayer, '기도문이 비어 있습니다');
  return out;
}

/** 퀴즈 정리 (성경공부 · 오늘의 말씀 공통): 정답 번호가 잘못된 객관식, 정답이 빈 빈칸은 걸러 냅니다 */
export function normalizeQuiz(q = {}) {
  const mc = (Array.isArray(q.multiple_choice) ? q.multiple_choice : [])
    .map((x) => {
      const options = asArray(x?.options).slice(0, 5);
      const idx = Number(x?.answer_index);
      const level = /어려/.test(asString(x?.level)) ? '어려움' : /중/.test(asString(x?.level)) ? '중간' : /쉬/.test(asString(x?.level)) ? '쉬움' : '';
      return { question: asString(x?.question), options, answer_index: Number.isInteger(idx) ? idx : -1, level, explanation: asString(x?.explanation) };
    })
    .filter((x) => x.question && x.options.length >= 2 && x.answer_index >= 0 && x.answer_index < x.options.length);
  const fb = (Array.isArray(q.fill_blank) ? q.fill_blank : [])
    .map((x) => ({ question: asString(x?.question), answer: clip(x?.answer, 40), accept: asArray(x?.accept).map((a) => a.slice(0, 40)).filter((a) => blankKey(a)).slice(0, 6), explanation: asString(x?.explanation) }))
    .filter((x) => x.question && blankKey(x.answer));
  const sa = (Array.isArray(q.short_answer) ? q.short_answer : [])
    .map((x) => ({ question: asString(x?.question), answer: asString(x?.answer), explanation: asString(x?.explanation) }))
    .filter((x) => x.question && x.answer);
  return { multiple_choice: mc, fill_blank: fb, short_answer: sa };
}

export function normalizeStudy(raw, { requireQuiz = true } = {}) {
  const { multiple_choice: mc, fill_blank: fb, short_answer: sa } = normalizeQuiz(raw.quiz || {});
  const out = {
    opening_prayer: asString(raw.opening_prayer),
    songs: songItems(raw.songs),
    deep_dive: (Array.isArray(raw.deep_dive) ? raw.deep_dive : [])
      .map((o) => {
        const base = outlineItems([o])[0];
        if (!base) return null;
        const notes = (Array.isArray(o?.word_notes) ? o.word_notes : [])
          .map((n) => ({ word: clip(n?.word, 40), original: clip(n?.original, 60), meaning: clip(n?.meaning, 300) }))
          .filter((n) => n.word && n.meaning)
          .slice(0, 3);
        return { ...base, word_notes: notes };
      })
      .filter(Boolean),
    summary: asString(raw.summary),
    quiz: { multiple_choice: mc, fill_blank: fb, short_answer: sa },
    closing_prayer: asString(raw.closing_prayer),
  };
  need(out.deep_dive.length, '신학 딥다이브(deep_dive)가 비어 있습니다');
  if (requireQuiz) need(mc.length >= 3 && fb.length >= 3 && sa.length >= 3, `퀴즈가 부족합니다 (객관식 ${mc.length}, 빈칸 ${fb.length}, 주관식 ${sa.length})`);
  need(out.opening_prayer && out.closing_prayer, '기도문이 비어 있습니다');
  return out;
}

export function normalizeGroup(raw) {
  const q = raw.questions || {};
  const guide = raw.sharing_guide || {};
  const ice = qaItems([q.icebreaker])[0] || { question: '', guide: '', answer: '' };
  const out = {
    representative_prayer: asString(raw.representative_prayer),
    songs: songItems(raw.songs),
    outline: outlineItems(raw.outline),
    applications: applicationItems(raw.applications),
    questions: {
      icebreaker: ice,
      observation: qaItems(q.observation),
      reflection: qaItems(q.reflection),
      application: qaItems(q.application),
      prayer: qaItems(q.prayer),
    },
    sharing_guide: {
      intro: asString(guide.intro),
      steps: (Array.isArray(guide.steps) ? guide.steps : [])
        .map((s) => ({ title: asString(s?.title), detail: asString(s?.detail), minutes: Number.isFinite(Number(s?.minutes)) ? Math.round(Number(s.minutes)) : 0 }))
        .filter((s) => s.title || s.detail),
      prayer_guide: asArray(guide.prayer_guide),
    },
    closing_prayer: asString(raw.closing_prayer),
  };
  need(out.outline.length, '소그룹 설교 정리(outline)가 비어 있습니다');
  need(out.questions.observation.length + out.questions.reflection.length > 0, '소그룹 질문이 비어 있습니다');
  need(out.applications.length, '삶의 적용(applications)이 비어 있습니다');
  need(out.sharing_guide.steps.length, '나눔 진행 가이드가 비어 있습니다');
  need(out.representative_prayer && out.closing_prayer, '기도문이 비어 있습니다');
  return out;
}

/* ---------- 오늘의 말씀 ---------- */
export function normalizeDailyQt(raw) {
  const base = normalizeQt(raw);
  const kv = raw.key_verse || {};
  return {
    ...base,
    key_verse: { reference: clip(kv.reference, 60), text: clip(kv.text, 400) },
    summaries: (Array.isArray(raw.summaries) ? raw.summaries : []).map((s) => ({ reference: clip(s?.reference, 40), summary: clip(s?.summary, 200) })).filter((s) => s.reference && s.summary),
  };
}
const paraList = (v, max = 8, n = 3000) => (Array.isArray(v) ? v : splitParagraphs(v)).map((x) => clip(x, n)).filter(Boolean).slice(0, max);
/** 오늘의 말씀 성경공부: 배경 · 절별 주석 · 신학적 깊이 보기 */
export function normalizeDailyStudy(raw) {
  const out = normalizeStudy(raw, { requireQuiz: false });
  delete out.quiz; // 오늘의 말씀은 퀴즈를 따로 만듭니다
  out.background = (Array.isArray(raw.background) ? raw.background : [])
    .map((b) => ({ title: clip(b?.title, 120), paragraphs: paraList(b?.paragraphs, 8) }))
    .filter((b) => b.title && b.paragraphs.length)
    .slice(0, 4);
  out.commentary = (Array.isArray(raw.commentary) ? raw.commentary : [])
    .map((c) => ({
      passage: clip(c?.passage, 60),
      sections: (Array.isArray(c?.sections) ? c.sections : [])
        .map((x) => ({
          verses: clip(x?.verses, 20),
          heading: clip(x?.heading, 160),
          paragraphs: paraList(x?.paragraphs, 6),
          cross_refs: (Array.isArray(x?.cross_refs) ? x.cross_refs : []).map((r) => clip(r, 200)).filter(Boolean).slice(0, 6),
          commentators: (Array.isArray(x?.commentators) ? x.commentators : [])
            .map((m) => ({ name: clip(m?.name, 40), view: clip(m?.view, 700) }))
            .filter((m) => m.name && m.view)
            .slice(0, 4),
        }))
        .filter((x) => x.heading && x.paragraphs.length)
        .slice(0, 12),
    }))
    .filter((c) => c.passage && c.sections.length)
    .slice(0, 4);
  return out;
}
export function normalizeDailyQuiz(raw) {
  const quiz = normalizeQuiz(raw.quiz || raw);
  need(quiz.multiple_choice.length >= 8 && quiz.fill_blank.length >= 3, `퀴즈가 부족합니다 (객관식 ${quiz.multiple_choice.length}, 빈칸 ${quiz.fill_blank.length})`);
  return quiz;
}
const DAILY_NORMALIZERS = { qt: normalizeDailyQt, study: normalizeDailyStudy, group: normalizeGroup, quiz: normalizeDailyQuiz };
export const normalizeDailyMode = (mode, raw) => DAILY_NORMALIZERS[mode](raw);

const NORMALIZERS = { review: normalizeReview, qt: normalizeQt, study: normalizeStudy, group: normalizeGroup };
export const normalizeMode = (mode, raw) => NORMALIZERS[mode](raw);

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

  async function call(config, contents, parse) {
    let lastError;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const response = await ai.models.generateContent({
          model,
          contents,
          config: { maxOutputTokens: 65_536, temperature: 0.4, ...config }, // 사고(thinking) 토큰이 포함될 수 있어 넉넉하게
        });
        return parse(readResponseText(response));
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

    /** 설교 한 편의 한 모드(review | qt | study | group)를 만듭니다. */
    generateMode(mode, { category, title, publishedAt, transcript, info }) {
      if (!MODES.includes(mode)) throw new Error(`알 수 없는 모드: ${mode}`);
      const clipped = transcript.length > MAX_TRANSCRIPT_CHARS ? transcript.slice(0, MAX_TRANSCRIPT_CHARS) : transcript;
      return call(
        { systemInstruction: systemPromptFor(mode), responseMimeType: 'application/json' },
        buildUserMessage(mode, { category, title, publishedAt, transcript: clipped, info }),
        (text) => normalizeMode(mode, extractJson(text)),
      );
    },

    /** 오늘의 말씀 한 모드(qt | study | group | quiz)를 만듭니다. text = 그날 본문 전문 */
    generateDaily(mode, { date, refs, text }) {
      if (!DAILY_MODES.includes(mode)) throw new Error(`알 수 없는 말씀 읽기 모드: ${mode}`);
      return call({ systemInstruction: systemPromptForDaily(mode), responseMimeType: 'application/json' }, buildDailyMessage({ date, refs, text }), (t) => normalizeDailyMode(mode, extractJson(t)));
    },

    /**
     * 자막이 없는 영상: 유튜브 영상(공개 영상만)을 Gemini가 직접 듣고 글로 옮깁니다.
     * 화면 영상은 중요하지 않으므로 해상도를 낮춰 토큰(=사용량)을 줄입니다.
     */
    transcribeVideo({ title, videoUrl }) {
      const contents = [{ role: 'user', parts: [{ fileData: { fileUri: videoUrl } }, { text: buildTranscribeMessage({ title }) }] }];
      return call(
        { mediaResolution: 'MEDIA_RESOLUTION_LOW', httpOptions: { timeout: 15 * 60 * 1000 } },
        contents,
        (text) => {
          const t = text.replace(/\s+\n/g, '\n').trim();
          if (t.length < 200) throw new Error('영상에서 옮긴 글이 너무 짧습니다');
          return t;
        },
      );
    },
  };
}
