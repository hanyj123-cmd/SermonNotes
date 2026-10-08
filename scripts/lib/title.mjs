// 영상 제목 해석: "[YYYY.MM.DD] 설교제목 (성경본문) - 설교자" → 날짜·제목·성경본문·설교자
// 그리고 성경 본문 표기("열왕기상 4, 5장", "요 3:16-21")를 책·장·절 범위로 바꿉니다.
import { MAX_PASSAGES } from './bible-books.mjs';

// [정식 이름, 줄임말들, USFM 코드]  — 성경 순서대로 (66권)
const BOOKS = [
  ['창세기', ['창'], 'GEN'], ['출애굽기', ['출'], 'EXO'], ['레위기', ['레'], 'LEV'], ['민수기', ['민'], 'NUM'], ['신명기', ['신'], 'DEU'],
  ['여호수아', ['수'], 'JOS'], ['사사기', ['삿'], 'JDG'], ['룻기', ['룻'], 'RUT'], ['사무엘상', ['삼상'], '1SA'], ['사무엘하', ['삼하'], '2SA'],
  ['열왕기상', ['왕상'], '1KI'], ['열왕기하', ['왕하'], '2KI'], ['역대상', ['대상'], '1CH'], ['역대하', ['대하'], '2CH'], ['에스라', ['스'], 'EZR'],
  ['느헤미야', ['느'], 'NEH'], ['에스더', ['에'], 'EST'], ['욥기', ['욥'], 'JOB'], ['시편', ['시'], 'PSA'], ['잠언', ['잠'], 'PRO'],
  ['전도서', ['전'], 'ECC'], ['아가', ['아'], 'SNG'], ['이사야', ['사'], 'ISA'], ['예레미야', ['렘'], 'JER'], ['예레미야애가', ['애'], 'LAM'],
  ['에스겔', ['겔'], 'EZK'], ['다니엘', ['단'], 'DAN'], ['호세아', ['호'], 'HOS'], ['요엘', ['욜'], 'JOL'], ['아모스', ['암'], 'AMO'],
  ['오바댜', ['옵'], 'OBA'], ['요나', ['욘'], 'JON'], ['미가', ['미'], 'MIC'], ['나훔', ['나'], 'NAM'], ['하박국', ['합'], 'HAB'],
  ['스바냐', ['습'], 'ZEP'], ['학개', ['학'], 'HAG'], ['스가랴', ['슥'], 'ZEC'], ['말라기', ['말'], 'MAL'],
  ['마태복음', ['마'], 'MAT'], ['마가복음', ['막'], 'MRK'], ['누가복음', ['눅'], 'LUK'], ['요한복음', ['요'], 'JHN'], ['사도행전', ['행'], 'ACT'],
  ['로마서', ['롬'], 'ROM'], ['고린도전서', ['고전'], '1CO'], ['고린도후서', ['고후'], '2CO'], ['갈라디아서', ['갈'], 'GAL'], ['에베소서', ['엡'], 'EPH'],
  ['빌립보서', ['빌'], 'PHP'], ['골로새서', ['골'], 'COL'], ['데살로니가전서', ['살전'], '1TH'], ['데살로니가후서', ['살후'], '2TH'],
  ['디모데전서', ['딤전'], '1TI'], ['디모데후서', ['딤후'], '2TI'], ['디도서', ['딛'], 'TIT'], ['빌레몬서', ['몬'], 'PHM'], ['히브리서', ['히'], 'HEB'],
  ['야고보서', ['약'], 'JAS'], ['베드로전서', ['벧전'], '1PE'], ['베드로후서', ['벧후'], '2PE'], ['요한일서', ['요일'], '1JN'], ['요한이서', ['요이'], '2JN'],
  ['요한삼서', ['요삼'], '3JN'], ['유다서', ['유'], 'JUD'], ['요한계시록', ['계'], 'REV'],
];

export const BOOK_ORDER = BOOKS.map(([name, , usfm]) => ({ name, usfm }));

// 정식 이름이 긴 것부터 맞춰 봅니다 ("요한일서"가 "요한"으로 잘못 읽히지 않도록)
const FULL = [...BOOKS].map(([name, abbr, usfm], i) => ({ key: name, name, usfm, idx: i + 1 })).sort((a, b) => b.key.length - a.key.length);
const ABBR = BOOKS.flatMap(([name, abbr, usfm], i) => abbr.map((a) => ({ key: a, name, usfm, idx: i + 1 }))).sort((a, b) => b.key.length - a.key.length);

