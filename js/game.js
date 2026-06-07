/* ============================================================
 *  LEAGUE — 리그 전체 운영 컨트롤러
 * ============================================================ */

const TEAM_IDS = ['kiwoom', 'nc', 'ssg', 'lg', 'doosan', 'samsung', 'kia', 'hanwha', 'kt', 'lotte'];
const ENTRY_MAX = 28;

const LEAGUE = {
  teams: {}, playersById: {}, userTeam: null,
  schedule: null, phase: 'preseason', dayIdx: 0, date: '',
  level1: {}, news: [], transactions: [], results: [],
  postseason: null, lastMonth: 3, tradeDeadline: '2026-07-31',
};

function getP(pid) { return LEAGUE.playersById[pid]; }

function initLeague(userTeamId) {
  LEAGUE.userTeam = userTeamId;
  LEAGUE.teams = {}; LEAGUE.playersById = {};
  for (const id of TEAM_IDS) {
    const t = buildTeam(id);
    LEAGUE.teams[id] = t;
    t.players.forEach(p => LEAGUE.playersById[p.pid] = p);
    autoSetLevel1(id);
  }
  LEAGUE.schedule = generateSchedule(TEAM_IDS);
  LEAGUE.phase = 'preseason'; LEAGUE.dayIdx = 0;
  LEAGUE.date = LEAGUE.schedule.preseason[0].date;
  LEAGUE.news = []; LEAGUE.transactions = []; LEAGUE.results = [];
  LEAGUE.lastMonth = 3;
  pushNews('리그', `2026 KBO 시범경기 개막 (${LEAGUE.date}). 정규시즌 개막은 3월 28일.`);
}

// 1군 28인 자동 구성: 투수 12 + 포수 2 + 내야 7 + 외야 5 (잔여 보충)
function autoSetLevel1(teamId) {
  const t = LEAGUE.teams[teamId];
  const set = new Set();
  const byOvr = (a, b) => b.ovr - a.ovr;
  const ps = t.players.filter(p => p.isPitcher && !p.injury);
  const cs = t.players.filter(p => p.group === 'C' && !p.injury).sort(byOvr);
  const ifs = t.players.filter(p => p.group === 'IF' && !p.injury).sort(byOvr);
  const ofs = t.players.filter(p => p.group === 'OF' && !p.injury).sort(byOvr);
  // 투수: 선발5 + 마무리 + 나머지 OVR순으로 12명
  const rot = t.rotationNames.map(n => ps.find(p => p.name === n)).filter(Boolean);
  const cl = ps.find(p => p.name === t.closerName);
  const core = new Set([...rot, cl].filter(Boolean).map(p => p.pid));
  const pen = ps.filter(p => !core.has(p.pid)).sort(byOvr);
  const pitchers = [...rot, cl, ...pen].filter(Boolean);
  pitchers.slice(0, 12).forEach(p => set.add(p.pid));
  cs.slice(0, 2).forEach(p => set.add(p.pid));
  ifs.slice(0, 7).forEach(p => set.add(p.pid));
  ofs.slice(0, 5).forEach(p => set.add(p.pid));
  // 잔여 채우기(최대 28)
  const rest = t.players.filter(p => !p.injury && !set.has(p.pid)).sort(byOvr);
  for (const p of rest) { if (set.size >= ENTRY_MAX) break; set.add(p.pid); }
  LEAGUE.level1[teamId] = set;
  t.players.forEach(p => p.level = set.has(p.pid) ? 1 : 2);
}

function isLevel1(pid) { const p = getP(pid); return LEAGUE.level1[p.team].has(pid); }

