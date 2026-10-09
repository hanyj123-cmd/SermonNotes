#!/usr/bin/env node
// 화면 확인용 샘플(?demo)을 docs/data/sample/ 에 만듭니다. 실제 파이프라인(정규화 → 시트 행 → 내보내기)과 같은 코드를 지나므로
// 데이터 형식이 바뀌면 이 스크립트가 먼저 알려 줍니다.   node scripts/make-sample.mjs
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { normalizeReview, normalizeQt, normalizeStudy, normalizeGroup } from './lib/gemini.mjs';
import { exportJson, exportDaily, exportProverbs } from './sync.mjs';
import { normalizeDailyQt, normalizeDailyStudy, normalizeDailyQuiz, normalizeProverbWord, normalizeProverbGroup, normalizeProverbStudy } from './lib/gemini.mjs';
import { readingRefs } from './lib/daily.mjs';
import { parseScripture } from './lib/title.mjs';
import { BIBLE_SOURCES, bibleSignature } from './lib/bible-web.mjs';

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../docs/data/sample');

const para = (a, b) => [a, b];
const full = {
  id: 'sampleSun01',
  category: 'sunday',
  title: '[2026.10.04] 믿음으로 걷는 길 (창세기 12:1-9) - 홍길동 목사',
  date: '2026-10-04',
};

const review = {
  title: '믿음으로 걷는 길',
  scripture: ['창세기 12:1-9'],
  preacher: '홍길동 목사',
  theme: '아브람의 부르심은 목적지를 보여 주기 전에 하나님을 신뢰하라는 초대였다',
  summary_short: '하나님은 가야 할 곳을 다 보여 주시기 전에 먼저 “나를 따르라”고 부르시며, 믿음은 그 부르심에 한 걸음씩 순종하는 것입니다.',
  review: {
    outline: [
      { heading: '1. 떠나라는 부르심', scripture: '창 12:1', paragraphs: ['하나님은 아브람에게 고향과 친척과 아버지의 집을 떠나라고 말씀하십니다. 가야 할 땅은 “내가 네게 보여 줄 땅”이라고만 하십니다. 목적지가 구체적으로 주어지지 않았다는 것이 이 부르심의 핵심입니다.', '믿음은 지도를 다 받은 뒤에 출발하는 것이 아니라, 부르시는 분을 신뢰하며 먼저 걸음을 떼는 것입니다.'], key_summary: '믿음은 길 전체가 아니라 길을 여시는 분을 신뢰하는 것입니다.' },
      { heading: '2. 약속과 복', scripture: '창 12:2-3', paragraphs: ['하나님은 큰 민족, 복, 큰 이름을 약속하십니다. 그러나 복의 목적은 아브람 자신에게서 끝나지 않고 “땅의 모든 족속이 너로 말미암아 복을 얻는” 데 있습니다.', '택하심은 특권이기 전에 사명입니다. 복을 받은 자는 복의 통로로 부름받았습니다.'], key_summary: '복은 쌓아 두라고 주신 것이 아니라 흘려보내라고 주신 것입니다.' },
      { heading: '3. 순종의 걸음과 제단', scripture: '창 12:4-9', paragraphs: ['아브람은 “여호와의 말씀을 따라” 떠났고, 가는 곳마다 제단을 쌓았습니다. 순종은 한 번의 결단이 아니라 이동하는 삶 전체에서 하나님을 예배하는 것으로 이어집니다.'], key_summary: '순종하는 사람은 머무는 곳마다 예배의 자리를 세웁니다.' },
    ],
    summary: '아브람의 부르심은 목적지를 설명하는 말씀이 아니라 부르시는 분을 신뢰하라는 초대였습니다.\n\n하나님은 약속으로 믿음을 일으키시고, 그 복을 열방에 흘려보내도록 사명을 주십니다. 믿음의 사람은 걸음마다 제단을 쌓으며 하나님을 예배합니다.',
    gospel_connection: '아브람을 통해 약속된 복은 마침내 그의 후손 예수 그리스도 안에서 모든 민족에게 흘러갑니다.',
  },
  caveats: '샘플 데이터입니다. 실제 내용은 동기화 후 AI가 만든 정리로 바뀝니다.',
};

