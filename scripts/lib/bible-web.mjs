// 성경 본문을 웹사이트에서 가져옵니다 (API 대신 페이지를 읽어 본문만 뽑는 방식).
//   개역개정 · 표준새번역 → 대한성서공회 (bskorea.or.kr)
//   NIV · 메시지 성경     → BibleGateway (biblegateway.com)
// 사이트의 화면 구조가 바뀌면 읽지 못할 수 있습니다. 읽지 못한 역본은 건너뛰고(앱에서는 그 버튼이 안 보임) 로그에 이유를 남깁니다.
// 상태 점검: node scripts/bible-check.mjs
import * as cheerio from 'cheerio';
import { MAX_PASSAGES, toUsfm } from './bible-books.mjs';
import { BOOK_ORDER } from './title.mjs';

// 화면 버튼 순서 = 이 배열 순서
export const BIBLE_SOURCES = [
  { id: 'GAE', label: '개역개정', lang: 'ko', site: 'bskorea', code: 'GAE', copyright: '개역개정 ⓒ 대한성서공회', source: '대한성서공회 (bskorea.or.kr)' },
  { id: 'NIV', label: 'NIV', lang: 'en', site: 'biblegateway', code: 'NIV', copyright: 'Holy Bible, New International Version®, NIV® Copyright ©1973, 1978, 1984, 2011 by Biblica, Inc.®', source: 'BibleGateway (biblegateway.com)' },
  { id: 'SAE', label: '표준새번역', lang: 'ko', site: 'bskorea', code: 'SAE', copyright: '표준새번역 ⓒ 대한성서공회', source: '대한성서공회 (bskorea.or.kr)' },
  { id: 'MSG', label: '메시지 성경', lang: 'en', site: 'biblegateway', code: 'MSG', copyright: 'THE MESSAGE, Copyright © 1993, 2002, 2018 by Eugene H. Peterson', source: 'BibleGateway (biblegateway.com)' },
];
export const DEFAULT_BIBLE_ID = 'GAE';

export const MAX_VERSES_PER_VERSION = 120; // 한 역본에 담을 최대 절 수 (너무 길어지는 것을 막음)

const EN_NAMES = {
  GEN: 'Genesis', EXO: 'Exodus', LEV: 'Leviticus', NUM: 'Numbers', DEU: 'Deuteronomy', JOS: 'Joshua', JDG: 'Judges', RUT: 'Ruth', '1SA': '1 Samuel', '2SA': '2 Samuel',
  '1KI': '1 Kings', '2KI': '2 Kings', '1CH': '1 Chronicles', '2CH': '2 Chronicles', EZR: 'Ezra', NEH: 'Nehemiah', EST: 'Esther', JOB: 'Job', PSA: 'Psalm', PRO: 'Proverbs',
  ECC: 'Ecclesiastes', SNG: 'Song of Solomon', ISA: 'Isaiah', JER: 'Jeremiah', LAM: 'Lamentations', EZK: 'Ezekiel', DAN: 'Daniel', HOS: 'Hosea', JOL: 'Joel', AMO: 'Amos',
  OBA: 'Obadiah', JON: 'Jonah', MIC: 'Micah', NAM: 'Nahum', HAB: 'Habakkuk', ZEP: 'Zephaniah', HAG: 'Haggai', ZEC: 'Zechariah', MAL: 'Malachi',
  MAT: 'Matthew', MRK: 'Mark', LUK: 'Luke', JHN: 'John', ACT: 'Acts', ROM: 'Romans', '1CO': '1 Corinthians', '2CO': '2 Corinthians', GAL: 'Galatians', EPH: 'Ephesians',
  PHP: 'Philippians', COL: 'Colossians', '1TH': '1 Thessalonians', '2TH': '2 Thessalonians', '1TI': '1 Timothy', '2TI': '2 Timothy', TIT: 'Titus', PHM: 'Philemon', HEB: 'Hebrews',
  JAS: 'James', '1PE': '1 Peter', '2PE': '2 Peter', '1JN': '1 John', '2JN': '2 John', '3JN': '3 John', JUD: 'Jude', REV: 'Revelation',
};
const KO_NAMES = Object.fromEntries(BOOK_ORDER.map((b) => [b.usfm, b.name]));

/** "열왕기상 4:1-34" / "시편 23편" 같은 한글 표기 */
export function koReference(p) {
  const name = KO_NAMES[p.book] || p.book;
  const unit = p.book === 'PSA' ? '편' : '장';
  if (p.verse_from == null) return `${name} ${p.chapter}${unit}`;
  if (p.verse_to == null || p.verse_to === p.verse_from) return `${name} ${p.chapter}:${p.verse_from}`;
  return `${name} ${p.chapter}:${p.verse_from}-${p.verse_to}`;
}

const cleanSpace = (s) => String(s || '').replace(/[  ​]/g, ' ').replace(/[ \t\r\f\v]+/g, ' ').replace(/ *\n */g, '\n');