// 부상자 자동 정리: 1군 부상 선수를 2군으로 내리고 대체 콜업 (전 구단)
function autoFixRoster(teamId) {
  const set = LEAGUE.level1[teamId];
  const t = LEAGUE.teams[teamId];
  for (const pid of [...set]) {
    const p = getP(pid);
    if (!p || !p.injury) continue;
    set.delete(pid); p.level = 2;
    const samePref = t.players.filter(x => x.level === 2 && !x.injury && x.isPitcher === p.isPitcher).sort((a, b) => b.ovr - a.ovr);
    const repl = samePref[0] || t.players.filter(x => x.level === 2 && !x.injury).sort((a, b) => b.ovr - a.ovr)[0];
    if (repl && set.size < ENTRY_MAX) { set.add(repl.pid); repl.level = 1; }
  }
}

function callup(teamId, pid) {
  const set = LEAGUE.level1[teamId];
  if (set.has(pid)) return { ok: false, msg: '이미 1군 등록 선수입니다.' };
  if (set.size >= ENTRY_MAX) return { ok: false, msg: `1군 엔트리가 가득 찼습니다 (최대 ${ENTRY_MAX}명). 먼저 말소하세요.` };
  const p = getP(pid);
  if (p.injury) return { ok: false, msg: '부상 선수는 콜업할 수 없습니다.' };
  set.add(pid); p.level = 1;
  logTx(teamId, `콜업: ${p.name} (#${p.num}) 1군 등록`);
  if (teamId === LEAGUE.userTeam) pushNews(LEAGUE.teams[teamId].short, `${p.name} 1군 콜업`);
  return { ok: true };
}
function demote(teamId, pid) {
  const set = LEAGUE.level1[teamId];
  if (!set.has(pid)) return { ok: false, msg: '1군 선수가 아닙니다.' };
  const p = getP(pid);
  set.delete(pid); p.level = 2;
  logTx(teamId, `말소: ${p.name} (#${p.num}) 2군 강등`);
  return { ok: true };
}

function logTx(teamId, msg) {
  LEAGUE.transactions.unshift({ date: LEAGUE.date, team: teamId, msg });
}
function pushNews(tag, msg, important) {
  LEAGUE.news.unshift({ date: LEAGUE.date, tag, msg, important: !!important });
  if (LEAGUE.news.length > 200) LEAGUE.news.pop();
}

// 현재 일정의 오늘 경기들
function currentDaySlate() {
  const list = LEAGUE.phase === 'preseason' ? LEAGUE.schedule.preseason : LEAGUE.schedule.regular;
  return list[LEAGUE.dayIdx] || null;
}
function userMatchToday() {
  const slate = currentDaySlate();
  if (!slate) return null;
  return slate.games.find(g => g.home === LEAGUE.userTeam || g.away === LEAGUE.userTeam) || null;
}

// 선발투수 (로테이션) 가져오고 진행
function nextStarter(teamId) {
  const t = LEAGUE.teams[teamId];
  const set = LEAGUE.level1[teamId];
  for (let i = 0; i < t.rotationNames.length; i++) {
    const idx = (t.rotationIdx + i) % t.rotationNames.length;
    const name = t.rotationNames[idx];
    const p = t.players.find(pl => pl.name === name);
    if (p && set.has(p.pid) && !p.injury && p.restDays <= 0) {
      return { pid: p.pid, idx };
    }
  }
  // 대체선발: 1군 투수 중 휴식된 선발형/최고 OVR
  const cand = t.players.filter(p => p.isPitcher && set.has(p.pid) && !p.injury && p.restDays <= 0)
    .sort((a, b) => b.ovr - a.ovr)[0];
  return cand ? { pid: cand.pid, idx: t.rotationIdx } : null;
}
function advanceRotation(teamId) {
  const t = LEAGUE.teams[teamId];
  t.rotationIdx = (t.rotationIdx + 1) % t.rotationNames.length;
}

