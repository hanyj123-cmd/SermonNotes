// Claude API 호출 + 결과 검증 (설교 한 편을 4가지 모드로 따로 정리)
import Anthropic from '@anthropic-ai/sdk';
import { MODES, systemPromptFor, buildUserMessage, DAILY_MODES, systemPromptForDaily, buildDailyMessage, PROVERB_MODES, systemPromptForProverb, buildProverbMessage } from './prompt.mjs';
import { normalizePassages } from './bible-books.mjs';
import { mixQuiz } from './quizmix.mjs';

export const DEFAULT_MODEL = 'claude-sonnet-5-5';
export const DEFAULT_EFFORT = 'medium';
export const EFFORTS = ['low', 'medium', 'high'];
/** Claude 모델 이름 (claude- 로 시작) */
export const isClaudeModel = (m) => /^claude-[\w.-]{3,60}$/.test(String(m || '').trim());
/** Gemini 모델 이름 (예: gemini-3.8-flash) */
export const isGeminiModel = (m) => /^gemini-[\w.-]{2,60}$/.test(String(m || '').trim());
/** 관리 화면에서 고를 수 있는 모델 이름: Claude 또는 Gemini */
export const isAiModel = (m) => isClaudeModel(m) || isGeminiModel(m);
const MAX_TRANSCRIPT_CHARS = 150_000;
const MAX_ATTEMPTS = 3;
// 새로 만든 퀴즈가 최소한 이만큼은 있어야 저장합니다 (정해진 개수보다 조금 여유를 둡니다)
const QUIZ_MIN = { multiple_choice: 17, fill_blank: 4, word_answer: 4 };
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504, 529]);
const MAX_TOKENS = 128_000; // 생각(thinking) + 답 전체 한도 (모델 최대). 본문이 여러 곳인 날의 긴 성경공부도 잘리지 않게

export function extractJson(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('응답에서 JSON을 찾지 못했습니다');
  return JSON.parse(text.slice(start, end + 1));
}

const LEVEL_OF = (v) => (/어려/.test(asString(v)) ? '어려움' : /중/.test(asString(v)) ? '중간' : /쉬/.test(asString(v)) ? '쉬움' : '');
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
export function normalizeQuiz(q = {}, max = { mc: 20, fb: 5, wa: 5, sa: 5 }) {
  const mc = (Array.isArray(q.multiple_choice) ? q.multiple_choice : [])
    .map((x) => {
      const options = asArray(x?.options).slice(0, 5);
      const idx = Number(x?.answer_index);
      const level = LEVEL_OF(x?.level);
      return { question: asString(x?.question), options, answer_index: Number.isInteger(idx) ? idx : -1, level, ...(asString(x?.hint) ? { hint: clip(x.hint, 300) } : {}), explanation: asString(x?.explanation) };
    })
    .filter((x) => x.question && x.options.length >= 2 && x.answer_index >= 0 && x.answer_index < x.options.length);
  const shortWord = (list) =>
    (Array.isArray(list) ? list : [])
      .map((x) => ({ question: asString(x?.question), answer: clip(x?.answer, 40), accept: asArray(x?.accept).map((a) => a.slice(0, 40)).filter((a) => blankKey(a)).slice(0, 6), level: LEVEL_OF(x?.level), ...(asString(x?.hint) ? { hint: clip(x.hint, 300) } : {}), explanation: asString(x?.explanation) }))
      .filter((x) => x.question && blankKey(x.answer));
  const fb = shortWord(q.fill_blank);
  const wa = shortWord(q.word_answer);
  const sa = (Array.isArray(q.short_answer) ? q.short_answer : [])
    .map((x) => ({ question: asString(x?.question), answer: asString(x?.answer), explanation: asString(x?.explanation) }))
    .filter((x) => x.question && x.answer);
  // 정답이 거의 매번 "가장 긴 보기"면 티가 나므로 다시 만들게 합니다 (재시도)
  if (mc.length >= 8) {
    const longest = mc.filter((x) => {
      const len = x.options.map((o) => o.length);
      return len[x.answer_index] === Math.max(...len) && len.filter((n) => n === len[x.answer_index]).length === 1;
    }).length;
    need(longest / mc.length <= 0.65, `객관식 정답이 가장 긴 보기인 문제가 너무 많습니다 (${longest}/${mc.length})`);
  }
  const mixed = mixQuiz(mc, fb, wa);
  return { multiple_choice: mixed.mc.slice(0, max.mc), fill_blank: mixed.fb.slice(0, max.fb), word_answer: mixed.wa.slice(0, max.wa), short_answer: sa.slice(0, max.sa) };
}

