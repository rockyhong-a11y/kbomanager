/* ============================================================
 *  경기 엔진 — 타석 단위 시뮬레이션 (KBO 규칙)
 *  - DH 사용, 9이닝, 동점시 연장 최대 12이닝(무승부 허용)
 *  - 투수 피로/연투, 부상, 실책, 도루, 폭투 등 변수
 *  - 교체 선수 재출전 불가
 * ============================================================ */

const POS_ORDER_FILL = ['C', 'SS', 'CF', '2B', '3B', 'RF', 'LF', '1B'];

function activeHitters(team, pidsLevel1, P) {
  return team.players.filter(p => !p.isPitcher && pidsLevel1.has(p.pid) && !p.injury);
}
function activePitchers(team, pidsLevel1) {
  return team.players.filter(p => p.isPitcher && pidsLevel1.has(p.pid) && !p.injury);
}

function offValue(p) {
  const s = p.stats;
  return s.contact * 0.5 + s.power * 0.3 + s.speed * 0.2 + (p.form || 0);
}

// 자동 라인업 구성
function buildAutoLineup(team, level1, P, starterPid) {
  const hitters = activeHitters(team, level1, P).slice().sort((a, b) => b.ovr - a.ovr);
  const pitchers = activePitchers(team, level1);
  const assigned = {};            // pos -> pid
  const usedPid = new Set();

  for (const pos of POS_ORDER_FILL) {
    let best = null, bestScore = -1;
    for (const h of hitters) {
      if (usedPid.has(h.pid)) continue;
      const g = h.prof[pos];
      if (g === 'E') continue;
      const gradeBonus = { A: 12, B: 6, C: 2, D: 0 }[g] || 0;
      const sc = h.ovr + gradeBonus;
      if (sc > bestScore) { bestScore = sc; best = h; }
    }
    // 적임자가 없으면 비상 기용(아무 야수)
    if (!best) { best = hitters.find(h => !usedPid.has(h.pid)) || null; }
    if (best) { assigned[pos] = best.pid; usedPid.add(best.pid); }
  }
  // DH = 남은 최고 타자
  let dh = null;
  for (const h of hitters) { if (!usedPid.has(h.pid)) { dh = h; break; } }
  if (dh) { assigned['DH'] = dh.pid; usedPid.add(dh.pid); }

  // 타순: 공격력 순 정렬 후 배치 (간이)
  const starters = Object.values(assigned).map(pid => P(pid));
  starters.sort((a, b) => offValue(b) - offValue(a));
  // 1번=스피드+컨택, 3~4번=파워
  const order = [];
  const byPower = starters.slice().sort((a, b) => b.stats.power - a.stats.power);
  const cleanup = byPower[0], third = byPower[1];
  const rest = starters.filter(p => p !== cleanup && p !== third);
  rest.sort((a, b) => (b.stats.speed + b.stats.contact) - (a.stats.speed + a.stats.contact));
  // 1,2 = rest 상위, 3=third,4=cleanup, 5~9 나머지
  order.push(rest[0], rest[1], third, cleanup, ...rest.slice(2));
  const battingOrder = order.filter(Boolean).map(p => p.pid);
  const posByPid = {};
  for (const [pos, pid] of Object.entries(assigned)) posByPid[pid] = pos;
  // 9명 보장: 부족 시 남은 1군 타자로 보강
  if (battingOrder.length < 9) {
    for (const h of hitters) {
      if (battingOrder.length >= 9) break;
      if (!battingOrder.includes(h.pid)) { battingOrder.push(h.pid); if (!posByPid[h.pid]) posByPid[h.pid] = 'DH'; }
    }
  }

  // 선발투수
  let starter = starterPid ? P(starterPid) : null;
  if (!starter || starter.injury || !level1.has(starter.pid)) {
    starter = pitchers.filter(p => p.role === 'SP').sort((a, b) => b.ovr - a.ovr)[0] || pitchers[0];
  }

  // 불펜 정렬: 미들(낮은 OVR)→셋업→마무리 마지막
  const closer = pitchers.find(p => p.role === 'CL');
  const pen = pitchers.filter(p => p.pid !== starter.pid && p.role !== 'CL').sort((a, b) => a.ovr - b.ovr);
  const bullpen = closer && closer.pid !== starter.pid ? [...pen, closer] : pen;

  const bench = hitters.filter(h => !usedPid.has(h.pid)).map(h => h.pid);

  return { teamId: team.id, battingOrder, posByPid, pitcher: starter.pid, bench, bullpen: bullpen.map(p => p.pid), usedPitchers: new Set([starter.pid]) };
}

