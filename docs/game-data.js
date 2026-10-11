// 말씀결 게임: 규칙 · 여정 · 아이템 목록
// 가격(price) · 칸(slot) · 얻는 방법(src) 은 apps-script/Code.gs 의 GAME_ITEMS 와 같아야 합니다 (npm test 가 확인합니다).
// src: start = 처음부터 있음 · shop = 달란트로 구입 · journey = 여정에서 받음

const GAME_RULES = {
  // 문제 하나 맞힐 때: 경험치(XP, 레벨·순위용) / 달란트(상점에서 쓰는 돈)
  xp: { mc: 4, blank: 6, perfect: 20, stamp: 20, reflect: 10, read: 15 },
  talent: { mc: 2, blank: 3, perfect: 15, stamp: 10, reflect: 5, read: 8, week: 50, comeback: 20 },
  passRate: 0.5, // 절반 이상 맞혀야 그날 도장
  dailyScored: 2, // 하루에 점수를 받는 퀘스트(설교) 수
  freezePrice: 120, // 안식 쿠폰: 하루 쉬어도 연속 기록 유지
  freezeMax: 2,
};
// 퀘스트 점수 (가족끼리 겨루는 점수): 정답 + 빠른 정답 + 연속 정답 + 만점.
// 서버(Code.gs)가 같은 식으로 다시 계산해서 저장하니까, 화면에서 보이는 점수와 순위가 같습니다 (npm test 가 확인합니다).
const QUEST_SCORE = {
  base: 100, // 정답 하나
  speedMax: 50, // 빠른 정답 보너스 (speedFast 안에 맞히면 최대, limit 에 가까울수록 0)
  speedFast: 3000,
  limitMc: 20000, // 객관식은 20초, 빈칸은 30초 안에 맞혀야 속도 보너스가 남아 있어요
  limitBlank: 30000,
  minMs: 1000, // 이보다 빨라도 1초로 쳐요
  maxMs: 120000,
  comboStep: 10, // 연속 정답 보너스: 2연속 +10, 3연속 +20 … (최대 comboCap 단계)
  comboCap: 5,
  perfect: 300, // 만점 보너스
};
/** 문제 하나의 점수 (틀리면 0). combo = 이 문제까지 이어진 연속 정답 수 */
function questPoints(ok, ms, kind, combo) {
  if (!ok) return { base: 0, speed: 0, combo: 0 };
  const Q = QUEST_SCORE;
  const t = Math.min(Q.maxMs, Math.max(Q.minMs, Math.round(Number(ms) || Q.maxMs)));
  const limit = kind === 'fb' ? Q.limitBlank : Q.limitMc;
  const speed = t <= Q.speedFast ? Q.speedMax : t >= limit ? 0 : Math.round((Q.speedMax * (limit - t)) / (limit - Q.speedFast));
  return { base: Q.base, speed, combo: combo >= 2 ? Q.comboStep * Math.min(combo - 1, Q.comboCap) : 0 };
}
/** oks: 문제별 정답 여부, msList: 문제별 걸린 시간(ms), kinds: 'mc' | 'fb' */
function questScore(oks, msList, kinds) {
  let combo = 0;
  const out = { base: 0, speed: 0, combo: 0, perfect: 0, total: 0, ms: 0, right: 0 };
  oks.forEach((ok, i) => {
    combo = ok ? combo + 1 : 0;
    const p = questPoints(ok, msList[i], kinds[i], combo);
    out.base += p.base;
    out.speed += p.speed;
    out.combo += p.combo;
    out.right += ok ? 1 : 0;
    out.ms += Math.min(QUEST_SCORE.maxMs, Math.max(QUEST_SCORE.minMs, Math.round(Number(msList[i]) || QUEST_SCORE.maxMs)));
  });
  if (oks.length && out.right === oks.length) out.perfect = QUEST_SCORE.perfect;
  out.total = out.base + out.speed + out.combo + out.perfect;
  return out;
}
/** 점수 등급: 이론상 최고점 대비 */
function questMaxScore(n) {
  const Q = QUEST_SCORE;
  let combo = 0;
  for (let i = 2; i <= n; i++) combo += Q.comboStep * Math.min(i - 1, Q.comboCap);
  return n * (Q.base + Q.speedMax) + combo + (n ? Q.perfect : 0);
}
function questGrade(total, n) {
  const r = n ? total / questMaxScore(n) : 0;
  return r >= 0.8 ? 'S' : r >= 0.65 ? 'A' : r >= 0.45 ? 'B' : 'C';
}

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