export function normalizeStudy(raw, { requireQuiz = true } = {}) {
  const { multiple_choice: mc, fill_blank: fb, word_answer: wa, short_answer: sa } = normalizeQuiz(raw.quiz || {});
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
    quiz: { multiple_choice: mc, fill_blank: fb, word_answer: wa, short_answer: sa },
    closing_prayer: asString(raw.closing_prayer),
  };
  need(out.deep_dive.length, '신학 딥다이브(deep_dive)가 비어 있습니다');
  if (requireQuiz) need(mc.length >= QUIZ_MIN.multiple_choice && fb.length >= QUIZ_MIN.fill_blank && wa.length >= QUIZ_MIN.word_answer && sa.length >= 3, `퀴즈가 부족합니다 (객관식 ${mc.length}, 빈칸 ${fb.length}, 단답식 ${wa.length}, 주관식 ${sa.length})`);
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
/** 오늘의 말씀 · 잠언 퀴즈: 객관식 15 + 단답식 5 (읽은 내용 확인용, 문제마다 힌트) */
const DAILY_QUIZ_MAX = { mc: 15, fb: 0, wa: 5, sa: 0 };
const DAILY_QUIZ_MIN = { multiple_choice: 13, word_answer: 4 };
export function normalizeDailyQuiz(raw) {
  const quiz = normalizeQuiz(raw.quiz || raw, DAILY_QUIZ_MAX);
  need(quiz.multiple_choice.length >= DAILY_QUIZ_MIN.multiple_choice && quiz.word_answer.length >= DAILY_QUIZ_MIN.word_answer, `퀴즈가 부족합니다 (객관식 ${quiz.multiple_choice.length}, 단답식 ${quiz.word_answer.length})`);
  return quiz;
}
const DAILY_NORMALIZERS = { qt: normalizeDailyQt, study: normalizeDailyStudy, group: normalizeGroup, quiz: normalizeDailyQuiz };
export const normalizeDailyMode = (mode, raw) => DAILY_NORMALIZERS[mode](raw);

