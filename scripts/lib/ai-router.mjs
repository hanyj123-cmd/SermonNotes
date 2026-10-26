// 메뉴마다 다른 AI 모델(Claude · Gemini)을 쓰게 하는 길잡이
//
// 관리 화면에서 고른 값은 시트 Settings 탭에 저장됩니다.
//   ai_model / ai_effort                 모든 메뉴의 기본 모델 · 생각 깊이
//   ai_model_<메뉴> / ai_effort_<메뉴>    그 메뉴만 다르게 쓸 때 (비어 있으면 기본을 따릅니다)
// 모델 이름이 claude- 로 시작하면 Claude, gemini- 로 시작하면 Gemini 를 씁니다.
import { createClaude, DEFAULT_MODEL, DEFAULT_EFFORT, EFFORTS, isClaudeModel, isGeminiModel, isAiModel } from './ai.mjs';
import { createGemini } from './ai-gemini.mjs';

/** 모델을 따로 고를 수 있는 메뉴 (설교 구분 5가지 + 오늘의 말씀 · 잠언 묵상 · AI 문장 다듬기) */
export const AI_MENUS = [
  { key: 'sunday', label: '주일예배', video: true },
  { key: 'wednesday', label: '수요예배', video: true },
  { key: 'dawn', label: '새벽기도', video: true },
  { key: 'youth', label: '청년부예배', video: true },
  { key: 'user', label: '사용자 영상', video: true },
  { key: 'daily', label: '오늘의 말씀', video: false },
  { key: 'proverbs', label: '잠언 묵상', video: false },
  { key: 'polish', label: 'AI 문장 다듬기', video: false },
];
export const MENU_KEYS = AI_MENUS.map((m) => m.key);

/** 관리 화면(Settings 탭)과 환경변수에서 읽은 값으로, 한 메뉴가 쓸 모델과 생각 깊이를 정합니다 */
export function resolveMenu(menu, settings = {}, env = {}) {
  const pickModel = (v) => (isAiModel(v) ? String(v).trim() : '');
  const own = pickModel(settings[`ai_model_${menu}`]);
  const dflt = pickModel(settings.ai_model) || [env.CLAUDE_MODEL].find(isClaudeModel) || DEFAULT_MODEL;
  const pickEffort = (v) => {
    const e = String(v || '').trim().toLowerCase();
    return EFFORTS.includes(e) ? e : '';
  };
  const effort = pickEffort(settings[`ai_effort_${menu}`]) || pickEffort(settings.ai_effort) || pickEffort(env.CLAUDE_EFFORT) || DEFAULT_EFFORT;
  const model = own || dflt;
  return { model, effort, provider: isGeminiModel(model) ? 'gemini' : 'claude', custom: !!own };
}

/** 키가 없어서 쓸 수 없는 모델: 만들 때가 아니라 쓸 때 이유를 알려 주어, 다른 메뉴는 그대로 돌아가게 합니다 */
function unusableEngine({ model, effort, provider }, reason) {
  const fail = async () => {
    throw new Error(reason);
  };
  return { model, effort, provider, watchesVideo: false, generateMode: fail, generateDaily: fail, generateProverb: fail, unusable: reason };
}

/**
 * @param opts { settings, env, anthropicKey, geminiKey, factories: { claude, gemini } } — factories 는 테스트용
 * @returns    { forMenu(menu) → AI 엔진, describe() → 메뉴별 안내 글 }
 */
export function createAiRouter({ settings = {}, env = {}, anthropicKey = '', geminiKey = '', factories = {} } = {}) {
  const makeClaude = factories.claude || createClaude;
  const makeGemini = factories.gemini || createGemini;
  const cache = new Map();

  function forMenu(menu) {
    const r = resolveMenu(menu, settings, env);
    const id = `${r.provider}|${r.model}|${r.effort}`;
    if (!cache.has(id)) {
      let engine;
      if (r.provider === 'gemini') {
        engine = geminiKey ? makeGemini(geminiKey, r.model, { effort: r.effort }) : unusableEngine(r, `Gemini 모델(${r.model})을 쓰려면 GEMINI_API_KEY 가 필요합니다 (GitHub Secrets 에 등록하세요)`);
      } else {
        engine = anthropicKey ? makeClaude(anthropicKey, r.model, { effort: r.effort }) : unusableEngine(r, `Claude 모델(${r.model})을 쓰려면 ANTHROPIC_API_KEY 가 필요합니다 (GitHub Secrets 에 등록하세요)`);
      }
      cache.set(id, engine);
    }
    return cache.get(id);
  }

  function describe() {
    return AI_MENUS.filter((m) => m.key !== 'polish').map((m) => {
      const e = forMenu(m.key);
      const how = e.unusable ? ' ⚠ 키 없음' : e.provider === 'gemini' && m.video ? ' (영상 직접 분석)' : '';
      return `   · ${m.label}: ${e.model} (${e.provider === 'gemini' ? '생각 ' : 'effort '}${e.effort})${how}`;
    });
  }

  return { forMenu, describe };
}