// 사용자 경기 생성 (대화형)
function createUserGame(customLineup) {
  const m = userMatchToday();
  if (!m) return null;
  const isHome = m.home === LEAGUE.userTeam;
  const homeT = LEAGUE.teams[m.home], awayT = LEAGUE.teams[m.away];
  const homeStarter = nextStarter(m.home), awayStarter = nextStarter(m.away);
  const opts = {
    exhibition: LEAGUE.phase === 'preseason',
    userSide: isHome ? 'home' : 'away',
    homeLevel1: LEAGUE.level1[m.home], awayLevel1: LEAGUE.level1[m.away],
    homeStarter: homeStarter && homeStarter.pid, awayStarter: awayStarter && awayStarter.pid,
  };
  if (customLineup) { if (isHome) opts.homeLineup = customLineup; else opts.awayLineup = customLineup; }
  const g = new Game(homeT, awayT, getP, opts);
  g._match = m;
  return g;
}

// AI 경기 자동 시뮬 (양팀 모두 AI)
function simAIGame(match) {
  const homeT = LEAGUE.teams[match.home], awayT = LEAGUE.teams[match.away];
  const hs = nextStarter(match.home), as = nextStarter(match.away);
  const g = new Game(homeT, awayT, getP, {
    exhibition: LEAGUE.phase === 'preseason',
    homeLevel1: LEAGUE.level1[match.home], awayLevel1: LEAGUE.level1[match.away],
    homeStarter: hs && hs.pid, awayStarter: as && as.pid,
  });
  let guard = 0;
  while (!g.finished && guard++ < 2000) {
    g.autoManage('home'); g.autoManage('away');
    g.step();
  }
  finalizeGame(g, match);
  return g;
}

// 경기 종료 후 집계 (승패/세이브/홀드/팀기록/등판일/부상로그)
function finalizeGame(g, match) {
  const exhibition = g.exhibition;
  const home = g.homeTeam, away = g.awayTeam;
  // 출전경기수
  for (const side of ['home', 'away']) {
    g.appeared[side].forEach(pid => { const p = getP(pid); if (p) p.season.g = (p.season.g || 0) + 1; });
    g.pitcherSeq[side].forEach((pid, i) => {
      const p = getP(pid); if (!p) return;
      p.pseason.g++; if (i === 0) p.pseason.gs++;
      p.restDays = (i === 0 && p.role === 'SP') ? 4 : 1; // 선발 4일 휴식
      p.fatigue = Math.min(100, p.fatigue + (g.pitchCount[pid] || 0) * 0.4);
    });
  }
  if (!exhibition) {
    // 승패 결정
    const winSide = g.winner;
    if (winSide === 'home' || winSide === 'away') {
      const lose = winSide === 'home' ? 'away' : 'home';
      const wseq = g.pitcherSeq[winSide], lseq = g.pitcherSeq[lose];
      // 승리투수
      const ws = getP(wseq[0]);
      let winPid = wseq[0];
      if (!(ws.role === 'SP' && ws._gameOuts >= 15)) {
        // 구원승: 가장 많은 아웃 잡은 구원투수
        const relievers = wseq.slice(1).map(getP);
        if (relievers.length) winPid = relievers.sort((a, b) => b._gameOuts - a._gameOuts)[0].pid;
      }
      getP(winPid).pseason.w++;
      // 패전투수: 패한팀 선발 (간이)
      getP(lseq[0]).pseason.l++;
      // 세이브/홀드
      const margin = Math.abs(g.score.home - g.score.away);
      if (margin <= 3 && wseq.length > 1) {
        const finisher = getP(wseq[wseq.length - 1]);
        if (finisher.pid !== winPid && finisher.role !== 'SP') finisher.pseason.sv++;
        // 홀드: 리드 지킨 중간계투
        wseq.slice(1, -1).forEach(pid => { const p = getP(pid); if (p.role !== 'SP' && (g.leadWhenEntered[pid] || 0) > 0) p.pseason.hld++; });
      }
    }
    // 팀 기록
    const ht = LEAGUE.teams[match.home], at = LEAGUE.teams[match.away];
    ht.rf += g.score.home; ht.ra += g.score.away;
    at.rf += g.score.away; at.ra += g.score.home;
    if (g.winner === 'home') { ht.w++; at.l++; ht.streak = ht.streak >= 0 ? ht.streak + 1 : 1; at.streak = at.streak <= 0 ? at.streak - 1 : -1; }
    else if (g.winner === 'away') { at.w++; ht.l++; at.streak = at.streak >= 0 ? at.streak + 1 : 1; ht.streak = ht.streak <= 0 ? ht.streak - 1 : -1; }
    else { ht.d++; at.d++; }
  }
  advanceRotation(match.home); advanceRotation(match.away);
  // 부상 뉴스
  g.events.forEach(ev => {
    if (ev.type === 'injury') {
      const tShort = LEAGUE.teams[ev.team].short;
      const imp = ev.team === LEAGUE.userTeam || ev.days >= 21;
      pushNews(tShort, `${ev.player} ${ev.desc}로 부상 (예상 결장 ${ev.days}일)`, imp);
    }
  });
  // 결과 저장
  LEAGUE.results.unshift({
    date: LEAGUE.date, phase: LEAGUE.phase,
    home: match.home, away: match.away,
    hs: g.score.home, as: g.score.away,
    winner: g.winner, user: (match.home === LEAGUE.userTeam || match.away === LEAGUE.userTeam),
  });
  if (LEAGUE.results.length > 400) LEAGUE.results.pop();
}

