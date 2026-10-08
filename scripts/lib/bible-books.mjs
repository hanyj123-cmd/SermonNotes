// 성경 66권 USFM 코드 (YouVersion 등 성경 API가 쓰는 표기)
export const USFM_BOOKS = new Set(
  ('GEN EXO LEV NUM DEU JOS JDG RUT 1SA 2SA 1KI 2KI 1CH 2CH EZR NEH EST JOB PSA PRO ECC SNG ISA JER LAM EZK DAN HOS JOL AMO OBA JON MIC NAM HAB ZEP HAG ZEC MAL ' +
    'MAT MRK LUK JHN ACT ROM 1CO 2CO GAL EPH PHP COL 1TH 2TH 1TI 2TI TIT PHM HEB JAS 1PE 2PE 1JN 2JN 3JN JUD REV').split(' '),
);

export const MAX_PASSAGES = 3;

/** AI가 돌려준 본문 범위를 검사해 쓸 수 있는 것만 남깁니다. 한 범위는 한 장 안에서만 (장이 다르면 범위를 나눠서). */
export function normalizePassages(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const p of list) {
    const book = String(p?.book || '').trim().toUpperCase();
    const chapter = Number(p?.chapter);
    const from = p?.verse_from == null || p?.verse_from === '' ? null : Number(p.verse_from);
    const to = p?.verse_to == null || p?.verse_to === '' ? null : Number(p.verse_to);
    if (!USFM_BOOKS.has(book)) continue;
    if (!Number.isInteger(chapter) || chapter < 1 || chapter > 150) continue;
    if (from !== null && (!Number.isInteger(from) || from < 1 || from > 176)) continue;
    if (to !== null && (!Number.isInteger(to) || to < (from || 1) || to > 176)) continue;
    out.push({ book, chapter, verse_from: from, verse_to: to });
    if (out.length >= MAX_PASSAGES) break;
  }
  return out;
}

/** { book, chapter, verse_from, verse_to } → "1KI.10.1-10" (절이 없으면 장 전체 "1KI.10") */
export function toUsfm(p) {
  if (p.verse_from == null) return `${p.book}.${p.chapter}`;
  if (p.verse_to == null || p.verse_to === p.verse_from) return `${p.book}.${p.chapter}.${p.verse_from}`;
  return `${p.book}.${p.chapter}.${p.verse_from}-${p.verse_to}`;
}