const songs = [
  { title: '내 주는 강한 성이요', artist: '찬송가 585장', kind: '찬송가', reason: '하나님을 신뢰하며 나아가는 믿음의 길에 어울리는 찬송입니다.' },
  { title: '주의 길을 걸으리라', artist: '샘플 아티스트', kind: 'CCM', reason: '부르심에 순종하는 마음을 고백하는 곡입니다.' },
];
const qt = {
  opening_prayer: '하나님 아버지, 고요한 이 시간 말씀 앞에 앉았습니다.\n\n제 생각과 계획을 내려놓고, 부르시는 음성에 귀를 기울이게 하여 주시고 말씀이 제 마음 깊은 곳에 닿게 하옵소서. 예수님의 이름으로 기도합니다. 아멘.',
  songs,
  outline: [
    { heading: '1. 나를 부르시는 하나님', scripture: '창 12:1', paragraphs: ['오늘 나에게도 “떠나라”고 하시는 영역이 있는지 조용히 살펴봅니다. 익숙함과 안전을 붙들고 있는 곳이 어디인지 하나님 앞에 정직하게 내어놓습니다.'], key_summary: '부르심 앞에서 먼저 할 일은 변명이 아니라 귀를 여는 일입니다.' },
    { heading: '2. 약속을 붙드는 믿음', scripture: '창 12:2-3', paragraphs: ['하나님의 약속은 나를 위한 위로이면서 동시에 다른 사람을 향한 사명입니다. 내가 받은 복을 누구에게 흘려보낼 수 있을지 묵상합니다.'], key_summary: '받은 복을 기억하면 순종의 두려움이 작아집니다.' },
  ],
  questions: [
    { question: '지금 내가 하나님께 “내려놓아야 한다”고 느끼는 것은 무엇입니까?', guide: '12:1의 “고향, 친척, 아버지의 집”이 아브람에게 안전과 정체성이었다는 점을 떠올리며, 내가 하나님보다 더 의지하는 것이 무엇인지 조용히 살펴보세요.', example: '저는 미래를 다 계산해 두어야 마음이 놓이는 사람입니다. 오늘 말씀 앞에서, 하나님보다 제 계획표를 더 믿어 왔다는 것을 고백합니다. 이번 주에는 걱정이 올라올 때마다 계획을 다시 짜는 대신 먼저 기도하겠습니다.' },
    { question: '아브람처럼 목적지를 모른 채 걸어야 했던 때가 있었다면, 그때 나를 붙든 것은 무엇이었습니까?', guide: '그때의 상황보다 “누가” 나를 붙들어 주셨는지에 초점을 맞춰 보세요. 기억나는 말씀이나 사람이 있다면 함께 적어 보세요.', example: '이직을 앞두고 아무것도 정해지지 않았던 몇 달이 있었습니다. 불안했지만 매일 아침 읽던 시편 말씀과 기도해 준 친구 덕분에 버틸 수 있었습니다. 돌아보니 길을 아는 것보다 함께하시는 하나님을 아는 것이 더 큰 힘이었습니다.' },
    { question: '내가 받은 복을 흘려보내야 할 사람은 누구입니까?', guide: '12:2-3의 “복이 될지라”를 떠올리며, 최근 내가 받은 구체적인 은혜 하나와 그것을 나눌 수 있는 한 사람을 연결해 보세요.', example: '요즘 건강을 회복한 것이 제게 큰 복입니다. 같은 병으로 힘들어하는 교회 집사님께 이번 주에 전화를 드려 제가 받은 위로를 나누고 함께 기도하겠습니다.' },
  ],
  applications: [
    { title: '이번 주 하나님께 순종할 한 가지 정하기', detail: '미루어 온 순종의 한 가지를 구체적으로 정하고 날짜를 적어 봅니다.' },
    { title: '매일 아침 3분 제단 쌓기', detail: '하루를 시작하기 전에 3분간 말씀을 읽고 기도하며 그날의 걸음을 하나님께 맡깁니다.' },
    { title: '복을 나누는 한 사람에게 연락하기', detail: '요즘 힘들어하는 지인에게 안부와 기도의 말을 전합니다.' },
  ],
  closing_prayer: '주님, 오늘 받은 말씀을 품고 한 걸음씩 순종하게 하옵소서. 걸음마다 제단을 쌓는 삶으로 인도하여 주옵소서. 아멘.',
};

