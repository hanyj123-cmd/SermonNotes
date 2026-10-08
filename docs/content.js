// 설교 내용을 화면·핸드아웃에 그리는 공통 도구 (app.js, handout.js 가 함께 씁니다)
// innerHTML 을 쓰지 않으므로 AI가 만든 글이 코드로 해석되지 않습니다.

const EVENT_NAMES = { dawn: '새벽기도회', wednesday: '수요예배', sunday: '주일예배' };
const eventName = (cat) => EVENT_NAMES[cat] || '예배';
const footnoteText = (cat) => `${eventName(cat)} 영상으로 설교 전 찬송, 사도신경, 마침기도 등 의전 순서를 제외하고 설교 본문과 메시지를 중심으로 정리하였습니다.`;
const AI_NOTICE = '이 정리는 AI(Gemini)가 영상 자막을 바탕으로 작성했습니다. 오류나 빠진 부분이 있을 수 있으니, 설교 영상과 성경 본문을 함께 확인해 주세요.';

/* ---------- 간단한 마크다운 (굵게 · 인용 · 목록) ---------- */
function inlineMd(text) {
  const out = [];
  String(text || '')
    .split(/\*\*(.+?)\*\*/g)
    .forEach((part, i) => {
      if (!part) return;
      out.push(i % 2 ? h('strong', { text: part }) : part.replace(/\*(?!\s)([^*]+?)\*/g, '$1'));
    });
  return out;
}

function mdBlocks(text) {
  const blocks = [];
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  let para = [];
  let quote = [];
  let items = [];
  const flush = () => {
    if (para.length) blocks.push(h('p', {}, inlineMd(para.join(' '))));
    if (quote.length) blocks.push(h('blockquote', {}, quote.map((q) => h('p', {}, inlineMd(q)))));
    if (items.length) blocks.push(h('ul', {}, items.map((i) => h('li', {}, inlineMd(i)))));
    para = [];
    quote = [];
    items = [];
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      flush();
      continue;
    }
    let m;
    if ((m = line.match(/^>\s?(.*)$/))) {
      if (para.length || items.length) flush();
      if (m[1]) quote.push(m[1]);
    } else if ((m = line.match(/^(?:[-*•]|\d+[.)])\s+(.*)$/))) {
      if (para.length || quote.length) flush();
      items.push(m[1]);
    } else if ((m = line.match(/^#{1,6}\s+(.*)$/))) {
      flush();
      blocks.push(h('p', {}, h('strong', { text: m[1].replace(/\*\*/g, '') })));
    } else {
      if (quote.length || items.length) flush();
      para.push(line);
    }
  }
  flush();
  return blocks;
}

const splitParas = (text) =>
  String(text || '')
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

// 대지의 문단들 (새 형식 paragraphs, 옛 형식 content 모두 지원)
const outlineParas = (o) => (Array.isArray(o.paragraphs) && o.paragraphs.length ? o.paragraphs : splitParas(o.content));
const outlineSummary = (o) => o.key_summary || o.key_quote || '';

