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
  PLAYLISTS_TAB,
  PLAYLIST_HEADERS,
  SERMONS_TAB,
  SERMON_HEADERS,
} from './lib/sheets.mjs';
import { extractPlaylistId, fetchPlaylistVideos, fetchTranscript } from './lib/youtube.mjs';
import { createGemini, DEFAULT_MODEL } from './lib/gemini.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = path.resolve(__dirname, '../docs/data/sermons.json');
const CELL_LIMIT = 49_000; // Google Sheets 셀 하나의 최대 글자 수는 50,000

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

async function main() {
  const spreadsheetId = need('SHEET_ID');
  const sheets = createSheetsClient(need('GOOGLE_SERVICE_ACCOUNT_JSON'));

  await ensureTab(sheets, spreadsheetId, PLAYLISTS_TAB, PLAYLIST_HEADERS);
  await ensureTab(sheets, spreadsheetId, SERMONS_TAB, SERMON_HEADERS);

  let sermons = await readSermons(sheets, spreadsheetId);

  if (exportOnly) {
    await exportJson(sermons);
    return;
  }

  const youtubeKey = need('YOUTUBE_API_KEY');
  const ai = createGemini(need('GEMINI_API_KEY'), process.env.GEMINI_MODEL || DEFAULT_MODEL);
  const maxPerRun = Math.max(1, parseInt(process.env.MAX_NEW_PER_RUN || '5', 10) || 5);

  // 1) 재생목록 → 새 영상 등록
  const playlists = await readPlaylists(sheets, spreadsheetId);
  if (!playlists.length) {
    console.warn(`⚠️  ${PLAYLISTS_TAB} 탭에 재생목록이 없습니다. A열=구분, B열=재생목록 URL 을 입력하세요.`);
  }
  const known = new Set(sermons.map((s) => s.video_id));
  const fresh = [];
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
        fresh.push({ ...v, category: pl.category, status: 'pending', updated_at: now(), note: '' });
      }
    } catch (e) {
      console.error(`❌ 재생목록 조회 실패 (${pl.category}): ${e.message}`);
    }
  }
  if (fresh.length) {
    await appendSermons(sheets, spreadsheetId, fresh);
    console.log(`➕ 새 영상 ${fresh.length}편을 시트에 추가했습니다.`);
    sermons = await readSermons(sheets, spreadsheetId);
  } else {
    console.log('새 영상이 없습니다.');
  }

  // 2) 정리할 영상 선택: redo 먼저, 그다음 pending(최신순)
  const byDateDesc = (a, b) => String(b.published_at).localeCompare(String(a.published_at));
  const queue = [
    ...sermons.filter((s) => s.status === 'redo').sort(byDateDesc),
    ...sermons.filter((s) => s.status === 'pending').sort(byDateDesc),
  ].slice(0, maxPerRun);

  console.log(`🛠  이번 실행에서 정리할 영상: ${queue.length}편 (최대 ${maxPerRun}편)`);

  for (const row of queue) {
    console.log(`\n▶ [${row.category}] ${row.title} (${row.video_id})`);
    let transcript = String(row.transcript_manual || '').trim();
    let source = '직접 입력한 자막';
    if (!transcript) {
      const t = await fetchTranscript(row.video_id);
      transcript = t.text;
      source = 'YouTube 자막';
      if (!transcript) {
        console.warn(`   자막 없음: ${t.error}`);
        await updateSermonRow(sheets, spreadsheetId, row.rowNumber, {
          status: 'no_transcript',
          note: `자막을 가져오지 못했습니다 (${t.error}). transcript_manual 칸에 자막을 붙여넣고 status를 redo로 바꾸세요.`,
          updated_at: now(),
        });
        continue;
      }
    }
    console.log(`   ${source} ${transcript.length.toLocaleString()}자 → Gemini 정리 중…`);

    try {
      const result = await ai.summarize({
        category: row.category,
        title: row.title,
        publishedAt: row.published_at,
        transcript,
      });
      const json = JSON.stringify(result);
      if (json.length > CELL_LIMIT) throw new Error(`결과가 너무 깁니다 (${json.length}자)`);
      await updateSermonRow(sheets, spreadsheetId, row.rowNumber, {
        status: 'done',
        result_json: json,
        note: `${source} · ${ai.model}`,
        updated_at: now(),
      });
      row.status = 'done';
      row.result_json = json;
      console.log('   ✅ 완료');
    } catch (e) {
      console.error(`   ❌ 실패: ${e.message}`);
      await updateSermonRow(sheets, spreadsheetId, row.rowNumber, {
        status: 'error',
        note: String(e.message).slice(0, 300) + ' — status를 redo로 바꾸면 다시 시도합니다.',
        updated_at: now(),
      });
    }
  }

  // 3) 내보내기
  sermons = await readSermons(sheets, spreadsheetId);
  await exportJson(sermons);
}

main().catch((e) => {
  console.error('\n💥', e.message || e);
  process.exit(1);
});
