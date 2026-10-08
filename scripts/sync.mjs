#!/usr/bin/env node
// 메인 파이프라인
//   1) Google Sheets의 Playlists 탭에서 재생목록 읽기
//   2) YouTube에서 새 영상 찾아 Sermons 탭에 추가 (status = pending)
//   3) pending / redo 영상의 자막을 가져와 Gemini로 정리 → Sermons 탭에 저장
//   4) status = done 인 행을 docs/data/sermons.json 으로 내보내기 (웹앱이 읽는 파일)
//
// 사용법:
//   node scripts/sync.mjs                 전체 실행
//   node scripts/sync.mjs --export-only   시트 내용만 sermons.json 으로 내보내기 (API 키 불필요)

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
} from './lib/sheets.mjs';
import { extractPlaylistId, fetchPlaylistVideos, fetchVideoStates } from './lib/youtube.mjs';
import { buildQueue } from './lib/queue.mjs';
import { attachSongVideos, buildPrayerMusic, musicIsStale } from './lib/media.mjs';
import { listBibles, parseBibleVersions, attachBible, needsBible } from './lib/bible.mjs';
import { processRow, CELL_LIMIT } from './lib/process.mjs';
import { createGemini, DEFAULT_MODEL } from './lib/gemini.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = path.resolve(__dirname, '../docs/data/sermons.json');
const MUSIC_PATH = path.resolve(__dirname, '../docs/data/music.json');
const BIBLES_PATH = path.resolve(__dirname, '../docs/data/bibles.json');

const args = new Set(process.argv.slice(2));
const exportOnly = args.has('--export-only');

function need(name) {
  const v = process.env[name];
  if (!v) throw new Error(`환경변수 ${name} 이(가) 필요합니다. (.env.example 참고)`);
  return v;
}

const now = () => new Date().toISOString();

export async function exportJson(sermons) {
  const done = sermons
    .filter((s) => s.status === 'done' && s.result_json)
    .map((s) => {
      let result;
      try {
        result = JSON.parse(s.result_json);
      } catch {
        return null;
      }
      return {
        id: s.video_id,
        category: s.category,
        title: s.title,
        published_at: s.published_at,
        url: s.url,
        result,
      };
    })
    .filter(Boolean)
    .sort((a, b) => String(b.published_at).localeCompare(String(a.published_at)));

  const payload = { updated: now(), count: done.length, sermons: done };
  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await fs.writeFile(OUTPUT_PATH, JSON.stringify(payload, null, 1) + '\n', 'utf8');
  console.log(`📦 docs/data/sermons.json 저장 (${done.length}편)`);
}

