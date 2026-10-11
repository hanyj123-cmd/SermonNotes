#!/usr/bin/env node
// 메인 파이프라인
//   1) Google Sheets의 Playlists 탭에서 재생목록 읽기
//   2) YouTube에서 새 영상 찾아 Sermons 탭에 추가 (status = pending)
//   3) pending / redo 영상의 자막을 가져와 Gemini로 4가지 모드(설교리뷰·QT 묵상·성경공부·소그룹 나눔)로 정리 → Sermons 탭에 저장
//   4) 성경 본문 4역본(웹사이트에서 읽음) 붙이기
//   5) 결과를 docs/data/ 로 내보내기: sermons.json(목록) + s/<영상ID>.json(설교별 상세)
//
// 사용법:
//   node scripts/sync.mjs                 전체 실행
//   node scripts/sync.mjs --export-only   시트 내용만 내보내기 (API 키 불필요)
// 환경변수 ONLY_CATEGORIES=sunday,wednesday  : 이번 실행에서 확인할 구분 (기본: sunday. 새벽기도·수요예배·청년부는 직접 적어야 함, all = 전부)
// 오늘의 말씀: 매 실행마다 내일·오늘(토론토 기준) 분량 중 빠진 것을 교회 앱에서 가져와 AI 정리(QT·성경공부·소그룹·퀴즈)를 만듭니다. DAILY_DATES=2026-10-08,2026-10-09 로 날짜를 직접 지정할 수도 있고, DAILY_FORCE=true 면 이미 만든 날도 다시 만듭니다.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createSheetsClient,
  ensureTab,
  readPlaylists,
  readSermons,
  appendSermons,
  updateSermonRow,
  readSettings,
  SETTINGS_TAB,
  SETTINGS_HEADERS,
  PLAYLISTS_TAB,
  PLAYLIST_HEADERS,
  SERMONS_TAB,
  SERMON_HEADERS,
  CATEGORY_KEYS,
  DAILY_TAB,
  DAILY_HEADERS,
  readDaily,
  writeDailyRow,
  readTabRows,
  writeTabRow,
} from './lib/sheets.mjs';
import { PROVERBS_TAB, PROVERBS_HEADERS, PROVERB_COLUMNS, PROVERB_CHAPTERS, buildProverbChapter, proverbExport, proverbChaptersToBuild } from './lib/proverbs.mjs';
import { buildDailyDay, dailyExport, findReadingVideos, torontoDate, isDailyDate, fetchDailyReading, readingRefs } from './lib/daily.mjs';
import { findDawnUpdates, dawnPlaylistId } from './lib/dawn.mjs';
import { ensureReadingIndex } from './lib/reading-index.mjs';
import { extractPlaylistId, fetchPlaylistVideos, fetchVideoStates, fetchPublishDates } from './lib/youtube.mjs';
import { buildQueue } from './lib/queue.mjs';
import { attachBibleAudio, buildPrayerMusic, musicIsStale } from './lib/media.mjs';
import { fetchBibleBlock, bibleIsCurrent } from './lib/bible-web.mjs';
import { processRow, CELL_LIMIT } from './lib/process.mjs';
import { MODES, MODE_LABELS } from './lib/prompt.mjs';
import { createGemini, DEFAULT_MODEL } from './lib/gemini.mjs';
import { parseTitle, parseAnyTitle, parseScripture, bookOf, tidyTitle, normalizePreacher, displayTitle } from './lib/title.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '../docs/data');
const OUTPUT_PATH = path.join(DATA_DIR, 'sermons.json');
const DETAIL_DIR = path.join(DATA_DIR, 's');
const MUSIC_PATH = path.join(DATA_DIR, 'music.json');

const args = new Set(process.argv.slice(2));
const exportOnly = args.has('--export-only');

function need(name) {
  const v = process.env[name];
  if (!v) throw new Error(`환경변수 ${name} 이(가) 필요합니다. (.env.example 참고)`);
  return v;
}

const now = () => new Date().toISOString();