/** "열왕기상 4, 5장" → { name:'열왕기상', usfm:'1KI', idx:11, rest:'4, 5장' } (책 이름이 아니면 null) */
export function bookOf(text) {
  const s = String(text || '').trim().replace(/^본문\s*[:：]?\s*/, '');
  for (const b of FULL) {
    if (s.startsWith(b.key)) return { ...b, rest: s.slice(b.key.length).trim() };
  }
  for (const b of ABBR) {
    // 줄임말은 뒤에 공백이나 숫자가 올 때만 (예: "요 3:16", "롬8:1")
    if (s.startsWith(b.key) && /^[\s\d]/.test(s.slice(b.key.length) || ' ')) return { ...b, rest: s.slice(b.key.length).trim() };
  }
  return null;
}

/** "[2026.10.1] 새벽기도회 (열왕기상 4, 5장) - 윤정환 목사" → { date, title, scripture, preacher } */
export function parseTitle(raw) {
  let s = String(raw || '').trim();
  let date = '';
  const dm = /^\[\s*(\d{4})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*(\d{1,2})\s*\]\s*/.exec(s);
  if (dm) {
    date = `${dm[1]}-${dm[2].padStart(2, '0')}-${dm[3].padStart(2, '0')}`;
    s = s.slice(dm[0].length);
  }
  let preacher = '';
  const pm = /\s[-–—]\s+([^-–—]+)$/.exec(s);
  if (pm) {
    preacher = pm[1].trim();
    s = s.slice(0, pm.index).trim();
  }
  let scripture = '';
  const sm = /\(([^()]+)\)\s*$/.exec(s);
  if (sm && bookOf(sm[1])) {
    scripture = sm[1].trim();
    s = s.slice(0, sm.index).trim();
  }
  return { date, title: s, scripture, preacher };
}

/** 화면·PDF에 쓸 깔끔한 제목: "[2026.10.04] 믿음의 길 (창 12:1-9) - 홍길동 목사" → "믿음의 길" (규칙에 안 맞는 제목은 그대로) */
export function tidyTitle(raw) {
  const s = String(raw || '').trim();
  if (!s.startsWith('[')) return s; // [날짜]로 시작하는 유튜브 제목 형식일 때만 뗍니다 ("은혜 - 감사" 같은 제목을 설교자로 오해하지 않도록)
  return parseTitle(s).title || s;
}


export const CAT_TITLE_LABEL = { sunday: '주일예배', dawn: '새벽기도', wednesday: '수요예배', youth: '청년부예배' };
const GENERIC_TITLE = /^(주일|새벽|수요|청년부?|청년\d?부)(오전|낮|저녁|\d부|\d차)?(예배|기도회|기도|말씀)?$/;
export const isGenericTitle = (t) => {
  const k = String(t || '').replace(/\s+/g, '');
  return !k || GENERIC_TITLE.test(k);
};

/** 설교자 이름 통일: "전대혁" · "전대혁 담임목사" · "토론토영락교회 전대혁" → "전대혁 목사" (전도사·강도사·장로·선교사·교수는 그 직함을 그대로 둠) */
const PREACHER_ROLE = '(?:목사|전도사|강도사|장로|선교사|교수|박사)';
const PREACHER_MOD = '(?:담임|부|협동|원로|객원|초청|수석|선임|청년부|청년1부)';
function normalizeOnePreacher(raw) {
  let s = String(raw || '').replace(/[()[\]]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s || !/[가-힣]/.test(s)) return s;
  s = s.replace(/^(설교자|설교|강사|말씀)\s*[:：]\s*/, '').replace(/^(토론토\s*)?영락\s*교회\s*/, '').trim();
  let role = '';
  const lead = new RegExp(`^(?:${PREACHER_MOD}\\s*)*(${PREACHER_ROLE})\\s+`).exec(s);
  if (lead) {
    role = lead[1];
    s = s.slice(lead[0].length);
  }
  const trail = new RegExp(`\\s*(?:${PREACHER_MOD}\\s*)*(${PREACHER_ROLE})\\s*님?$`).exec(s);
  if (trail) {
    role = role || trail[1];
    s = s.slice(0, trail.index);
  }
  s = s.replace(/님$/, '').trim();
  if (!s) return '';
  return `${s} ${role && role !== '목사' ? role : '목사'}`;
}
export function normalizePreacher(raw) {
  const parts = String(raw || '').split(/\s*[,/·&]\s*|\s+및\s+/).filter((x) => x.trim());
  return parts.map(normalizeOnePreacher).filter(Boolean).join(', ');
}