// 같은 날 나머지 AI 경기 시뮬 + 결과 요약
function simRestOfSlate(excludeMatch) {
  const slate = currentDaySlate();
  const out = [];
  for (const m of slate.games) {
    if (m === excludeMatch) continue;
    const g = simAIGame(m);
    out.push({ m, g });
  }
  return out;
}

// 2군 경기 시뮬 (사용자 팀) — 1군 경기 후 자동
function sim2gunGame(teamId) {
  const t = LEAGUE.teams[teamId];
  const farm = t.players.filter(p => p.level === 2 && !p.injury);
  const hitters = farm.filter(p => !p.isPitcher).sort((a, b) => b.ovr - a.ovr);
  const pitchers = farm.filter(p => p.isPitcher).sort((a, b) => b.ovr - a.ovr);
  // 상대 2군 (랜덤)
  const oppId = TEAM_IDS.filter(x => x !== teamId)[Math.floor(Math.random() * 9)];
  const us = Math.max(0, Math.round(3 + (Math.random() - 0.4) * 6));
  const them = Math.max(0, Math.round(3 + (Math.random() - 0.4) * 6));
  // 주목 활약 2~3명
  const stars = [];
  hitters.slice(0, 6).forEach(p => {
    const ab = 3 + Math.floor(Math.random() * 2);
    const h = Math.random() < (0.25 + (p.ovr - 60) * 0.012) ? 1 + (Math.random() < 0.3 ? 1 : 0) : 0;
    const hr = (h > 0 && Math.random() < 0.12 + (p.stats.power - 60) * 0.01) ? 1 : 0;
    p.season.g = (p.season.g || 0) + 1; p.season.pa += ab; p.season.ab += ab;
    p.season.h += h; if (hr) { p.season.hr += hr; p.season.rbi += hr; p.season.r += hr; }
    if (h > 0) stars.push(`${p.name} ${h}안타${hr ? ' 포함 홈런' : ''}`);
  });
  pitchers.filter(p => p.role === 'SP').slice(0, 1).forEach(p => {
    const outs = 12 + Math.floor(Math.random() * 9); const er = Math.floor(Math.random() * 4);
    p.pseason.g++; p.pseason.gs++; p.pseason.outs += outs; p.pseason.er += er; p.restDays = 4;
    stars.push(`${p.name} ${Math.floor(outs / 3)}이닝 ${er}실점`);
  });
  return {
    opp: LEAGUE.teams[oppId].short, us, them,
    result: us > them ? '승' : us < them ? '패' : '무',
    stars: stars.slice(0, 4),
  };
}