// 성경 66권: [교회 앱 bookID, 이름, 장 수, 줄임]
const BIBLE_BOOKS = [
  ['01', '창세기', 50, '창'], ['02', '출애굽기', 40, '출'], ['03', '레위기', 27, '레'], ['04', '민수기', 36, '민'], ['05', '신명기', 34, '신'],
  ['06', '여호수아', 24, '수'], ['07', '사사기', 21, '삿'], ['08', '룻기', 4, '룻'], ['09', '사무엘상', 31, '삼상'], ['10', '사무엘하', 24, '삼하'],
  ['11', '열왕기상', 22, '왕상'], ['12', '열왕기하', 25, '왕하'], ['13', '역대상', 29, '대상'], ['14', '역대하', 36, '대하'], ['15', '에스라', 10, '스'],
  ['16', '느헤미야', 13, '느'], ['17', '에스더', 10, '에'], ['18', '욥기', 42, '욥'], ['19', '시편', 150, '시'], ['20', '잠언', 31, '잠'],
  ['21', '전도서', 12, '전'], ['22', '아가', 8, '아'], ['23', '이사야', 66, '사'], ['24', '예레미야', 52, '렘'], ['25', '예레미야애가', 5, '애'],
  ['26', '에스겔', 48, '겔'], ['27', '다니엘', 12, '단'], ['28', '호세아', 14, '호'], ['29', '요엘', 3, '욜'], ['30', '아모스', 9, '암'],
  ['31', '오바댜', 1, '옵'], ['32', '요나', 4, '욘'], ['33', '미가', 7, '미'], ['34', '나훔', 3, '나'], ['35', '하박국', 3, '합'],
  ['36', '스바냐', 3, '습'], ['37', '학개', 2, '학'], ['38', '스가랴', 14, '슥'], ['39', '말라기', 4, '말'],
  ['40', '마태복음', 28, '마'], ['41', '마가복음', 16, '막'], ['42', '누가복음', 24, '눅'], ['43', '요한복음', 21, '요'], ['44', '사도행전', 28, '행'],
  ['45', '로마서', 16, '롬'], ['46', '고린도전서', 16, '고전'], ['47', '고린도후서', 13, '고후'], ['48', '갈라디아서', 6, '갈'], ['49', '에베소서', 6, '엡'],
  ['50', '빌립보서', 4, '빌'], ['51', '골로새서', 4, '골'], ['52', '데살로니가전서', 5, '살전'], ['53', '데살로니가후서', 3, '살후'], ['54', '디모데전서', 6, '딤전'],
  ['55', '디모데후서', 4, '딤후'], ['56', '디도서', 3, '딛'], ['57', '빌레몬서', 1, '몬'], ['58', '히브리서', 13, '히'], ['59', '야고보서', 5, '약'],
  ['60', '베드로전서', 5, '벧전'], ['61', '베드로후서', 3, '벧후'], ['62', '요한일서', 5, '요일'], ['63', '요한이서', 1, '요이'], ['64', '요한삼서', 1, '요삼'],
  ['65', '유다서', 1, '유'], ['66', '요한계시록', 22, '계'],
];
const BIBLE_TOTAL = BIBLE_BOOKS.reduce((n, b) => n + b[2], 0); // 1189
// 일독표 칸 이름: "41:10" = 마가복음 10장
const chapterKey = (bookId, chapter) => `${Number(bookId)}:${Number(chapter)}`;

const SLOT_LABELS = { skin: '피부', hair: '머리 모양', hairColor: '머리 색', robe: '옷', head: '머리 장식', handR: '오른손', handL: '왼손', chest: '가슴', belt: '허리', feet: '신', pet: '동물 친구', bg: '배경' };
const RARITY_LABELS = { common: '일반', rare: '희귀', epic: '보물', legend: '전설' };

