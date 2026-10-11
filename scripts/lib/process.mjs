// 영상 한 편을 처리합니다: 설교 내용 확보 → Gemini로 4개 모드 정리 → 시트에 결과(또는 실패 사유) 기록
// 시트·API 호출은 모두 바깥에서 받아 쓰므로, 테스트에서 가짜로 바꿔 끼울 수 있습니다.
//
// 모드별로 따로 저장합니다: result_json(설교리뷰+공통 정보) · mode_qt · mode_study · mode_group · bible_json
// 일부 모드만 실패하면 status 를 error 로 두되 성공한 모드는 시트에 남기고, 다음 재시도 때는 빠진 모드만 다시 만듭니다.
import { obtainMaterial as defaultObtain } from './transcript.mjs';
import { MODES, MODE_LABELS } from './prompt.mjs';
import { parseTitle, parseAnyTitle, parseScripture, normalizePreacher } from './title.mjs';
import { bibleIsCurrent } from './bible-web.mjs';

export const CELL_LIMIT = 49_000; // Google Sheets 셀 하나의 최대 글자 수는 50,000

export const MODE_COLUMNS = { review: 'result_json', qt: 'mode_qt', study: 'mode_study', group: 'mode_group' };

const parseJson = (s) => {
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
};

/** 시트 행에서 이미 만들어 둔 모드를 읽습니다 (error 상태의 재시도에서만 씁니다) */
export function readExisting(row) {
  const core = parseJson(row.result_json);
  const out = { bible: parseJson(row.bible_json) };
  if (core?.schema === 3 && core.review?.outline?.length) out.review = core;
  for (const mode of ['qt', 'study', 'group']) {
    const v = parseJson(row[MODE_COLUMNS[mode]]);
    if (v && Object.keys(v).length) out[mode] = v;
  }
  return out;
}

const validDate = (x) => (/^\d{4}-\d{2}-\d{2}$/.test(String(x || '').trim()) ? String(x).trim() : '');

/** 영상 제목 · 사용자가 직접 입력한 값으로 이미 알고 있는 정보 (날짜·제목·본문·설교자) */
export function knownInfo(row) {
  const p = row.category === 'user' ? parseAnyTitle('user', row.title) : parseTitle(row.title); // 사용자 영상은 자유로운 제목 형식도 읽습니다
  return {
    date: validDate(row.date_override) || p.date || String(row.published_at || '').slice(0, 10),
    title: String(row.title_override || '').trim() || p.title || row.title,
    scripture: String(row.scripture_override || '').trim() || String(row.scripture || '').trim() || p.scripture,
    preacher: normalizePreacher(String(row.preacher_override || '').trim() || String(row.preacher || '').trim() || p.preacher),
  };
}

/**
 * @param row   Sermons 탭의 한 행
 * @param deps  { ai, update(patch), enrichSongs(songs), fetchBible(passages), supadataKey, geminiVideo, obtain, now, log }
 * @returns     'done' | 'error' | 'no_transcript'
 */