// 하루 종료 처리: 회복/성장/날짜 진행
function advanceDay() {
  // 부상 회복 / 휴식 / 피로 회복
  for (const id of TEAM_IDS) {
    for (const p of LEAGUE.teams[id].players) {
      if (p.injury) {
        p.injury.days--;
        if (p.injury.days <= 0) {
          const wasUser = id === LEAGUE.userTeam;
          p.injury = null; p.fatigue = Math.max(0, p.fatigue - 20);
          pushNews(LEAGUE.teams[id].short, `${p.name} 부상 복귀 (2군 재활)`, wasUser);
          if (LEAGUE.level1[id].has(p.pid)) { /* 부상중에도 엔트리 유지했다면 */ } else p.level = 2;
        }
      }
      if (p.restDays > 0) p.restDays--;
      p.fatigue = Math.max(0, p.fatigue - 6);
      // 폼 자연 회귀
      if (p.form > 0) p.form = Math.max(0, p.form - 0.3); else if (p.form < 0) p.form = Math.min(0, p.form + 0.3);
    }
  }
  // 부상자 자동 정리 (전 구단) — 다음 경기 로스터 정상화
  for (const id of TEAM_IDS) autoFixRoster(id);
  // 날짜/일정 진행
  LEAGUE.dayIdx++;
  const list = LEAGUE.phase === 'preseason' ? LEAGUE.schedule.preseason : LEAGUE.schedule.regular;
  if (LEAGUE.dayIdx >= list.length) {
    if (LEAGUE.phase === 'preseason') {
      LEAGUE.phase = 'regular'; LEAGUE.dayIdx = 0;
      // 시범경기 기록은 리셋 (정규 누적만)
      for (const id of TEAM_IDS) LEAGUE.teams[id].players.forEach(p => { p.season = emptyBatLine(); p.pseason = emptyPitchLine(); });
      LEAGUE.date = LEAGUE.schedule.regular[0].date;
      pushNews('리그', '⚾ 2026 KBO 정규시즌 개막!', true);
      checkMonthlyGrowth(true);
    } else {
      LEAGUE.phase = 'postseason';
      buildPostseason();
      return;
    }
  } else {
    LEAGUE.date = list[LEAGUE.dayIdx].date;
  }
  // 월 변경시 성장/감소 평가
  const mon = parseInt(LEAGUE.date.slice(5, 7), 10);
  if (mon !== LEAGUE.lastMonth) { LEAGUE.lastMonth = mon; checkMonthlyGrowth(); }
}

// 월간 성장/감소 (현실적 빈도 — 매우 드물게)
function checkMonthlyGrowth(silent) {
  for (const id of TEAM_IDS) {
    for (const p of LEAGUE.teams[id].players) {
      const usage = p.isPitcher ? (p.pseason.outs / 3) : p.season.pa;
      const playing = usage > 8;
      // 성장: 24세 이하 & 잠재 여유 & 출전 & 확률
      if (p.age <= 24 && p.cur < p.peak && playing && Math.random() < 0.10) {
        p.cur++; p.ovr = p.cur; bumpStats(p, +1);
        const msg = `${p.name} 기량 성장! 종합 ${p.cur - 1}→${p.cur}`;
        pushNews(LEAGUE.teams[id].short, '📈 ' + msg, id === LEAGUE.userTeam);
      }
      // 감소: 33세 이상 & 확률
      else if (p.age >= 33 && p.cur > 55 && Math.random() < 0.07) {
        p.cur--; p.ovr = p.cur; bumpStats(p, -1);
        pushNews(LEAGUE.teams[id].short, `📉 ${p.name} 노쇠화로 기량 하락. 종합 ${p.cur + 1}→${p.cur}`, id === LEAGUE.userTeam);
      }
    }
  }
}
function bumpStats(p, d) {
  const s = p.stats;
  const keys = p.isPitcher ? ['velo', 'control', 'stuff'] : ['power', 'speed', 'contact', 'defense'];
  // 무작위 2개 스탯 조정
  const pick = keys.sort(() => Math.random() - 0.5).slice(0, 2);
  pick.forEach(k => s[k] = clamp(s[k] + d, STAT_MIN, STAT_MAX));
}