/* ---------- 잠언 묵상 ---------- */
export function normalizeProverbWord(raw) {
  const out = {
    theme: clip(raw.theme, 200),
    summary: clip(raw.summary, 800),
    outline: (Array.isArray(raw.outline) ? raw.outline : []).map((o) => ({ verses: clip(o?.verses, 20), title: clip(o?.title, 120) })).filter((o) => o.title).slice(0, 8),
    key_verses: (Array.isArray(raw.key_verses) ? raw.key_verses : [])
      .map((k) => ({ reference: clip(k?.reference, 40), text: clip(k?.text, 600), title: clip(k?.title, 120), meaning: clip(k?.meaning, 1200), apply: clip(k?.apply, 400) }))
      .filter((k) => k.reference && k.text)
      .slice(0, 3),
  };
  need(out.key_verses.length >= 3, `핵심 구절이 3개가 아닙니다 (${out.key_verses.length}개)`);
  need(out.summary, '장 요약이 비어 있습니다');
  return out;
}
export function normalizeProverbStudy(raw) {
  const out = normalizeDailyStudy(raw);
  out.perspectives = (Array.isArray(raw.perspectives) ? raw.perspectives : [])
    .map((p) => ({ title: clip(p?.title, 160), views: paraList(p?.views, 5), pastoral: paraList(p?.pastoral, 3) }))
    .filter((p) => p.title && p.views.length)
    .slice(0, 6);
  return out;
}
const GROUP_SECTION_KEYS = ['icebreaker', 'observation', 'reflection', 'application', 'prayer'];
export function normalizeProverbGroup(raw) {
  const m = raw.member || {};
  const l = raw.leader || {};
  const questions = (Array.isArray(m.questions) ? m.questions : [])
    .map((q, i) => ({ id: clip(q?.id, 10) || `q${i + 1}`, section: GROUP_SECTION_KEYS.includes(q?.section) ? q.section : 'reflection', question: clip(q?.question, 600) }))
    .filter((q) => q.question)
    .slice(0, 14);
  const byId = new Map((Array.isArray(l.questions) ? l.questions : []).map((q) => [String(q?.id || ''), q]));
  const out = {
    representative_prayer: asString(raw.representative_prayer),
    songs: songItems(raw.songs),
    member: { summary: clip(m.summary, 1500), key_verse: { reference: clip(m.key_verse?.reference, 40), text: clip(m.key_verse?.text, 500) }, questions },
    leader: {
      overview: clip(l.overview, 1000),
      questions: questions.map((q) => {
        const x = byId.get(q.id) || {};
        return { id: q.id, intent: clip(x.intent, 500), guide: clip(x.guide, 900), answers: asArray(x.answers).map((a) => clip(a, 500)).slice(0, 4), follow_up: clip(x.follow_up, 400) };
      }),
      flow: (Array.isArray(l.flow) ? l.flow : []).map((f) => ({ title: clip(f?.title, 80), minutes: Number.isFinite(Number(f?.minutes)) ? Math.round(Number(f.minutes)) : 0, detail: clip(f?.detail, 600) })).filter((f) => f.title).slice(0, 8),
      tips: asArray(l.tips).map((t) => clip(t, 400)).slice(0, 8),
      closing_words: clip(l.closing_words, 1200),
    },
    closing_prayer: asString(raw.closing_prayer),
  };
  need(questions.length >= 5, `나눔 질문이 부족합니다 (${questions.length}개)`);
  need(out.leader.questions.filter((q) => q.intent || q.guide).length >= Math.ceil(questions.length / 2), '인도자용 해설이 부족합니다');
  need(out.representative_prayer && out.closing_prayer, '기도문이 비어 있습니다');
  return out;
}
const PROVERB_NORMALIZERS = { word: normalizeProverbWord, qt: (r) => normalizeDailyQt(r), study: normalizeProverbStudy, group: normalizeProverbGroup, quiz: normalizeDailyQuiz };
export const normalizeProverbMode = (mode, raw) => PROVERB_NORMALIZERS[mode](raw);

const NORMALIZERS = { review: normalizeReview, qt: normalizeQt, study: normalizeStudy, group: normalizeGroup };
export const normalizeMode = (mode, raw) => NORMALIZERS[mode](raw);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Claude 응답에서 텍스트를 꺼내고, 비어 있거나 잘렸으면 이유를 설명하는 오류를 던집니다. */
export function readResponseText(message) {
  const text = (message?.content || []).filter((b) => b?.type === 'text').map((b) => b.text || '').join('');
  const stop = message?.stop_reason;
  if (stop === 'refusal') throw new Error('요청이 거절되었습니다 (refusal)');
  if (stop === 'max_tokens') throw new Error('응답이 길이 제한으로 잘렸습니다');
  if (!text.trim()) throw new Error(`빈 응답입니다 (stop_reason: ${stop || '알 수 없음'})`);
  return text;
}