/* ---------- 대한성서공회: 장 전체를 줄 단위로 읽기 ---------- */
// 줄 머리의 숫자 = 절 번호, "1)" 처럼 괄호가 붙은 줄 = 각주, 번호 없는 줄 = 소제목 등 (버림)
export function parseNumberedLines(lines) {
  const clean = lines.map((l) => cleanSpace(l).trim());
  let best = [];
  for (let start = 0; start < clean.length; start++) {
    if (!/^1(\s|$|[^\d)])/.test(clean[start])) continue;
    const run = [];
    let expected = 1;
    for (let i = start; i < clean.length; i++) {
      const line = clean[i];
      if (!line || /^\d{1,3}\)/.test(line)) continue; // 빈 줄·각주
      const m = /^(\d{1,3})\s*(.*)$/.exec(line);
      if (!m || Number(m[1]) !== expected) continue;
      let text = m[2];
      if (!text) {
        // 번호만 있는 줄이면 다음 줄이 본문
        let j = i + 1;
        while (j < clean.length && !clean[j]) j++;
        text = clean[j] || '';
        i = j;
      }
      text = text.replace(/\s*\d{1,2}\)(?=\s|$)/g, '').trim(); // 본문 중간의 각주 표시 "5)" 제거
      if (!text) continue;
      run.push({ n: String(expected), text });
      expected++;
    }
    if (run.length > best.length) best = run;
  }
  return best;
}

// 줄 단위로 읽히지 않을 때의 대비책: 한 덩어리 글에서 "1 … 2 … 3 …" 순서로 번호를 찾아 나눕니다
export function parseNumberedFlow(text) {
  const flat = cleanSpace(text).replace(/\s+/g, ' ');
  const verses = [];
  let pos = 0;
  let expected = 1;
  let prevStart = -1;
  for (;;) {
    const re = new RegExp(`(?:^|\\s)${expected}(?=\\s*[^\\d\\s)])`, 'g');
    re.lastIndex = pos;
    const m = re.exec(flat);
    if (!m) break;
    const start = m.index + m[0].length;
    if (prevStart >= 0) verses[verses.length - 1].text = flat.slice(prevStart, m.index).trim();
    verses.push({ n: String(expected), text: '' });
    prevStart = start;
    pos = start;
    expected++;
  }
  if (prevStart >= 0) verses[verses.length - 1].text = flat.slice(prevStart).trim();
  return verses.filter((v) => v.text).map((v) => ({ ...v, text: v.text.replace(/\s*\d{1,2}\)(?=\s|$)/g, '').trim() }));
}

const BLOCK_TAGS = 'p, div, li, tr, td, th, br, h1, h2, h3, h4, h5, h6, dt, dd, section, article, table';

function textLines($, root) {
  root.find('script, style, noscript, iframe, select, option, button, nav').remove();
  root.find(BLOCK_TAGS).each((_, el) => {
    $(el).append('\n').prepend('\n');
  });
  return root.text().split('\n');
}

export function parseBskorea(html) {
  const $ = cheerio.load(html);
  const lines = textLines($, $('body'));
  let verses = parseNumberedLines(lines);
  if (verses.length < 2) verses = parseNumberedFlow(lines.join(' '));
  return verses;
}

/* ---------- BibleGateway: 절 번호 표시를 기준으로 읽기 ---------- */
export function parseBibleGateway(html) {
  const $ = cheerio.load(html);
  let root = $('.passage-text').first();
  if (!root.length) root = $('.passage-content').first();
  if (!root.length) root = $('.result-text-style-normal').first();
  if (!root.length) throw new Error('본문 영역을 찾지 못했습니다');
  root.find('.footnotes, .crossrefs, .passage-display-version, .publisher-info-bottom, script, style').remove();
  root.find('sup.footnote, sup.crossreference, sup.fn, .footnote, .crossreference').remove();
  root.find('h1, h2, h3, h4, h5').remove(); // 소제목
  root.find('.small-caps').each((_, el) => {
    $(el).text($(el).text().toUpperCase()); // 하나님의 이름 LORD
  });
  root.find('sup.versenum').each((_, el) => {
    $(el).replaceWith(` ⟦V${$(el).text().trim()}⟧ `);
  });
  root.find('.chapternum').each((_, el) => {
    $(el).replaceWith(' ⟦C⟧ ');
  });
  root.find('br').replaceWith(' ');
  const flat = cleanSpace(root.text()).replace(/\s+/g, ' ');
  const parts = flat.split(/⟦(C|V[^⟧]*)⟧/);
  // parts: [앞글, 표지, 글, 표지, 글 …]
  const verses = [];
  for (let i = 1; i < parts.length; i += 2) {
    const mark = parts[i];
    let text = (parts[i + 1] || '').trim();
    if (mark === 'C') {
      if (!text && /^V/.test(parts[i + 2] || '')) continue; // 장 번호 바로 뒤에 절 번호가 오면 장 번호는 건너뜀
      verses.push({ n: '1', text });
    } else {
      verses.push({ n: mark.slice(1).replace(/[–—]/g, '-').trim(), text });
    }
  }
  // 첫 절 앞에 "1-3" 같은 번호가 본문 글자로 붙어 오는 경우 정리
  if (verses[0]) {
    const m = /^(\d{1,3}\s*[-–]\s*\d{1,3})\s+(.*)$/.exec(verses[0].text);
    if (m) verses[0] = { n: m[1].replace(/\s/g, '').replace('–', '-'), text: m[2] };
  }
  return verses.filter((v) => v.text);
}