// 포지션 훈련 (본 포지션 연관만 성장)
function trainPosition(pid, pos) {
  const p = getP(pid);
  if (p.isPitcher) return { ok: false, msg: '투수는 야수 포지션 훈련 대상이 아닙니다.' };
  const cur = p.prof[pos];
  // 인접성 판단: 이미 A/B/C/D면 연관 → 성장 가능. E면 인접 포지션 보유시만 천천히.
  const adj = adjacentPositions(p);
  if (cur === 'A') return { ok: false, msg: '이미 주포지션(A)입니다.' };
  if (cur === 'E' && !adj.has(pos)) return { ok: false, msg: `${pos}는(은) 본 포지션과 연관이 없어 습득이 거의 불가능합니다.` };
  // 확률적 1단계 상승
  const order = ['E', 'D', 'C', 'B', 'A'];
  const chance = cur === 'E' ? 0.15 : 0.35;
  if (Math.random() < chance) {
    p.prof[pos] = order[Math.min(order.indexOf(cur) + 1, 3)]; // 훈련으로는 최고 B까지
    return { ok: true, msg: `${p.name} ${pos} 숙련도 상승 → ${p.prof[pos]}` };
  }
  return { ok: true, msg: `${p.name} ${pos} 훈련 진행… 아직 변화 없음.` };
}
function adjacentPositions(p) {
  const groups = [['1B', '3B'], ['2B', 'SS'], ['LF', 'CF', 'RF'], ['1B', 'LF', 'RF']];
  const has = POS_LIST.filter(pos => ['A', 'B', 'C', 'D'].includes(p.prof[pos]));
  const adj = new Set(has);
  groups.forEach(gr => { if (gr.some(x => has.includes(x))) gr.forEach(x => adj.add(x)); });
  return adj;
}

// 순위표
function standings() {
  return TEAM_IDS.map(id => LEAGUE.teams[id])
    .map(t => ({ t, g: t.w + t.l + t.d, pct: (t.w + t.l) ? t.w / (t.w + t.l) : 0 }))
    .sort((a, b) => b.pct - a.pct || (b.t.w - a.t.w))
    .map((x, i) => ({ rank: i + 1, ...x }));
}

// ===== 트레이드 =====
function playerValue(p) {
  let v = (p.ovr - 49) * (p.peak - 49) / 4;
  if (p.age <= 23) v *= 1.25; else if (p.age >= 34) v *= 0.7;
  if (p.injury) v *= 0.6;
  return v;
}
function evaluateTrade(give, get) {
  const gv = give.reduce((s, pid) => s + playerValue(getP(pid)), 0);
  const rv = get.reduce((s, pid) => s + playerValue(getP(pid)), 0);
  return { gv, rv, accept: gv >= rv * 0.92 }; // 상대가 받는 가치(give)가 충분하면 수락
}
function executeTrade(otherTeamId, give, get) {
  if (new Date(LEAGUE.date) > new Date(LEAGUE.tradeDeadline)) return { ok: false, msg: '트레이드 마감일이 지났습니다 (7/31).' };
  const ev = evaluateTrade(give, get);
  if (!ev.accept) return { ok: false, msg: `상대 구단 거절. 제시 가치 부족 (제시 ${ev.gv.toFixed(0)} < 요구 ${ev.rv.toFixed(0)}).` };
  const user = LEAGUE.userTeam;
  // 이동
  give.forEach(pid => movePlayer(pid, otherTeamId));
  get.forEach(pid => movePlayer(pid, user));
  const gn = give.map(p => getP(p).name).join(', ');
  const rn = get.map(p => getP(p).name).join(', ');
  pushNews('트레이드', `${LEAGUE.teams[user].short} ↔ ${LEAGUE.teams[otherTeamId].short}: ${gn} ⇄ ${rn}`, true);
  logTx(user, `트레이드: OUT [${gn}] / IN [${rn}]`);
  return { ok: true, msg: '트레이드 성사!' };
}
function movePlayer(pid, toTeam) {
  const p = getP(pid);
  const fromTeam = p.team;
  LEAGUE.level1[fromTeam].delete(pid);
  const arr = LEAGUE.teams[fromTeam].players;
  arr.splice(arr.indexOf(p), 1);
  p.team = toTeam;
  LEAGUE.teams[toTeam].players.push(p);
  // 새 팀 2군에 배치 (즉시 반영)
  p.level = 2;
}