/** ONLY_CATEGORIES → 이번 실행의 대상 구분 목록 */
export function parseCategories(raw) {
  const v = String(raw || '').trim().toLowerCase();
  if (!v) return ['sunday']; // 새벽기도·수요예배·청년부는 자동으로 정리하지 않습니다 (필요할 때 직접 지정)
  const tokens = v.split(/[\s,]+/).filter(Boolean);
  if (tokens.includes('all')) return [...CATEGORY_KEYS];
  const list = tokens.filter((c) => CATEGORY_KEYS.includes(c));
  if (list.length) return list;
  // "user"(사용자 영상만) · "none" · "daily"(오늘의 말씀만) 은 재생목록을 확인하지 않고 사용자 영상·다시 정리 표시한 것만 처리합니다
  return tokens.some((t) => t === 'user' || t === 'none' || t === 'daily' || t === 'proverbs' || t === 'dawn_video') ? [] : ['sunday'];
}

const parseJson = (s) => {
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
};

/** 시트의 한 행 → 앱이 읽는 목록 항목 + 상세. 새 형식(schema 3)의 설교리뷰가 없으면 null */
export function toExport(s) {
  const result = parseJson(s.result_json);
  if (!result || result.schema !== 3 || !result.review?.outline?.length) return null;
  const p = parseAnyTitle(s.category, s.title); // 사용자 영상은 자유로운 제목 형식도 읽습니다
  const dateFixed = /^\d{4}-\d{2}-\d{2}$/.test(String(s.date_override || '').trim()) ? String(s.date_override).trim() : '';
  const date = dateFixed || p.date || String(s.published_at || '').slice(0, 10);
  const scriptureFixed = String(s.scripture_override || '').trim();
  const scripture = scriptureFixed || String(s.scripture || '').trim() || p.scripture || (result.scripture || []).join(', ');
  // 앱에서 직접 고친 값(title_override · preacher_override)이 있으면 그것이 가장 우선입니다
  const preacher = normalizePreacher(String(s.preacher_override || '').trim() || String(s.preacher || '').trim() || p.preacher || result.preacher || '');
  const first = bookOf(scripture);
  const qt = parseJson(s.mode_qt);
  const study = parseJson(s.mode_study);
  const group = parseJson(s.mode_group);
  let bible = parseJson(s.bible_json);
  // 본문을 직접 고쳤는데 성경 본문(4역본)이 아직 새 본문 것이 아니면, 틀린 본문이 보이지 않도록 뺍니다 (동기화 때 새로 가져옵니다)
  if (scriptureFixed && bible) {
    const want = parseScripture(scriptureFixed);
    if (!want.length || !bibleIsCurrent(bible, want)) bible = null;
  }
  const modes = ['review', ...(qt ? ['qt'] : []), ...(study ? ['study'] : []), ...(group ? ['group'] : [])];
  const titleFixed = String(s.title_override || '').trim();
  const title = displayTitle({ category: s.category, title: titleFixed || p.title, aiTitle: tidyTitle(result.title), scripture }) || p.title || s.title; // "주일예배 - 설교제목" (제목이 없으면 성경 본문)
  const index = {
    id: s.video_id,
    category: s.category,
    title,
    date,
    url: s.url,
    preacher,
    scripture,
    book: first?.name || '',
    bookIdx: first?.idx || 0,
    summary_short: result.summary_short || result.theme || '',
    modes,
    complete: s.status === 'done',
  };
  const detail = { ...index, theme: result.theme || '', result, qt, study, group, bible };
  return { index, detail };
}

export async function exportJson(sermons, { dataDir = DATA_DIR, quiet = false } = {}) {
  const items = [];
  let legacy = 0;
  for (const s of sermons) {
    if (s.status !== 'done' && s.status !== 'error') continue;
    const e = toExport(s);
    if (!e) {
      if (s.status === 'done' && s.result_json) legacy++;
      continue;
    }
    items.push(e);
  }
  // 날짜 최신순 (날짜가 없거나 형식이 이상한 것은 맨 뒤), 같은 날은 제목 가나다순
  const dateKey = (x) => {
    const m = String(x.index.date || '').match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
    return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : '';
  };
  items.sort((a, b) => dateKey(b).localeCompare(dateKey(a)) || String(a.index.title || '').localeCompare(String(b.index.title || ''), 'ko'));

  const detailDir = path.join(dataDir, 's');
  await fs.mkdir(detailDir, { recursive: true });
  const keep = new Set();
  for (const { index, detail } of items) {
    keep.add(`${index.id}.json`);
    await fs.writeFile(path.join(detailDir, `${index.id}.json`), JSON.stringify(detail) + '\n', 'utf8');
  }
  for (const f of await fs.readdir(detailDir)) if (f.endsWith('.json') && !keep.has(f)) await fs.unlink(path.join(detailDir, f));

  const payload = { updated: now(), count: items.length, sermons: items.map((i) => i.index) };
  await fs.writeFile(path.join(dataDir, 'sermons.json'), JSON.stringify(payload, null, 1) + '\n', 'utf8');
  if (!quiet) {
    console.log(`📦 docs/data/sermons.json + s/ 상세 ${items.length}편 저장`);
    if (legacy) console.warn(`⚠️  예전 형식으로 정리된 설교 ${legacy}편은 화면에 나오지 않습니다. 앱의 영상 관리에서 선택해 "다시 정리"하면 새 형식(4가지 모드)으로 바뀝니다.`);
  }
  return { count: items.length, legacy };
}

