// Google Sheets 읽기/쓰기 (서비스 계정 사용)
import { google } from 'googleapis';

export const PLAYLISTS_TAB = 'Playlists';
export const SERMONS_TAB = 'Sermons';

export const PLAYLIST_HEADERS = ['category', 'playlist_url', 'max_videos'];

// Sermons 탭 컬럼 (순서 고정)
export const SERMON_HEADERS = [
  'video_id',
  'category',
  'title',
  'published_at',
  'url',
  'status', // pending | done | error | no_transcript | skip | redo
  'transcript_manual', // 자막 수집이 안 될 때 여기에 직접 붙여넣기
  'result_json', // Gemini가 만든 결과 (JSON)
  'updated_at',
  'note',
];

const CATEGORY_ALIASES = {
  dawn: 'dawn',
  새벽: 'dawn',
  새벽기도: 'dawn',
  wednesday: 'wednesday',
  wed: 'wednesday',
  수요: 'wednesday',
  수요예배: 'wednesday',
  sunday: 'sunday',
  sun: 'sunday',
  주일: 'sunday',
  주일예배: 'sunday',
};

export function normalizeCategory(raw) {
  const key = String(raw || '').trim().toLowerCase().replace(/\s+/g, '');
  return CATEGORY_ALIASES[key] || null;
}

export function createSheetsClient(serviceAccountJson) {
  let creds;
  try {
    creds = JSON.parse(serviceAccountJson);
  } catch {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON 값이 올바른 JSON이 아닙니다.');
  }
  const auth = new google.auth.JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

function colLetter(n) {
  // 1 -> A
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** 탭이 없으면 만들고, 헤더가 없으면 헤더를 씁니다. */
export async function ensureTab(sheets, spreadsheetId, title, headers) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const exists = meta.data.sheets?.some((s) => s.properties?.title === title);
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: [{ addSheet: { properties: { title } } }] },
    });
  }
  const range = `${title}!A1:${colLetter(headers.length)}1`;
  const got = await sheets.spreadsheets.values.get({ spreadsheetId, range });
  const first = got.data.values?.[0] || [];
  if (first.length === 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range,
      valueInputOption: 'RAW',
      requestBody: { values: [headers] },
    });
  }
}

export async function readPlaylists(sheets, spreadsheetId) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${PLAYLISTS_TAB}!A2:C`,
  });
  const rows = res.data.values || [];
  const out = [];
  rows.forEach((r, i) => {
    const category = normalizeCategory(r[0]);
    const url = String(r[1] || '').trim();
    if (!url) return;
    if (!category) {
      console.warn(`⚠️  Playlists ${i + 2}행: 알 수 없는 구분 "${r[0]}" (새벽기도 / 수요예배 / 주일예배 중 하나)`);
      return;
    }
    const max = parseInt(r[2], 10);
    out.push({ category, url, maxVideos: Number.isFinite(max) && max > 0 ? max : 30 });
  });
  return out;
}

/** Sermons 탭 전체를 객체 배열로 읽습니다. rowNumber는 시트의 실제 행 번호(2부터). */
export async function readSermons(sheets, spreadsheetId) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${SERMONS_TAB}!A2:${colLetter(SERMON_HEADERS.length)}`,
  });
  const rows = res.data.values || [];
  return rows
    .map((r, i) => {
      const obj = { rowNumber: i + 2 };
      SERMON_HEADERS.forEach((h, c) => {
        obj[h] = r[c] ?? '';
      });
      return obj;
    })
    .filter((o) => o.video_id);
}

export async function appendSermons(sheets, spreadsheetId, items) {
  if (!items.length) return;
  const values = items.map((o) => SERMON_HEADERS.map((h) => o[h] ?? ''));
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${SERMONS_TAB}!A1`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values },
  });
}

/** 한 행의 일부 컬럼만 갱신합니다. */
export async function updateSermonRow(sheets, spreadsheetId, rowNumber, patch) {
  const data = Object.entries(patch).map(([key, value]) => {
    const idx = SERMON_HEADERS.indexOf(key);
    if (idx < 0) throw new Error(`알 수 없는 컬럼: ${key}`);
    const col = colLetter(idx + 1);
    return {
      range: `${SERMONS_TAB}!${col}${rowNumber}`,
      values: [[value]],
    };
  });
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: { valueInputOption: 'RAW', data },
  });
}
