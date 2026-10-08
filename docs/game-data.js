// 말씀결 게임: 규칙 · 여정 · 아이템 목록
// 가격(price) · 칸(slot) · 얻는 방법(src) 은 apps-script/Code.gs 의 GAME_ITEMS 와 같아야 합니다 (npm test 가 확인합니다).
// src: start = 처음부터 있음 · shop = 달란트로 구입 · journey = 여정에서 받음

const GAME_RULES = {
  // 문제 하나 맞힐 때: 경험치(XP, 레벨·순위용) / 달란트(상점에서 쓰는 돈)
  xp: { mc: 4, blank: 6, perfect: 20, stamp: 20, reflect: 10 },
  talent: { mc: 2, blank: 3, perfect: 15, stamp: 10, reflect: 5, week: 50, comeback: 20 },
  passRate: 0.5, // 절반 이상 맞혀야 그날 도장
  dailyScored: 2, // 하루에 점수를 받는 퀘스트(설교) 수
  freezePrice: 120, // 안식 쿠폰: 하루 쉬어도 연속 기록 유지
  freezeMax: 2,
};
// 연속 일수 → 달란트 배수
const STREAK_BONUS = [
  [30, 2],
  [14, 1.7],
  [7, 1.5],
  [3, 1.2],
  [1, 1],
];
const streakMult = (days) => (STREAK_BONUS.find(([d]) => days >= d) || [1, 1])[1];

// 레벨: Lv L 이 되려면 누적 경험치 50·L·(L-1)
const levelOf = (xp) => Math.max(1, Math.floor((1 + Math.sqrt(1 + (8 * Math.max(0, xp)) / 100)) / 2));
const levelXp = (lv) => 50 * lv * (lv - 1);
const LEVEL_TITLES = [
  [30, '반석'],
  [20, '등대'],
  [15, '일꾼'],
  [10, '제자'],
  [5, '순례자'],
  [1, '새싹'],
];
const levelTitle = (lv) => (LEVEL_TITLES.find(([n]) => lv >= n) || [1, '새싹'])[1];

const ARMOR_ORDER = [
  ['belt', '진리의 허리띠', '엡 6:14'],
  ['chest', '의의 호심경', '엡 6:14'],
  ['feet', '평안의 복음의 신', '엡 6:15'],
  ['shield', '믿음의 방패', '엡 6:16'],
  ['helmet', '구원의 투구', '엡 6:17'],
  ['sword', '성령의 검', '엡 6:17'],
];
const TIER_NAMES = [
  ['bronze', '청동'],
  ['silver', '은'],
  ['gold', '금'],
];

// 여정: 하나를 골라 진행하고, 끝나면 다른 여정을 고를 수 있습니다. 경험치를 얻을 때마다 고른 여정이 함께 나아갑니다.
const JOURNEYS = {
  pilgrim: {
    name: '천로역정 순례길',
    short: '순례길',
    verse: '“너희는 좁은 문으로 들어가라” (마 7:13)',
    desc: '멸망의 도시를 떠나 천성까지, 열두 곳을 지나는 순례자의 길입니다.',
    steps: 11,
    xpPerStep: 160,
    title: '천성에 이른 순례자',
    rewards: { 1: 'staff', 3: 'scroll', 4: 'robe_linen', 6: 'lamp', 11: 'laurel' },
  },
  armor: {
    name: '하나님의 전신갑주',
    short: '전신갑주',
    verse: '“하나님의 전신갑주를 입으라” (엡 6:11)',
    desc: '진리의 허리띠부터 성령의 검까지 여섯 장비를 청동 → 은 → 금으로 갖춥니다.',
    steps: 18,
    xpPerStep: 100,
    title: '믿음의 용사',
    rewards: { 18: 'bg_stars' },
  },
  tree: {
    name: '시냇가에 심은 나무',
    short: '나무',
    verse: '“시냇가에 심은 나무가 철을 따라 열매를 맺으며” (시 1:3)',
    desc: '씨앗이 큰 나무로 자라고, 성령의 아홉 열매가 하나씩 열립니다.',
    steps: 13,
    xpPerStep: 140,
    title: '열매 맺는 나무',
    rewards: { 4: 'bg_garden', 13: 'halo_flower' },
  },
};
const JOURNEY_KEYS = Object.keys(JOURNEYS);