/** 설교 제목 통일: "주일예배 - 설교제목". 제목이 없으면(새벽기도 등) 성경 본문을 씁니다. 사용자 영상은 구분 이름을 붙이지 않습니다. */
export function displayTitle({ category, title, aiTitle = '', scripture = '' }) {
  const label = CAT_TITLE_LABEL[category];
  const t = String(title || '').trim();
  if (label && /^(주일예배|새벽기도회?|수요예배|청년부예배)\s[-–—]\s\S/.test(t)) return t; // 이미 통일된 형식
  const pick = (x) => (isGenericTitle(x) ? '' : String(x).trim());
  const core = pick(t) || (category === 'dawn' ? '' : pick(aiTitle)) || String(scripture || '').trim() || t || String(aiTitle || '').trim();
  return label && core ? `${label} - ${core}` : core;
}

/** 설교자 이름에서 직함을 뗀 이름 ("윤정환 목사" → "윤정환") — 같은 사람을 하나로 묶을 때 씁니다 */
export function preacherName(p) {
  return String(p || '').replace(/\s*(담임|부|협동|원로|객원|초청)?\s*(목사|전도사|강도사|장로|선교사|교수|박사)님?\s*$/, '').trim();
}

/**
 * 성경 본문 표기를 범위 목록으로 바꿉니다.
 *   "열왕기상 4, 5장"      → 4장 전체, 5장 전체
 *   "요한복음 3:16-21"     → 3장 16~21절
 *   "시편 23편"            → 23편 전체
 *   "마 5:1-12, 6:9-13"    → 5장 1~12절, 6장 9~13절
 *   "창세기 1:1~2:3"       → 1장 1절~끝, 2장 1~3절 (장이 걸치면 나눕니다)
 * 해석하지 못하면 빈 배열.
 */
export function parseScripture(text, { chapterLengths = null } = {}) {
  const b = bookOf(text);
  if (!b) return [];
  const rest = b.rest.replace(/[장편절]/g, (m) => (m === '절' ? ' ' : ' ')).replace(/\s+/g, ' ').trim();
  const out = [];
  const push = (chapter, from = null, to = null) => {
    if (out.length < MAX_PASSAGES && chapter >= 1 && chapter <= 150) out.push({ book: b.usfm, chapter, verse_from: from, verse_to: to });
  };
  // 쉼표/세미콜론으로 나눈 토막을 차례로 읽습니다. 장이 정해진 뒤에는 "9-13" 같은 토막을 같은 장의 절로 봅니다.
  const hadVerses = /\d+\s*:\s*\d+/.test(rest);
  let curChapter = null;
  for (const raw of rest.split(/[,;]/)) {
    const part = raw.trim();
    if (!part) continue;
    let m;
    if ((m = /^(\d+)\s*:\s*(\d+)\s*[-~–]\s*(\d+)\s*:\s*(\d+)$/.exec(part))) {
      // 1:1~2:3  (장이 걸침)
      const [c1, v1, c2, v2] = m.slice(1).map(Number);
      push(c1, v1, null);
      for (let c = c1 + 1; c < c2; c++) push(c);
      push(c2, 1, v2);
      curChapter = c2;
    } else if ((m = /^(\d+)\s*:\s*(\d+)\s*(?:[-~–]\s*(\d+))?$/.exec(part))) {
      curChapter = Number(m[1]);
      push(curChapter, Number(m[2]), m[3] ? Number(m[3]) : Number(m[2]));
    } else if ((m = /^(\d+)\s*[-~–]\s*(\d+)$/.exec(part))) {
      if (hadVerses && curChapter) push(curChapter, Number(m[1]), Number(m[2]));
      else for (let c = Number(m[1]); c <= Number(m[2]) && c < Number(m[1]) + MAX_PASSAGES; c++) push(c); // "4-5장"
    } else if ((m = /^(\d+)$/.exec(part))) {
      if (hadVerses && curChapter) push(curChapter, Number(m[1]), Number(m[1]));
      else push(Number(m[1]));
    } else if ((m = /^(\d+)\s+(\d+)\s*[-~–]\s*(\d+)$/.exec(part))) {
      // "11장 1-6절" → "11 1-6"
      curChapter = Number(m[1]);
      push(curChapter, Number(m[2]), Number(m[3]));
    } else {
      return out; // 알 수 없는 표기에서 멈춤
    }
  }
  return out;
}
