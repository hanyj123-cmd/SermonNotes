#!/usr/bin/env node
// 자동(예약) 실행이 "정해진 토론토 시각"일 때만, 그 시각에 맞는 구분만 동기화하도록 판단합니다.
//   수요예배  : 매주 목요일 오전 07:00
//   주일예배  : 매주 일요일 밤 22:00
//   새벽기도회: 매일 오전 11:00
//   청년부예배: 자동 수집 없음 (필요할 때 앱/Actions에서 직접 실행)
// GitHub 예약은 UTC만 지원하고 토론토는 서머타임이 있어서, 여름/겨울용 예약을 둘 다 등록해 두고
// 이 판단으로 맞는 쪽만 실행합니다. 직접 실행(앱의 "지금 동기화" 버튼 등)은 항상 실행합니다.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export const TIME_ZONE = 'America/Toronto';
export const WINDOW_MINUTES = 59; // 정해진 시각부터 이 시간(분) 안에 시작한 예약 실행을 인정합니다

// day: 0=일 … 6=토, null=매일. minutes = 하루 중 분(0~1439)
export const RULES = [
  { category: 'wednesday', day: 4, minutes: 7 * 60, label: '수요예배 (목요일 07:00)' },
  { category: 'sunday', day: 0, minutes: 22 * 60, label: '주일예배 (일요일 22:00)' },
  { category: 'dawn', day: null, minutes: 11 * 60, label: '새벽기도회 (매일 11:00)' },
];

const WEEKDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** 토론토 현지의 요일(0=일)과 하루 중 분 */
export function torontoClock(date) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  const get = (t) => parts.find((p) => p.type === t).value;
  return { day: WEEKDAYS[get('weekday')], minutes: Number(get('hour')) * 60 + Number(get('minute')) };
}

/** 지금 해야 할 구분 목록 (예약 실행용) */
export function dueCategories(date = new Date()) {
  const { day, minutes } = torontoClock(date);
  return RULES.filter((r) => (r.day === null || r.day === day) && minutes >= r.minutes && minutes <= r.minutes + WINDOW_MINUTES).map((r) => r.category);
}

/**
 * @returns { run: boolean, categories: string }  categories 는 쉼표로 이은 목록 (직접 실행이면 빈 문자열 = 입력값/기본값 사용)
 */
export function decide(eventName, date = new Date()) {
  if (eventName !== 'schedule') return { run: true, categories: '' };
  const due = dueCategories(date);
  return { run: due.length > 0, categories: due.join(',') };
}

export const shouldRun = (eventName, date = new Date()) => decide(eventName, date).run;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { run, categories } = decide(process.env.GITHUB_EVENT_NAME || '');
  console.log(run ? `✅ 실행합니다 ${categories ? `(${categories})` : '(직접 실행)'}` : '⏭ 지금은 예약된 수집 시각이 아니라서 건너뜁니다', `(run=${run})`);
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `run=${run}\ncategories=${categories}\n`);
}