// ---- 타석 결과 모델 ----
function simPA(batter, pitcher, pitchCount, P) {
  const bs = batter.stats, ps = pitcher.stats;
  const stam = pitcher.stamina;
  const fatPen = Math.min(14, Math.max(0, (pitchCount - stam)) * 0.22) + (pitcher._timesThrough || 0) * 1.1;
  const battingPow = bs.contact * 0.45 + bs.power * 0.35 + bs.speed * 0.05 + (batter.form || 0) - (batter.fatigue * 0.03);
  const pitchPow = ps.control * 0.35 + ps.stuff * 0.40 + ps.velo * 0.25 - fatPen;
  const diff = (battingPow - pitchPow);          // 대략 -18~+18
  const f = diff * 0.018;

  let p = { bb: 0.085, hbp: 0.011, k: 0.165, hr: 0.033, t: 0.006, d: 0.050, s: 0.160 };
  const powBias = (bs.power - 65) * 0.025;
  const conBias = (bs.contact - 65) * 0.004;
  p.hr *= (1 + f * 1.3 + powBias);
  p.d *= (1 + f * 1.0 + powBias * 0.4 + conBias);
  p.t *= (1 + f * 0.5 + (bs.speed - 65) * 0.02);
  p.s *= (1 + f * 1.0 + conBias);
  p.bb *= (1 + (bs.contact - 65) * 0.006 - f * 0.15);
  p.k *= (1 - f * 0.7 + (ps.stuff - 65) * 0.01);
  // 정규화 (안타+볼넷+삼진+사구 합이 1 넘지 않게)
  for (const k in p) p[k] = Math.max(0, p[k]);
  const hitsbb = p.bb + p.hbp + p.k + p.hr + p.t + p.d + p.s;
  if (hitsbb > 0.92) { const sc = 0.92 / hitsbb; for (const k in p) p[k] *= sc; }
  const out = 1 - (p.bb + p.hbp + p.k + p.hr + p.t + p.d + p.s);

  const r = Math.random();
  let c = 0;
  if (r < (c += p.k)) return 'K';
  if (r < (c += p.bb)) return 'BB';
  if (r < (c += p.hbp)) return 'HBP';
  if (r < (c += p.hr)) return 'HR';
  if (r < (c += p.t)) return '3B';
  if (r < (c += p.d)) return '2B';
  if (r < (c += p.s)) return '1B';
  return 'OUT';
}

const INJ_TYPES = [
  ['햄스트링 불편', 3, 14], ['손목 타박상', 2, 8], ['발목 염좌', 5, 21], ['옆구리 통증', 10, 30],
  ['어깨 피로 누적', 7, 25], ['팔꿈치 염증', 14, 45], ['타구에 맞음(타박)', 1, 6], ['허리 통증', 4, 15],
];