/** 정답이 (혼자) 가장 긴 보기인 객관식인지 — normalizeQuiz 의 검사와 같은 기준 */
export function correctIsLongest(q) {
  const options = asArray(q?.options);
  const idx = Number(q?.answer_index);
  if (!Number.isInteger(idx) || idx < 0 || idx >= options.length) return false;
  const len = options.map((o) => o.length);
  return len[idx] === Math.max(...len) && len.filter((n) => n === len[idx]).length === 1;
}
const LONGEST_TARGET = 0.3; // 다듬은 뒤 이 비율 이하가 목표 (저장 기준은 65%)
const FIX_OPTIONS_SYSTEM = `당신은 성경 퀴즈의 객관식 보기를 다듬는 편집자입니다. 받은 문제들은 정답 보기가 가장 길어서 정답이 티가 납니다.
규칙:
1. 정답 보기(answer_index 자리)는 한 글자도 바꾸지 않고 같은 자리에 그대로 둡니다.
2. 오답 보기만 다시 씁니다. 정답과 같은 정도의 수식어·이유·근거를 붙여 정답과 비슷하거나 더 길게 씁니다.
3. 받은 문제의 절반 정도는 모든 오답을 정답보다 확실히 길게 써서 정답이 가장 짧은 보기가 되게 하고, 나머지는 오답 중 적어도 하나가 정답보다 확실히 길게 합니다.
4. 오답은 여전히 본문과 맞지 않는 분명히 틀린 내용이어야 하고, 정답과 뜻이 겹치면 안 됩니다. 그럴듯하지만 틀린 오답이 좋습니다.
5. 보기 개수는 그대로 둡니다.
출력: {"items": [{"i": 받은 번호, "options": ["보기1", "보기2", "보기3", "보기4"]}]}`;

export const JSON_ONLY = '\n\n출력 형식: 설명이나 코드 블록(```) 없이, 위에서 정한 JSON 객체 하나만 출력합니다.';

/**
 * 모델 회사(Claude · Gemini)와 상관없이 같은 방식으로 정리 결과를 만드는 공용 엔진입니다.
 * call(system, userText, parse, media) 만 회사마다 다르게 만들어 넣습니다.
 *   media = { videoId, textFallback } — 영상을 직접 보는 모델(Gemini)에게만 넘어갑니다.
 */
export function buildEngine({ call, model, effort, provider = 'claude', watchesVideo = false }) {
  /** 객관식 정답이 가장 긴 보기인 문제가 많으면, 그 문제들의 오답 보기만 AI 에게 다시 쓰게 합니다 (정답 글은 그대로) */
  async function balanceOptions(raw) {
    const quiz = raw && typeof raw.quiz === 'object' ? raw.quiz : raw;
    const mc = Array.isArray(quiz?.multiple_choice) ? quiz.multiple_choice : [];
    const bad = mc.map((q, i) => ({ q, i })).filter(({ q }) => correctIsLongest(q));
    if (mc.length < 8 || bad.length <= Math.floor(mc.length * LONGEST_TARGET)) return raw;
    console.log(`   ⚖️  객관식 ${mc.length}문제 중 ${bad.length}문제가 정답이 가장 긴 보기라 오답 보기를 다시 씁니다…`);
    try {
      const items = bad.map(({ q, i }) => ({ i, question: asString(q.question), options: asArray(q.options), answer_index: Number(q.answer_index) }));
      const out = await call(FIX_OPTIONS_SYSTEM, JSON.stringify({ items }, null, 1), (t) => extractJson(t));
      for (const it of Array.isArray(out?.items) ? out.items : []) {
        const q = mc[Number(it?.i)];
        if (!q) continue;
        const opts = asArray(it.options);
        const idx = Number(q.answer_index);
        const old = asArray(q.options);
        if (opts.length !== old.length || opts[idx] !== old[idx]) continue; // 정답이 바뀌었으면 쓰지 않음
        q.options = opts;
      }
      console.log(`   ⚖️  다시 쓴 뒤: ${mc.filter(correctIsLongest).length}/${mc.length}`);
    } catch (e) {
      console.warn(`   ⚖️  보기 다시 쓰기 실패: ${String(e?.message || e).slice(0, 160)}`);
    }
    return raw;
  }

  return {
    model,
    effort,
    provider,
    /** true 이면 설교 정리 때 영상 주소(videoId)를 넘겨 모델이 영상을 직접 보고 듣게 합니다 */
    watchesVideo,

    /**
     * 설교 한 편의 한 모드(review | qt | study | group)를 만듭니다.
     * videoId 가 있고 이 모델이 영상을 볼 수 있으면 영상을 직접 분석하고, 영상을 열 수 없을 때만 transcript(자막)로 대신합니다.
     */
    generateMode(mode, { category, title, publishedAt, transcript = '', info, videoId = '' }) {
      if (!MODES.includes(mode)) throw new Error(`알 수 없는 모드: ${mode}`);
      const clipped = transcript.length > MAX_TRANSCRIPT_CHARS ? transcript.slice(0, MAX_TRANSCRIPT_CHARS) : transcript;
      const textMsg = clipped ? buildUserMessage(mode, { category, title, publishedAt, transcript: clipped, info }) : '';
      const direct = watchesVideo && videoId;
      if (!direct && !textMsg) return Promise.reject(new Error('정리할 설교 내용(자막)이 없습니다'));
      const userText = direct ? buildUserMessage(mode, { category, title, publishedAt, info, video: true }) : textMsg;
      const parse = async (text) => normalizeMode(mode, mode === 'study' ? await balanceOptions(extractJson(text)) : extractJson(text));
      return call(systemPromptFor(mode), userText, parse, direct ? { videoId, textFallback: textMsg } : null);
    },

    /** 오늘의 말씀 한 모드(qt | study | group | quiz)를 만듭니다. text = 그날 본문 전문 */
    generateDaily(mode, { date, refs, text }) {
      if (!DAILY_MODES.includes(mode)) throw new Error(`알 수 없는 말씀 읽기 모드: ${mode}`);
      return call(systemPromptForDaily(mode), buildDailyMessage({ date, refs, text }), async (t) => normalizeDailyMode(mode, mode === 'quiz' ? await balanceOptions(extractJson(t)) : extractJson(t)));
    },

    generateProverb(mode, { chapter, text }) {
      if (!PROVERB_MODES.includes(mode)) throw new Error(`알 수 없는 잠언 모드: ${mode}`);
      return call(systemPromptForProverb(mode), buildProverbMessage({ chapter, text }), async (t) => normalizeProverbMode(mode, mode === 'quiz' ? await balanceOptions(extractJson(t)) : extractJson(t)));
    },
  };
}

