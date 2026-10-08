#!/usr/bin/env node
// docs/game-data.js(화면용 게임 규칙·아이템) → apps-script/Code.gs 의 GAME_CONF 를 새로 만듭니다.
//   node scripts/game-conf.mjs          Code.gs 를 고쳐 씀
//   node scripts/game-conf.mjs --check  다르면 실패 (npm test 에서 사용)
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export function readGameConf() {
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'docs/game-data.js'), 'utf8') + '\n;globalThis.__conf = gameServerConf();', ctx);
  return JSON.parse(JSON.stringify(ctx.__conf));
}
const START = '// <GAME_CONF> (scripts/game-conf.mjs 가 docs/game-data.js 에서 만듭니다 — 직접 고치지 마세요)';
const END = '// </GAME_CONF>';
export function confBlock() {
  return `${START}\nconst GAME_CONF = ${JSON.stringify(readGameConf())};\n${END}`;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const file = path.join(ROOT, 'apps-script/Code.gs');
  const code = fs.readFileSync(file, 'utf8');
  const a = code.indexOf(START);
  const b = code.indexOf(END);
  if (a < 0 || b < 0) throw new Error('Code.gs 에 GAME_CONF 자리가 없습니다');
  const next = code.slice(0, a) + confBlock() + code.slice(b + END.length);
  if (process.argv.includes('--check')) {
    if (next !== code) {
      console.error('❌ Code.gs 의 GAME_CONF 가 docs/game-data.js 와 다릅니다. node scripts/game-conf.mjs 를 실행하세요.');
      process.exit(1);
    }
    console.log('✓ 게임 설정: Code.gs 와 game-data.js 가 같습니다');
  } else {
    fs.writeFileSync(file, next);
    console.log('Code.gs 의 GAME_CONF 를 새로 썼습니다');
  }
}