// [id, slot, 이름, 가격, src, 희귀도, 설명, 조건]
// 조건(need): 'lv10' = 레벨 10부터 살 수 있음 · 'b:perfect10' = 그 업적을 받아야 살 수 있음
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
  // ---- 새 머리 모양 ----
  ['hair_pony', 'hair', '포니테일', 80, 'shop', 'common', '높이 묶어 찰랑이는 말총머리'],
  ['hair_side', 'hair', '옆 가르마', 80, 'shop', 'common', '단정하게 넘긴 신사 머리'],
  ['hair_twin', 'hair', '양갈래 머리', 120, 'shop', 'rare', '리본으로 묶은 발랄한 양갈래'],
  ['hair_odango', 'hair', '양쪽 올림머리', 120, 'shop', 'rare', '동글동글 귀여운 쌍둥이 번'],
  ['hair_braid', 'hair', '옆으로 땋은 머리', 150, 'shop', 'rare', '어깨로 길게 내린 한 갈래 땋은 머리'],
  ['hair_wave', 'hair', '긴 웨이브', 180, 'shop', 'rare', '물결처럼 풍성한 긴 머리'],
  ['hair_princess', 'hair', '공주님 롤 컬', 300, 'shop', 'epic', '돌돌 말린 우아한 롤 컬', 'lv5'],
  // ---- 새 머리 색 ----
  ['midnight', 'hairColor', '밤하늘 남색', 60, 'shop', 'common', ''],
  ['rose', 'hairColor', '로즈 핑크', 80, 'shop', 'rare', '샤론의 꽃처럼 (아 2:1)'],
  ['lavender', 'hairColor', '라벤더', 80, 'shop', 'rare', ''],
  ['platinum', 'hairColor', '백금', 150, 'shop', 'epic', '정금처럼 빛나는 머리', 'lv5'],
  // ---- 새 옷 ----
  ['robe_pink', 'robe', '벚꽃 원피스', 150, 'shop', 'rare', '봄날 같은 분홍 원피스'],
  ['robe_kitty', 'robe', '고양이 발자국 옷', 220, 'shop', 'rare', '말랑한 발바닥 무늬가 콕콕'],
  ['robe_pearl', 'robe', '진주 드레스', 500, 'shop', 'epic', '“값진 진주 하나를 발견하매” (마 13:46)', 'lv8'],
  ['robe_royal', 'robe', '왕실 벨벳 망토', 650, 'shop', 'epic', '흰 털로 두른 자주빛 왕의 망토', 'lv10'],
  ['robe_gold', 'robe', '솔로몬의 금실 예복', 1200, 'shop', 'legend', '“솔로몬의 모든 영광으로도” (마 6:29)', 'lv15'],
  // ---- 새 머리 장식 ----
  ['ribbon', 'head', '큰 리본', 90, 'shop', 'common', '머리 위에 사뿐히 얹은 리본'],
  ['star_pin', 'head', '별 머리핀', 120, 'shop', 'common', '반짝이는 별 두 개'],
  ['kitty_band', 'head', '고양이 귀 머리띠', 160, 'shop', 'rare', '쫑긋 세운 아기 고양이 귀'],
  ['tiara_pearl', 'head', '진주 티아라', 450, 'shop', 'epic', '진주와 다이아몬드가 박힌 티아라', 'lv8'],
  ['crown_ruby', 'head', '루비 왕관', 700, 'shop', 'epic', '“현숙한 여인… 그 값은 진주보다 더 하니라” (잠 31:10)', 'lv10'],
  ['crown_diamond', 'head', '다이아몬드 왕관', 1500, 'shop', 'legend', '만점 10번을 이룬 사람만 쓸 수 있는 왕관', 'b:perfect10'],
  // ---- 보석 · 장신구 (가슴) ----
  ['neck_pearl', 'chest', '진주 목걸이', 300, 'shop', 'rare', '동글동글 하얀 진주 한 줄'],
  ['neck_ruby', 'chest', '루비 펜던트', 550, 'shop', 'epic', '하트 모양 루비와 금 사슬', 'lv8'],
  ['breastplate', 'chest', '대제사장의 흉패', 1300, 'shop', 'legend', '열두 보석에 열두 지파의 이름을 (출 28:21)', 'lv12'],
  // ---- 손 ----
  ['bouquet', 'handR', '들꽃 다발', 140, 'shop', 'common', '들의 백합화를 한 아름'],
  ['harp', 'handR', '다윗의 수금', 450, 'shop', 'epic', '“다윗이 수금을 들고 손으로 탄즉” (삼상 16:23)', 'lv8'],
  ['scepter', 'handR', '보석 홀', 1100, 'shop', 'legend', '“왕이 손에 잡았던 금 규를 내미니” (에 5:2)', 'lv12'],
  ['alabaster', 'handL', '향유 옥합', 320, 'shop', 'rare', '지극히 비싼 향유 한 옥합 (막 14:3)'],
  ['kitty_bag', 'handL', '고양이 핸드백', 260, 'shop', 'rare', '고양이 얼굴 모양 작은 가방'],
  // ---- 신 ----
  ['shoe_ribbon', 'feet', '리본 구두', 120, 'shop', 'common', '앞코에 리본이 달린 구두'],
  ['shoe_gold', 'feet', '금빛 샌들', 400, 'shop', 'epic', '“좋은 소식을 전하는 자의 발이여” (사 52:7)', 'lv8'],
  // ---- 동물 친구 ----
  ['pet_kitten', 'pet', '아기 고양이', 300, 'shop', 'rare', '방울 목걸이를 단 치즈색 아기 고양이'],
  ['pet_kitten_gray', 'pet', '회색 아기 고양이', 300, 'shop', 'rare', '하늘빛 리본 목걸이를 한 회색 고양이'],
  ['pet_peacock', 'pet', '솔로몬의 공작', 650, 'shop', 'epic', '다시스의 배가 실어 온 공작 (왕상 10:22)', 'lv10'],
  ['pet_lion', 'pet', '유다 지파의 사자', 1400, 'shop', 'legend', '“유다 지파의 사자 다윗의 뿌리가 이기었으니” (계 5:5)', 'lv15'],
  // ---- 배경 ----
  ['bg_sakura', 'bg', '벚꽃 길', 180, 'shop', 'rare', ''],
  ['bg_kitty', 'bg', '고양이 놀이방', 200, 'shop', 'rare', '털실 뭉치와 쿠션이 가득'],
  ['bg_palace', 'bg', '솔로몬의 궁전', 600, 'shop', 'epic', '금으로 입힌 상아 보좌 (왕상 10:18)', 'lv10'],
  ['bg_jerusalem', 'bg', '새 예루살렘', 1600, 'shop', 'legend', '“그 성의 성곽은 각색 보석으로 꾸몄는데” (계 21:19)', 'lv15'],
];
// 전신갑주 장비 18개 (여정에서 받음)
ARMOR_ORDER.forEach(([piece, name, ref]) => {
  const slot = { belt: 'belt', chest: 'chest', feet: 'feet', shield: 'handL', helmet: 'head', sword: 'handR' }[piece];
  TIER_NAMES.forEach(([tier, tname], ti) => GAME_ITEM_LIST.push([`${piece}_${tier}`, slot, `${name} (${tname})`, 0, 'journey', ti === 2 ? 'legend' : ti === 1 ? 'rare' : 'common', `${ref}`]));
});
const GAME_ITEMS = Object.fromEntries(GAME_ITEM_LIST.map(([id, slot, name, price, src, rarity, desc, need = '']) => [id, { id, slot, name, price, src, rarity, desc, need }]));