// ===== 포스트시즌 (KBO: WC→준PO→PO→한국시리즈) =====
function buildPostseason() {
  const s = standings();
  LEAGUE.postseason = {
    seeds: s.slice(0, 5).map(x => x.t.id),
    round: 'WC', series: [], champion: null,
    log: [`정규시즌 종료. 1위 ${LEAGUE.teams[s[0].t.id].name}`],
  };
  pushNews('포스트시즌', `정규시즌 종료! 가을야구 진출: ${s.slice(0, 5).map(x => LEAGUE.teams[x.t.id].short).join(', ')}`, true);
}
function simSeries(aId, bId, wins) {
  // 단순 전력 기반 시리즈
  const A = teamStrength(aId), B = teamStrength(bId);
  let aw = 0, bw = 0; const games = [];
  while (aw < wins && bw < wins) {
    const pa = A / (A + B);
    if (Math.random() < pa) aw++; else bw++;
    games.push(`${LEAGUE.teams[aId].short} ${aw}-${bw} ${LEAGUE.teams[bId].short}`);
  }
  return { winner: aw > bw ? aId : bId, aw, bw, games };
}
function teamStrength(id) {
  const t = LEAGUE.teams[id];
  const set = LEAGUE.level1[id];
  const top = t.players.filter(p => set.has(p.pid)).sort((a, b) => b.ovr - a.ovr).slice(0, 18);
  return top.reduce((s, p) => s + p.ovr, 0) / top.length;
}
function advancePostseason() {
  const ps = LEAGUE.postseason;
  const [s1, s2, s3, s4, s5] = ps.seeds;
  if (ps.round === 'WC') {
    const r = simSeries(s4, s5, 2); // WC: 4위 2승 어드밴티지(간이: 2선승)
    ps.wc = r.winner; ps.log.push(`[와일드카드] 승자: ${LEAGUE.teams[r.winner].short}`);
    ps.round = 'SEMI';
    pushNews('포스트시즌', `와일드카드 결정전: ${LEAGUE.teams[r.winner].short} 승리 → 준플레이오프 진출`, true);
  } else if (ps.round === 'SEMI') {
    const r = simSeries(s3, ps.wc, 3);
    ps.semi = r.winner; ps.log.push(`[준플레이오프] 승자: ${LEAGUE.teams[r.winner].short} (${r.aw}-${r.bw})`);
    ps.round = 'PO';
    pushNews('포스트시즌', `준PO: ${LEAGUE.teams[r.winner].short} 플레이오프 진출`, true);
  } else if (ps.round === 'PO') {
    const r = simSeries(s2, ps.semi, 3);
    ps.po = r.winner; ps.log.push(`[플레이오프] 승자: ${LEAGUE.teams[r.winner].short} (${r.aw}-${r.bw})`);
    ps.round = 'KS';
    pushNews('포스트시즌', `PO: ${LEAGUE.teams[r.winner].short} 한국시리즈 진출`, true);
  } else if (ps.round === 'KS') {
    const r = simSeries(s1, ps.po, 4);
    ps.champion = r.winner; ps.log.push(`[한국시리즈] 🏆 우승: ${LEAGUE.teams[r.winner].name} (${r.aw}-${r.bw})`);
    ps.round = 'DONE';
    pushNews('포스트시즌', `🏆 2026 한국시리즈 우승: ${LEAGUE.teams[r.winner].name}!`, true);
  }
}