/* ---------- 오늘의 말씀 ---------- */
const DAILY_DIR = path.join(DATA_DIR, 'daily');

/** Daily 탭 → docs/data/daily/<날짜>.json + index.json */
export async function exportDaily(rows, { dataDir = DATA_DIR, quiet = false } = {}) {
  const dir = path.join(dataDir, 'daily');
  await fs.mkdir(dir, { recursive: true });
  const index = [];
  for (const row of rows) {
    if (!row.refs && !row.dawn_json) continue; // 본문이 아직 없어도 새벽기도 영상만 있으면 내보냅니다
    const d = dailyExport(row);
    await fs.writeFile(path.join(dir, `${row.date}.json`), JSON.stringify(d) + '\n', 'utf8');
    index.push({ date: d.date, refs: d.refs, complete: d.complete });
  }
  index.sort((a, b) => b.date.localeCompare(a.date));
  await fs.writeFile(path.join(dir, 'index.json'), JSON.stringify({ updated: now(), days: index }, null, 1) + '\n', 'utf8');
  if (!quiet) console.log(`📖 오늘의 말씀 ${index.length}일치를 docs/data/daily/ 에 내보냈습니다.`);
  return index.length;
}

/** 내일·오늘(또는 DAILY_DATES) 분량을 만들고 Daily 탭에 저장합니다. 실패해도 설교 동기화는 계속합니다. */
// 관리 화면 "다시 만들기"에서 고를 수 있는 부분 → 비울 열
const DAILY_MODE_COLUMNS = { qt: ['qt_json'], study: ['study_json', 'commentary_json'], group: ['group_json'], quiz: ['quiz_json'], videos: ['videos_json'] };
async function syncDaily(sheets, spreadsheetId, ai, youtubeKey) {
  await ensureTab(sheets, spreadsheetId, DAILY_TAB, DAILY_HEADERS);
  const rows = await readDaily(sheets, spreadsheetId);
  const byDate = new Map(rows.map((r) => [r.date, r]));
  const wanted = String(process.env.DAILY_DATES || '').split(/[\s,]+/).filter(isDailyDate);
  // 기본: 다음 날 분량을 하루 전에 만들고, 혹시 오늘 것이 빠졌으면 같이 채웁니다
  const dates = wanted.length ? wanted.slice(0, 14) : [torontoDate(1), torontoDate(0)];
  const force = String(process.env.DAILY_FORCE || '').toLowerCase() === 'true';
  const forceModes = String(process.env.DAILY_MODES || '').split(/[\s,]+/).filter((m) => DAILY_MODE_COLUMNS[m]);
  const index = youtubeKey ? await ensureReadingIndex(youtubeKey, { log: (m) => console.log(m) }) : null;
  for (const date of dates) {
    const found = byDate.get(date);
    const hasVideos = found && found.videos_json && found.videos_json !== '[]';
    if (!force && found && found.status === 'done' && (hasVideos || !youtubeKey)) continue;
    // 다시 만들기: DAILY_MODES 가 있으면 그 부분만, 없으면 본문만 남기고 전부 새로 (시트의 같은 줄에 덮어씁니다)
    let prev = found;
    if (force && found) {
      if (forceModes.length) {
        prev = { ...found };
        for (const m of forceModes) for (const col of DAILY_MODE_COLUMNS[m] || []) prev[col] = '';
      } else prev = { rowNumber: found.rowNumber, passages_json: found.passages_json };
    }
    console.log(`\n📖 오늘의 말씀 ${date}`);
    // 관리 화면에서 "만드는 중"으로 보이게 먼저 표시합니다 (끝나면 결과로 덮어씁니다)
    let rowNumber = found ? found.rowNumber : 0;
    try {
      rowNumber = await writeDailyRow(sheets, spreadsheetId, rowNumber, { ...(found || { date }), date, status: 'running', updated_at: now(), note: force ? '다시 만드는 중' : '만드는 중' });
    } catch (e) {
      console.warn(`   (진행 표시를 남기지 못했습니다: ${e.message})`);
    }
    try {
      const row = await buildDailyDay(date, prev, {
        ai,
        findVideos: youtubeKey || index ? (passages) => findReadingVideos(passages, youtubeKey, { index, log: (m) => console.warn(`   ${m}`) }) : null,
        log: (m) => console.log(m),
      });
      if (!row) {
        console.log(`   교회 앱에 ${date} 본문이 아직 없습니다.`);
        if (rowNumber) await writeDailyRow(sheets, spreadsheetId, rowNumber, { ...(found || { date }), date, status: found ? found.status : 'error', updated_at: now(), note: '교회 앱에 이 날 본문이 아직 없습니다' });
        continue;
      }
      await writeDailyRow(sheets, spreadsheetId, rowNumber, row);
      console.log(`   ✅ ${row.refs} (${row.status === 'done' ? '완료' : `일부 실패: ${row.note}`})`);
    } catch (e) {
      console.error(`   ❌ ${date} 오늘의 말씀을 만들지 못했습니다: ${e.message || e}`);
      if (rowNumber) await writeDailyRow(sheets, spreadsheetId, rowNumber, { ...(found || { date }), date, status: 'error', updated_at: now(), note: String(e.message || e).slice(0, 300) }).catch(() => {});
    }
  }
}