const study = {
  opening_prayer: '성령님, 말씀의 뜻을 바르게 깨닫게 하시고 배운 것을 삶으로 살아내게 하옵소서. 아멘.',
  songs,
  deep_dive: [
    { heading: '1. “떠나라”(레크 레카)의 신학적 무게', scripture: '창 12:1', paragraphs: ['히브리어 “레크 레카”는 “너 자신을 위하여 가라”는 뜻으로 읽을 수 있어, 떠남이 곧 하나님이 준비하신 복의 자리로 가는 길임을 암시합니다. 개혁주의 신학은 이를 하나님의 일방적 은혜의 선택(소명, effectual calling)으로 이해합니다.', '아브람의 부르심은 그의 공로나 준비에 근거하지 않습니다. 우르에서 우상을 섬기던 가문(수 24:2)에서 그를 불러내신 것은 오직 하나님의 주권적 은혜입니다.'], key_summary: '부르심은 인간의 공로가 아닌 하나님의 주권적 은혜에서 시작됩니다.', word_notes: [{ word: '떠나라', original: '레크 레카', meaning: '“가라”는 명령형으로, 이후 “네게 보일 땅으로”라는 방향이 뒤따릅니다.' }, { word: '복', original: '베라카', meaning: '하나님이 주시는 생명과 번영의 선물을 가리킵니다.' }] },
    { heading: '2. 아브라함 언약의 구조', scripture: '창 12:2-3', paragraphs: ['땅, 자손, 복이라는 세 약속은 이후 창세기 15장과 17장에서 언약으로 확정됩니다. 합동과 통합 측 모두 이 언약을 구속사의 중심으로 보며, 갈라디아서 3장의 해석에 따라 그리스도 안에서 성취된다고 고백합니다.'], key_summary: '아브라함 언약은 그리스도 안에서 모든 민족에게 열린 복의 약속입니다.', word_notes: [] },
  ],
  summary: '아브람의 부르심은 인간의 준비와 상관없이 시작된 은혜의 사건이며, 그 약속은 아브라함 언약으로 확정되어 그리스도에게서 성취됩니다. 믿음은 이 은혜에 대한 응답입니다.',
  quiz: {
    multiple_choice: [
      { level: '쉬움', question: '아브람이 하란을 떠날 때 몇 세였습니까?', options: ['65세', '70세', '75세', '80세'], answer_index: 2, explanation: '창 12:4 “아브람이 하란을 떠날 때에 칠십오 세였더라”. 70세는 데라가 아브람을 낳은 나이(창 11:26)라 헷갈리기 쉽습니다.' },
      { level: '쉬움', question: '창 12:4-5에서 아브람과 함께 하란을 떠난 사람으로 이름이 나오는 이들은?', options: ['사래와 롯', '사래와 나홀', '롯과 데라', '하갈과 롯'], answer_index: 0, explanation: '아내 사래와 조카 롯이 함께 떠났습니다. 나홀은 형제, 데라는 하란에서 죽은 아버지, 하갈은 훗날 등장합니다.' },
      { level: '쉬움', question: '여호와께서 아브람에게 처음 나타나 “이 땅을 네 자손에게 주리라” 하신 곳은?', options: ['벧엘 동쪽 산', '헤브론 마므레', '하란', '세겜 땅 모레 상수리나무'], answer_index: 3, explanation: '창 12:6-7. 벧엘 동쪽 산은 그다음 장막을 친 곳, 마므레는 13장에 나옵니다.' },
      { level: '중간', question: '아브람이 벧엘 동쪽 산에 장막을 쳤을 때 그 동쪽에 있던 성읍은?', options: ['여리고', '아이', '세겜', '헤브론'], answer_index: 1, explanation: '창 12:8 “서쪽은 벧엘이요 동쪽은 아이라”.' },
      { level: '중간', question: '창 12:3에서 “너를 축복하는 자에게는” 바로 뒤에 이어지는 말씀은?', options: ['내가 큰 민족을 이루고', '내가 복을 내리고', '내가 네 이름을 창대하게 하리니', '내가 이 땅을 주리라'], answer_index: 1, explanation: '“너를 축복하는 자에게는 내가 복을 내리고 너를 저주하는 자에게는 내가 저주하리니”. 나머지는 12:2와 12:7의 표현입니다.' },
      { level: '중간', question: '설교에서 하나님이 목적지를 먼저 알려 주지 않으신 이유로 강조한 것은?', options: ['순종을 시험해 그만큼 상을 주시려고', '그 땅에 아직 가나안 사람이 살고 있어서', '아브람이 스스로 살 땅을 고르게 하시려고', '길 전체가 아니라 부르시는 분을 신뢰하게 하시려고'], answer_index: 3, explanation: '설교는 “믿음은 지도를 다 받은 뒤 출발하는 것이 아니라 부르시는 분을 신뢰하며 걸음을 떼는 것”이라고 했습니다.' },
      { level: '중간', question: '설교가 말한 “복”의 목적으로 가장 알맞은 것은?', options: ['땅의 모든 족속이 복을 얻도록 복의 통로가 되는 것', '아브람의 가문이 크게 번성해 이름을 남기는 것', '약속의 땅을 차지하고 그곳에서 안식하는 것', '이스라엘이 열방 위에 높아져 다스리는 것'], answer_index: 0, explanation: '“택하심은 특권이기 전에 사명”이며 복은 흘려보내라고 주신 것이라고 했습니다.' },
      { level: '중간', question: '아브람이 가는 곳마다 제단을 쌓은 것에 대해 설교가 강조한 의미는?', options: ['한 번의 결단으로 순종이 끝났다는 표시', '가나안 사람들에게 하나님을 알리는 전도', '이동하는 삶 전체에서 하나님을 예배하는 순종', '그 땅을 이미 소유했다는 법적 표시'], answer_index: 2, explanation: '“순종은 한 번의 결단이 아니라 이동하는 삶 전체에서 하나님을 예배하는 것으로 이어진다”고 했습니다.' },
      { level: '중간', question: '창 12:6이 “그때에 가나안 사람이 그 땅에 거주하였더라”고 덧붙인 의미로 알맞은 것은?', options: ['그 땅이 아직 비어 있어 곧 차지할 수 있었다', '아브람이 가나안 사람과 동맹을 맺었다', '가나안 사람이 아브람에게 땅을 내주었다', '약속의 땅에 이미 다른 민족이 있어 믿음으로 붙들어야 했다'], answer_index: 3, explanation: '약속은 눈앞의 현실과 달랐기에 아브람은 보이는 것이 아니라 약속을 믿고 머물러야 했습니다.' },
      { level: '어려움', question: '히브리어 “레크 레카”에 대한 공부 내용으로 맞는 것은?', options: ['“너 자신을 위하여 가라”로도 읽히는 명령', '“내가 너와 함께 가리라”는 동행의 약속', '“돌아오라”는 회개의 부르심', '“너는 복이 될지라”는 선언'], answer_index: 0, explanation: '“가라”는 명령형으로, 떠남이 하나님이 준비하신 복의 자리로 가는 길임을 암시합니다. “너는 복이 될지라”는 12:2의 다른 표현입니다.' },
      { level: '어려움', question: '여호수아 24:2이 알려 주는 아브람 부르심의 배경은?', options: ['이미 하나님을 경외하던 가문 출신이었다', '조상이 강 저편에서 다른 신들을 섬겼다', '멜기세덱에게서 하나님을 배웠다', '하란에 기근이 들어 떠날 수밖에 없었다'], answer_index: 1, explanation: '우상을 섬기던 가문에서 불러내신 것은 오직 하나님의 주권적 은혜임을 보여 줍니다.' },
      { level: '어려움', question: '창세기 12장의 세 약속(땅·자손·복)이 이후 언약으로 확정되는 곳으로 공부에서 든 장은?', options: ['13장과 14장', '11장과 16장', '15장과 17장', '22장과 24장'], answer_index: 2, explanation: '15장의 언약 체결과 17장의 할례 언약에서 확정됩니다.' },
      { level: '어려움', question: '갈라디아서 3장이 말하는 아브라함 언약의 성취로 맞는 것은?', options: ['약속된 자손은 그리스도이시며 믿는 자가 그 복을 받는다', '율법을 지키는 자가 아브라함의 참 자손이 된다', '할례받은 이스라엘만 그 복을 상속한다', '가나안 땅이 회복될 때 그 약속이 성취된다'], answer_index: 0, explanation: '갈 3:16, 29 — “그는 곧 그리스도라”, “너희가 그리스도의 것이면 곧 아브라함의 자손이요”.' },
      { level: '어려움', question: '개혁주의 신학에서 아브람의 부르심을 설명하는 용어와 뜻이 바르게 연결된 것은?', options: ['외적 부르심 — 아브람의 결단이 구원을 완성함', '일반 은총 — 모든 사람이 똑같이 받는 구원의 부르심', '선행 은총 — 사람이 먼저 준비하면 하나님이 응답하심', '유효한 부르심 — 하나님의 주권적 은혜가 실제로 응답하게 하심'], answer_index: 3, explanation: '유효한 부르심(소명)은 하나님이 은혜로 부르시고 그 부르심에 실제로 응답하게 하시는 일입니다.' },
      { level: '어려움', question: '아브람이 벧엘 동쪽에서 제단을 쌓은 뒤 옮겨 간 방향은?', options: ['북쪽 하란으로 돌아감', '점점 남방(네게브)으로 옮겨 감', '서쪽 바닷가로 내려감', '동쪽 요단 평지로 감'], answer_index: 1, explanation: '창 12:9 “점점 남방으로 옮겨 갔더라”.' },
    ],
    fill_blank: [
      { question: '“너는 너의 ____과 친척과 아버지의 집을 떠나 내가 네게 보여 줄 땅으로 가라”', answer: '고향', accept: [], explanation: '창 12:1' },
      { question: '아브람은 가는 곳마다 ____을 쌓고 여호와의 이름을 불렀다.', answer: '제단', accept: [], explanation: '창 12:7-8' },
      { question: '“땅의 모든 ____이 너로 말미암아 복을 얻을 것이라”', answer: '족속', accept: [], explanation: '창 12:3' },
      { question: '아브람과 함께 떠난 조카의 이름은 ____이다.', answer: '롯', accept: [], explanation: '창 12:4' },
      { question: '아브라함 언약의 약속된 자손은 곧 ____이시다.', answer: '그리스도', accept: ['예수그리스도', '예수', '예수님'], explanation: '갈 3:16' },
    ],
    short_answer: [
      { question: '목적지를 알려 주지 않으시고 부르신 하나님의 의도는 무엇이라고 생각합니까?', answer: '길 전체를 아는 것이 아니라 부르시는 분을 신뢰하게 하시려는 것입니다. 믿음은 정보가 아니라 관계에 근거합니다.', explanation: '' },
      { question: '“복의 근원”이라는 말씀이 오늘 우리에게 주는 사명은 무엇입니까?', answer: '받은 복을 자신에게 쌓아 두지 않고 이웃과 열방에 흘려보내는 통로가 되라는 사명입니다.', explanation: '' },
      { question: '아브람의 제단은 순종과 어떤 관계가 있습니까?', answer: '순종의 삶은 예배와 분리되지 않습니다. 이동하는 삶 속에서도 하나님을 먼저 예배하는 것이 순종의 열매입니다.', explanation: '' },
      { question: '아브라함 언약이 그리스도 안에서 성취된다는 것을 설명해 보세요.', answer: '약속된 “씨”는 궁극적으로 그리스도이시며, 믿는 모든 자가 그분 안에서 아브라함의 복을 받습니다(갈 3:16, 29).', explanation: '' },
      { question: '유효한 부르심이 신앙생활에 주는 위로는 무엇입니까?', answer: '구원이 나의 준비와 열심이 아니라 하나님의 은혜에서 시작되었으므로 흔들리는 순간에도 소망이 하나님께 있다는 위로입니다.', explanation: '' },
    ],
  },
  closing_prayer: '아버지, 오늘 배운 말씀을 마음에 새기고 삶으로 응답하게 하옵소서. 아멘.',
};