// ===== 저장/불러오기 =====
function saveGame() {
  try {
    const data = {
      v: 1, userTeam: LEAGUE.userTeam, phase: LEAGUE.phase, dayIdx: LEAGUE.dayIdx, date: LEAGUE.date,
      lastMonth: LEAGUE.lastMonth,
      teams: {}, level1: {}, news: LEAGUE.news.slice(0, 80), transactions: LEAGUE.transactions.slice(0, 80),
      results: LEAGUE.results.slice(0, 120), postseason: LEAGUE.postseason,
    };
    for (const id of TEAM_IDS) {
      const t = LEAGUE.teams[id];
      data.teams[id] = {
        w: t.w, l: t.l, d: t.d, rf: t.rf, ra: t.ra, streak: t.streak, rotationIdx: t.rotationIdx,
        players: t.players.map(p => ({
          pid: p.pid, num: p.num, name: p.name, age: p.age, group: p.group, isPitcher: p.isPitcher,
          role: p.role, primary: p.primary, prof: p.prof, cur: p.cur, ovr: p.ovr, peak: p.peak,
          stats: p.stats, stamina: p.stamina, level: p.level, fatigue: p.fatigue, restDays: p.restDays,
          injury: p.injury, form: p.form, season: p.season, pseason: p.pseason, team: p.team,
        })),
      };
      data.level1[id] = [...LEAGUE.level1[id]];
    }
    localStorage.setItem('kbo2026_save', JSON.stringify(data));
    return true;
  } catch (e) { console.error(e); return false; }
}
function loadGame() {
  let raw = null;
  try { raw = localStorage.getItem('kbo2026_save'); } catch (e) { return false; }
  if (!raw) return false;
  const data = JSON.parse(raw);
  LEAGUE.userTeam = data.userTeam; LEAGUE.phase = data.phase; LEAGUE.dayIdx = data.dayIdx;
  LEAGUE.date = data.date; LEAGUE.lastMonth = data.lastMonth || 3;
  LEAGUE.schedule = generateSchedule(TEAM_IDS);
  LEAGUE.teams = {}; LEAGUE.playersById = {}; LEAGUE.level1 = {};
  for (const id of TEAM_IDS) {
    const raw0 = TEAMS_RAW[id];
    const t = { id, name: raw0.name, short: raw0.short, code: raw0.code, color: raw0.color,
      ovr: raw0.ovr, difficulty: raw0.difficulty, budget: raw0.budget, captain: raw0.captain,
      rotationNames: raw0.rotation.slice(), closerName: raw0.closer, players: [],
      ...data.teams[id], rotationIdx: data.teams[id].rotationIdx || 0 };
    t.players = data.teams[id].players.map(sp => ({
      ...sp, usedOut: false,
    }));
    LEAGUE.teams[id] = t;
    t.players.forEach(p => LEAGUE.playersById[p.pid] = p);
    LEAGUE.level1[id] = new Set(data.level1[id]);
  }
  LEAGUE.news = data.news || []; LEAGUE.transactions = data.transactions || [];
  LEAGUE.results = data.results || []; LEAGUE.postseason = data.postseason || null;
  return true;
}
function hasSave() { try { return !!localStorage.getItem('kbo2026_save'); } catch (e) { return false; } }
function deleteSave() { try { localStorage.removeItem('kbo2026_save'); } catch (e) {} }
