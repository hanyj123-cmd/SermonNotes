// 말씀결 게임 그림 (모두 직접 그린 SVG). 귀여운 만화풍 순례자 캐릭터 + 여정 3가지 장면.
// 캐릭터는 겹쳐 그리는 방식: 배경 → 동물 친구(뒤) → 뒷머리 → 몸·옷 → 갑옷 → 팔·손 도구 → 머리·얼굴 → 앞머리 → 머리 장식.
// 이 파일은 그림만 만듭니다. 아이템 이름·값은 game-data.js 에 있습니다.

const ART_LINE = '#3b2e4a'; // 외곽선 색 (스티커 느낌)
const SKIN = { s1: ['#ffe2cc', '#f4c4a4'], s2: ['#f1c79f', '#dba57c'], s3: ['#c98e63', '#a96f48'] };
const HAIR_COLOR = { black: '#2c2433', brown: '#6b4428', auburn: '#9a4b2c', gray: '#a7aab3', blond: '#d9a84e' };
const TIER = {
  bronze: { base: '#c98a4b', hi: '#ecb983', lo: '#9a6331' },
  silver: { base: '#b9c4cf', hi: '#eef3f7', lo: '#8794a3' },
  gold: { base: '#ebbb3a', hi: '#fff0a8', lo: '#b9861b' },
};
const ROBE = {
  robe_brown: { base: '#a77a52', lo: '#86603f', trim: '#e9d3a8' },
  robe_blue: { base: '#5b8fd6', lo: '#4371b3', trim: '#dbe8fb' },
  robe_green: { base: '#6fb06a', lo: '#538e50', trim: '#e3f3d6' },
  robe_linen: { base: '#f6f0e3', lo: '#ddd2bb', trim: '#c9a86a' },
  robe_purple: { base: '#8a64c9', lo: '#6b4aa6', trim: '#f3d77a' },
  robe_red: { base: '#d9655b', lo: '#b14a42', trim: '#ffe1b3' },
  robe_star: { base: '#2f4a8a', lo: '#22386b', trim: '#f6d76b' },
};

const tierOf = (id) => (/_gold$/.test(id) ? 'gold' : /_silver$/.test(id) ? 'silver' : 'bronze');