const qa = (question, answer, guide = '') => ({ question, guide, answer });
const group = {
  representative_prayer: '사랑의 하나님, 오늘 우리를 한자리에 모으셔서 감사합니다. 말씀 앞에서 서로의 삶을 정직하게 나누고 함께 기도하게 하옵소서. 아멘.',
  songs,
  outline: [
    { heading: '1. 떠남과 부르심', scripture: '창 12:1-3', paragraphs: ['아브람은 목적지를 모른 채 하나님의 말씀을 믿고 떠났습니다. 우리도 각자의 자리에서 하나님이 부르시는 일을 함께 돌아봅니다.'], key_summary: '부르심에 대한 응답은 신뢰에서 시작됩니다.' },
    { heading: '2. 복의 통로', scripture: '창 12:3', paragraphs: ['받은 복은 나누라고 주신 것입니다. 우리 공동체가 누구에게 복의 통로가 될 수 있을지 이야기합니다.'], key_summary: '복은 나눌 때 복이 됩니다.' },
  ],
  applications: [
    { title: '이번 주 한 가지 순종', detail: '모임에서 서로의 순종 한 가지를 나누고 중보합니다.' },
    { title: '복을 나눌 사람 찾기', detail: '각자 복을 흘려보낼 한 사람을 정해 연락해 봅니다.' },
  ],
  questions: {
    icebreaker: qa('최근에 낯선 곳으로 처음 가 본 경험이 있다면 어땠는지 나눠 봅시다.', '지난달 처음 가 본 동네 병원에서 길을 헤매다 친절한 분의 안내를 받았어요. 낯선 곳에서 누군가 길을 알려 줄 때 참 든든하더라고요.', '정답이 없는 질문입니다. 리더가 먼저 짧게 나누면 다른 사람들도 편하게 이야기합니다. 설렘과 불안 둘 다 자연스럽다는 점을 짚어 주세요.'),
    observation: [qa('창세기 12:1-3에서 하나님이 아브람에게 명령하신 것과 약속하신 것을 구분해 봅시다.', '명령: 고향과 친척과 아버지의 집을 떠나라. 약속: 큰 민족, 복, 큰 이름, 복의 근원, 모든 족속이 복을 얻음.'), qa('아브람은 가는 곳마다 무엇을 했습니까?', '제단을 쌓고 여호와의 이름을 불렀습니다(12:7-8).', '7절과 8절을 함께 소리 내어 읽고, 반복되는 행동을 찾아보게 하세요.')],
    reflection: [qa('목적지를 알려 주지 않으시고 부르신 이유는 무엇일까요?', '하나님을 신뢰하는 관계 안에서 걷게 하시려는 의도로 볼 수 있습니다.'), qa('“복의 근원”이라는 말씀은 우리에게 어떤 사명을 줍니까?', '받은 복을 나누는 통로가 되라는 사명입니다.')],
    application: [qa('이번 주 내가 순종해야 할 한 가지는 무엇입니까?', '구체적이고 실천 가능한 한 가지를 정하도록 돕습니다.'), qa('복을 흘려보낼 한 사람은 누구입니까?', '')],
    prayer: [qa('서로를 위해 어떻게 기도하면 좋겠습니까?', '')],
  },
  sharing_guide: {
    intro: '모임 시간은 약 60분으로 가정하였습니다. 말씀 이야기에 앞서 서로의 한 주를 짧게 나누고, 마지막에는 기도제목을 함께 나눕니다.',
    steps: [
      { title: '마음 열기와 한 주 삶 나눔', detail: '한 사람당 2분 안팎으로 한 주의 기쁨과 어려움을 나눕니다.', minutes: 15 },
      { title: '말씀 나눔', detail: '준비된 질문으로 본문을 함께 살펴보고 적용을 나눕니다.', minutes: 30 },
      { title: '기도제목 나누고 기도하기', detail: '한 사람당 한두 문장으로 기도제목을 말하고, 짝을 지어 서로 기도합니다.', minutes: 15 },
    ],
    prayer_guide: ['길게 설명하기보다 한두 문장으로 말합니다.', '가족·직장·건강·신앙의 영역을 골고루 떠올려 봅니다.', '들은 기도제목은 한 주 동안 기억하고 안부를 묻습니다.'],
  },
  closing_prayer: '주님, 오늘 나눈 이야기를 기억하며 각자의 삶에서 순종하게 하옵소서. 서로 중보하는 공동체가 되게 하옵소서. 아멘.',
};