/** 살 수 있는 조건을 채웠나요? (조건이 없으면 true) */
function itemNeedMet(need, { level = 1, badges = [] } = {}) {
  if (!need) return true;
  const lv = /^lv(\d+)$/.exec(need);
  if (lv) return level >= Number(lv[1]);
  const b = /^b:(\w+)$/.exec(need);
  if (b) return badges.includes(b[1]);
  return false;
}
function itemNeedLabel(need) {
  const lv = /^lv(\d+)$/.exec(need || '');
  if (lv) return `Lv.${lv[1]}부터`;
  const b = /^b:(\w+)$/.exec(need || '');
  if (b) {
    const badge = BADGES.find(([id]) => id === b[1]);
    return `업적 「${badge ? badge[1] : b[1]}」 필요`;
  }
  return '';
}
/** 모은 아이템 수 (처음부터 있던 것은 빼고) */
const COLLECTIBLE_IDS = GAME_ITEM_LIST.filter(([, , , , src]) => src !== 'start').map(([id]) => id);
const collectedCount = (inv) => COLLECTIBLE_IDS.filter((id) => (inv || []).includes(id)).length;

// 이번 주 특가: 매주 월요일 바뀌는 할인 3개 (일반·희귀 2개 30% · 보물·전설 1개 20%).
// 서버도 같은 순서·같은 계산으로 값을 정합니다 (npm test 가 확인합니다).
const DEAL_RULES = { small: 2, smallOff: 30, big: 1, bigOff: 20 };
const DEAL_POOL_SMALL = GAME_ITEM_LIST.filter(([, , , price, src, rarity]) => src === 'shop' && price > 0 && (rarity === 'common' || rarity === 'rare')).map(([id]) => id);
const DEAL_POOL_BIG = GAME_ITEM_LIST.filter(([, , , price, src, rarity]) => src === 'shop' && price > 0 && (rarity === 'epic' || rarity === 'legend')).map(([id]) => id);
function dealHash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}
function dealPick(pool, n, seed) {
  const out = [];
  let k = 0;
  while (out.length < Math.min(n, pool.length) && k < 50) {
    const id = pool[(seed + k * 7919) % pool.length];
    if (!out.includes(id)) out.push(id);
    k += 1;
  }
  return out;
}
/** weekKey(월요일 날짜 yyyy-mm-dd) → { 아이템 id: 할인율(%) } */
function weeklyDeals(weekKey) {
  const seed = dealHash(String(weekKey || ''));
  const out = {};
  dealPick(DEAL_POOL_SMALL, DEAL_RULES.small, seed).forEach((id) => (out[id] = DEAL_RULES.smallOff));
  dealPick(DEAL_POOL_BIG, DEAL_RULES.big, seed >>> 3).forEach((id) => (out[id] = DEAL_RULES.bigOff));
  return out;
}
const dealPrice = (price, off) => (off ? Math.max(5, Math.round((price * (100 - off)) / 100 / 5) * 5) : price);
/** 그 날짜가 속한 주의 월요일 (서버 gameWeekKey 와 같음) */
function weekKeyOf(day) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day || ''));
  if (!m) return '';
  const n = Math.round(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86400000);
  const dow = (new Date(n * 86400000).getUTCDay() + 6) % 7;
  return new Date((n - dow) * 86400000).toISOString().slice(0, 10);
}

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
  ['read7', '말씀의 한 주', '말씀 읽기 7일', 60],
  ['read30', '말씀의 한 달', '말씀 읽기 30일', 200],
  ['nt', '신약 완독', '신약 27권을 모두 읽었어요', 300],
  ['bible', '성경 일독', '성경 66권을 모두 읽었어요', 1000],
  ['journey1', '첫 여정 완주', '여정 하나를 끝까지', 100],
  ['journey3', '세 여정 완주', '여정 세 개를 모두 완주', 300],
  ['collect10', '꾸미기 시작', '아이템 10개 모으기', 50],
  ['collect25', '보물 수집가', '아이템 25개 모으기', 150],
  ['collect50', '보물 창고', '아이템 50개 모으기', 400],
  ['treasure1', '첫 보물', '보물·전설 아이템 갖기', 80],
];