/* ---------- 가져오기 ---------- */
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

async function getHtml(url, { fetchImpl = fetch, timeoutMs = 25_000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { headers: { 'user-agent': UA, 'accept-language': 'ko,en;q=0.8' }, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

export function bskoreaUrl(code, usfm, chapter) {
  return `https://www.bskorea.or.kr/bible/korbibReadpage.php?version=${encodeURIComponent(code)}&book=${usfm.toLowerCase()}&chap=${chapter}&sec=1`;
}
export function bibleGatewayUrl(code, p) {
  const name = EN_NAMES[p.book] || p.book;
  const ref = p.verse_from == null ? `${name} ${p.chapter}` : `${name} ${p.chapter}:${p.verse_from}${p.verse_to && p.verse_to !== p.verse_from ? `-${p.verse_to}` : ''}`;
  return `https://www.biblegateway.com/passage/?search=${encodeURIComponent(ref)}&version=${encodeURIComponent(code)}`;
}

// 범위 안의 절만 남깁니다 (숫자 번호 기준. "1-3" 같은 묶음은 걸치면 포함)
function inRange(v, from, to) {
  if (from == null) return true;
  const [a, b = a] = String(v.n).split('-').map(Number);
  const hi = to == null ? from : to;
  return b >= from && a <= hi;
}

/** 한 역본의 한 범위 → { reference, verses:[{n,text}] } (실패하면 Error) */
export async function fetchPassage(source, p, { fetchImpl = fetch, cache = new Map() } = {}) {
  let verses;
  if (source.site === 'bskorea') {
    const url = bskoreaUrl(source.code, p.book, p.chapter);
    if (!cache.has(url)) cache.set(url, parseBskorea(await getHtml(url, { fetchImpl })));
    verses = cache.get(url);
    if (!verses.length) throw new Error('절을 읽지 못했습니다');
    const to = p.verse_from == null ? null : p.verse_to ?? p.verse_from;
    verses = verses.filter((v) => inRange(v, p.verse_from, to));
  } else {
    const url = bibleGatewayUrl(source.code, p);
    if (!cache.has(url)) cache.set(url, parseBibleGateway(await getHtml(url, { fetchImpl })));
    verses = cache.get(url);
  }
  if (!verses.length) throw new Error('요청한 절을 찾지 못했습니다');
  return { reference: koReference(p), verses };
}

export const bibleSignature = (passages) => passages.map(toUsfm).join('|');

/**
 * 모든 역본의 본문을 모아 하나의 블록으로 만듭니다.
 * @returns { signature, fetched_at, versions:[{ id, label, lang, copyright, source, passages:[{reference, verses}], truncated }] } 또는 null(전부 실패)
 */
export async function fetchBibleBlock(passages, { sources = BIBLE_SOURCES, fetchImpl = fetch, log = () => {}, sleepImpl = (ms) => new Promise((r) => setTimeout(r, ms)), delayMs = 800, now = () => new Date().toISOString() } = {}) {
  const list = (passages || []).slice(0, MAX_PASSAGES);
  if (!list.length) return null;
  const cache = new Map();
  const versions = [];
  for (const src of sources) {
    try {
      const parts = [];
      let total = 0;
      let truncated = false;
      for (const p of list) {
        const got = await fetchPassage(src, p, { fetchImpl, cache });
        await sleepImpl(delayMs);
        const room = MAX_VERSES_PER_VERSION - total;
        if (room <= 0) {
          truncated = true;
          break;
        }
        if (got.verses.length > room) {
          got.verses = got.verses.slice(0, room);
          truncated = true;
        }
        total += got.verses.length;
        parts.push(got);
      }
      if (!parts.length) throw new Error('본문이 비어 있습니다');
      versions.push({ id: src.id, label: src.label, lang: src.lang, copyright: src.copyright, source: src.source, passages: parts, truncated });
    } catch (e) {
      log(`성경 본문 실패 (${src.label}): ${e.message}`);
    }
  }
  if (!versions.length) return null;
  return { signature: bibleSignature(list), fetched_at: now(), versions };
}

/** 이미 받은 본문이 지금 본문 범위와 같은 것인지 (같으면 다시 받지 않음) */
export const bibleIsCurrent = (block, passages) => !!block?.versions?.length && block.signature === bibleSignature((passages || []).slice(0, MAX_PASSAGES));