const verses = (tag) => [1, 2, 3].map((n) => ({ n, text: `(샘플) ${tag} 본문 ${n}절입니다. 실제 본문은 동기화 후 웹사이트에서 가져옵니다.` }));
function sampleBible(passages) {
  return {
    signature: bibleSignature(passages),
    fetched_at: '2026-10-05T12:00:00Z',
    audio: [{ reference: '창세기 12장', video_id: 'sample00003', title: '(샘플) 드라마바이블 창세기 12장', channel: '샘플 채널' }],
    audio_checked: true,
    versions: BIBLE_SOURCES.map((s) => ({ id: s.id, label: s.label, lang: s.lang, copyright: s.copyright, source: s.source, passages: [{ reference: '창세기 12:1-3', verses: verses(s.label) }], truncated: false })),
  };
}

const rows = [];
const base = (o) => ({ video_id: '', category: '', title: '', published_at: '', url: '', status: 'done', transcript_manual: '', result_json: '', updated_at: '', note: '', preacher: '', scripture: '', mode_qt: '', mode_study: '', mode_group: '', bible_json: '', owner: '', ...o });
const ytUrl = (id) => `https://www.youtube.com/watch?v=${id}`;

rows.push(
  base({
    video_id: full.id,
    category: full.category,
    title: full.title,
    published_at: full.date,
    url: ytUrl(full.id),
    result_json: JSON.stringify(normalizeReview(review)),
    mode_qt: JSON.stringify(normalizeQt(qt)),
    mode_study: JSON.stringify(normalizeStudy(study)),
    mode_group: JSON.stringify(normalizeGroup(group)),
    bible_json: JSON.stringify(sampleBible(parseScripture('창세기 12:1-9'))),
  }),
);

