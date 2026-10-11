// 퀴즈 섞기: AI 는 보통 쉬운 것 → 어려운 것, 본문 앞 → 뒤 순서로 내고 정답 번호도 한쪽으로 쏠리기 쉬워서,
// 저장하기 전에 코드로 섞습니다. 같은 문제 묶음은 항상 같은 순서가 되도록 문제 글에서 씨앗을 만듭니다(재현 가능).

function hashSeed(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
}
export function makeRng(seedText) {
  let a = hashSeed(String(seedText))();
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function shuffled(list, rng) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// 보기끼리 서로를 가리키는 문제("위 모두", "ㄱ, ㄴ" 등)는 보기 순서를 바꾸면 뜻이 달라져서 그대로 둡니다
const ORDER_BOUND = /(모두|위의|위\s*보기|①|②|③|④|^\s*[ㄱ-ㅎ][.,)]|^\s*[A-Da-d][.)])/;
export const optionsOrderFree = (opts) => !opts.some((o) => ORDER_BOUND.test(o));

/** 같은 난이도가 3개 연속 나오지 않게 고칩니다 */
function spreadLevels(list) {
  const a = list.slice();
  for (let i = 2; i < a.length; i++) {
    if (a[i].level && a[i].level === a[i - 1].level && a[i].level === a[i - 2].level) {
      const k = a.findIndex((x, j) => j > i && x.level !== a[i].level);
      if (k > 0) [a[i], a[k]] = [a[k], a[i]];
    }
  }
  return a;
}

/** 객관식·빈칸의 문제 순서를 섞고, 객관식 정답 위치를 고르게 흩습니다 */
export function mixQuiz(mc, fb) {
  const rng = makeRng([...mc.map((q) => q.question), ...fb.map((q) => q.question)].join('|'));
  let m = spreadLevels(shuffled(mc, rng)).map((q) => ({ ...q }));
  // 정답 위치: 보기 순서를 바꿔도 되는 문제는 0~3 번에 돌아가며 배정합니다 (같은 번호가 세 번 연속 나오지 않게)
  const free = m.map((q, i) => (optionsOrderFree(q.options) ? i : -1)).filter((i) => i >= 0);
  const targets = shuffled(free.map((_, k) => k % 4), rng);
  free.forEach((qi, k) => {
    const q = m[qi];
    let t = targets[k] % q.options.length;
    // 앞 두 문제와 같은 번호면 다른 번호로
    const prev = [m[qi - 1], m[qi - 2]].filter(Boolean);
    if (prev.length === 2 && prev[0].answer_index === t && prev[1].answer_index === t) t = (t + 1) % q.options.length;
    if (t !== q.answer_index) {
      const o = q.options.slice();
      [o[t], o[q.answer_index]] = [o[q.answer_index], o[t]];
      q.options = o;
      q.answer_index = t;
    }
  });
  return { mc: m, fb: shuffled(fb, rng) };
}