export async function processRow(row, deps) {
  const {
    ai,
    update,
    enrichSongs = null, // (songs[]) => 찬양 영상 붙이기 (실패해도 정리는 유지)
    fetchBible = null, // (passages) => 성경 본문 블록 | null
    supadataKey = '',
    geminiVideo = true,
    obtain = defaultObtain,
    now = () => new Date().toISOString(),
    log = { info: console.log, warn: console.warn, error: console.error },
    redoModes = [], // 다시 정리하기에서 고른 부분만 새로 만들 때: ['qt'] 처럼 (비어 있으면 전부 새로)
  } = deps;

  // 오류 재시도: 이미 만든 모드는 두고 빠진 것만. 부분 다시 정리: 고른 모드만 비우고 나머지는 그대로 둡니다.
  const picked = (redoModes || []).filter((m) => MODES.includes(m));
  let resume = { bible: null };
  if (row.status === 'error') resume = readExisting(row);
  else if (row.status === 'redo' && picked.length) {
    resume = readExisting(row);
    for (const m of picked) delete resume[m];
  }
  const material = await obtain(row, { supadataKey, geminiVideo, log: (m) => log.warn(`   ${m}`) });

  if (material.kind === 'none') {
    await update({
      status: 'no_transcript',
      note: `자막을 가져오지 못했습니다 (${material.problems.join(' / ')}). transcript_manual 칸에 자막을 붙여넣고 status를 redo로 바꾸세요.`.slice(0, 500),
      updated_at: now(),
    });
    return 'no_transcript';
  }

  let transcript = material.kind === 'text' ? material.text : '';
  let source = material.source;
  const info = knownInfo(row);

  try {
    if (material.kind === 'video') {
      log.info('   자막이 없어 영상을 Gemini가 직접 듣고 글로 옮깁니다 (몇 분 걸릴 수 있습니다)…');
      transcript = await ai.transcribeVideo({ title: row.title, videoUrl: `https://www.youtube.com/watch?v=${row.video_id}` });
      source = material.source || 'Gemini 영상 직접 분석';
    } else {
      log.info(`   ${material.source} ${transcript.length.toLocaleString()}자`);
    }
  } catch (e) {
    log.error(`   ❌ 실패: ${e.message}`);
    await update({
      status: 'error',
      note: `영상 직접 분석 실패 (${material.problems.join(' / ').slice(0, 120)}) — ${String(e.message).slice(0, 300)} — status를 redo로 바꾸면 다시 시도합니다. 계속 안 되면 transcript_manual 칸에 자막을 붙여넣으세요.`,
      updated_at: now(),
    });
    return 'error';
  }

  // 1) 모드별로 만들기 (이미 있는 모드는 건너뜀)
  const results = { review: resume.review, qt: resume.qt, study: resume.study, group: resume.group };
  const failures = [];
  for (const mode of MODES) {
    if (results[mode]) continue;
    log.info(`   ▷ ${MODE_LABELS[mode]} 정리 중…`);
    try {
      const out = await ai.generateMode(mode, { category: row.category, title: row.title, publishedAt: info.date, transcript, info });
      if (mode === 'review') {
        // 영상 제목이나 직접 입력으로 확실히 아는 값은 AI 값보다 우선합니다
        if (info.scripture) out.scripture = [info.scripture];
        if (info.preacher) out.preacher = info.preacher;
      }
      results[mode] = out;
    } catch (e) {
      failures.push(`${MODE_LABELS[mode]}: ${String(e.message).slice(0, 120)}`);
      log.error(`   ❌ ${MODE_LABELS[mode]} 실패: ${e.message}`);
    }
  }

  // 2) 부가 정보: 찬양 영상, 성경 본문 (실패해도 정리는 유지)
  let bible = resume.bible;
  if (results.review) {
    const passages = (info.scripture && parseScripture(info.scripture)) || [];
    const usable = passages.length ? passages : results.review.passages || [];
    try {
      if (enrichSongs) for (const mode of ['qt', 'study', 'group']) if (results[mode]?.songs) await enrichSongs(results[mode].songs);
      if (fetchBible && usable.length && !bibleIsCurrent(bible, usable)) bible = (await fetchBible(usable)) || bible;
    } catch (e) {
      log.warn(`   부가 정보(찬양 영상·성경 본문)를 붙이지 못했습니다: ${e.message}`);
    }
  }

  // 3) 저장
  const patch = { updated_at: now() };
  const tooBig = [];
  const put = (column, value) => {
    const json = JSON.stringify(value);
    if (json.length > CELL_LIMIT) tooBig.push(`${column} ${json.length}자`);
    else patch[column] = json;
  };
  for (const mode of MODES) if (results[mode]) put(MODE_COLUMNS[mode], results[mode]);
  if (bible) put('bible_json', bible);
  if (tooBig.length) failures.push(`결과가 너무 깁니다 (${tooBig.join(', ')})`);
  if (results.review) {
    patch.preacher = normalizePreacher(results.review.preacher || '');
    patch.scripture = (results.review.scripture || []).join(', ');
  }

  const okModes = MODES.filter((m) => results[m] && patch[MODE_COLUMNS[m]]);
  if (!failures.length && okModes.length === MODES.length) {
    patch.status = 'done';
    patch.note = `${source} · ${ai.model}`;
    await update(patch);
    row.status = 'done';
    log.info('   ✅ 완료');
    return 'done';
  }

  patch.status = 'error';
  patch.note = `일부 실패 — ${failures.join(' / ')}`.slice(0, 450) + ' — 다음 실행 때 실패한 모드만 다시 만듭니다(최근 영상). 바로 하려면 status를 error 그대로 두고 앱에서 다시 정리하세요.';
  await update(patch);
  log.error(`   ⚠ 일부만 완료: 성공 ${okModes.map((m) => MODE_LABELS[m]).join(', ') || '없음'}`);
  return 'error';
}