class Game {
  constructor(homeTeam, awayTeam, P, opts = {}) {
    this.P = P;
    this.homeTeam = homeTeam; this.awayTeam = awayTeam;
    this.opts = opts;
    this.exhibition = !!opts.exhibition;
    this.userSide = opts.userSide || null; // 'home' | 'away' | null
    this.lineups = {
      home: opts.homeLineup || buildAutoLineup(homeTeam, opts.homeLevel1, P, opts.homeStarter),
      away: opts.awayLineup || buildAutoLineup(awayTeam, opts.awayLevel1, P, opts.awayStarter),
    };
    this.inning = 1; this.half = 'top';
    this.outs = 0;
    this.bases = [null, null, null];
    this.score = { home: 0, away: 0 };
    this.lineScore = { home: [], away: [] };   // 이닝별 득점
    this.hits = { home: 0, away: 0 };
    this.errors = { home: 0, away: 0 };
    this.battingIdx = { home: 0, away: 0 };
    this.pitchCount = {};
    this.log = [];
    this.finished = false;
    this.winner = null;
    this.events = []; // 주목 이벤트 (부상 등)
    this.pitcherSeq = { home: [this.lineups.home.pitcher], away: [this.lineups.away.pitcher] };
    this.leadWhenEntered = {}; // pid -> 등판 시점 팀 리드
    this.appeared = { home: new Set(), away: new Set() };
    [...this.lineups.home.battingOrder].forEach(p => this.appeared.home.add(p));
    [...this.lineups.away.battingOrder].forEach(p => this.appeared.away.add(p));
    this._initPitchers();
    this.note(`▶ ${awayTeam.name} (원정) vs ${homeTeam.name} (홈) — 경기 시작`);
    this.note(`선발: ${P(this.lineups.away.pitcher).name} (${awayTeam.short}) / ${P(this.lineups.home.pitcher).name} (${homeTeam.short})`);
  }
  _initPitchers() {
    for (const side of ['home', 'away']) {
      const pid = this.lineups[side].pitcher;
      this.pitchCount[pid] = 0;
      const pit = this.P(pid);
      pit._timesThrough = 0; pit._battersFaced = 0; pit._runsAllowed = 0; pit._gameOuts = 0;
      pit._gs = true;
    }
  }
  note(s) { this.log.push(s); }

  battingSide() { return this.half === 'top' ? 'away' : 'home'; }
  fieldingSide() { return this.half === 'top' ? 'home' : 'away'; }
  curBatter() {
    const side = this.battingSide();
    const lu = this.lineups[side];
    return this.P(lu.battingOrder[this.battingIdx[side]]);
  }
  curPitcher() { return this.P(this.lineups[this.fieldingSide()].pitcher); }

  basesDesc() {
    const b = this.bases.map((x, i) => x ? (i + 1) + '루' : null).filter(Boolean);
    return b.length ? b.join('·') + ' 주자' : '주자 없음';
  }

