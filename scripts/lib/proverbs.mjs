// 잠언 묵상 / 성경공부: 잠언 1~31장을 한 번씩 정리해 둡니다. 한 달에 한 장씩 화면에서 골라 깊이 묵상합니다.
//   시트 Proverbs 탭 한 줄 = 한 장. 말씀(핵심 3구절) · QT 묵상 · 성경공부 · 소그룹(부원용+인도자용) · 퀴즈를 AI 가 만들고,
//   성경 본문(4역본)은 설교와 같은 방식(bible-web.mjs)으로 가져옵니다.
import { fetchBibleBlock } from './bible-web.mjs';
import { parseScripture } from './title.mjs';
import { fitCommentary, DAILY_CELL_LIMIT } from './daily.mjs';

export const PROVERBS_TAB = 'Proverbs';
export const PROVERBS_HEADERS = ['chapter', 'status', 'bible_json', 'word_json', 'qt_json', 'study_json', 'commentary_json', 'group_json', 'quiz_json', 'updated_at', 'note'];
export const PROVERB_COLUMNS = { word: ['word_json'], qt: ['qt_json'], study: ['study_json', 'commentary_json'], group: ['group_json'], quiz: ['quiz_json'] };
const MODE_COL = { word: 'word_json', qt: 'qt_json', study: 'study_json', group: 'group_json', quiz: 'quiz_json' };
export const PROVERB_MODES_ALL = ['word', 'qt', 'study', 'group', 'quiz'];
export const PROVERB_CHAPTERS = 31;
export const PROVERB_PICK_MAX = 12; // 관리 화면에서 한 번에 고를 수 있는 장 수


const parseJson = (s) => {
  try {
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
};

/** 4역본 중 개역개정 본문 → AI 에게 줄 글 ("1 내 아들아 …") */
export function proverbText(bible) {
  const v = (bible?.versions || []).find((x) => x.id === 'GAE') || (bible?.versions || [])[0];
  return (v?.passages || []).flatMap((p) => (p.verses || []).map((x) => `${x.n} ${x.text}`)).join('\n');
}

/**
 * 한 장을 만들거나(처음) 빠진 부분만 채웁니다.
 * @returns Proverbs 탭에 쓸 한 줄 객체 (본문을 못 가져오면 오류)
 */
export async function buildProverbChapter(chapter, existing, { ai, modes = PROVERB_MODES_ALL, fetchBible = (ps) => fetchBibleBlock(ps), now = () => new Date().toISOString(), log = () => {} }) {
  const prev = existing || {};
  let bible = parseJson(prev.bible_json);
  if (!bible || !(bible.versions || []).length) bible = await fetchBible(parseScripture(`잠언 ${chapter}장`));
  const text = proverbText(bible);
  if (!text) throw new Error(`잠언 ${chapter}장 본문을 가져오지 못했습니다`);
  const results = Object.fromEntries(PROVERB_MODES_ALL.map((m) => [m, parseJson(prev[MODE_COL[m]])]));
  if (results.study && !results.study.commentary) {
    const c = parseJson(prev.commentary_json);
    if (Array.isArray(c)) results.study.commentary = c;
  }
  const failures = [];
  for (const mode of modes) {
    if (results[mode]) continue;
    log(`   ▷ 잠언 ${chapter}장 ${mode} 만드는 중…`);
    try {
      results[mode] = await ai.generateProverb(mode, { chapter, text });
    } catch (e) {
      failures.push(`${mode}: ${String(e.message || e).slice(0, 120)}`);
      log(`   ❌ 잠언 ${chapter}장 ${mode} 실패: ${e.message}`);
    }
  }
  const missing = PROVERB_MODES_ALL.filter((m) => !results[m]);
  const row = { chapter: String(chapter), status: failures.length || missing.length ? 'error' : 'done', updated_at: now(), note: (failures.join(' / ') || (missing.length ? `아직 없음: ${missing.join(', ')}` : '')).slice(0, 500) };
  const put = (col, value) => {
    const j = value == null ? '' : JSON.stringify(value);
    if (j.length > DAILY_CELL_LIMIT) {
      row.status = 'error';
      row.note = `${row.note} ${col} 이(가) 너무 깁니다`.trim();
    } else row[col] = j;
  };
  put('bible_json', bible);
  for (const m of PROVERB_MODES_ALL) {
    if (m === 'study' && results.study && Array.isArray(results.study.commentary)) {
      const { commentary, ...rest } = results.study;
      put('study_json', rest);
      put('commentary_json', fitCommentary(commentary));
    } else put(MODE_COL[m], results[m]);
  }
  return row;
}

/** 시트 한 줄 → 화면용 JSON */
export function proverbExport(row) {
  const study = parseJson(row.study_json);
  const c = parseJson(row.commentary_json);
  if (study && Array.isArray(c) && c.length) study.commentary = c;
  const ch = Number(row.chapter);
  return {
    id: `prov-${String(ch).padStart(2, '0')}`,
    chapter: ch,
    ref: `잠언 ${ch}장`,
    complete: row.status === 'done',
    bible: parseJson(row.bible_json),
    word: parseJson(row.word_json),
    qt: parseJson(row.qt_json),
    study,
    group: parseJson(row.group_json),
    quiz: parseJson(row.quiz_json),
  };
}

/**
 * 이번 실행에서 만들 장들.
 * @param want  'missing' | '3,7' | '' (자동: 1장부터 빠진 장 몇 개)
 */
export function proverbChaptersToBuild(rows, { want = '', force = false, perRun = 3, now = new Date() } = {}) {
  const done = new Map(rows.map((r) => [Number(r.chapter), r]));
  const isDone = (ch) => done.get(ch)?.status === 'done';
  const picked = String(want || '').trim().toLowerCase();
  if (picked && picked !== 'missing') {
    const list = [...new Set(picked.split(/[\s,]+/).map(Number).filter((n) => n >= 1 && n <= PROVERB_CHAPTERS))];
    return (force ? list : list.filter((ch) => !isDone(ch))).slice(0, PROVERB_PICK_MAX);
  }
  const list = Array.from({ length: PROVERB_CHAPTERS }, (_, i) => i + 1).filter((ch) => !isDone(ch));
  return list.slice(0, picked === 'missing' ? 6 : perRun);
}
