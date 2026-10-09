#!/usr/bin/env node
// 자동(예약) 실행이 "정해진 토론토 시각"일 때만, 그 시각에 맞는 구분만 동기화하도록 판단합니다.
//   주일예배    : 매주 일요일 밤 22:00
//   오늘의 말씀 : 매일 아침 07:00 (다음 날 분량의 QT·성경공부·소그룹·퀴즈를 하루 전에 미리 만듭니다)
//   새벽기도회·수요예배·청년부예배 설교 정리: 자동 수집 없음 (이미 정리된 것은 "지난 설교"로 남아 있고, 필요하면 직접 실행)
// GitHub 예약은 UTC만 지원하고 토론토는 서머타임이 있어서, 여름/겨울용 예약을 둘 다 등록해 두고
// 이 판단으로 맞는 쪽만 실행합니다. 직접 실행(앱의 "지금 동기화" 버튼 등)은 항상 실행합니다.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export const TIME_ZONE = 'America/Toronto';
export const WINDOW_MINUTES = 59; // 정해진 시각부터 이 시간(분) 안에 시작한 예약 실행을 인정합니다

// day: 0=일 … 6=토, null=매일. minutes = 하루 중 분(0~1439)
export const RULES = [
  { category: 'sunday', day: 0, minutes: 22 * 60, label: '주일예배 (일요일 22:00)' },
  { category: 'daily', day: null, minutes: 7 * 60, label: '오늘의 말씀 (매일 07:00, 다음 날 분량)' },
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
  return [...new Set(RULES.filter((r) => (r.day === null || r.day === day) && minutes >= r.minutes && minutes <= r.minutes + (r.window || WINDOW_MINUTES)).map((r) => r.category))];
}

/**
 * @returns { run: boolean, categories: string }  categories 는 쉼표로 이은 목록 (직접 실행이면 빈 문자열 = 입력값/기본값 사용)
 */
/**
 * 어느 예약(cron)이 울렸는지 알면(github.event.schedule), 실제 시작 시각이 아니라 그 예약의 "정해진 시각"으로 판단합니다.
 * GitHub 예약은 몇 분~수십 분 늦게 시작하기도 해서, 07:00 예약이 07:25 에 시작해도 07:20 예약으로 오해하지 않게 합니다.
 */
export function scheduledCategories(schedule, date = new Date()) {
  const m = /^(\d{1,2})\s+(\d{1,2})\s/.exec(String(schedule || '').trim());
  if (!m) return null;
  const nominal = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), Number(m[2]), Number(m[1])));
  if (nominal.getTime() - date.getTime() > 3600000) nominal.setUTCDate(nominal.getUTCDate() - 1); // 자정을 넘겨 시작한 경우
  const { day, minutes } = torontoClock(nominal);
  return [...new Set(RULES.filter((r) => (r.day === null || r.day === day) && r.minutes === minutes).map((r) => r.category))];
}

export function decide(eventName, date = new Date(), schedule = '') {
  if (eventName !== 'schedule') return { run: true, categories: '' };
  const due = scheduledCategories(schedule, date) || dueCategories(date);
  return { run: due.length > 0, categories: due.join(',') };
}

export const shouldRun = (eventName, date = new Date()) => decide(eventName, date).run;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { run, categories } = decide(process.env.GITHUB_EVENT_NAME || '', new Date(), process.env.SCHEDULE || '');
  console.log(run ? `✅ 실행합니다 ${categories ? `(${categories})` : '(직접 실행)'}` : '⏭ 지금은 예약된 수집 시각이 아니라서 건너뜁니다', `(run=${run})`);
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `run=${run}\ncategories=${categories}\n`);
}