  // 한 타석 진행
  step() {
    if (this.finished) return null;
    const side = this.battingSide(), fside = this.fieldingSide();
    const batter = this.curBatter();
    const pitcher = this.curPitcher();
    const ppid = pitcher.pid;
    const before = { score: { ...this.score }, outs: this.outs };
    const entry = { inning: this.inning, half: this.half, batter: batter.name, pitcher: pitcher.name, lines: [] };

    // 도루 시도 (1루 주자, 2루 비어있음)
    this._maybeSteal(side, entry);

    let outcome = simPA(batter, pitcher, this.pitchCount[ppid], this.P);
    const pitches = 3 + Math.round(Math.random() * 3) + (outcome === 'K' || outcome === 'BB' ? 1 : 0);
    this.pitchCount[ppid] += pitches;
    pitcher._battersFaced++;

    // 기록: 타석
    batter.season.pa++;
    pitcher.pseason.bf++;

    let rbi = 0, runsScored = 0;
    const isAB = !['BB', 'HBP'].includes(outcome);
    if (isAB) batter.season.ab++;

    switch (outcome) {
      case 'K':
        this.outs++; batter.season.k++; pitcher.pseason.k++; pitcher._gameOuts++; pitcher.pseason.outs++;
        entry.lines.push(`${batter.name} 삼진`); break;
      case 'BB':
        batter.season.bb++; pitcher.pseason.bb++;
        runsScored += this._walkAdvance(batter); entry.lines.push(`${batter.name} 볼넷`); break;
      case 'HBP':
        batter.season.hbp++; runsScored += this._walkAdvance(batter); entry.lines.push(`${batter.name} 몸에 맞는 공`);
        if (Math.random() < 0.04) this._injure(batter, entry, true); break;
      case 'HR': {
        const onbase = this.bases.filter(Boolean).length;
        runsScored = onbase + 1; rbi = onbase + 1;
        this.bases = [null, null, null];
        batter.season.h++; batter.season.hr++; batter.season.r++;
        pitcher.pseason.h++; pitcher.pseason.hr++;
        this.hits[side]++;
        entry.lines.push(`💥 ${batter.name} ${onbase === 3 ? '만루 ' : ''}홈런! (${onbase + 1}점)`); break;
      }
      case '3B':
        runsScored += this._hitAdvance(batter, 3, entry); batter.season.h++; batter.season.h3++; this.hits[side]++; pitcher.pseason.h++;
        entry.lines.push(`${batter.name} 3루타`); break;
      case '2B':
        runsScored += this._hitAdvance(batter, 2, entry); batter.season.h++; batter.season.h2++; this.hits[side]++; pitcher.pseason.h++;
        entry.lines.push(`${batter.name} 2루타`); break;
      case '1B':
        runsScored += this._hitAdvance(batter, 1, entry); batter.season.h++; this.hits[side]++; pitcher.pseason.h++;
        entry.lines.push(`${batter.name} 안타`); break;
      default: { // OUT — 인플레이 아웃 (땅볼/뜬공, 실책/병살 변수)
        if (Math.random() < 0.012) { // 실책
          this.errors[fside]++;
          runsScored += this._hitAdvance(batter, 1, entry, true);
          entry.lines.push(`${this.P(this.lineups[fside].pitcher) && ''}${batter.name} 타구 — 야수 실책으로 출루!`);
        } else if (this.outs < 2 && this.bases[0] && Math.random() < 0.13) { // 병살
          this.outs += 2; this.bases[0] = null; pitcher._gameOuts += 2; pitcher.pseason.outs += 2;
          entry.lines.push(`${batter.name} 병살타`);
        } else {
          // 희생플라이 (2루/3루 주자 + 1아웃 이하)
          if (this.outs < 2 && this.bases[2] && Math.random() < 0.35) {
            this.outs++; pitcher._gameOuts++; pitcher.pseason.outs++;
            this.bases[2] = null; runsScored += 1; rbi += 1;
            entry.lines.push(`${batter.name} 희생플라이 (1타점)`);
          } else {
            this.outs++; pitcher._gameOuts++; pitcher.pseason.outs++;
            entry.lines.push(`${batter.name} 범타`);
          }
        }
      }
    }

    // 안타/볼넷으로 들어온 득점은 타점으로 집계 (실책 득점 제외)
    if (['BB', 'HBP', '1B', '2B', '3B'].includes(outcome)) rbi = runsScored;
    batter.season.rbi += rbi;
    if (runsScored) {
      this.score[side] += runsScored;
      this.lineScore[side][this.inning - 1] = (this.lineScore[side][this.inning - 1] || 0) + runsScored;
      pitcher._runsAllowed += runsScored;
      pitcher.pseason.er += runsScored; // 간이: 전부 자책
      if (outcome === 'HR') {/* 득점은 위에서 r++ 처리됨, 주자 득점은 별도 */}
    }

    // 부상 변수 (수비/주루 중)
    if (Math.random() < 0.0009) this._injure(batter, entry, false);
    if (Math.random() < 0.0007 + this.pitchCount[ppid] * 0.000012) this._injurePitcher(pitcher, entry);

    // 타순 진행
    this.battingIdx[side] = (this.battingIdx[side] + 1) % 9;
    if (this.battingIdx[side] === 0) pitcher._timesThrough++;

    entry.scoreAfter = { ...this.score };
    entry.outsAfter = this.outs;
    entry.basesAfter = this.basesDesc();
    entry.lines.forEach(l => this.note(`  ${l}`));

    this._checkHalfEnd();
    this._checkGameEnd();
    return entry;
  }

  _walkAdvance(batter) {
    // 밀어내기 포함
    let runs = 0;
    if (this.bases[0]) {
      if (this.bases[1]) {
        if (this.bases[2]) { runs = 1; this._scoreRunner(this.bases[2]); }
        this.bases[2] = this.bases[1];
      }
      this.bases[1] = this.bases[0];
    }
    this.bases[0] = batter.pid;
    if (runs) batter.season.rbi += 0; // 밀어내기 타점은 호출부에서 미반영→ 여기서 직접
    return runs;
  }
  _scoreRunner(pid) { const r = this.P(pid); if (r) r.season.r++; }