/* ---------- 배경 ---------- */
function bgArt(id) {
  switch (id) {
    case 'bg_dawn':
      return `<defs><linearGradient id="gbDawn" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffd7b8"/><stop offset=".6" stop-color="#ffe9d2"/><stop offset="1" stop-color="#f6d8a8"/></linearGradient></defs>
        <rect width="200" height="250" rx="26" fill="url(#gbDawn)"/>
        <circle cx="150" cy="78" r="26" fill="#fff3c4"/><circle cx="150" cy="78" r="38" fill="#fff3c4" opacity=".35"/>
        <path d="M0 196 Q50 170 104 190 T200 182 V250 H0Z" fill="#eec488"/><path d="M0 214 Q70 196 130 214 T200 208 V250 H0Z" fill="#e2ad6c"/>`;
    case 'bg_galilee':
      return `<defs><linearGradient id="gbGal" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#bfe6ff"/><stop offset="1" stop-color="#eaf7ff"/></linearGradient></defs>
        <rect width="200" height="250" rx="26" fill="url(#gbGal)"/>
        <path d="M0 150 Q40 120 80 146 Q120 118 200 144 V170 H0Z" fill="#a8d59a"/>
        <rect y="160" width="200" height="90" fill="#7cc3ea"/><path d="M14 186 h26 M70 200 h30 M140 180 h34 M120 222 h28" stroke="#d6f0ff" stroke-width="3" stroke-linecap="round"/>
        <path d="M150 168 l24 0 l-4 8 h-16z" fill="#a46b3f"/><path d="M162 168 V146 L174 164Z" fill="#fff"/>
        <rect y="200" width="200" height="50" fill="#e9d6a8"/>`;
    case 'bg_zion':
      return `<defs><linearGradient id="gbZion" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d8ccff"/><stop offset="1" stop-color="#fff2d9"/></linearGradient></defs>
        <rect width="200" height="250" rx="26" fill="url(#gbZion)"/>
        <path d="M0 170 L60 96 L100 140 L140 86 L200 160 V250 H0Z" fill="#b9a8e6"/>
        <g fill="#f5d77e" stroke="#c99a2e" stroke-width="2"><rect x="112" y="92" width="56" height="30" rx="3"/><rect x="118" y="80" width="10" height="14"/><rect x="152" y="80" width="10" height="14"/><rect x="134" y="74" width="12" height="20"/></g>
        <path d="M0 206 Q100 186 200 206 V250 H0Z" fill="#c9e3a5"/>`;
    case 'bg_stars':
      return `<defs><linearGradient id="gbStar" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1d2a5c"/><stop offset="1" stop-color="#40407a"/></linearGradient></defs>
        <rect width="200" height="250" rx="26" fill="url(#gbStar)"/>
        <g fill="#fff6c9">${[[20, 30], [52, 58], [86, 22], [130, 40], [168, 24], [180, 70], [30, 96], [150, 104], [110, 70], [66, 120], [176, 140], [16, 150]].map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="${i % 3 === 0 ? 2.6 : 1.6}"/>`).join('')}</g>
        <path d="M150 52 l3 8 8 3 -8 3 -3 8 -3 -8 -8 -3 8 -3z" fill="#fff6c9"/>
        <path d="M0 208 Q100 190 200 208 V250 H0Z" fill="#2c3466"/>`;
    case 'bg_rainbow':
      return `<rect width="200" height="250" rx="26" fill="#eaf6ff"/>
        ${['#ff9b9b', '#ffc98b', '#fff08b', '#a8e6a1', '#9ccfff', '#c5a8ff'].map((c, i) => `<path d="M${10 + i * 7} 190 A${90 - i * 7} ${90 - i * 7} 0 0 1 ${190 - i * 7} 190" fill="none" stroke="${c}" stroke-width="7"/>`).join('')}
        <ellipse cx="30" cy="186" rx="26" ry="12" fill="#fff"/><ellipse cx="172" cy="186" rx="26" ry="12" fill="#fff"/>
        <path d="M0 204 Q100 192 200 204 V250 H0Z" fill="#bfe3a8"/>`;
    case 'bg_garden':
      return `<rect width="200" height="250" rx="26" fill="#eefbe7"/>
        <path d="M0 190 Q100 170 200 190 V250 H0Z" fill="#9fd68f"/>
        ${[[24, 200, '#ff9fb8'], [48, 214, '#ffd36b'], [160, 204, '#b69cff'], [182, 222, '#ff9fb8'], [140, 226, '#ffd36b']].map(([x, y, c]) => `<g><circle cx="${x}" cy="${y}" r="5" fill="${c}"/><circle cx="${x}" cy="${y}" r="2" fill="#fff6c9"/></g>`).join('')}
        <path d="M14 70 q12 -14 24 0 q12 -14 24 0" fill="#fff" opacity=".9"/><path d="M134 50 q10 -12 20 0 q10 -12 20 0" fill="#fff" opacity=".9"/>`;
    default:
      return `<defs><linearGradient id="gbBase" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e9f1ff"/><stop offset="1" stop-color="#f6fbef"/></linearGradient></defs>
        <rect width="200" height="250" rx="26" fill="url(#gbBase)"/><ellipse cx="100" cy="226" rx="80" ry="16" fill="#dde9d0"/>`;
  }
}

/* ---------- 머리카락 ---------- */
function hairBack(style, c) {
  switch (style) {
    case 'hair_long':
      return `<path d="M44 96 C38 44 70 28 100 28 C130 28 162 44 156 96 L162 176 Q150 188 132 178 L132 120 H68 L68 178 Q50 188 38 176Z" fill="${c}" stroke="${ART_LINE}" stroke-width="3.5" stroke-linejoin="round"/>`;
    case 'hair_bob':
    case 'hair_bun':
      return `<path d="M42 100 C36 46 68 28 100 28 C132 28 164 46 158 100 L160 132 Q148 142 136 132 L136 110 H64 L64 132 Q52 142 40 132Z" fill="${c}" stroke="${ART_LINE}" stroke-width="3.5" stroke-linejoin="round"/>`;
    default:
      return '';
  }
}
function hairFront(style, c) {
  const st = `fill="${c}" stroke="${ART_LINE}" stroke-width="3.5" stroke-linejoin="round"`;
  const shine = `<path d="M72 50 Q86 40 102 42" fill="none" stroke="#fff" stroke-opacity=".35" stroke-width="5" stroke-linecap="round"/>`;
  switch (style) {
    case 'hair_curly':
      return `<g ${st}>${[[58, 64, 16], [76, 48, 17], [100, 42, 18], [124, 48, 17], [142, 64, 16], [50, 84, 12], [150, 84, 12]].map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}"/>`).join('')}</g>
        <path d="M60 72 Q100 52 140 72" fill="${c}"/>${shine}`;
    case 'hair_long':
    case 'hair_bob':
      return `<path d="M46 96 C44 50 72 34 100 34 C128 34 156 50 154 96 C146 80 134 68 120 66 C114 76 104 80 96 72 C88 80 74 82 66 72 C58 78 50 86 46 96Z" ${st}/>${shine}`;
    case 'hair_bun':
      return `<circle cx="100" cy="24" r="17" ${st}/><path d="M46 96 C44 50 72 34 100 34 C128 34 156 50 154 96 C146 80 134 68 120 66 C114 76 104 80 96 72 C88 80 74 82 66 72 C58 78 50 86 46 96Z" ${st}/>${shine}`;
    case 'hair_spiky':
      return `<path d="M46 94 L50 60 L62 70 L66 42 L82 58 L92 32 L104 54 L118 34 L124 58 L140 44 L140 68 L152 62 L154 94 C140 76 126 70 110 72 C96 66 72 70 46 94Z" ${st}/>${shine}`;
    default: // hair_short
      return `<path d="M46 92 C44 50 72 34 100 34 C128 34 156 50 154 92 C146 74 132 64 118 70 C110 60 92 58 84 68 C70 62 54 72 46 92Z" ${st}/>${shine}`;
  }
}

/* ---------- 몸 · 옷 ---------- */
function bodyArt(robeId, skin) {
  const r = ROBE[robeId] || ROBE.robe_brown;
  return `<path d="M68 150 Q100 138 132 150 L146 220 Q100 234 54 220Z" fill="${r.base}" stroke="${ART_LINE}" stroke-width="3.5" stroke-linejoin="round"/>
    <path d="M100 146 L100 226" stroke="${r.lo}" stroke-width="3" opacity=".55"/>
    <path d="M86 146 L100 166 L114 146" fill="${skin[0]}" stroke="${ART_LINE}" stroke-width="3" stroke-linejoin="round"/>
    <path d="M56 214 Q100 228 144 214" fill="none" stroke="${r.trim}" stroke-width="4"/>
    ${robeId === 'robe_star' ? `<g fill="${r.trim}">${[[74, 196], [120, 204], [96, 186], [130, 178], [70, 172]].map(([x, y]) => `<path d="M${x} ${y} l2 5 5 2 -5 2 -2 5 -2 -5 -5 -2 5 -2z"/>`).join('')}</g>` : ''}`;
}
function beltArt(id) {
  if (id && id.startsWith('belt_')) {
    const t = TIER[tierOf(id)];
    return `<path d="M60 184 Q100 196 140 184 L141 194 Q100 206 59 194Z" fill="${t.base}" stroke="${ART_LINE}" stroke-width="3" stroke-linejoin="round"/>
      <rect x="92" y="188" width="16" height="12" rx="3" fill="${t.hi}" stroke="${ART_LINE}" stroke-width="2.5"/><path d="M60 188 Q100 199 140 188" stroke="${t.hi}" stroke-width="1.5" fill="none" opacity=".8"/>`;
  }
  return `<path d="M60 188 Q100 199 140 188" fill="none" stroke="#7a5233" stroke-width="5" stroke-linecap="round"/><path d="M104 196 l-2 14 M108 195 l3 13" stroke="#7a5233" stroke-width="3" stroke-linecap="round"/>`;
}
function chestArt(id) {
  if (!id) return '';
  const t = TIER[tierOf(id)];
  return `<path d="M76 152 Q100 144 124 152 L121 182 Q100 190 79 182Z" fill="${t.base}" stroke="${ART_LINE}" stroke-width="3" stroke-linejoin="round"/>
    <path d="M84 158 Q100 152 114 158" stroke="${t.hi}" stroke-width="3" fill="none" stroke-linecap="round"/>
    <path d="M100 160 v16 M93 167 h14" stroke="${t.lo}" stroke-width="3" stroke-linecap="round"/>`;
}
function feetArt(id) {
  const t = id ? TIER[tierOf(id)] : { base: '#8a5a36', hi: '#b7845a' };
  const wing = id ? `<path d="M64 222 q-10 -6 -12 -14 q8 2 12 8z M136 222 q10 -6 12 -14 q-8 2 -12 8z" fill="#fff" stroke="${ART_LINE}" stroke-width="2"/>` : '';
  return `${wing}<ellipse cx="82" cy="228" rx="15" ry="8" fill="${t.base}" stroke="${ART_LINE}" stroke-width="3"/><ellipse cx="118" cy="228" rx="15" ry="8" fill="${t.base}" stroke="${ART_LINE}" stroke-width="3"/>
    <path d="M74 225 q6 -3 12 0 M110 225 q6 -3 12 0" stroke="${t.hi}" stroke-width="2.5" fill="none" stroke-linecap="round"/>`;
}

/* ---------- 손 도구 ---------- */
function handRArt(id) {
  // 오른손(화면 오른쪽) 위치 140,196
  if (!id) return '';
  if (id === 'staff') {
    return `<path d="M146 236 L146 112 Q146 94 132 94 Q120 94 122 106" fill="none" stroke="#8a5a36" stroke-width="7" stroke-linecap="round"/><path d="M146 236 L146 112 Q146 94 132 94 Q120 94 122 106" fill="none" stroke="#b7845a" stroke-width="2.5" stroke-linecap="round"/>`;
  }
  if (id === 'scroll') {
    return `<g transform="rotate(-18 150 186)"><rect x="140" y="168" width="22" height="36" rx="4" fill="#fbf1d6" stroke="${ART_LINE}" stroke-width="2.5"/><rect x="136" y="164" width="30" height="7" rx="3.5" fill="#c99a5b" stroke="${ART_LINE}" stroke-width="2.5"/><rect x="136" y="201" width="30" height="7" rx="3.5" fill="#c99a5b" stroke="${ART_LINE}" stroke-width="2.5"/><path d="M145 180 h12 M145 186 h10 M145 192 h12" stroke="#b49a6a" stroke-width="2"/></g>`;
  }
  if (id.startsWith('sword_')) {
    const t = TIER[tierOf(id)];
    return `<g><path d="M148 118 L156 112 L160 186 L150 188Z" fill="${t.hi}" stroke="${ART_LINE}" stroke-width="2.5" stroke-linejoin="round"/><path d="M152 120 L156 184" stroke="${t.base}" stroke-width="2"/>
      <rect x="138" y="186" width="34" height="8" rx="4" fill="${t.base}" stroke="${ART_LINE}" stroke-width="2.5"/><rect x="150" y="193" width="9" height="16" rx="3" fill="#7a5233" stroke="${ART_LINE}" stroke-width="2.5"/>
      <circle cx="154.5" cy="212" r="4.5" fill="${t.base}" stroke="${ART_LINE}" stroke-width="2"/><path d="M160 130 l3 -6 m-1 14 l5 -3" stroke="#fff" stroke-width="2" stroke-linecap="round"/></g>`;
  }
  return '';
}
function handLArt(id) {
  // 왼손(화면 왼쪽) 위치 60,196
  if (!id) return '';
  if (id === 'lamp') {
    return `<g><circle cx="44" cy="176" r="18" fill="#ffe28a" opacity=".45"/><path d="M30 196 Q44 210 60 196 Q56 188 44 188 Q34 188 30 196Z" fill="#d7a24a" stroke="${ART_LINE}" stroke-width="2.5" stroke-linejoin="round"/>
      <path d="M58 194 q8 -2 10 4" fill="none" stroke="${ART_LINE}" stroke-width="2.5"/><path d="M36 186 Q40 172 42 168 Q46 176 46 186Z" fill="#ffb347" stroke="#e07b22" stroke-width="1.5"/><path d="M40 184 Q42 178 42 175 Q44 180 44 184Z" fill="#fff3b0"/></g>`;
  }
  if (id.startsWith('shield_')) {
    const t = TIER[tierOf(id)];
    return `<g><path d="M30 162 Q46 154 62 162 L60 196 Q46 214 32 196Z" fill="${t.base}" stroke="${ART_LINE}" stroke-width="3" stroke-linejoin="round"/>
      <path d="M36 166 Q46 161 56 166 L55 194 Q46 206 37 194Z" fill="none" stroke="${t.hi}" stroke-width="2"/><path d="M46 170 v26 M38 180 h16" stroke="${t.lo === undefined ? '#fff' : t.hi}" stroke-width="4" stroke-linecap="round"/></g>`;
  }
  return '';
}

/* ---------- 머리 장식 ---------- */
function headArt(id) {
  if (!id) return '';
  if (id === 'scarf') {
    return `<path d="M42 92 C40 44 70 26 100 26 C130 26 160 44 158 92 L160 132 Q150 136 144 128 L142 94 C132 70 68 70 58 94 L56 128 Q50 136 40 132Z" fill="#f4ead2" stroke="${ART_LINE}" stroke-width="3.5" stroke-linejoin="round"/>
      <path d="M50 70 Q100 50 150 70" fill="none" stroke="#5b8fd6" stroke-width="7"/><path d="M50 70 Q100 50 150 70" fill="none" stroke="#9cc0ef" stroke-width="2"/>`;
  }
  if (id === 'straw_hat') {
    return `<ellipse cx="100" cy="56" rx="72" ry="16" fill="#efcd7a" stroke="${ART_LINE}" stroke-width="3.5"/><path d="M62 54 Q64 22 100 20 Q136 22 138 54Z" fill="#f4d98f" stroke="${ART_LINE}" stroke-width="3.5" stroke-linejoin="round"/>
      <path d="M64 48 Q100 56 136 48" stroke="#d9655b" stroke-width="6" fill="none"/><path d="M76 34 l6 4 M96 28 l3 5 M116 30 l-2 5" stroke="#d1aa55" stroke-width="2"/>`;
  }
  if (id === 'laurel') {
    const leaves = [];
    for (let i = 0; i < 7; i++) {
      const a = Math.PI * (0.95 + i * 0.13);
      const x = 100 + Math.cos(a) * 54;
      const y = 72 + Math.sin(a) * 34;
      leaves.push(`<ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="9" ry="5" transform="rotate(${(a * 57.3 + 90).toFixed(0)} ${x.toFixed(1)} ${y.toFixed(1)})"/>`, `<ellipse cx="${(200 - x).toFixed(1)}" cy="${y.toFixed(1)}" rx="9" ry="5" transform="rotate(${(-(a * 57.3 + 90)).toFixed(0)} ${(200 - x).toFixed(1)} ${y.toFixed(1)})"/>`);
    }
    return `<g fill="#7cc46a" stroke="#3f7a3a" stroke-width="2">${leaves.join('')}</g><circle cx="100" cy="40" r="5" fill="#f6d76b" stroke="#c99a2e" stroke-width="2"/>`;
  }
  if (id.startsWith('helmet_')) {
    const t = TIER[tierOf(id)];
    return `<path d="M44 84 C44 40 72 24 100 24 C128 24 156 40 156 84 L144 86 C140 64 124 54 100 54 C76 54 60 64 56 86Z" fill="${t.base}" stroke="${ART_LINE}" stroke-width="3.5" stroke-linejoin="round"/>
      <path d="M100 24 Q112 8 128 12 Q118 18 116 30" fill="#e0574e" stroke="${ART_LINE}" stroke-width="3" stroke-linejoin="round"/>
      <path d="M62 50 Q80 34 100 32" stroke="${t.hi}" stroke-width="5" fill="none" stroke-linecap="round"/><path d="M100 26 V54" stroke="${t.lo}" stroke-width="3"/>`;
  }
  if (id === 'halo_flower') {
    return `<g>${[60, 80, 100, 120, 140].map((x, i) => `<g transform="translate(${x} ${i === 2 ? 30 : i % 2 ? 36 : 46})"><circle r="8" fill="${['#ff9fb8', '#ffd36b', '#fff', '#b69cff', '#ff9fb8'][i]}" stroke="${ART_LINE}" stroke-width="2"/><circle r="3" fill="#ffb347"/></g>`).join('')}</g>`;
  }
  return '';
}

/* ---------- 동물 친구 ---------- */
function petArt(id) {
  if (id === 'pet_lamb') {
    return `<g transform="translate(18 182)"><g fill="#fff" stroke="${ART_LINE}" stroke-width="2.5">${[[14, 24, 12], [28, 18, 13], [42, 24, 12], [22, 34, 11], [36, 34, 11]].map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}"/>`).join('')}</g>
      <path d="M18 44 v10 M38 44 v10" stroke="${ART_LINE}" stroke-width="4" stroke-linecap="round"/>
      <ellipse cx="50" cy="16" rx="11" ry="10" fill="#f6e3d7" stroke="${ART_LINE}" stroke-width="2.5"/><ellipse cx="42" cy="10" rx="6" ry="3.5" fill="#f6e3d7" stroke="${ART_LINE}" stroke-width="2" transform="rotate(-30 42 10)"/>
      <circle cx="47" cy="15" r="2" fill="${ART_LINE}"/><circle cx="54" cy="15" r="2" fill="${ART_LINE}"/><ellipse cx="50" cy="20" rx="2.5" ry="1.6" fill="#ff9fb8"/></g>`;
  }
  if (id === 'pet_dove') {
    return `<g transform="translate(150 2)"><path d="M10 26 Q20 8 38 14 Q50 18 46 30 Q36 40 18 36Z" fill="#fff" stroke="${ART_LINE}" stroke-width="2.5" stroke-linejoin="round"/>
      <path d="M22 22 Q30 0 46 4 Q38 14 34 26Z" fill="#f1f5ff" stroke="${ART_LINE}" stroke-width="2.5" stroke-linejoin="round"/><circle cx="42" cy="22" r="2" fill="${ART_LINE}"/><path d="M47 24 l6 2 -6 2z" fill="#ffb347"/>
      <path d="M2 30 q6 -4 10 -2" stroke="#8fcf5a" stroke-width="3" fill="none" stroke-linecap="round"/><ellipse cx="4" cy="27" rx="4" ry="2.4" fill="#8fcf5a"/></g>`;
  }
  if (id === 'pet_donkey') {
    return `<g transform="translate(10 176)"><ellipse cx="30" cy="36" rx="24" ry="15" fill="#b7a59a" stroke="${ART_LINE}" stroke-width="2.5"/>
      <path d="M14 46 v14 M24 48 v12 M38 48 v12 M46 46 v14" stroke="${ART_LINE}" stroke-width="4" stroke-linecap="round"/>
      <ellipse cx="56" cy="20" rx="12" ry="14" fill="#c9b8ad" stroke="${ART_LINE}" stroke-width="2.5"/><ellipse cx="50" cy="2" rx="4" ry="10" fill="#c9b8ad" stroke="${ART_LINE}" stroke-width="2.5"/><ellipse cx="62" cy="2" rx="4" ry="10" fill="#c9b8ad" stroke="${ART_LINE}" stroke-width="2.5"/>
      <ellipse cx="57" cy="28" rx="8" ry="5" fill="#efe3da"/><circle cx="52" cy="18" r="2" fill="${ART_LINE}"/><circle cx="61" cy="18" r="2" fill="${ART_LINE}"/></g>`;
  }
  if (id === 'pet_fish') {
    return `<g transform="translate(150 196)"><path d="M4 18 Q20 2 38 18 Q20 34 4 18Z" fill="#7cc3ea" stroke="${ART_LINE}" stroke-width="2.5"/><path d="M38 18 l10 -9 v18z" fill="#7cc3ea" stroke="${ART_LINE}" stroke-width="2.5" stroke-linejoin="round"/><circle cx="14" cy="15" r="2.2" fill="${ART_LINE}"/><path d="M20 12 q4 6 0 12" stroke="#d6f0ff" stroke-width="2" fill="none"/></g>`;
  }
  return '';
}

/* ---------- 얼굴 ---------- */
function faceArt(skin, mood) {
  const mouth = mood === 'cheer' ? `<path d="M90 116 Q100 130 110 116Z" fill="#9b3d4a" stroke="${ART_LINE}" stroke-width="2.5" stroke-linejoin="round"/><path d="M95 122 Q100 126 105 122" fill="#ff8a9a"/>` : mood === 'sad' ? `<path d="M93 122 Q100 116 107 122" fill="none" stroke="${ART_LINE}" stroke-width="3" stroke-linecap="round"/>` : `<path d="M92 117 Q100 125 108 117" fill="none" stroke="${ART_LINE}" stroke-width="3" stroke-linecap="round"/>`;
  const eyes = mood === 'cheer' ? `<path d="M72 102 Q80 92 88 102 M112 102 Q120 92 128 102" fill="none" stroke="${ART_LINE}" stroke-width="4" stroke-linecap="round"/>` : `<ellipse cx="80" cy="100" rx="8" ry="10" fill="#2b2238"/><ellipse cx="120" cy="100" rx="8" ry="10" fill="#2b2238"/>
      <circle cx="83" cy="96" r="3.2" fill="#fff"/><circle cx="123" cy="96" r="3.2" fill="#fff"/><circle cx="78" cy="104" r="1.5" fill="#fff"/><circle cx="118" cy="104" r="1.5" fill="#fff"/>`;
  return `<circle cx="100" cy="92" r="54" fill="${skin[0]}" stroke="${ART_LINE}" stroke-width="3.5"/>
    <ellipse cx="100" cy="140" rx="30" ry="6" fill="${skin[1]}" opacity=".35"/>
    ${eyes}
    <path d="M72 86 q8 -5 16 -1 M112 85 q8 -4 16 1" fill="none" stroke="${ART_LINE}" stroke-width="2.5" stroke-linecap="round" opacity=".7"/>
    <ellipse cx="68" cy="114" rx="9" ry="5.5" fill="#ff8fa3" opacity=".5"/><ellipse cx="132" cy="114" rx="9" ry="5.5" fill="#ff8fa3" opacity=".5"/>
    ${mouth}`;
}
function earsArt(skin) {
  return `<circle cx="47" cy="98" r="9" fill="${skin[0]}" stroke="${ART_LINE}" stroke-width="3"/><circle cx="153" cy="98" r="9" fill="${skin[0]}" stroke="${ART_LINE}" stroke-width="3"/>`;
}
function armsArt(robeId, skin, look) {
  const r = ROBE[robeId] || ROBE.robe_brown;
  const lHand = look.handL ? 'M70 160 Q54 172 52 194' : 'M70 160 Q58 176 60 196';
  const rHand = look.handR ? 'M130 160 Q146 172 148 192' : 'M130 160 Q142 176 140 196';
  const lx = look.handL ? 52 : 60;
  const ly = look.handL ? 196 : 198;
  const rx = look.handR ? 148 : 140;
  const ry = look.handR ? 194 : 198;
  return `<path d="${lHand}" fill="none" stroke="${ART_LINE}" stroke-width="20" stroke-linecap="round"/><path d="${lHand}" fill="none" stroke="${r.base}" stroke-width="13" stroke-linecap="round"/>
    <path d="${rHand}" fill="none" stroke="${ART_LINE}" stroke-width="20" stroke-linecap="round"/><path d="${rHand}" fill="none" stroke="${r.base}" stroke-width="13" stroke-linecap="round"/>
    <circle cx="${lx}" cy="${ly}" r="8.5" fill="${skin[0]}" stroke="${ART_LINE}" stroke-width="3"/><circle cx="${rx}" cy="${ry}" r="8.5" fill="${skin[0]}" stroke="${ART_LINE}" stroke-width="3"/>`;
}

/** 캐릭터 SVG 문자열. look = { skin, hair, hairColor, robe, head, handR, handL, chest, belt, feet, pet, bg } */
function avatarSvg(look = {}, { mood = 'smile', size = 200, frame = true } = {}) {
  const skin = SKIN[look.skin] || SKIN.s1;
  const hc = HAIR_COLOR[look.hairColor] || HAIR_COLOR.black;
  const hair = look.hair || 'hair_short';
  const covered = look.head === 'scarf' || (look.head || '').startsWith('helmet_');
  const h = Math.round((size * 250) / 200);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 250" width="${size}" height="${h}" role="img" aria-label="내 캐릭터">
    ${frame ? bgArt(look.bg) : ''}
    <ellipse cx="100" cy="236" rx="48" ry="7" fill="#000" opacity=".12"/>
    ${look.pet === 'pet_dove' ? '' : petArt(look.pet)}
    ${covered ? '' : hairBack(hair, hc)}
    ${feetArt(look.feet)}
    ${bodyArt(look.robe, skin)}
    ${chestArt(look.chest)}
    ${beltArt(look.belt)}
    ${handLArt(look.handL)}
    ${armsArt(look.robe, skin, look)}
    ${handRArt(look.handR)}
    ${covered ? '' : earsArt(skin)}
    ${faceArt(skin, mood)}
    ${covered ? '' : hairFront(hair, hc)}
    ${headArt(look.head)}
    ${look.pet === 'pet_dove' ? petArt(look.pet) : ''}
  </svg>`;
}