// 전신갑주 여정의 n번째 단계(1~18)에 받는 장비 id
function armorItemAt(step) {
  const i = step - 1;
  const [piece] = ARMOR_ORDER[i % 6];
  const [tier] = TIER_NAMES[Math.floor(i / 6)];
  return `${piece}_${tier}`;
}

const SLOT_LABELS = { skin: '피부', hair: '머리 모양', hairColor: '머리 색', robe: '옷', head: '머리 장식', handR: '오른손', handL: '왼손', chest: '가슴', belt: '허리', feet: '신', pet: '동물 친구', bg: '배경' };
const RARITY_LABELS = { common: '일반', rare: '희귀', legend: '전설' };

// [id, slot, 이름, 가격, src, 희귀도, 설명]
const GAME_ITEM_LIST = [
  ['s1', 'skin', '밝은 피부', 0, 'start', 'common', ''],
  ['s2', 'skin', '따뜻한 피부', 0, 'start', 'common', ''],
  ['s3', 'skin', '구릿빛 피부', 0, 'start', 'common', ''],
  ['hair_short', 'hair', '짧은 머리', 0, 'start', 'common', ''],
  ['hair_bob', 'hair', '단발머리', 0, 'start', 'common', ''],
  ['hair_long', 'hair', '긴 머리', 0, 'start', 'common', ''],
  ['hair_bun', 'hair', '올림머리', 0, 'start', 'common', ''],
  ['hair_curly', 'hair', '곱슬머리', 60, 'shop', 'common', '보글보글 사랑스러운 곱슬머리'],
  ['hair_spiky', 'hair', '삐죽머리', 60, 'shop', 'common', '씩씩한 개구쟁이 머리'],
  ['black', 'hairColor', '검은색', 0, 'start', 'common', ''],
  ['brown', 'hairColor', '갈색', 0, 'start', 'common', ''],
  ['gray', 'hairColor', '은빛', 40, 'shop', 'common', '“백발은 영화의 면류관” (잠 16:31)'],
  ['auburn', 'hairColor', '적갈색', 40, 'shop', 'common', ''],
  ['blond', 'hairColor', '금빛', 40, 'shop', 'common', ''],
  ['robe_brown', 'robe', '순례자의 겉옷', 0, 'start', 'common', '먼 길을 떠나는 순례자의 옷'],
  ['robe_blue', 'robe', '하늘빛 겉옷', 80, 'shop', 'common', ''],
  ['robe_green', 'robe', '들판빛 겉옷', 80, 'shop', 'common', ''],
  ['robe_red', 'robe', '붉은 겉옷', 120, 'shop', 'common', ''],
  ['robe_purple', 'robe', '자색 옷', 200, 'shop', 'rare', '자색 옷감 장사 루디아를 떠올리며 (행 16:14)'],
  ['robe_star', 'robe', '별빛 겉옷', 400, 'shop', 'legend', '“하늘을 우러러 뭇별을 셀 수 있나 보라” (창 15:5)'],
  ['robe_linen', 'robe', '흰 세마포 옷', 0, 'journey', 'rare', '순례길 십자가 언덕에서 받는 새 옷 (계 19:8)'],
  ['straw_hat', 'head', '밀짚모자', 100, 'shop', 'common', '들판의 백합화처럼 (마 6:28)'],
  ['scarf', 'head', '목자의 두건', 120, 'shop', 'common', '양을 치는 목자의 두건'],
  ['laurel', 'head', '썩지 않을 면류관', 0, 'journey', 'legend', '순례길 끝 천성에서 받는 면류관 (고전 9:25)'],
  ['halo_flower', 'head', '열매의 꽃관', 0, 'journey', 'legend', '아홉 열매를 다 맺으면 받는 꽃관'],
  ['staff', 'handR', '순례자의 지팡이', 0, 'journey', 'common', '좁은 문을 지나면 받는 지팡이'],
  ['scroll', 'handR', '말씀 두루마리', 0, 'journey', 'rare', '해석자의 집에서 받는 두루마리'],
  ['lamp', 'handL', '말씀의 등불', 0, 'journey', 'rare', '“주의 말씀은 내 발에 등이요” (시 119:105)'],
  ['pet_fish', 'pet', '작은 물고기', 150, 'shop', 'common', '오병이어의 그 물고기'],
  ['pet_lamb', 'pet', '어린 양', 250, 'shop', 'rare', '“선한 목자는 양들을 위하여” (요 10:11)'],
  ['pet_dove', 'pet', '비둘기', 300, 'shop', 'rare', '감람나무 잎을 물고 온 비둘기 (창 8:11)'],
  ['pet_donkey', 'pet', '아기 나귀', 350, 'shop', 'rare', '예루살렘으로 들어가신 그 나귀 (요 12:14)'],
  ['bg_dawn', 'bg', '광야의 새벽', 80, 'shop', 'common', ''],
  ['bg_galilee', 'bg', '갈릴리 호숫가', 120, 'shop', 'common', ''],
  ['bg_rainbow', 'bg', '노아의 무지개', 200, 'shop', 'rare', '“내가 내 무지개를 구름 속에 두었나니” (창 9:13)'],
  ['bg_zion', 'bg', '시온의 언덕', 300, 'shop', 'rare', ''],
  ['bg_garden', 'bg', '열매의 동산', 0, 'journey', 'rare', '나무가 다 자라면 받는 동산'],
  ['bg_stars', 'bg', '아브라함의 별밤', 0, 'journey', 'legend', '전신갑주를 모두 금으로 갖추면 받는 별밤'],
];
// 전신갑주 장비 18개 (여정에서 받음)
ARMOR_ORDER.forEach(([piece, name, ref]) => {
  const slot = { belt: 'belt', chest: 'chest', feet: 'feet', shield: 'handL', helmet: 'head', sword: 'handR' }[piece];
  TIER_NAMES.forEach(([tier, tname], ti) => GAME_ITEM_LIST.push([`${piece}_${tier}`, slot, `${name} (${tname})`, 0, 'journey', ti === 2 ? 'legend' : ti === 1 ? 'rare' : 'common', `${ref}`]));
});
const GAME_ITEMS = Object.fromEntries(GAME_ITEM_LIST.map(([id, slot, name, price, src, rarity, desc]) => [id, { id, slot, name, price, src, rarity, desc }]));