  _hitAdvance(batter, basesNum, entry, isError) {
    let runs = 0;
    const newBases = [null, null, null];
    // 기존 주자 진루 (단타=1~2칸, 2루타=2칸, 3루타=3칸)
    const adv = basesNum;
    for (let i = 2; i >= 0; i--) {
      if (this.bases[i]) {
        const dest = i + adv + (basesNum === 1 && Math.random() < 0.3 ? 1 : 0);
        if (dest >= 3) { runs++; this._scoreRunner(this.bases[i]); }
        else newBases[dest] = this.bases[i];
      }
    }
    // 타자 진루
    const bdest = basesNum - 1 + (isError ? 0 : 0);
    if (bdest >= 3) { runs++; batter.season.r++; }
    else newBases[Math.min(bdest, 2)] = batter.pid;
    this.bases = newBases;
    return runs;
  }

  _maybeSteal(side, entry) {
    if (!this.bases[0] || this.bases[1]) return;
    const runner = this.P(this.bases[0]);
    if (!runner) return;
    const sp = runner.stats.speed;
    const attempt = (sp - 60) * 0.004;
    if (Math.random() < Math.max(0, attempt)) {
      const success = Math.random() < (0.55 + (sp - 65) * 0.02);
      if (success) {
        this.bases[1] = this.bases[0]; this.bases[0] = null;
        runner.season.sb++;
        entry.lines.push(`${runner.name} 도루 성공 (2루)`);
      } else {
        this.outs++; this.bases[0] = null;
        const pit = this.curPitcher(); pit._gameOuts++; pit.pseason.outs++;
        entry.lines.push(`${runner.name} 도루 실패 (포수 송구 아웃)`);
      }
    }
  }

  _injure(player, entry, fromHBP) {
    const t = INJ_TYPES[Math.floor(Math.random() * INJ_TYPES.length)];
    const days = t[1] + Math.floor(Math.random() * (t[2] - t[1]));
    player.injury = { type: t[0], days };
    entry.lines.push(`🚑 ${player.name} ${t[0]} — 부상 (예상 ${days}일)`);
    this.events.push({ type: 'injury', team: player.team, player: player.name, desc: t[0], days });
  }
  _injurePitcher(player, entry) {
    const t = INJ_TYPES[Math.floor(Math.random() * INJ_TYPES.length)];
    const days = t[1] + Math.floor(Math.random() * (t[2] - t[1]));
    player.injury = { type: t[0], days };
    entry.lines.push(`🚑 투수 ${player.name} ${t[0]} — 부상 (예상 ${days}일), 교체 필요`);
    this.events.push({ type: 'injury', team: player.team, player: player.name, desc: t[0], days });
    player._mustReplace = true;
  }

  _checkHalfEnd() {
    if (this.outs >= 3) {
      this.outs = 0; this.bases = [null, null, null];
      if (this.half === 'top') { this.half = 'bot'; }
      else { this.half = 'top'; this.inning++; }
      // 새 이닝/하프 자동 투수관리 (수비팀)
      this.note(`— ${this.inning}회 ${this.half === 'top' ? '초' : '말'} —`);
    }
  }

  _checkGameEnd() {
    const { home, away } = this.score;
    // 9회 이상, 말 진행/시작 시점에 홈 리드 → 종료 (끝내기 또는 9회초 후 말 생략)
    if (this.half === 'bot' && this.inning >= 9 && home > away) return this._finish();
    // 한 이닝(말)이 막 끝난 직후: _checkHalfEnd가 half=top, inning 증가시킴
    if (this.half === 'top') {
      const completed = this.inning - 1;
      if (completed >= 9 && home !== away) return this._finish();   // 9회 이상 + 점수차 → 종료
      if (completed >= 12) return this._finish();                   // 12회까지 동점 → 무승부
    }
  }