async function backfillBible(sheets, spreadsheetId, sermons, versions, appKey) {
  let n = 0;
  for (const row of sermons) {
    if (n >= 20) break; // 한 번에 너무 많이 하지 않도록
    if (row.status !== 'done' || !row.result_json) continue;
    let result;
    try {
      result = JSON.parse(row.result_json);
    } catch {
      continue;
    }
    if (!needsBible(result, versions)) continue;
    n++;
    const before = result.bible;
    await attachBible(result, versions, appKey, { log: (m) => console.warn(`   ${m}`) });
    if (result.bible && result.bible !== before) {
      const json = JSON.stringify(result);
      if (json.length <= CELL_LIMIT) {
        await updateSermonRow(sheets, spreadsheetId, row.rowNumber, { result_json: json, updated_at: now() });
        console.log(`📖 성경 본문 추가: ${row.title}`);
      }
    }
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

async function refreshBibleList(appKey) {
  if (!appKey) return;
  const current = await readJsonFile(BIBLES_PATH);
  const age = Date.now() - Date.parse(current?.updated || '');
  if (current?.bibles?.length && age < 7 * 86400000) return;
  try {
    const bibles = await listBibles(appKey);
    if (!bibles.length) throw new Error('사용할 수 있는 역본이 없습니다');
    await fs.mkdir(path.dirname(BIBLES_PATH), { recursive: true });
    await fs.writeFile(BIBLES_PATH, JSON.stringify({ updated: now(), bibles }, null, 1) + '\n', 'utf8');
    console.log(`📚 선택할 수 있는 성경 역본 ${bibles.length}개 목록을 갱신했습니다.`);
  } catch (e) {
    console.warn(`⚠️  성경 역본 목록을 가져오지 못했습니다: ${e.message}`);
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
    await exportJson(sermons);
    return;
  }

  const youtubeKey = need('YOUTUBE_API_KEY');
  // 앱의 관리 화면에서 고른 설정(Settings 탭)이 있으면 그것을, 없으면 환경변수·기본값을 씁니다.
  const settings = await readSettings(sheets, spreadsheetId);
  const modelName = /^[\w.-]{3,60}$/.test(settings.gemini_model || '') ? settings.gemini_model : process.env.GEMINI_MODEL || DEFAULT_MODEL;
  console.log(`🤖 Gemini 모델: ${modelName}`);
  const ai = createGemini(need('GEMINI_API_KEY'), modelName);
  const bibleKey = process.env.BIBLE_API_KEY || '';
  const bibleVersions = parseBibleVersions(settings.bible_versions);
  console.log(`📖 성경 본문: ${bibleKey && bibleVersions.length ? bibleVersions.map((v) => v.label).join(' · ') : '사용 안 함 (BIBLE_API_KEY와 역본 선택이 필요합니다)'}`);
  const maxPerRun = Math.max(1, parseInt(process.env.MAX_NEW_PER_RUN || '5', 10) || 5);
  // 자막이 없는 영상 처리 방식 (선택): Supadata 키가 있으면 먼저 쓰고, 그래도 안 되면 Gemini가 영상을 직접 듣습니다.
  const supadataKey = process.env.SUPADATA_API_KEY || '';
  const geminiVideo = String(process.env.GEMINI_VIDEO || '').trim().toLowerCase() !== 'off';
  console.log(
    `자막이 없는 영상: ${supadataKey ? 'Supadata → ' : ''}${geminiVideo ? 'Gemini 영상 직접 분석' : '건너뜀(no_transcript 표시)'}`,
  );

  // 1) 재생목록 → 새 영상 등록
  const playlists = await readPlaylists(sheets, spreadsheetId);
  if (!playlists.length) {
    console.warn(`⚠️  ${PLAYLISTS_TAB} 탭에 재생목록이 없습니다. A열=구분, B열=재생목록 URL 을 입력하세요.`);
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
        // 최근 AUTO_WITHIN_DAYS일 안에 올라온 영상만 자동 정리하고, 오래된 영상은 "목록만"으로 두어 앱에서 골라 돌립니다.
        const isOld = v.published_at && v.published_at < autoCutoff;
        candidates.push({ ...v, category: pl.category, status: isOld ? 'listed' : 'pending', updated_at: now(), note: isOld ? '오래된 영상 — 앱에서 선택해 정리할 수 있습니다' : '' });
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

  // 2) 정리할 영상 선택: redo → 최근 실패한 것 → pending(최신순). 아직 영상이 없는 것은 건너뜁니다.
  const retryDays = Math.max(0, parseInt(process.env.RETRY_DAYS || '7', 10) || 7);
  const pool = buildQueue(sermons, { maxPerRun: Infinity, retryDays });
  const states = await fetchVideoStates(pool.queue.map((r) => r.video_id), youtubeKey);
  const { queue, skipped } = buildQueue(sermons, { maxPerRun, retryDays, states });
  for (const { row, reason } of skipped) console.log(`⏭  건너뜀 (${reason}): ${row.title}`);
  const retried = queue.filter((r) => r.status === 'error' || r.status === 'no_transcript').length;

  console.log(`🛠  이번 실행에서 정리할 영상: ${queue.length}편 (최대 ${maxPerRun}편${retried ? `, 이전에 실패한 ${retried}편 포함` : ''})`);

  const mediaState = {};
  for (const row of queue) {
    console.log(`\n▶ [${row.category}] ${row.title} (${row.video_id})`);
    await processRow(row, {
      ai,
      update: (patch) => updateSermonRow(sheets, spreadsheetId, row.rowNumber, patch),
      supadataKey,
      geminiVideo,
      enrich: async (result) => {
        await attachSongVideos(result, youtubeKey, { state: mediaState, log: (m) => console.warn(`   ${m}`) });
        await attachBible(result, bibleVersions, bibleKey, { log: (m) => console.warn(`   ${m}`) });
      },
    });
  }

  // 이미 정리된 설교에도 성경 본문을 붙입니다 (역본을 새로 골랐거나 아직 없는 경우)
  if (bibleKey && bibleVersions.length) {
    await backfillBible(sheets, spreadsheetId, sermons, bibleVersions, bibleKey);
    sermons = await readSermons(sheets, spreadsheetId);
  }

  // 기도 배경음악 목록, 성경 역본 목록 갱신 (선택 화면용)
  await refreshMusic(youtubeKey);
  await refreshBibleList(bibleKey);

  // 3) 내보내기
  sermons = await readSermons(sheets, spreadsheetId);
  await exportJson(sermons);
}

main().catch((e) => {
  console.error('\n💥', e.message || e);
  process.exit(1);
});