const DEFAULT_LOOK = { skin: 's1', hair: 'hair_short', hairColor: 'black', robe: 'robe_brown', head: '', handR: '', handL: '', chest: '', belt: '', feet: '', pet: '', bg: '' };

// 업적: [id, 이름, 설명, 보상 달란트]
const BADGES = [
  ['first', '첫 걸음', '첫 퀘스트를 마쳤어요', 20],
  ['streak3', '사흘 연속', '3일 연속 도장', 30],
  ['streak7', '한 주 완주', '7일 연속 도장', 60],
  ['streak30', '한 달의 순례', '30일 연속 도장', 200],
  ['perfect1', '만점!', '퀘스트 하나를 모두 맞혔어요', 30],
  ['perfect10', '말씀 박사', '만점 10번', 150],
  ['quests10', '열 번의 퀘스트', '퀘스트 10번 완료', 50],
  ['quests50', '오십 번의 퀘스트', '퀘스트 50번 완료', 200],
  ['reflect10', '묵상의 사람', '묵상 기록 10번', 60],
  ['journey1', '첫 여정 완주', '여정 하나를 끝까지', 100],
  ['journey3', '세 여정 완주', '여정 세 개를 모두 완주', 300],
];

// 서버(Code.gs)에 넣는 설정 묶음 — scripts/game-conf.mjs 가 이 함수로 만들어 Code.gs 에 붙여 넣습니다
function gameServerConf() {
  return {
    rules: GAME_RULES,
    streak: STREAK_BONUS,
    journeys: Object.fromEntries(JOURNEY_KEYS.map((k) => [k, { steps: JOURNEYS[k].steps, xpPerStep: JOURNEYS[k].xpPerStep, title: JOURNEYS[k].title, rewards: JOURNEYS[k].rewards }])),
    armor: Array.from({ length: 18 }, (_, i) => armorItemAt(i + 1)),
    items: Object.fromEntries(GAME_ITEM_LIST.map(([id, slot, , price, src]) => [id, [slot, price, src]])),
    look: DEFAULT_LOOK,
    badges: BADGES.map(([id, , , reward]) => [id, reward]),
    levelTitles: LEVEL_TITLES,
  };
}
