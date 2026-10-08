// 성경 본문 가져오기 — YouVersion Platform API (https://developers.youversion.com)
//   · 어떤 역본을 쓸 수 있는지는 API 키(앱 키)의 라이선스에 따라 달라, 앱의 관리 화면에서 고릅니다.
//   · 본문에는 항상 역본 이름과 저작권 문구를 함께 보여 줍니다.
import { toUsfm } from './bible-books.mjs';

const BASE = 'https://api.youversion.com';
const MAX_VERSIONS = 3;
const MAX_CHARS_PER_VERSION = 6000;
const PREFERRED_EN = new Set(['NIV', 'ESV', 'NKJV', 'NASB', 'NASB2020', 'NLT', 'KJV', 'CSB', 'NRSV']);

const headers = (appKey) => ({ 'X-YVP-App-Key': appKey, Accept: 'application/json' });

async function getJson(url, appKey, fetchImpl) {
  const res = await fetchImpl(url, { headers: headers(appKey) });
  if (res.status === 401 || res.status === 403) throw new Error('성경 API 키가 올바르지 않거나 이 역본을 쓸 권한이 없습니다');
  if (res.status === 404) throw new Error('성경 구절을 찾을 수 없습니다');
  if (res.status === 429) throw new Error('성경 API 요청이 너무 많습니다');
  if (!res.ok) throw new Error(`성경 API 오류 (${res.status})`);
  return res.json();
}

const rowsOf = (body) => (Array.isArray(body) ? body : body?.data || body?.bibles || body?.items || []);

/** 앱 키로 쓸 수 있는 한국어·영어 역본 목록 → [{ id, abbreviation, title, language }] */
export async function listBibles(appKey, { languages = ['ko', 'en'], fetchImpl = fetch } = {}) {
  const out = [];
  for (const lang of languages) {
    let token = '';
    for (let page = 0; page < 10; page++) {
      const params = new URLSearchParams();
      params.append('language_ranges[]', lang);
      if (token) params.set('page_token', token);
      const body = await getJson(`${BASE}/v1/bibles?${params}`, appKey, fetchImpl);
      for (const b of rowsOf(body)) {
        const abbr = String(b.abbreviation || '').trim();
        if (b.id == null) continue;
        if (lang === 'en' && !PREFERRED_EN.has(abbr.toUpperCase())) continue; // 영어는 많아서 대표 역본만
        out.push({ id: String(b.id), abbreviation: abbr, title: String(b.localized_title || b.title || abbr), language: lang });
      }
      token = body?.next_page_token || '';
      if (!token) break;
    }
  }
  return out;
}

export function cleanVerseText(raw) {
  return String(raw || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function fetchOne(appKey, versionId, usfm, fetchImpl) {
  const body = await getJson(`${BASE}/v1/bibles/${encodeURIComponent(versionId)}/passages/${encodeURIComponent(usfm)}?format=text`, appKey, fetchImpl);
  const c = body?.content;
  const text = cleanVerseText(typeof c === 'string' ? c : c?.text || c?.html || '');
  if (!text) throw new Error('본문이 비어 있습니다');
  return { reference: String(body?.reference || usfm), text };
}

async function fetchCopyright(appKey, versionId, fetchImpl) {
  try {
    const b = await getJson(`${BASE}/v1/bibles/${encodeURIComponent(versionId)}`, appKey, fetchImpl);
    return { abbreviation: String(b.abbreviation || ''), copyright: String(b.copyright || '') };
  } catch {
    return { abbreviation: '', copyright: '' };
  }
}

/** 관리 화면에서 저장한 값(JSON 문자열)을 검사해 [{ id, label }] 로 돌려줍니다 (최대 3개) */
export function parseBibleVersions(raw) {
  let arr;
  try {
    arr = JSON.parse(raw || '[]');
  } catch {
    return [];
  }
  if (!Array.isArray(arr)) return [];
  const out = [];
  const seen = new Set();
  for (const v of arr) {
    const id = String(v?.id ?? '').trim();
    const label = String(v?.label ?? '').trim().slice(0, 30);
    if (!/^\d{1,8}$/.test(id) || !label || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, label });
    if (out.length >= MAX_VERSIONS) break;
  }
  return out;
}

export const bibleSignature = (versions) => versions.map((v) => v.id).join(',');

/**
 * 본문 범위(passages)를 역본별로 가져옵니다.
 * @returns { signature, versions:[{ id, label, abbreviation, copyright, passages:[{reference,text}], truncated }] } | null
 * 한 역본이 실패해도 나머지는 보여 주고, 모두 실패하면 null.
 */
export async function fetchBibleBlock(passages, versions, appKey, { fetchImpl = fetch, log = () => {}, now = () => new Date().toISOString() } = {}) {
  if (!appKey || !versions.length || !passages?.length) return null;
  const out = [];
  for (const v of versions) {
    try {
      const parts = [];
      let total = 0;
      let truncated = false;
      for (const p of passages) {
        const got = await fetchOne(appKey, v.id, toUsfm(p), fetchImpl);
        if (total + got.text.length > MAX_CHARS_PER_VERSION) {
          const room = MAX_CHARS_PER_VERSION - total;
          if (room > 200) parts.push({ reference: got.reference, text: got.text.slice(0, room).replace(/\s+\S*$/, '') + ' …' });
          truncated = true;
          break;
        }
        parts.push(got);
        total += got.text.length;
      }
      if (!parts.length) throw new Error('본문이 비어 있습니다');
      const meta = await fetchCopyright(appKey, v.id, fetchImpl);
      out.push({ id: v.id, label: v.label, abbreviation: meta.abbreviation, copyright: meta.copyright.slice(0, 400), passages: parts, truncated });
    } catch (e) {
      log(`성경 본문 실패 (${v.label}): ${e.message}`);
    }
  }
  if (!out.length) return null;
  return { signature: bibleSignature(versions), fetched_at: now(), versions: out };
}

/** result.bible 을 붙입니다. 실패해도 설교 정리에는 영향 없음. */
export async function attachBible(result, versions, appKey, opts = {}) {
  if (!result.passages?.length) return result;
  const block = await fetchBibleBlock(result.passages, versions, appKey, opts);
  if (block) result.bible = block;
  return result;
}

/** 이미 정리된 설교에 성경 본문을 붙여야 하는지 (아직 없거나, 역본 설정이 바뀐 경우) */
export function needsBible(result, versions) {
  if (!versions.length || !result?.passages?.length) return false;
  return result.bible?.signature !== bibleSignature(versions);
}