/** 재시도할 만한 일시적 오류인지에 따른 대기 시간(ms) */
export const retryDelay = (status, attempt) => (RETRYABLE_STATUS.has(status) ? 8000 * attempt : 1000);
export const MAX_CALL_ATTEMPTS = MAX_ATTEMPTS;

// options.client / options.sleep 은 테스트에서 가짜로 바꿔 끼우기 위한 것입니다.
export function createClaude(apiKey, model = DEFAULT_MODEL, options = {}) {
  const effort = EFFORTS.includes(options.effort) ? options.effort : DEFAULT_EFFORT;
  const client = options.client || new Anthropic({ apiKey, maxRetries: 2, timeout: 20 * 60 * 1000 });
  const wait = options.sleep || sleep;

  async function call(system, userText, parse) {
    let lastError;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        // 긴 답은 스트리밍으로 받아야 시간 제한에 걸리지 않습니다
        const message = await client.messages
          .stream({
            model,
            max_tokens: MAX_TOKENS,
            system: system + JSON_ONLY,
            messages: [{ role: 'user', content: userText }],
            output_config: { effort },
          })
          .finalMessage();
        return await parse(readResponseText(message));
      } catch (e) {
        lastError = e;
        console.warn(`   ↻ 시도 ${attempt}/${MAX_ATTEMPTS} 실패: ${String(e?.message || e).slice(0, 160)}`);
        if (e?.status === 401 || e?.status === 403) break; // 키 문제는 다시 해도 소용없음
        if (/credit balance/i.test(String(e?.message || ''))) break; // 크레딧 소진
        if (attempt === MAX_ATTEMPTS) break;
        // 일시적 오류(429/5xx/529 과부하)는 잠시 기다렸다 재시도, 그 외(깨진 JSON 등)는 바로 재시도
        await wait(retryDelay(e?.status, attempt));
      }
    }
    throw lastError;
  }

  return buildEngine({ call, model, effort, provider: 'claude', watchesVideo: false });
}