/** 새벽기도 영상을 날짜별로 연결합니다 (Daily 탭 dawn_json). 관리자가 직접 넣은 영상은 그대로 둡니다. */
async function syncDawn(sheets, spreadsheetId, youtubeKey, settings, { force = false } = {}) {
  await ensureTab(sheets, spreadsheetId, DAILY_TAB, DAILY_HEADERS);
  const rows = await readDaily(sheets, spreadsheetId);
  const byDate = new Map(rows.map((r) => [r.date, r]));
  const updates = await findDawnUpdates({ rows, playlistId: dawnPlaylistId(settings.dawn_playlist), apiKey: youtubeKey, force, log: (m) => console.log(m) });
  for (const u of updates) {
    const found = byDate.get(u.date);
    const dawn_json = JSON.stringify(u.dawn);
    if (found) {
      await writeDailyRow(sheets, spreadsheetId, found.rowNumber, { ...found, dawn_json });
      continue;
    }
    // 아직 그 날 줄이 없으면 본문(분량)만 먼저 넣어 둡니다 — AI 정리는 다음 오늘의 말씀 동기화가 채웁니다
    let refs = '';
    let passages_json = '';
    try {
      const passages = await fetchDailyReading(u.date, 'KNKRV');
      if (passages.length) {
        refs = readingRefs(passages);
        passages_json = JSON.stringify(passages);
      }
    } catch (e) {
      console.warn(`   ${u.date} 본문을 가져오지 못했습니다: ${e.message}`);
    }
    await writeDailyRow(sheets, spreadsheetId, 0, { date: u.date, refs, passages_json, status: '', updated_at: now(), note: '새벽기도 영상만 먼저 연결', dawn_json });
  }
  return updates.length;
}

/* ---------- 잠언 묵상 ---------- */
/** Proverbs 탭 → docs/data/proverbs/<장>.json + index.json */
export async function exportProverbs(rows, { dataDir = DATA_DIR, quiet = false } = {}) {
  const dir = path.join(dataDir, 'proverbs');
  await fs.mkdir(dir, { recursive: true });
  const index = [];
  for (const row of rows) {
    const ch = Number(row.chapter);
    if (!(ch >= 1 && ch <= PROVERB_CHAPTERS)) continue;
    const d = proverbExport(row);
    await fs.writeFile(path.join(dir, `${ch}.json`), JSON.stringify(d) + '\n', 'utf8');
    index.push({ chapter: ch, complete: d.complete, theme: d.word?.theme || '' });
  }
  index.sort((a, b) => a.chapter - b.chapter);
  await fs.writeFile(path.join(dir, 'index.json'), JSON.stringify({ updated: now(), chapters: index }, null, 1) + '\n', 'utf8');
  if (!quiet) console.log(`📜 잠언 묵상 ${index.length}장을 docs/data/proverbs/ 에 내보냈습니다.`);
  return index.length;
}