// 서버(Code.gs)에 넣는 설정 묶음 — scripts/game-conf.mjs 가 이 함수로 만들어 Code.gs 에 붙여 넣습니다
function gameServerConf() {
  return {
    rules: GAME_RULES,
    score: QUEST_SCORE,
    streak: STREAK_BONUS,
    journeys: Object.fromEntries(JOURNEY_KEYS.map((k) => [k, { steps: JOURNEYS[k].steps, xpPerStep: JOURNEYS[k].xpPerStep, title: JOURNEYS[k].title, rewards: JOURNEYS[k].rewards }])),
    armor: Array.from({ length: 18 }, (_, i) => armorItemAt(i + 1)),
    items: Object.fromEntries(GAME_ITEM_LIST.map(([id, slot, , price, src, , , need = '']) => [id, need ? [slot, price, src, need] : [slot, price, src]])),
    collectible: COLLECTIBLE_IDS,
    treasures: GAME_ITEM_LIST.filter(([, , , , , rarity]) => rarity === 'epic' || rarity === 'legend').map(([id]) => id),
    deals: { rules: DEAL_RULES, small: DEAL_POOL_SMALL, big: DEAL_POOL_BIG },
    look: DEFAULT_LOOK,
    badges: BADGES.map(([id, , , reward]) => [id, reward]),
    levelTitles: LEVEL_TITLES,
    bible: BIBLE_BOOKS.map(([, , n]) => n),
  };
}