// 필터·목록 확인용 (설교리뷰만 있는 설교들)
const small = (id, category, title, date, scripture, preacher, line, extra = {}) => {
  const raw = { ...review, title: title.replace(/^\[.*?\]\s*/, '').replace(/\s*\(.*$/, ''), scripture: [scripture], preacher, summary_short: line, theme: line, review: { outline: [{ heading: '1. 본문의 핵심', scripture, paragraphs: ['샘플 설교 정리입니다. 실제 내용은 동기화 후 AI가 만든 정리로 바뀝니다.'], key_summary: line }], summary: line } };
  return base({ video_id: id, category, title, published_at: date, url: ytUrl(id), result_json: JSON.stringify(normalizeReview(raw)), ...extra });
};
rows.push(
  small('sampleDwn01', 'dawn', '[2026.10.07] 솔로몬의 지혜 (열왕기상 3:5-14) - 윤정환 목사', '2026-10-07', '열왕기상 3:5-14', '윤정환 목사', '지혜를 구하는 기도는 하나님을 향한 겸손에서 시작됩니다.'),
  small('sampleDwn02', 'dawn', '[2026.10.06] 성전 건축의 준비 (열왕기상 5장) - 윤정환 목사', '2026-10-06', '열왕기상 5장', '윤정환 목사', '하나님의 집을 세우는 일은 사람의 협력과 평화 위에서 이루어집니다.'),
  small('sampleWed01', 'wednesday', '[2026.10.01] 기도의 능력 (마태복음 6:5-13) - 김은혜 목사', '2026-10-01', '마태복음 6:5-13', '김은혜 목사', '주기도문은 기도의 내용과 순서를 가르치는 하나님 나라의 기도입니다.'),
  small('sampleWed02', 'wednesday', '[2026.09.17] 감사의 이유 (시편 103편) - 홍길동 목사', '2026-09-17', '시편 103편', '홍길동 목사', '여호와의 모든 은택을 잊지 않는 것이 참된 감사의 시작입니다.'),
  small('sampleSun02', 'sunday', '[2026.09.27] 사랑의 계명 (요한복음 13:34-35) - 홍길동 목사', '2026-09-27', '요한복음 13:34-35', '홍길동 목사', '서로 사랑하라는 새 계명은 예수님의 사랑을 기준으로 합니다.'),
  small('sampleSun03', 'sunday', '[2026.08.30] 은혜로 구원받았으니 (에베소서 2:1-10) - 박은혜 목사', '2026-08-30', '에베소서 2:1-10', '박은혜 목사', '구원은 행위가 아닌 하나님의 은혜로 받은 선물입니다.'),
  small('sampleYth01', 'youth', '[2026.09.26] 청년의 소명 (디모데전서 4:12) - 이청년 목사', '2026-09-26', '디모데전서 4:12', '이청년 목사', '나이가 어려도 말과 행실로 믿는 자의 본이 될 수 있습니다.'),
  small('sampleUsr01', 'user', '시편 23편 묵상', '2026-10-05', '시편 23편', '박은혜 목사', '여호와는 나의 목자이시니 내게 부족함이 없습니다.', { owner: 'sample@example.com' }),
);

await fs.rm(OUT, { recursive: true, force: true });
await fs.mkdir(OUT, { recursive: true });
const res = await exportJson(rows, { dataDir: OUT, quiet: true });
console.log(`샘플 ${res.count}편을 ${path.relative(process.cwd(), OUT)} 에 만들었습니다.`);

/* ---------- 오늘의 말씀 샘플 (2026-10-08: 열왕기상 11장 · 마가복음 10장) ---------- */
const dPassages = [
  { bookId: '11', book: '열왕기상', chapter: 11, verses: [1, 2, 3].map((n) => ({ n, text: `(샘플) 열왕기상 11장 ${n}절입니다. 실제 본문은 교회 앱에서 가져옵니다.` })) },
  { bookId: '41', book: '마가복음', chapter: 10, verses: [1, 2, 3].map((n) => ({ n, text: `(샘플) 마가복음 10장 ${n}절입니다. 실제 본문은 교회 앱에서 가져옵니다.` })) },
];
const ccm = [{ title: '주 은혜임을', artist: '샘플 아티스트', kind: 'CCM', reason: '흔들리는 마음을 붙드시는 은혜를 고백하는 곡입니다.' }];
const mcD = (level, question, options, answer_index, explanation) => ({ level, question, options, answer_index, explanation });
const dQuiz = normalizeDailyQuiz({ quiz: {
  multiple_choice: [
    mcD('쉬움', '솔로몬에게 있었던 후궁과 첩의 수로 맞는 것은?', ['후궁 300명, 첩 700명', '후궁 700명, 첩 300명', '후궁 500명, 첩 500명', '후궁 600명, 첩 400명'], 1, '왕상 11:3'),
    mcD('쉬움', '영생을 물은 사람이 슬픈 기색을 띠고 근심하며 간 이유는?', ['재물이 많았기 때문에', '율법을 다 지키지 못해서', '부모를 떠날 수 없어서', '바리새인들이 막아서'], 0, '막 10:22'),
    mcD('쉬움', '여리고에서 예수님께 고침을 받은 맹인의 이름은?', ['디매오', '바디매오', '삭개오', '나사로'], 1, '막 10:46 — 디매오는 그의 아버지 이름입니다.'),
    mcD('쉬움', '제자들이 어린 아이들을 데려오는 사람들을 꾸짖을 때 예수님은?', ['제자들을 칭찬하셨다', '아이들을 집으로 돌려보내셨다', '부모들을 꾸짖으셨다', '노하시며 아이들이 오는 것을 용납하라 하셨다'], 3, '막 10:14'),
    mcD('중간', '선지자 아히야는 자기가 입은 새 옷을 몇 조각으로 찢었습니까?', ['열 조각', '열두 조각', '일곱 조각', '두 조각'], 1, '왕상 11:30'),
    mcD('중간', '아히야가 여로보암에게 가지라고 한 조각은 몇 개입니까?', ['열두 조각', '한 조각', '열 조각', '두 조각'], 2, '왕상 11:31'),
    mcD('중간', '솔로몬이 예루살렘 앞 산에 산당을 지어 준 "모압의 가증한" 신은?', ['밀곰', '그모스', '아스다롯', '몰록'], 1, '왕상 11:7 — 몰록과 밀곰은 암몬, 아스다롯은 시돈의 신입니다.'),
    mcD('중간', '"낙타가 바늘귀로 나가는 것이…"라는 말씀을 들은 제자들의 반응은?', ['우리가 무엇을 얻으리이까', '주여 믿나이다', '이 말씀은 어렵도다', '그런즉 누가 구원을 얻을 수 있는가'], 3, '막 10:26'),
    mcD('중간', '야고보와 요한이 예수님께 구한 것은?', ['주의 영광 중에 좌우편에 앉게 해 달라', '하늘에서 불을 내려 달라', '열두 지파를 다스리게 해 달라', '먼저 아버지를 장사하게 해 달라'], 0, '막 10:37'),
    mcD('중간', '예루살렘에 올라가며 예수님은 인자가 누구에게 넘겨질 것이라고 하셨습니까?', ['헤롯과 빌라도', '바리새인과 사두개인', '대제사장들과 서기관들', '장로들과 군병들'], 2, '막 10:33'),
    mcD('어려움', '여호와께서 솔로몬의 대적으로 일으키신 하닷은 어느 나라 사람입니까?', ['모압', '에돔', '수리아', '블레셋'], 1, '왕상 11:14'),
    mcD('어려움', '엘리아다의 아들 르손이 무리를 모아 가서 왕이 된 곳은?', ['소바', '다메섹', '하맛', '두로'], 1, '왕상 11:24 — 소바 왕 하닷에셀은 그가 도망쳐 나온 주인입니다.'),
    mcD('어려움', '여로보암의 어머니 이름은?', ['다브네스', '나아마', '마아가', '스루아'], 3, '왕상 11:26 — 다브네스는 애굽 왕비입니다.'),
    mcD('어려움', '여로보암이 솔로몬을 피해 도망가 머문 애굽 왕은?', ['바로 느고', '시삭', '소', '하닷에셀'], 1, '왕상 11:40'),
    mcD('어려움', '바리새인들이 예수님을 시험하여 처음 물은 것은 무엇에 관한 질문입니까?', ['안식일', '세금', '아내를 버리는 것', '정결 예식'], 2, '막 10:2'),
  ],
  fill_blank: [
    { question: '솔로몬의 신하 느밧의 아들 ____이 또한 손을 들어 왕을 대적하였으니', answer: '여로보암', accept: [], explanation: '왕상 11:26' },
    { question: '그 사람은 ____이 많은 고로 이 말씀으로 인하여 슬픈 기색을 띠고 근심하며 가니라', answer: '재물', accept: [], explanation: '막 10:22' },
    { question: '____가 바늘귀로 나가는 것이 부자가 하나님의 나라에 들어가는 것보다 쉬우니라', answer: '낙타', accept: [], explanation: '막 10:25' },
    { question: '자기 목숨을 많은 사람의 ____로 주려 함이니라', answer: '대속물', accept: [], explanation: '막 10:45' },
    { question: '솔로몬이 예루살렘에서 온 이스라엘을 다스린 날 수가 ____ 년이라', answer: '사십', accept: ['40'], explanation: '왕상 11:42' },
  ],
  short_answer: [
    { question: '솔로몬의 마음이 하나님을 떠나게 된 과정을 본문에서 정리해 보세요.', answer: '이방 여인들을 사랑하여 그들의 신들을 따르게 되었고, 나이가 많을 때 마음이 돌아서 산당까지 지었습니다.', explanation: '왕상 11:1-8' },
    { question: '하나님이 나라를 다 빼앗지 않으신 이유는 무엇입니까?', answer: '다윗과 택하신 예루살렘을 위하여 한 지파를 남겨 두셨습니다. 언약에 신실하신 하나님을 보여 줍니다.', explanation: '왕상 11:12-13, 32-36' },
    { question: '부자 청년에게 부족했던 "한 가지"는 무엇이라고 생각합니까?', answer: '재물보다 예수님을 따르는 것을 더 귀하게 여기는 마음입니다.', explanation: '막 10:21' },
    { question: '"크고자 하는 자는 섬기는 자가 되라"는 말씀이 오늘 나에게 주는 의미를 써 보세요.', answer: '예수님이 섬기러 오셨듯이 가정과 교회에서 먼저 섬기는 자리로 가라는 부르심입니다.', explanation: '막 10:43-45' },
    { question: '바디매오의 믿음은 어떤 모습으로 나타났습니까?', answer: '사람들이 꾸짖어도 더 크게 부르짖었고, 부르실 때 겉옷을 버리고 뛰어 나아갔습니다.', explanation: '막 10:47-52' },
  ],
} });
const dQt = normalizeDailyQt({
  opening_prayer: '주님, 오늘 말씀 앞에 마음을 엽니다. 솔로몬처럼 마음이 나뉘지 않게 하시고, 섬기러 오신 주님을 따르게 하옵소서. 아멘.',
  songs: ccm,
  outline: [
    { heading: '1. 나뉜 마음의 끝', scripture: '왕상 11:1-13', paragraphs: ['지혜의 왕 솔로몬도 마음이 나뉘자 하나님을 떠났습니다.', '하나님은 그래도 다윗과의 언약을 지키십니다.'], key_summary: '작은 타협이 마음 전체를 돌려놓을 수 있습니다.' },
    { heading: '2. 섬기러 오신 왕', scripture: '막 10:35-45', paragraphs: ['제자들이 높은 자리를 구할 때 예수님은 섬김의 길을 보여 주셨습니다.'], key_summary: '참된 크기는 섬김에서 드러납니다.' },
  ],
  questions: [{ question: '내 마음을 하나님에게서 돌려놓으려는 것은 무엇입니까?', guide: '왕상 11:4를 다시 읽고, 하나님보다 마음을 더 쏟는 것을 떠올려 보세요.', example: '요즘 바쁜 일이 기도 시간을 밀어내고 있습니다. 내일부터 아침 10분을 먼저 드리겠습니다.' }],
  applications: [{ title: '섬김 하나 실천하기', detail: '오늘 가족이나 동료를 위해 말없이 한 가지를 섬겨 봅니다.' }],
  closing_prayer: '섬기러 오신 주님, 오늘 하루 섬기는 자리로 가게 하옵소서. 아멘.',
  key_verse: { reference: '마가복음 10:45', text: '인자가 온 것은 섬김을 받으려 함이 아니라 도리어 섬기려 하고 자기 목숨을 많은 사람의 대속물로 주려 함이니라' },
  summaries: [
    { reference: '열왕기상 11장', summary: '이방 여인들로 마음이 돌아선 솔로몬, 나라가 나뉠 것이 예고되고 여로보암이 등장합니다.' },
    { reference: '마가복음 10장', summary: '부자 청년, 섬기러 오신 인자, 맹인 바디매오 — 무엇을 버리고 누구를 따를지 묻습니다.' },
  ],
});
const dStudy = normalizeDailyStudy({ opening_prayer: '주님, 오늘 본문을 깊이 깨닫게 하옵소서. 아멘.', songs: ccm, deep_dive: [{ heading: '1. 왕국 분열의 원인', scripture: '왕상 11:9-13', paragraphs: ['솔로몬의 우상 숭배는 언약 위반이었고, 그 결과로 나라가 나뉠 것이 선언됩니다.', '그러나 다윗 언약 때문에 한 지파가 남습니다.'], key_summary: '하나님의 심판 속에도 언약의 신실하심이 있습니다.', word_notes: [] }], summary: '솔로몬의 나뉜 마음과 섬기러 오신 예수님이 대조됩니다.', closing_prayer: '주님, 배운 말씀대로 살게 하옵소서. 아멘.',
  background: [{ title: '열왕기상의 배경', paragraphs: ['(샘플) 열왕기상은 솔로몬의 통치와 왕국 분열을 다룹니다.', '(샘플) 포로기 독자들에게 언약의 의미를 되새기게 합니다.'] }],
  commentary: [{ passage: '열왕기상 11장', sections: [{ verses: '1-8', heading: '솔로몬의 나뉜 마음', paragraphs: ['(샘플) 이방 여인들과의 혼인이 우상 숭배로 이어집니다.', '(샘플) 신명기 17장의 왕의 규례를 어긴 모습입니다.'], cross_refs: ['신명기 17:17 — 왕은 아내를 많이 두지 말라'], commentators: [{ name: '매튜 헨리', view: '(샘플) 작은 타협이 마음 전체를 빼앗는다고 해석합니다.' }] }] }, { passage: '마가복음 10장', sections: [{ verses: '35-45', heading: '섬기러 오신 인자', paragraphs: ['(샘플) 제자들의 자리 다툼과 대속물 말씀.'], cross_refs: ['이사야 53:10-12 — 고난받는 종'], commentators: [] }] }] });
const dGroup = normalizeGroup({ ...group, songs: ccm });
const dRow = { date: '2026-10-08', refs: readingRefs(dPassages), status: 'done', passages_json: JSON.stringify(dPassages), qt_json: JSON.stringify(dQt), study_json: JSON.stringify(dStudy), group_json: JSON.stringify(dGroup), quiz_json: JSON.stringify(dQuiz), videos_json: JSON.stringify([{ reference: '열왕기상 11장', book: '열왕기상', chapter: 11, video_id: 'sample00011', title: '(샘플) 공동체성경읽기 열왕기상 11장', channel: '샘플 채널' }, { reference: '마가복음 10장', book: '마가복음', chapter: 10, video_id: 'sample00041', title: '(샘플) 공동체성경읽기 마가복음 10장', channel: '샘플 채널' }]), updated_at: '', note: '' };
const dRow2 = { ...dRow, date: '2026-10-07', refs: '열왕기상 10장 · 마가복음 9장', passages_json: JSON.stringify([{ ...dPassages[0], chapter: 10 }, { ...dPassages[1], chapter: 9 }]), videos_json: '[]' };
const nDaily = await exportDaily([dRow, dRow2], { dataDir: OUT, quiet: true });
console.log(`오늘의 말씀 샘플 ${nDaily}일치를 만들었습니다.`);

// ---------- 잠언 묵상 샘플 (9장 · 10장) ----------
const pvBible = (ch) => ({ versions: BIBLE_SOURCES.map((s) => ({ id: s.id, label: s.label, lang: s.lang, copyright: s.copyright, source: s.source, passages: [{ reference: `잠언 ${ch}장`, verses: [1, 2, 3, 4, 5].map((n) => ({ n, text: `(샘플 ${s.label}) 잠언 ${ch}장 ${n}절입니다.` })) }], truncated: false })) });
const pvWord = (ch) => normalizeProverbWord({
  theme: ch === 9 ? '지혜의 잔치와 어리석음의 초대 — 누구의 식탁에 앉을 것인가' : '의인과 악인의 대조 — 말과 부지런함',
  summary: '(샘플) 지혜와 어리석음이 각각 사람들을 자기 집으로 초대합니다. 여호와를 경외하는 것이 지혜의 근본입니다.',
  outline: [{ verses: '1-6', title: '지혜의 초대' }, { verses: '7-12', title: '거만한 자와 지혜로운 자' }, { verses: '13-18', title: '미련한 여자의 초대' }],
  key_verses: [
    { reference: `잠언 ${ch}:10`, text: '여호와를 경외하는 것이 지혜의 근본이요 거룩하신 자를 아는 것이 명철이니라', title: '지혜의 출발점', meaning: '(샘플) 지혜는 정보가 아니라 하나님과의 관계에서 시작합니다.', apply: '오늘 결정 하나를 내리기 전에 먼저 기도합니다.' },
    { reference: `잠언 ${ch}:9`, text: '지혜 있는 자에게 교훈을 더하라 그가 더욱 지혜로워질 것이요', title: '배우는 사람', meaning: '(샘플) 지혜로운 사람은 책망을 받을 때 더 자랍니다.', apply: '오늘 들은 조언 하나를 고마워하며 받아들입니다.' },
    { reference: `잠언 ${ch}:6`, text: '어리석음을 버리고 생명을 얻으라 명철의 길을 행하라 하느니라', title: '생명의 길', meaning: '(샘플) 지혜의 초대에 응답하는 것은 생명을 택하는 일입니다.', apply: '버려야 할 습관 하나를 적어 봅니다.' },
  ],
});
const pvGroup = normalizeProverbGroup({
  representative_prayer: '(샘플) 주님, 지혜의 잔치에 우리를 부르심을 감사합니다. 아멘.',
  songs: ccm,
  member: { summary: '(샘플) 지혜와 어리석음이 모두 우리를 부릅니다.', key_verse: { reference: '잠언 9:10', text: '여호와를 경외하는 것이 지혜의 근본이요' }, questions: [
    { id: 'q1', section: 'icebreaker', question: '최근에 받은 가장 기억에 남는 초대는 무엇인가요?' },
    { id: 'q2', section: 'observation', question: '지혜는 어떤 음식을 차려 놓고 누구를 부릅니까? (1-6절)' },
    { id: 'q3', section: 'reflection', question: '하나님을 경외하는 것이 왜 지혜의 "근본"일까요?' },
    { id: 'q4', section: 'application', question: '이번 주 어리석음의 초대를 거절해야 할 자리는 어디인가요?' },
    { id: 'q5', section: 'prayer', question: '서로를 위해 어떤 지혜를 구하며 기도할까요?' },
  ] },
  leader: { overview: '(샘플) 두 초대를 비교하며 지혜의 길을 택하도록 돕습니다.', questions: [
    { id: 'q1', intent: '가볍게 마음을 엽니다.', guide: '짧게 한 사람씩 돌아가며.', answers: ['결혼식 초대', '친구 생일'], follow_up: '초대를 거절해 본 적은?' },
    { id: 'q2', intent: '본문을 꼼꼼히 봅니다.', guide: '1-6절을 함께 읽고 찾게 합니다.', answers: ['고기와 포도주, 상을 차림 — 어리석은 자를 부름'], follow_up: '왜 어리석은 자를 부를까요?' },
    { id: 'q3', intent: '핵심 구절을 깊이 생각합니다.', guide: '10절을 소리 내어 읽습니다.', answers: ['지혜의 출발이 관계이기 때문'], follow_up: '경외와 두려움은 어떻게 다를까요?' },
    { id: 'q4', intent: '구체적으로 적용합니다.', guide: '각자 한 가지씩.', answers: ['밤늦은 스마트폰', '험담 자리'], follow_up: '' },
    { id: 'q5', intent: '서로 중보합니다.', guide: '짝을 지어 기도합니다.', answers: [], follow_up: '' },
  ], flow: [{ title: '마음 열기', minutes: 10, detail: '근황 나누기' }, { title: '말씀 읽기', minutes: 10, detail: '9장 함께 읽기' }, { title: '나눔', minutes: 30, detail: '질문 2-4' }, { title: '기도', minutes: 10, detail: '짝 기도' }],
  tips: ['침묵이 길면 인도자가 먼저 짧게 나눕니다.', '한 사람이 길게 말하면 "다른 분 생각도 들어 볼까요?"로 이어 갑니다.'], closing_words: '(샘플) 오늘 우리는 지혜의 초대를 들었습니다. 이번 주 그 식탁에 앉기로 결단합시다.' },
  closing_prayer: '(샘플) 지혜의 근본이신 주님, 이번 주도 주님을 경외하며 살게 하옵소서. 아멘.',
});
const pvStudy = normalizeProverbStudy({ ...JSON.parse(JSON.stringify(dStudy)), commentary: [{ passage: '잠언 9장', sections: [{ verses: '1-6', heading: '지혜의 잔치', paragraphs: ['(샘플) 일곱 기둥은 완전함을 나타냅니다.'], cross_refs: ['잠언 8:1-4 — 지혜가 부름'], commentators: [{ name: '데릭 키드너', view: '(샘플) 두 초대의 대조가 1-9장 전체의 결론이라고 봅니다.' }] }] }], perspectives: [{ title: '"일곱 기둥"은 무엇인가', views: ['(샘플) 완전함의 상징으로 보는 견해와 실제 건축 양식으로 보는 견해가 있습니다.'], pastoral: ['(샘플) 지혜는 삶 전체를 떠받치는 기둥입니다.'] }] });
const pvRow = (ch) => ({ chapter: String(ch), status: 'done', bible_json: JSON.stringify(pvBible(ch)), word_json: JSON.stringify(pvWord(ch)), qt_json: JSON.stringify(dQt), study_json: JSON.stringify(pvStudy), commentary_json: '', group_json: JSON.stringify(pvGroup), quiz_json: JSON.stringify(dQuiz), updated_at: '', note: '' });
const nProv = await exportProverbs([pvRow(9), pvRow(10)], { dataDir: OUT, quiet: true });
console.log(`잠언 묵상 샘플 ${nProv}장을 만들었습니다.`);