/** 잠언 장 만들기: 자동은 1장부터 빠진 장 3개씩, PROVERBS=3,7|missing 로 직접 지정. DAILY_FORCE · DAILY_MODES 로 다시 만들기 */
async function syncProverbs(sheets, spreadsheetId, ai, { want = process.env.PROVERBS || '', force = false, forceModes = [] } = {}) {
  await ensureTab(sheets, spreadsheetId, PROVERBS_TAB, PROVERBS_HEADERS);
  const rows = (await readTabRows(sheets, spreadsheetId, PROVERBS_TAB, PROVERBS_HEADERS)).filter((r) => Number(r.chapter) >= 1);
  const byCh = new Map(rows.map((r) => [Number(r.chapter), r]));
  const chapters = proverbChaptersToBuild(rows, { want, force });
  for (const ch of chapters) {
    const found = byCh.get(ch);
    let prev = found;
    if (force && found) {
      if (forceModes.length) {
        prev = { ...found };
        for (const m of forceModes) for (const col of PROVERB_COLUMNS[m] || []) prev[col] = '';
      } else prev = { rowNumber: found.rowNumber, chapter: found.chapter, bible_json: found.bible_json };
    }
    console.log(`\n📜 잠언 ${ch}장`);
    try {
      const row = await buildProverbChapter(ch, prev, { ai, log: (m) => console.log(m) });
      await writeTabRow(sheets, spreadsheetId, PROVERBS_TAB, PROVERBS_HEADERS, found ? found.rowNumber : 0, row);
      console.log(`   ✅ 잠언 ${ch}장 (${row.status === 'done' ? '완료' : `일부 실패: ${row.note}`})`);
    } catch (e) {
      console.error(`   ❌ 잠언 ${ch}장을 만들지 못했습니다: ${e.message || e}`);
    }
  }
}

/** 이미 정리된 설교 중 성경 본문이 없거나 본문 범위가 바뀐 것에 4역본을 붙입니다 */
async function backfillBible(sheets, spreadsheetId, sermons, youtubeKey, limit = 12, mediaState = {}) {
  let n = 0;
  for (const row of sermons) {
    if (n >= limit) break;
    if (row.status !== 'done' || !row.result_json) continue;
    const info = parseTitle(row.title);
    const scripture = String(row.scripture_override || '').trim() || String(row.scripture || '').trim() || info.scripture;
    const passages = scripture ? parseScripture(scripture) : [];
    if (!passages.length) continue;
    const current = parseJson(row.bible_json);
    const logWarn = (m) => console.warn(`   ${m}`);
    if (bibleIsCurrent(current, passages)) {
      if (current.audio_checked || !youtubeKey) continue;
      n++; // 본문은 이미 있고 개역개정 낭독 영상만 아직 안 찾은 경우
      await attachBibleAudio(current, passages, youtubeKey, { state: mediaState, log: logWarn });
      if (!current.audio_checked) continue;
      const j = JSON.stringify(current);
      if (j.length <= CELL_LIMIT) await updateSermonRow(sheets, spreadsheetId, row.rowNumber, { bible_json: j, updated_at: now() });
      continue;
    }
    n++;
    const block = await fetchBibleBlock(passages, { log: logWarn });
    if (!block) continue;
    await attachBibleAudio(block, passages, youtubeKey, { state: mediaState, log: logWarn });
    const json = JSON.stringify(block);
    if (json.length > CELL_LIMIT) continue;
    await updateSermonRow(sheets, spreadsheetId, row.rowNumber, { bible_json: json, updated_at: now() });
    console.log(`📖 성경 본문 추가: ${row.title} (${block.versions.map((v) => v.label).join(' · ')})`);
  }
}

