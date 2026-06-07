/* ============================================================
 *  선수 객체 생성 — 세부스탯 / 포지션 숙련도 / 역할 산출
 * ============================================================ */

// 결정론적 시드 RNG (이름+번호 기반 → 항상 동일한 세부스탯)
function hashSeed(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const STAT_MIN = 50, STAT_MAX = 80;

// 평균이 ovr에 맞도록 오프셋+노이즈로 분배 후 클램프
function distribute(ovr, offsets, rng) {
  const n = offsets.length;
  let vals = offsets.map(o => ovr + o + Math.round((rng() - 0.5) * 6));
  // 평균 보정
  let mean = vals.reduce((a, b) => a + b, 0) / n;
  let adj = ovr - mean;
  vals = vals.map(v => Math.round(clamp(v + adj, STAT_MIN, STAT_MAX)));
  return vals;
}

// 타자 세부스탯: 파워/주루/컨택/수비
function batterStats(ovr, primaryPos, rng) {
  // 포지션별 성향 오프셋 [pow, spd, con, def]
  const P = {
    C:  [1, -4, 0, 4], '1B': [4, -4, 1, -3], DH: [5, -3, 2, -6],
    '2B': [-2, 3, 2, 2], SS: [-3, 3, 0, 4], '3B': [3, -1, 0, 1],
    LF: [3, 0, 0, -2], CF: [-2, 4, 1, 2], RF: [3, 1, 0, 0],
  };
  const off = P[primaryPos] || [0, 0, 0, 0];
  const [pow, spd, con, def] = distribute(ovr, off, rng);
  return { power: pow, speed: spd, contact: con, defense: def };
}

// 투수 세부스탯: 구속/제구/구위
function pitcherStats(ovr, role, rng) {
  // role: 'SP' 선발, 'CL' 마무리, 'RP' 불펜
  const off = role === 'CL' ? [4, -2, 4] : role === 'SP' ? [-1, 3, 0] : [3, -1, 2];
  const [velo, ctrl, stuff] = distribute(ovr, off, rng);
  return { velo, control: ctrl, stuff };
}

// 포지션 숙련도 파싱 → {C:'A', SS:'B', ...}
function parseProficiency(posStr) {
  const prof = {};
  POS_LIST.forEach(p => prof[p] = 'E');
  if (!posStr) return prof;
  const [primPart, secPart] = posStr.split('|');
  primPart.split(',').forEach(p => { if (p) prof[p.trim()] = 'A'; });
  if (secPart) {
    const grades = ['B', 'C', 'D', 'D', 'D', 'D', 'D'];
    secPart.split(',').forEach((p, i) => { p = p.trim(); if (p && prof[p] === 'E') prof[p] = grades[i] || 'D'; });
  }
  return prof;
}

function primaryOf(posStr) {
  if (!posStr) return 'DH';
  return posStr.split('|')[0].split(',')[0].trim();
}

let _pidCounter = 1;
function buildPlayer(teamId, raw, group, rotation, closer) {
  const [num, name, age, cur, peak, posStr] = raw;
  const seed = hashSeed(teamId + '_' + name + '_' + num);
  const rng = mulberry32(seed);
  const isPitcher = (group === 'P');
  let role = null, primary, prof, stats;

  if (isPitcher) {
    role = (name === closer) ? 'CL' : (rotation.includes(name) ? 'SP' : 'RP');
    stats = pitcherStats(cur, role, rng);
    primary = 'P';
    prof = null;
  } else {
    primary = (group === 'C') ? 'C' : primaryOf(posStr);
    prof = (group === 'C') ? parseProficiency(posStr || 'C') : parseProficiency(posStr);
    if (group === 'C' && !posStr) prof['C'] = 'A';
    stats = batterStats(cur, primary, rng);
  }

  // 스태미나 (투수 역할별) / 타자 체력
  let stamina;
  if (isPitcher) stamina = role === 'SP' ? 88 + Math.round(rng() * 22) : role === 'CL' ? 20 + Math.round(rng() * 6) : 22 + Math.round(rng() * 12);
  else stamina = 100;

  return {
    pid: _pidCounter++, team: teamId, num: num, name, age,
    ovr: cur, cur, peak, group, isPitcher, role, primary, prof,
    stats, stamina,
    // 동적 상태
    level: 1,                 // 1군/2군 (1 or 2)
    fatigue: 0,               // 0~100 누적 피로
    restDays: 0,
    injury: null,             // {type, days}
    form: 0,                  // -5~+5 폼
    // 경기 중 임시
    usedOut: false,
    // 누적 기록
    season: emptyBatLine(),
    pseason: emptyPitchLine(),
  };
}

function emptyBatLine() {
  return { g: 0, pa: 0, ab: 0, h: 0, h2: 0, h3: 0, hr: 0, rbi: 0, r: 0, bb: 0, k: 0, sb: 0, hbp: 0 };
}
function emptyPitchLine() {
  return { g: 0, gs: 0, w: 0, l: 0, sv: 0, hld: 0, outs: 0, h: 0, er: 0, bb: 0, k: 0, hr: 0, bf: 0 };
}

function buildTeam(teamId) {
  const raw = TEAMS_RAW[teamId];
  const players = [];
  const rot = raw.rotation, cl = raw.closer;
  raw.pitchers.forEach(p => players.push(buildPlayer(teamId, p, 'P', rot, cl)));
  raw.catchers.forEach(p => players.push(buildPlayer(teamId, p, 'C', rot, cl)));
  raw.infielders.forEach(p => players.push(buildPlayer(teamId, p, 'IF', rot, cl)));
  raw.outfielders.forEach(p => players.push(buildPlayer(teamId, p, 'OF', rot, cl)));
  return {
    id: teamId, name: raw.name, short: raw.short, code: raw.code, color: raw.color,
    ovr: raw.ovr, difficulty: raw.difficulty, budget: raw.budget, captain: raw.captain,
    rotationNames: raw.rotation.slice(), closerName: raw.closer,
    players,
    // 시즌 성적
    w: 0, l: 0, d: 0, rf: 0, ra: 0, streak: 0,
    rotationIdx: 0,
  };
}

// 계산 헬퍼 ---------------------------------------------------
function avg(b) { return b.ab ? b.h / b.ab : 0; }
function obp(b) { const d = b.ab + b.bb + b.hbp; return d ? (b.h + b.bb + b.hbp) / d : 0; }
function slg(b) { if (!b.ab) return 0; const tb = (b.h - b.h2 - b.h3 - b.hr) + 2 * b.h2 + 3 * b.h3 + 4 * b.hr; return tb / b.ab; }
function ops(b) { return obp(b) + slg(b); }
function era(p) { return p.outs ? (p.er * 27) / p.outs : 0; }
function whip(p) { return p.outs ? (p.bb + p.h) / (p.outs / 3) : 0; }
function ipStr(p) { return Math.floor(p.outs / 3) + ' ' + (p.outs % 3) + '/3'; }
function fmt3(v) { return v.toFixed(3).replace(/^0/, ''); }

if (typeof module !== 'undefined') module.exports = { buildTeam, parseProficiency };
