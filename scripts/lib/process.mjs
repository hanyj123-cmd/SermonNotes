// 영상 한 편을 처리합니다: 설교 내용 확보 → Gemini 정리 → 시트에 결과(또는 실패 사유) 기록
// 시트·API 호출은 모두 바깥에서 받아 쓰므로, 테스트에서 가짜로 바꿔 끼울 수 있습니다.
import { obtainMaterial as defaultObtain } from './transcript.mjs';

export const CELL_LIMIT = 49_000; // Google Sheets 셀 하나의 최대 글자 수는 50,000

/**
 * @param row   Sermons 탭의 한 행 (video_id, category, title, published_at, transcript_manual …)
 * @param deps  { ai, update(patch), supadataKey, geminiVideo, obtain, now, log }
 * @returns     'done' | 'error' | 'no_transcript'
 */
export async function processRow(row, deps) {
  const {
    ai,
    update,
    enrich = null, // (result) => 찬양 영상·성경 본문 같은 부가 정보를 붙임 (실패해도 정리는 유지)
    supadataKey = '',
    geminiVideo = true,
    obtain = defaultObtain,
    now = () => new Date().toISOString(),
    log = { info: console.log, warn: console.warn, error: console.error },
  } = deps;

  const material = await obtain(row, { supadataKey, geminiVideo, log: (m) => log.warn(`   ${m}`) });

  if (material.kind === 'none') {
    await update({
      status: 'no_transcript',
      note: `자막을 가져오지 못했습니다 (${material.problems.join(' / ')}). transcript_manual 칸에 자막을 붙여넣고 status를 redo로 바꾸세요.`.slice(0, 500),
      updated_at: now(),
    });
    return 'no_transcript';
  }

  if (material.kind === 'text') {
    log.info(`   ${material.source} ${material.text.length.toLocaleString()}자 → Gemini 정리 중…`);
  } else {
    log.info('   자막이 없어 영상을 Gemini가 직접 듣고 정리합니다 (몇 분 걸릴 수 있습니다)…');
  }

  try {
    const meta = { category: row.category, title: row.title, publishedAt: row.published_at };
    const result =
      material.kind === 'video'
        ? await ai.summarizeVideo({ ...meta, videoUrl: `https://www.youtube.com/watch?v=${row.video_id}` })
        : await ai.summarize({ ...meta, transcript: material.text });
    if (enrich) {
      try {
        await enrich(result);
      } catch (e) {
        log.warn(`   부가 정보(찬양 영상·성경 본문)를 붙이지 못했습니다: ${e.message}`);
      }
    }
    const json = JSON.stringify(result);
    if (json.length > CELL_LIMIT) throw new Error(`결과가 너무 깁니다 (${json.length}자)`);
    await update({
      status: 'done',
      result_json: json,
      note: `${material.source} · ${ai.model}`,
      updated_at: now(),
    });
    row.status = 'done';
    row.result_json = json;
    log.info('   ✅ 완료');
    return 'done';
  } catch (e) {
    log.error(`   ❌ 실패: ${e.message}`);
    await update({
      status: 'error',
      note:
        (material.kind === 'video' ? `영상 직접 분석 실패 (${material.problems.join(' / ').slice(0, 120)}) — ` : '') +
        String(e.message).slice(0, 300) +
        ' — status를 redo로 바꾸면 다시 시도합니다. 계속 안 되면 transcript_manual 칸에 자막을 붙여넣으세요.',
      updated_at: now(),
    });
    return 'error';
  }
}