async function readJsonFile(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

async function refreshMusic(youtubeKey) {
  const current = await readJsonFile(MUSIC_PATH);
  if (!musicIsStale(current)) return;
  try {
    const music = await buildPrayerMusic(youtubeKey, { log: (m) => console.warn(m) });
    await fs.mkdir(path.dirname(MUSIC_PATH), { recursive: true });
    await fs.writeFile(MUSIC_PATH, JSON.stringify(music, null, 1) + '\n', 'utf8');
    console.log(`🎵 기도 배경음악 ${music.tracks.length}곡 목록을 갱신했습니다.`);
  } catch (e) {
    console.warn(`⚠️  기도 배경음악 목록을 만들지 못했습니다: ${e.message}`);
  }
}

async function main() {
  const spreadsheetId = need('SHEET_ID');
  const sheets = createSheetsClient(need('GOOGLE_SERVICE_ACCOUNT_JSON'));

  await ensureTab(sheets, spreadsheetId, PLAYLISTS_TAB, PLAYLIST_HEADERS);
  await ensureTab(sheets, spreadsheetId, SERMONS_TAB, SERMON_HEADERS);
  await ensureTab(sheets, spreadsheetId, SETTINGS_TAB, SETTINGS_HEADERS);

  let sermons = await readSermons(sheets, spreadsheetId);

  if (exportOnly) {
    // 본문을 고친 설교의 성경 본문만 새로 가져옵니다 (새로 정리하지는 않습니다)
    try {
      await backfillBible(sheets, spreadsheetId, sermons, process.env.YOUTUBE_API_KEY || '', 12, {});
      sermons = await readSermons(sheets, spreadsheetId);
    } catch (e) {
      console.warn(`⚠️  성경 본문 갱신을 건너뜁니다: ${e.message || e}`);
    }
    await exportJson(sermons);
    try {
      await ensureTab(sheets, spreadsheetId, DAILY_TAB, DAILY_HEADERS);
      await exportDaily(await readDaily(sheets, spreadsheetId));
    } catch (e) {
      console.warn(`⚠️  오늘의 말씀 내보내기를 건너뜁니다: ${e.message || e}`);
    }
    try {
      await ensureTab(sheets, spreadsheetId, PROVERBS_TAB, PROVERBS_HEADERS);
      await exportProverbs(await readTabRows(sheets, spreadsheetId, PROVERBS_TAB, PROVERBS_HEADERS));
    } catch (e) {
      console.warn(`⚠️  잠언 묵상 내보내기를 건너뜁니다: ${e.message || e}`);
    }
    return;
  }

  const youtubeKey = need('YOUTUBE_API_KEY');
  const categories = parseCategories(process.env.ONLY_CATEGORIES);
  console.log(`🗂  이번 실행의 구분: ${categories.join(', ') || '(재생목록 확인 없음)'} (+ 사용자 영상·다시 정리 표시한 것)`);
  // 앱의 관리 화면에서 고른 설정(Settings 탭)이 있으면 그것을, 없으면 환경변수·기본값을 씁니다.
  const settings = await readSettings(sheets, spreadsheetId);
  // 새벽기도 영상만 연결하는 짧은 실행 (07:20 · 08:00 예약, 관리 화면 "수동 업데이트 실행")
  const onlyTokens = String(process.env.ONLY_CATEGORIES || '').toLowerCase().split(/[\s,]+/).filter(Boolean);
  if (onlyTokens.length && onlyTokens.every((t) => t === 'dawn_video')) {
    await syncDawn(sheets, spreadsheetId, youtubeKey, settings, { force: String(process.env.DAILY_FORCE || '').toLowerCase() === 'true' });
    await exportDaily(await readDaily(sheets, spreadsheetId));
    return;
  }
  const modelName = /^[\w.-]{3,60}$/.test(settings.gemini_model || '') ? settings.gemini_model : process.env.GEMINI_MODEL || DEFAULT_MODEL;
  console.log(`🤖 Gemini 모델: ${modelName}`);
  const ai = createGemini(need('GEMINI_API_KEY'), modelName);
  const maxPerRun = Math.max(1, parseInt(process.env.MAX_NEW_PER_RUN || '5', 10) || 5);
  // 자막이 없는 영상 처리 방식 (선택): Supadata 키가 있으면 먼저 쓰고, 그래도 안 되면 Gemini가 영상을 직접 듣습니다.
  const supadataKey = process.env.SUPADATA_API_KEY || '';
  const geminiVideo = String(process.env.GEMINI_VIDEO || '').trim().toLowerCase() !== 'off';
  console.log(
    `자막이 없는 영상: ${supadataKey ? 'Supadata → ' : ''}${geminiVideo ? 'Gemini 영상 직접 분석' : '건너뜀(no_transcript 표시)'}`,
  );

  // 1) 재생목록 → 새 영상 등록
  const playlists = (await readPlaylists(sheets, spreadsheetId)).filter((pl) => categories.includes(pl.category));
  if (!playlists.length && categories.length) {
    console.warn(`⚠️  ${PLAYLISTS_TAB} 탭에 이번 실행 대상(${categories.join(', ')})의 재생목록이 없습니다. A열=구분, B열=재생목록 URL 을 입력하세요.`);
  }
  const known = new Set(sermons.map((s) => s.video_id));
  const candidates = [];
  const autoDays = Math.max(0, parseInt(process.env.AUTO_WITHIN_DAYS || '14', 10) || 14);
  const autoCutoff = new Date(Date.now() - autoDays * 86400000).toISOString().slice(0, 10);
  for (const pl of playlists) {
    const listId = extractPlaylistId(pl.url);
    if (!listId) {
      console.warn(`⚠️  재생목록 ID를 찾지 못했습니다: ${pl.url}`);
      continue;
    }
    console.log(`📺 [${pl.category}] 재생목록 ${listId} 확인 중…`);
    try {
      const videos = await fetchPlaylistVideos(listId, youtubeKey, pl.maxVideos);
      for (const v of videos) {
        if (known.has(v.video_id)) continue;
        known.add(v.video_id);
        // 영상 제목 "[YYYY.MM.DD] 제목 (성경본문) - 설교자" 에서 날짜·본문·설교자를 바로 읽어 둡니다 (목록·필터용)
        const p = parseTitle(v.title);
        const when = p.date || v.published_at;
        // 최근 AUTO_WITHIN_DAYS일 안의 영상만 자동 정리하고, 오래된 영상은 "목록만"으로 두어 앱에서 골라 돌립니다.
        const isOld = when && when < autoCutoff;
        candidates.push({
          ...v,
          category: pl.category,
          preacher: p.preacher,
          scripture: p.scripture,
          status: isOld ? 'listed' : 'pending',
          updated_at: now(),
          note: isOld ? '오래된 영상 — 앱에서 선택해 정리할 수 있습니다' : '',
        });
      }
    } catch (e) {
      console.error(`❌ 재생목록 조회 실패 (${pl.category}): ${e.message}`);
    }
  }
  // 라이브 예약·방송 중처럼 아직 영상이 없는 것은 시트에 넣지 않고 다음에 다시 확인합니다.
  const freshStates = await fetchVideoStates(candidates.map((v) => v.video_id), youtubeKey);
  const fresh = [];
  for (const v of candidates) {
    const st = freshStates.get(v.video_id);
    if (st && !st.ready) {
      console.log(`⏭  건너뜀 (${st.reason}): ${v.title}`);
      continue;
    }
    fresh.push(v);
  }
  if (fresh.length) {
    await appendSermons(sheets, spreadsheetId, fresh);
    console.log(`➕ 새 영상 ${fresh.length}편을 시트에 추가했습니다.`);
    sermons = await readSermons(sheets, spreadsheetId);
  } else {
    console.log('새 영상이 없습니다.');
  }

  // 2) 정리할 영상 선택: redo → 사용자 영상 → 최근 실패한 것 → pending(최신순). 아직 영상이 없는 것은 건너뜁니다.
  const retryDays = Math.max(0, parseInt(process.env.RETRY_DAYS || '7', 10) || 7);
  const pool = buildQueue(sermons, { maxPerRun: Infinity, retryDays, categories });
  const states = await fetchVideoStates(pool.queue.map((r) => r.video_id), youtubeKey);
  const { queue, skipped } = buildQueue(sermons, { maxPerRun, retryDays, states, categories });
  for (const { row, reason } of skipped) console.log(`⏭  건너뜀 (${reason}): ${row.title}`);
  const retried = queue.filter((r) => r.status === 'error' || r.status === 'no_transcript').length;

  console.log(`🛠  이번 실행에서 정리할 영상: ${queue.length}편 (최대 ${maxPerRun}편${retried ? `, 이전에 실패한 ${retried}편 포함` : ''})`);

  // 사용자 영상에 날짜가 비어 있으면 제목의 날짜 → 유튜브 게시일 → 오늘 순서로 채웁니다
  const noDate = queue.filter((r) => r.category === 'user' && !String(r.published_at || '').trim());
  if (noDate.length) {
    const posted = await fetchPublishDates(noDate.map((r) => r.video_id), youtubeKey);
    for (const row of noDate) {
      row.published_at = parseAnyTitle('user', row.title).date || posted.get(row.video_id) || now().slice(0, 10);
      await updateSermonRow(sheets, spreadsheetId, row.rowNumber, { published_at: row.published_at });
    }
  }

  const mediaState = {};
  const sermonRedoModes = String(process.env.SERMON_MODES || '').split(/[\s,]+/).filter((m) => MODES.includes(m));
  if (sermonRedoModes.length) console.log(`✂️  다시 정리 표시한 영상은 ${sermonRedoModes.map((m) => MODE_LABELS[m]).join(' · ')}만 새로 만듭니다.`);
  for (const row of queue) {
    console.log(`\n▶ [${row.category}] ${row.title} (${row.video_id})`);
    await processRow(row, {
      ai,
      update: (patch) => updateSermonRow(sheets, spreadsheetId, row.rowNumber, patch),
      supadataKey,
      geminiVideo,
      redoModes: sermonRedoModes, // 관리 화면에서 고른 부분만 다시 정리 (비면 전부)
      enrichSongs: null, // 찬양은 CCM 한 곡만, 영상은 화면에서 YouTube 검색 링크로 엽니다 (검색 할당량 아끼기)
      fetchBible: async (passages) => {
        const block = await fetchBibleBlock(passages, { log: (m) => console.warn(`   ${m}`) });
        return block ? attachBibleAudio(block, passages, youtubeKey, { state: mediaState, log: (m) => console.warn(`   ${m}`) }) : block;
      },
    });
  }

  // 이미 정리된 설교에도 성경 본문을 붙입니다 (아직 없거나 본문 범위가 바뀐 경우)
  sermons = await readSermons(sheets, spreadsheetId);
  await backfillBible(sheets, spreadsheetId, sermons, youtubeKey, 12, mediaState);

  // 기도 배경음악 목록 갱신 (QT 묵상 화면용)
  await refreshMusic(youtubeKey);

  // 오늘의 말씀 (오늘·내일)
  try {
    await syncDaily(sheets, spreadsheetId, ai, youtubeKey);
  } catch (e) {
    console.error(`❌ 오늘의 말씀 동기화 실패: ${e.message || e}`);
  }

  // 새벽기도 영상 (오늘 것이 아직 없을 때만 재생목록을 읽습니다)
  try {
    await syncDawn(sheets, spreadsheetId, youtubeKey, settings);
  } catch (e) {
    console.error(`❌ 새벽기도 영상 연결 실패: ${e.message || e}`);
  }

  // 잠언 묵상 (빠진 장 3개씩, 또는 관리 화면에서 고른 장)
  try {
    const onlyProverbs = String(process.env.ONLY_CATEGORIES || '').toLowerCase().split(/[\s,]+/).includes('proverbs');
    await syncProverbs(sheets, spreadsheetId, ai, {
      force: onlyProverbs && String(process.env.DAILY_FORCE || '').toLowerCase() === 'true',
      forceModes: onlyProverbs ? String(process.env.DAILY_MODES || '').split(/[\s,]+/).filter((m) => PROVERB_COLUMNS[m]) : [],
    });
  } catch (e) {
    console.error(`❌ 잠언 묵상 동기화 실패: ${e.message || e}`);
  }

  // 3) 내보내기
  sermons = await readSermons(sheets, spreadsheetId);
  await exportJson(sermons);
  try {
    await exportDaily(await readDaily(sheets, spreadsheetId));
  } catch (e) {
    console.warn(`⚠️  오늘의 말씀 내보내기 실패: ${e.message || e}`);
  }
  try {
    await exportProverbs(await readTabRows(sheets, spreadsheetId, PROVERBS_TAB, PROVERBS_HEADERS));
  } catch (e) {
    console.warn(`⚠️  잠언 묵상 내보내기 실패: ${e.message || e}`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error('\n💥', e.message || e);
    process.exit(1);
  });
}