/* ---------- 여정 1: 천로역정 순례길 지도 ---------- */
const PILGRIM_STOPS = [
  { name: '멸망의 도시', x: 70, y: 470, icon: 'city', ly: 36 },
  { name: '좁은 문', x: 190, y: 452, icon: 'gate', ly: 36 },
  { name: '낙심의 늪', x: 290, y: 404, icon: 'swamp', ly: 36 },
  { name: '해석자의 집', x: 190, y: 366, icon: 'house', ly: -24 },
  { name: '십자가 언덕', x: 80, y: 322, icon: 'cross', ly: 36 },
  { name: '곤고의 산', x: 170, y: 270, icon: 'hill', lx: -24, ly: 5, la: 'end' },
  { name: '아름다운 궁전', x: 284, y: 232, icon: 'palace', ly: 36 },
  { name: '겸손의 골짜기', x: 200, y: 188, icon: 'valley', lx: 12, ly: -20, la: 'start' },
  { name: '어두운 골짜기', x: 86, y: 150, icon: 'dark', ly: 36 },
  { name: '허영의 시장', x: 168, y: 106, icon: 'market', lx: -24, ly: 5, la: 'end' },
  { name: '기쁨의 산', x: 282, y: 76, icon: 'joy', ly: 36 },
  { name: '천성', x: 186, y: 40, icon: 'celestial', lx: -24, ly: 5, la: 'end' },
];
function stopIcon(kind, done) {
  const c = done ? '#fff' : '#9a8a73';
  switch (kind) {
    case 'gate':
      return `<path d="M-8 8 V-4 Q0 -12 8 -4 V8" fill="none" stroke="${c}" stroke-width="2.5"/>`;
    case 'swamp':
      return `<path d="M-9 4 q3 -3 6 0 t6 0 t6 0" fill="none" stroke="${c}" stroke-width="2.5"/><path d="M-6 -2 q3 -3 6 0 t6 0" fill="none" stroke="${c}" stroke-width="2"/>`;
    case 'house':
      return `<path d="M-8 8 V-1 L0 -8 L8 -1 V8Z" fill="none" stroke="${c}" stroke-width="2.5" stroke-linejoin="round"/>`;
    case 'cross':
      return `<path d="M0 -9 V9 M-6 -3 H6" stroke="${c}" stroke-width="3" stroke-linecap="round"/>`;
    case 'hill':
      return `<path d="M-10 7 L-2 -7 L3 1 L6 -3 L10 7Z" fill="none" stroke="${c}" stroke-width="2.5" stroke-linejoin="round"/>`;
    case 'palace':
      return `<path d="M-9 8 V-2 H-5 V-6 H-1 V-2 H1 V-6 H5 V-2 H9 V8Z" fill="none" stroke="${c}" stroke-width="2.2" stroke-linejoin="round"/>`;
    case 'valley':
      return `<path d="M-10 -6 L0 6 L10 -6" fill="none" stroke="${c}" stroke-width="2.5" stroke-linejoin="round"/>`;
    case 'dark':
      return `<path d="M3 -8 A8 8 0 1 0 8 4 A6 6 0 1 1 3 -8Z" fill="${c}"/>`;
    case 'market':
      return `<path d="M-9 -3 H9 L7 -8 H-7Z M-7 -3 V8 H7 V-3" fill="none" stroke="${c}" stroke-width="2.2" stroke-linejoin="round"/>`;
    case 'joy':
      return `<path d="M0 -9 l2.6 6 6.4 .6 -4.8 4.2 1.4 6.2 -5.6 -3.3 -5.6 3.3 1.4 -6.2 -4.8 -4.2 6.4 -.6z" fill="${c}"/>`;
    case 'celestial':
      return `<path d="M-9 8 V-2 L-5 -6 V-9 M5 -9 V-6 L9 -2 V8 M-3 8 V2 Q0 -2 3 2 V8" fill="none" stroke="${c}" stroke-width="2.2" stroke-linejoin="round"/>`;
    default:
      return `<path d="M-8 8 V-4 H-3 V-8 H3 V-4 H8 V8Z" fill="none" stroke="${c}" stroke-width="2.2" stroke-linejoin="round"/>`;
  }
}
function pilgrimMapSvg(reached, look) {
  const path = PILGRIM_STOPS.map((s, i) => `${i ? 'L' : 'M'}${s.x} ${s.y}`).join(' ');
  const cur = PILGRIM_STOPS[Math.min(reached, PILGRIM_STOPS.length - 1)];
  const done = PILGRIM_STOPS.slice(0, reached + 1).map((s, i) => `${i ? 'L' : 'M'}${s.x} ${s.y}`).join(' ');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 510" class="gm-map" role="img" aria-label="순례길 지도">
    <defs><linearGradient id="gmParch" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff4d9"/><stop offset="1" stop-color="#f3e2bb"/></linearGradient>
    <radialGradient id="gmGlow"><stop offset="0" stop-color="#fff8c9"/><stop offset="1" stop-color="#fff8c9" stop-opacity="0"/></radialGradient></defs>
    <rect width="360" height="510" rx="24" fill="url(#gmParch)"/>
    <g opacity=".5"><path d="M20 420 q30 -16 60 0" stroke="#d8c08f" stroke-width="3" fill="none"/><path d="M240 300 q30 -16 60 0" stroke="#d8c08f" stroke-width="3" fill="none"/><path d="M30 220 q20 -12 40 0" stroke="#d8c08f" stroke-width="3" fill="none"/></g>
    <circle cx="186" cy="34" r="46" fill="url(#gmGlow)"/>
    <path d="${path}" fill="none" stroke="#d6c3a0" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="${path}" fill="none" stroke="#fff" stroke-width="3" stroke-dasharray="2 10" stroke-linecap="round"/>
    <path d="${done}" fill="none" stroke="#8fcf5a" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>
    ${PILGRIM_STOPS.map((s, i) => {
      const ok = i <= reached;
      return `<g transform="translate(${s.x} ${s.y})"><circle r="17" fill="${ok ? (i === PILGRIM_STOPS.length - 1 ? '#ebbb3a' : '#1b5fc4') : '#efe2c6'}" stroke="${ART_LINE}" stroke-width="2.5"/>${stopIcon(s.icon, ok)}
        <text x="${s.lx || 0}" y="${s.ly || 33}" text-anchor="${s.la || 'middle'}" font-size="12" font-weight="700" fill="${ok ? '#12408a' : '#8b7a60'}" font-family="Noto Sans KR, sans-serif" paint-order="stroke" stroke="#fff4d9" stroke-width="4">${s.name}</text></g>`;
    }).join('')}
    <g transform="translate(${cur.x - 4} ${cur.y - 72}) scale(.24)">${avatarSvg(look, { frame: false }).replace(/^<svg[^>]*>|<\/svg>$/g, '')}</g>
  </svg>`;
}

/* ---------- 여정 3: 시편 1편 나무 ---------- */
const FRUITS = [
  ['사랑', '#ff6b81'],
  ['희락', '#ffb347'],
  ['화평', '#7cc3ea'],
  ['오래 참음', '#9b7bd8'],
  ['자비', '#ff9fb8'],
  ['양선', '#8fcf5a'],
  ['충성', '#e0574e'],
  ['온유', '#f6d76b'],
  ['절제', '#5fb3a1'],
];
// 열매 자리: 나뭇잎 덩어리 중심에서의 상대 위치 (나뭇잎 반지름 단위)
const FRUIT_POS = [[-0.55, -0.55], [0.15, -0.95], [0.75, -0.5], [-1.2, 0.05], [-0.35, -0.05], [0.4, 0.05], [1.2, 0.1], [-0.7, 0.55], [0.75, 0.6]];
function treeSvg(stage, ripe) {
  // stage 0 씨앗 · 1 싹 · 2 어린나무 · 3 나무 · 4 열매 맺는 큰 나무
  const ground = 300;
  const trunkH = [0, 34, 70, 96, 112][stage];
  const R = [0, 0, 44, 66, 80][stage]; // 나뭇잎 덩어리 크기
  const cx = 186;
  const cy = ground - trunkH - R * 0.35;
  const leaves = stage >= 2
    ? `<g stroke="${ART_LINE}" stroke-width="3">
        <circle cx="${cx - R * 0.95}" cy="${cy + R * 0.2}" r="${R * 0.62}" fill="#62a85e"/><circle cx="${cx + R * 0.95}" cy="${cy + R * 0.2}" r="${R * 0.62}" fill="#62a85e"/>
        <circle cx="${cx}" cy="${cy}" r="${R}" fill="#6fb06a"/>
        <circle cx="${cx - R * 0.5}" cy="${cy - R * 0.55}" r="${R * 0.6}" fill="#7cc46a"/><circle cx="${cx + R * 0.5}" cy="${cy - R * 0.55}" r="${R * 0.6}" fill="#86cf73"/></g>
       <path d="M${cx - R * 0.9} ${cy - R * 0.7} q${R * 0.25} -${R * 0.3} ${R * 0.6} -${R * 0.32}" stroke="#fff" stroke-opacity=".45" stroke-width="6" fill="none" stroke-linecap="round"/>
       <g fill="#4f9150" opacity=".55">${[[-0.3, 0.3], [0.5, 0.45], [-0.8, -0.2], [0.9, -0.15], [0.05, -0.4]].map(([x, y]) => `<path d="M${cx + x * R} ${cy + y * R} q4 -6 9 -2" stroke="#4f9150" stroke-width="2.5" fill="none"/>`).join('')}</g>`
    : '';
  const fruits = stage >= 3
    ? FRUIT_POS.map(([dx, dy], i) => {
        const x = (cx + dx * R).toFixed(1);
        const y = (cy + dy * R).toFixed(1);
        return i < ripe
          ? `<g transform="translate(${x} ${y})"><path d="M0 -10 q2 -7 8 -8" stroke="#3f7a3a" stroke-width="2.5" fill="none" stroke-linecap="round"/><circle r="10.5" fill="${FRUITS[i][1]}" stroke="${ART_LINE}" stroke-width="2.5"/><circle cx="-3.5" cy="-3.5" r="3" fill="#fff" opacity=".75"/></g>`
          : `<circle cx="${x}" cy="${y}" r="6.5" fill="#cfe8bf" stroke="#94bf80" stroke-width="2" stroke-dasharray="3 3"/>`;
      }).join('')
    : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 380" class="gm-tree" role="img" aria-label="시냇가에 심은 나무">
    <defs><linearGradient id="gtSky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d9f1ff"/><stop offset="1" stop-color="#f4fbe9"/></linearGradient></defs>
    <rect width="360" height="380" rx="24" fill="url(#gtSky)"/>
    <circle cx="56" cy="54" r="22" fill="#fff3c4"/><circle cx="56" cy="54" r="34" fill="#fff3c4" opacity=".35"/>
    <path d="M250 52 q12 -14 24 0 q12 -14 24 0" fill="#fff"/>
    <path d="M0 ${ground} Q180 ${ground - 26} 360 ${ground} V380 H0Z" fill="#a9db8f"/>
    <path d="M0 336 Q90 318 180 334 T360 326 V356 Q270 364 180 356 T0 364Z" fill="#7cc3ea" stroke="#5aa6d2" stroke-width="2"/>
    <path d="M30 344 h24 M120 340 h30 M230 336 h26 M300 344 h22" stroke="#e5f6ff" stroke-width="3" stroke-linecap="round"/>
    ${stage === 0 ? `<ellipse cx="${cx}" cy="${ground - 2}" rx="13" ry="8" fill="#8a5a36" stroke="${ART_LINE}" stroke-width="2.5"/><path d="M${cx} ${ground - 9} q-2 -8 5 -13" stroke="#6fb06a" stroke-width="3" fill="none" stroke-linecap="round"/>` : ''}
    ${stage >= 1 ? `<path d="M${cx - 9} ${ground + 2} Q${cx - 13} ${ground - trunkH / 2} ${cx - 5} ${ground - trunkH} L${cx + 5} ${ground - trunkH} Q${cx + 11} ${ground - trunkH / 2} ${cx + 9} ${ground + 2}Z" fill="#9a6a43" stroke="${ART_LINE}" stroke-width="3" stroke-linejoin="round"/>` : ''}
    ${stage === 1 ? `<path d="M${cx} ${ground - trunkH} q-24 -6 -30 -24 q22 0 30 18z M${cx} ${ground - trunkH} q24 -6 30 -24 q-22 0 -30 18z" fill="#7cc46a" stroke="${ART_LINE}" stroke-width="2.5"/>` : ''}
    ${leaves}${fruits}
  </svg>`;
}

/** SVG 문자열 → 화면에 넣을 수 있는 요소 (우리가 만든 그림 문자열만 넣습니다) */
function svgNode(markup) {
  const doc = new DOMParser().parseFromString(markup, 'image/svg+xml');
  return document.importNode(doc.documentElement, true);
}