  _finish() {
    if (this.finished) return;
    this.finished = true;
    const { home, away } = this.score;
    this.winner = home > away ? 'home' : away > home ? 'away' : 'draw';
    const sp = { home: this.lineups.home.pitcher, away: this.lineups.away.pitcher };
    // 승패/세이브/홀드는 game.js 집계에서 처리
    this.note(`■ 경기 종료 — ${this.awayTeam.short} ${away} : ${home} ${this.homeTeam.short} (${this.winner === 'draw' ? '무승부' : (this.winner === 'home' ? this.homeTeam.short : this.awayTeam.short) + ' 승'})`);
  }

  // 교체 ----------------------------------------------------
  pinchHit(side, newPid) {
    const lu = this.lineups[side];
    const idx = this.battingIdx[side];
    const oldPid = lu.battingOrder[idx];
    const np = this.P(newPid), op = this.P(oldPid);
    lu.battingOrder[idx] = newPid;
    lu.posByPid[newPid] = lu.posByPid[oldPid]; delete lu.posByPid[oldPid];
    lu.bench = lu.bench.filter(x => x !== newPid);
    op.usedOut = true;
    this.appeared[side].add(newPid);
    this.note(`  ↔ 대타: ${op.name} → ${np.name}`);
    return true;
  }
  defSub(side, outPid, newPid, pos) {
    const lu = this.lineups[side];
    const idx = lu.battingOrder.indexOf(outPid);
    if (idx < 0) return false;
    const np = this.P(newPid), op = this.P(outPid);
    lu.battingOrder[idx] = newPid;
    lu.posByPid[newPid] = pos || lu.posByPid[outPid];
    delete lu.posByPid[outPid];
    lu.bench = lu.bench.filter(x => x !== newPid);
    op.usedOut = true;
    this.appeared[side].add(newPid);
    this.note(`  ↔ 대수비/교체: ${op.name} → ${np.name} (${lu.posByPid[newPid]})`);
    return true;
  }
  changePitcher(side, newPid) {
    const lu = this.lineups[side];
    const oldPid = lu.pitcher;
    const np = this.P(newPid), op = this.P(oldPid);
    lu.pitcher = newPid;
    lu.bullpen = lu.bullpen.filter(x => x !== newPid);
    lu.usedPitchers.add(newPid);
    this.pitcherSeq[side].push(newPid);
    this.leadWhenEntered[newPid] = this.score[side] - this.score[side === 'home' ? 'away' : 'home'];
    op.usedOut = true; op._mustReplace = false;
    this.pitchCount[newPid] = this.pitchCount[newPid] || 0;
    np._timesThrough = 0; np._battersFaced = 0; np._runsAllowed = np._runsAllowed || 0;
    np._gameOuts = np._gameOuts || 0;
    this.note(`  ⚾ 투수교체: ${op.name} → ${np.name}`);
    return true;
  }

  // AI 자동 운영 (해당 side가 사용자가 아닐 때 매 스텝 호출)
  autoManage(side) {
    const lu = this.lineups[side];
    const pit = this.P(lu.pitcher);
    const pc = this.pitchCount[lu.pitcher];
    const isLosingBigOrTired = pit._mustReplace
      || (pit.role === 'SP' && (pc > pit.stamina + 8 || pit._runsAllowed >= 6))
      || (pit.role !== 'SP' && pit._battersFaced >= 5 + Math.floor(Math.random() * 3));
    // 9회 세이브 상황 → 마무리
    const fside = side;
    const lead = this.score[fside] - this.score[fside === 'home' ? 'away' : 'home'];
    if (lu.bullpen.length) {
      const closerId = lu.bullpen[lu.bullpen.length - 1];
      const closer = this.P(closerId);
      if (this.inning >= 9 && this.half === (fside === 'home' ? 'top' : 'bot') && lead > 0 && lead <= 3 && pit.role !== 'CL' && closer && closer.role === 'CL') {
        this.changePitcher(side, closerId); return;
      }
      if (isLosingBigOrTired) {
        // 마무리는 세이브 상황 외 아끼기
        let cand = lu.bullpen.filter(id => this.P(id).role !== 'CL');
        if (!cand.length) cand = lu.bullpen.slice();
        if (cand.length) this.changePitcher(side, cand[0]);
      }
    }
  }
}

if (typeof module !== 'undefined') module.exports = { Game, buildAutoLineup };
