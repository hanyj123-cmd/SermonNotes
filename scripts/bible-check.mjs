#!/usr/bin/env node
// 성경 본문 가져오기 점검: 4개 역본이 지금도 읽히는지 확인합니다.
//   node scripts/bible-check.mjs                 (기본: 요한복음 3:16-18)
//   node scripts/bible-check.mjs "시편 23편"
// 사이트 화면 구조가 바뀌어 읽지 못하면 어느 역본이 왜 안 되는지 알려 줍니다.
import { BIBLE_SOURCES, fetchPassage } from './lib/bible-web.mjs';
import { parseScripture } from './lib/title.mjs';

const text = process.argv.slice(2).join(' ') || '요한복음 3:16-18';
const passages = parseScripture(text);
if (!passages.length) {
  console.error(`본문 표기를 읽지 못했습니다: ${text}`);
  process.exit(2);
}
let failed = 0;
for (const src of BIBLE_SOURCES) {
  try {
    const got = await fetchPassage(src, passages[0]);
    const first = got.verses[0];
    console.log(`✅ ${src.label}: ${got.verses.length}절 — ${first.n}절 "${first.text.slice(0, 50)}…"`);
  } catch (e) {
    failed++;
    console.log(`❌ ${src.label} (${src.source}): ${e.message}`);
  }
}
console.log(failed ? `\n${failed}개 역본을 읽지 못했습니다. 사이트 구조가 바뀌었을 수 있습니다.` : '\n4개 역본 모두 정상입니다.');
process.exit(failed ? 1 : 0);
