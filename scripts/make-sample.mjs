#!/usr/bin/env node
// 화면 확인용 샘플(?demo)을 docs/data/sample/ 에 만듭니다. 실제 파이프라인(정규화 → 시트 행 → 내보내기)과 같은 코드를 지나므로
// 데이터 형식이 바뀌면 이 스크립트가 먼저 알려 줍니다.   node scripts/make-sample.mjs
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { normalizeReview, normalizeQt, normalizeStudy, normalizeGroup } from './lib/gemini.mjs';
import { exportJson } from './sync.mjs';
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
  questions: ['지금 내가 하나님께 “내려놓아야 한다”고 느끼는 것은 무엇입니까?', '아브람처럼 목적지를 모른 채 걸어야 했던 때가 있었다면 그때 나를 붙든 것은 무엇이었습니까?', '내가 받은 복을 흘려보내야 할 사람은 누구입니까?'],
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
      { question: '창세기 12장에서 하나님이 아브람에게 처음 하신 명령은 무엇입니까?', options: ['성전을 지으라', '고향과 아버지의 집을 떠나라', '제물을 드리라', '이스마엘을 보내라'], answer_index: 1, explanation: '창 12:1은 “너는 너의 고향과 친척과 아버지의 집을 떠나”라고 말씀합니다.' },
      { question: '하나님이 아브람에게 약속하신 복의 목적으로 알맞은 것은?', options: ['아브람의 부유함', '땅의 모든 족속이 복을 얻음', '이스라엘의 군사력', '가나안 정복'], answer_index: 1, explanation: '창 12:3 “땅의 모든 족속이 너로 말미암아 복을 얻을 것이라”.' },
      { question: '아브람이 가나안에서 가는 곳마다 한 일은?', options: ['성을 쌓음', '제단을 쌓음', '우물을 팜', '왕을 세움'], answer_index: 1, explanation: '창 12:7-8 제단을 쌓고 여호와의 이름을 불렀습니다.' },
      { question: '아브람이 하란을 떠날 때 나이는?', options: ['55세', '65세', '75세', '85세'], answer_index: 2, explanation: '창 12:4 “하란을 떠날 때에 칠십오 세였더라”.' },
      { question: '개혁주의 신학에서 아브람의 부르심을 가장 잘 설명하는 용어는?', options: ['공로 사상', '유효한 부르심(소명)', '율법의 행위', '자유의지 결단'], answer_index: 1, explanation: '하나님의 주권적 은혜로 일으키시는 부르심을 뜻합니다.' },
    ],
    fill_blank: [
      { question: '“너는 너의 ____과 친척과 아버지의 집을 떠나 내가 네게 보여 줄 땅으로 가라”', answer: '고향', explanation: '창 12:1' },
      { question: '아브람은 가는 곳마다 ____을 쌓고 여호와의 이름을 불렀다.', answer: '제단', explanation: '창 12:7-8' },
      { question: '“땅의 모든 ____이 너로 말미암아 복을 얻을 것이라”', answer: '족속', explanation: '창 12:3' },
      { question: '아브람과 함께 떠난 조카의 이름은 ____이다.', answer: '롯', explanation: '창 12:4' },
      { question: '아브라함 언약의 성취는 ____ 안에서 이루어진다.', answer: '그리스도(예수 그리스도)', explanation: '갈 3:16' },
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

const qa = (question, answer) => ({ question, answer });
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
    icebreaker: qa('최근에 낯선 곳으로 처음 가 본 경험이 있다면 어땠는지 나눠 봅시다.', '새로운 환경에서의 설렘과 불안을 자연스럽게 나누도록 돕습니다. 정답은 없으며 서로 공감하는 분위기가 중요합니다.'),
    observation: [qa('창세기 12:1-3에서 하나님이 아브람에게 명령하신 것과 약속하신 것을 구분해 봅시다.', '명령: 고향과 친척과 아버지의 집을 떠나라. 약속: 큰 민족, 복, 큰 이름, 복의 근원, 모든 족속이 복을 얻음.'), qa('아브람은 가는 곳마다 무엇을 했습니까?', '제단을 쌓고 여호와의 이름을 불렀습니다(12:7-8).')],
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
  small('sampleUsr01', 'user', '시편 23편 묵상', '2026-10-05', '시편 23편', '사용자', '여호와는 나의 목자이시니 내게 부족함이 없습니다.', { owner: 'sample@example.com' }),
);

await fs.rm(OUT, { recursive: true, force: true });
await fs.mkdir(OUT, { recursive: true });
const res = await exportJson(rows, { dataDir: OUT, quiet: true });
console.log(`샘플 ${res.count}편을 ${path.relative(process.cwd(), OUT)} 에 만들었습니다.`);