/* ---------- 영상 ID · 링크 ---------- */
const ytId = (v) => (/^[A-Za-z0-9_-]{11}$/.test(String(v || '')) ? String(v) : '');
const ytEmbed = (id) => `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0&modestbranding=1`;
const ytSearch = (q) => `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;

function embedPlayer(id, title) {
  return h('iframe', {
    class: 'yt-frame',
    src: ytEmbed(id),
    title: title || '유튜브 영상',
    allow: 'autoplay; encrypted-media; picture-in-picture',
    allowfullscreen: true,
    referrerpolicy: 'strict-origin-when-cross-origin',
  });
}

/* ---------- 성경 본문 3역본 ---------- */
function renderBibleBlock(bible) {
  const versions = (bible && bible.versions) || [];
  if (!versions.length) return null;
  const cols = versions.map((v) =>
    h(
      'article',
      { class: 'bible-col' },
      h('h3', { text: v.label || v.abbreviation || '성경' }),
      (v.passages || []).map((p) => h('div', { class: 'bible-passage' }, p.reference ? h('p', { class: 'ref', text: p.reference }) : null, h('p', { class: 'bible-text', text: p.text }))),
      v.truncated ? h('p', { class: 'meta', text: '분량이 길어 앞부분만 보여 드립니다.' }) : null,
    ),
  );
  const credits = versions.filter((v) => v.copyright).map((v) => h('li', {}, h('strong', { text: `${v.label || v.abbreviation}  ` }), v.copyright));
  return h(
    'section',
    { class: 'block', id: 'passage' },
    h('h2', { text: '성경 본문' }),
    h('div', { class: `bible-grid cols-${Math.min(versions.length, 3)}` }, cols),
    h('details', { class: 'bible-credit' }, h('summary', { text: '저작권 · 제공처' }), h('ul', {}, credits), h('p', { text: '성경 본문은 YouVersion 성경 서비스를 통해 가져왔습니다.' })),
  );
}

/* ---------- 추천 찬양 ---------- */
function renderWorshipSection(songs) {
  if (!songs || !songs.length) return null;
  return h(
    'section',
    { class: 'block', id: 'worship' },
    h('h2', { text: '추천 찬양' }),
    h('p', { class: 'meta', text: '오늘 말씀을 묵상하며 함께 부르면 좋은 찬양입니다. AI가 추천한 것이라 곡 정보가 정확하지 않을 수 있습니다.' }),
    h(
      'div',
      { class: 'songs' },
      songs.map((s) => {
        const id = ytId(s.video_id);
        const stage = h('div', { class: 'song-stage' });
        const play = id
          ? h('button', {
              class: 'btn primary',
              type: 'button',
              onclick: (e) => {
                stage.replaceChildren(embedPlayer(id, `${s.title} 찬양`));
                e.currentTarget.hidden = true;
              },
            }, '▶ 듣기')
          : null;
        const link = h('a', { class: 'btn', href: id ? `https://www.youtube.com/watch?v=${id}` : ytSearch(`${s.title} ${s.artist || ''}`.trim()), target: '_blank', rel: 'noopener noreferrer' }, id ? 'YouTube에서 열기' : 'YouTube에서 찾기');
        return h(
          'article',
          { class: 'song' },
          h('div', { class: 'song-head' }, h('h3', { text: s.title }), s.kind ? h('span', { class: 'chip', text: s.kind }) : null),
          s.artist ? h('p', { class: 'meta', text: s.artist }) : null,
          s.reason ? h('p', { class: 'song-reason', text: s.reason }) : null,
          h('div', { class: 'actions' }, play, link),
          stage,
        );
      }),
    ),
  );
}

/* ---------- 기도 배경음악 ---------- */
function renderMusicSection(music) {
  const tracks = ((music && music.tracks) || []).filter((t) => ytId(t.id));
  if (!tracks.length) return null;
  const stage = h('div', { class: 'music-stage' });
  const list = h('ul', { class: 'tracks' });
  let current = null;
  const play = (t, btn) => {
    stage.replaceChildren(embedPlayer(t.id, t.title));
    if (current) current.classList.remove('on');
    btn.classList.add('on');
    current = btn;
  };
  tracks.forEach((t) => {
    const btn = h('button', { class: 'track', type: 'button' }, h('span', { class: 'track-title', text: t.title }), h('span', { class: 'meta', text: `${t.channel || ''}${t.minutes ? ` · ${t.minutes}분` : ''}` }));
    btn.addEventListener('click', () => play(t, btn));
    list.append(h('li', {}, btn));
  });
  return h(
    'section',
    { class: 'block', id: 'music' },
    h('h2', { text: '기도 배경음악' }),
    h('p', { class: 'meta', text: '조용히 기도할 때 틀어 두세요. 유튜브에서 길게 이어지는 잔잔한 기도 음악을 모았습니다. 화면을 다른 곳으로 옮기면 음악이 멈춥니다.' }),
    stage,
    list,
  );
}
