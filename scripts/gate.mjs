#!/usr/bin/env node
// 자동(예약) 실행이 "토론토 오전 7:30 무렵"일 때만 동기화하도록 판단합니다.
// GitHub 예약은 UTC만 지원하고 토론토는 서머타임이 있어서, 여름/겨울용 예약 두 개를 모두 등록해 두고
// 이 판단으로 맞는 쪽만 실행합니다. 직접 실행(앱의 "지금 동기화" 버튼 등)은 항상 실행합니다.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export const TIME_ZONE = 'America/Toronto';
export const WINDOW = { from: 7 * 60 + 20, to: 8 * 60 + 20 }; // 07:20 ~ 08:20

export function torontoMinutes(date) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  const get = (t) => Number(parts.find((p) => p.type === t).value);
  return get('hour') * 60 + get('minute');
}

export function shouldRun(eventName, date = new Date()) {
  if (eventName !== 'schedule') return true;
  const m = torontoMinutes(date);
  return m >= WINDOW.from && m <= WINDOW.to;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const run = shouldRun(process.env.GITHUB_EVENT_NAME || '');
  const line = `run=${run}`;
  console.log(run ? '✅ 실행합니다' : `⏭ 토론토 시간이 아침 7:30 무렵이 아니라서 건너뜁니다`, `(${line})`);
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `${line}\n`);
}
