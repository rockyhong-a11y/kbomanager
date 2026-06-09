/* ============================================================
 *  UI — 화면 구성 및 상호작용
 * ============================================================ */
const $ = (sel) => document.querySelector(sel);
const APP = () => $('#app');
const UI = { screen: 'select', game: null, draft: null, squadTab: 1, subOut: null };

// ---- 표시 헬퍼 ----
function ovrColor(v) {
  if (v >= 74) return '#3fb950'; if (v >= 70) return '#7bc96f'; if (v >= 66) return '#d8b400';
  if (v >= 62) return '#f0a500'; if (v >= 58) return '#f0883e'; return '#f85149';
}
function ovrBadge(v) { return `<span class="ovr" style="background:${ovrColor(v)}">${v}</span>`; }
function bar(v) {
  const pct = Math.max(0, Math.min(100, ((v - 50) / 30) * 100));
  return `<span class="sb"><span class="sbar"><i style="width:${pct}%;background:${ovrColor(v)}"></i></span><b style="font-size:11px">${v}</b></span>`;
}
function gradeColor(g) { return { A: '#3fb950', B: '#7bc96f', C: '#f0a500', D: '#f0883e', E: '#555' }[g] || '#555'; }
function profChips(p) {
  return POS_LIST.filter(pos => pos !== 'DH').map(pos => {
    const g = p.prof[pos];
    if (g === 'E') return '';
    return `<span class="tag" style="color:${gradeColor(g)};border-color:${gradeColor(g)}55">${pos}:${g}</span>`;
  }).join(' ');
}
function injTag(p) {
  if (p.injury) return `<span class="pill" style="background:#f8514922;color:#f85149">🚑 ${p.injury.type} (${p.injury.days}일)</span>`;
  if (p.fatigue > 60) return `<span class="pill" style="background:#f0883e22;color:#f0883e">피로 ${Math.round(p.fatigue)}</span>`;
  return '';
}
function roleK(r) { return { SP: '선발', CL: '마무리', RP: '불펜' }[r] || ''; }
function fmtNum(p) { return (p.num === '' || p.num == null) ? '–' : p.num; }

// ============================================================
//  부트
// ============================================================
window.addEventListener('DOMContentLoaded', () => renderSelect());

// ============================================================
//  1. 팀 선택
// ============================================================
function renderSelect() {
  UI.screen = 'select';
  const teams = TEAM_IDS.map(id => buildTeam(id)).sort((a, b) => b.ovr - a.ovr);
  const cont = hasSave() ? `<button class="btn-good" onclick="UIH.continueGame()">이어하기 (저장된 게임)</button>` : '';
  APP().innerHTML = `
    <div style="text-align:center;margin:18px 0">
      <h1 style="font-size:28px">⚾ KBO 매니저 2026</h1>
      <p class="mut">감독 시뮬레이터 · 프리시즌 · 운영할 구단을 선택하세요</p>
      <div class="row" style="justify-content:center;margin-top:10px">${cont}</div>
    </div>
    <div class="team-grid">
      ${teams.map(t => `
        <div class="team-card" style="border-left-color:${t.color}" onclick="UIH.selectTeam('${t.id}')">
          <div class="row" style="align-items:center">${teamBadge(t.id, 38)}<div class="nm">${t.name}</div><div class="spacer"></div><div class="ovrbig" style="color:${ovrColor(t.ovr)}">${t.ovr}</div></div>
          <div class="row mut" style="margin-top:6px;font-size:12px">
            <span>난이도 ${t.difficulty}</span>
          </div>
          <div class="row mut" style="font-size:12px"><span>가용예산 ${t.budget}억 원</span><span>·</span><span>주장 ${t.captain}</span></div>
        </div>`).join('')}
    </div>
    <p class="mut" style="text-align:center;margin-top:14px;font-size:12px">선수 종합스탯 50~80 · 세부스탯(파워·주루·컨택·수비 / 구속·제구·구위) 자동 산출 · 콜업/말소·트레이드·부상·포스트시즌 구현</p>`;
}

const UIH = {
  selectTeam(id) {
    const t = buildTeam(id);
    showModal(`<h2>${t.name}</h2>
      <p class="mut">종합 오버롤 <b style="color:${ovrColor(t.ovr)}">${t.ovr}</b> · 난이도 ${t.difficulty}</p>
      <p style="margin:10px 0">가용 예산 <b>${t.budget}억 원</b> · 주장 ${t.captain}</p>
      <p class="mut" style="font-size:12px">선발 로테이션: ${t.rotationNames.join(', ')} / 마무리: ${t.closerName}</p>
      <div class="row" style="margin-top:16px;justify-content:flex-end">
        <button class="btn-ghost" onclick="closeModal()">취소</button>
        <button class="btn-primary" onclick="UIH.startNew('${id}')">이 팀으로 시작</button>
      </div>`);
  },
  startNew(id) {
    closeModal(); initLeague(id); saveGame(); renderHub();
  },
  continueGame() { if (loadGame()) { LEAGUE.phase === 'postseason' ? renderPostseason() : renderHub(); } },
};

// ============================================================
//  공통 상단바
// ============================================================
function topbar() {
  const t = LEAGUE.teams[LEAGUE.userTeam];
  const phaseK = { preseason: '시범경기', regular: '정규시즌', postseason: '포스트시즌', offseason: '오프시즌' }[LEAGUE.phase];
  const day = currentDaySlate();
  return `<div class="topbar">
    <div><b style="color:${t.color === '#000000' ? '#fff' : t.color}">${t.name}</b> <span class="tag">${phaseK}</span></div>
    <div class="mut">📅 ${LEAGUE.date}${day && day.round ? ` · ${day.round}일차` : ''}</div>
    <div class="spacer"></div>
    <div class="navbtns">
      <button onclick="renderHub()">🏠 홈</button>
      <button onclick="renderSquad()">👥 스쿼드</button>
      <button onclick="renderRoster()">🔁 콜업/말소</button>
      <button onclick="renderStandings()">📊 순위</button>
      <button onclick="renderLeaders()">🏅 기록</button>
      <button onclick="renderTrade()">🤝 트레이드</button>
      <button onclick="renderTraining()">🎯 훈련</button>
      <button onclick="renderNews()">📰 뉴스</button>
      <button class="btn-ghost" onclick="UIH.save()">💾 저장</button>
    </div>
  </div>`;
}
UIH.save = () => { saveGame() ? toast('저장 완료') : toast('저장 실패'); };

// ============================================================
//  2. 메인 허브
// ============================================================
function renderHub() {
  if (LEAGUE.phase === 'postseason') return renderPostseason();
  UI.screen = 'hub';
  const t = LEAGUE.teams[LEAGUE.userTeam];
  const m = userMatchToday();
  const opp = m ? (m.home === LEAGUE.userTeam ? m.away : m.home) : null;
  const isHome = m && m.home === LEAGUE.userTeam;
  const s = standings();
  const myRank = s.find(x => x.t.id === LEAGUE.userTeam);
  const news = LEAGUE.news.slice(0, 8);

  const matchCard = m ? `
    <div class="panel">
      <div class="sec-title">오늘 경기</div>
      <div class="row" style="font-size:18px;font-weight:800;align-items:center">
        ${badgeName(m.away, LEAGUE.teams[m.away].short, 34)}<span class="mut">@</span>${badgeName(m.home, LEAGUE.teams[m.home].short, 34)}
        <span class="tag">${isHome ? '홈' : '원정'}</span>
      </div>
      <div class="mut" style="margin:6px 0">상대: ${LEAGUE.teams[opp].name} (오버롤 ${LEAGUE.teams[opp].ovr}) · 최근 ${formStrip(opp)}</div>
      <div class="row" style="margin-top:8px">
        <button class="btn-primary" onclick="renderLineup()">⚾ 라인업 짜고 경기 시작</button>
        <button class="btn-ghost" onclick="UIH.meeting('pre')">🗣️ 경기 전 팀 미팅</button>
        <button class="btn-ghost" onclick="UIH.quickSimDay()">⏩ 오늘 빠르게 시뮬</button>
      </div>
    </div>` : `<div class="panel mut">오늘은 휴식일입니다. <button class="btn-primary" onclick="UIH.quickSimDay()">다음 날로</button></div>`;

  APP().innerHTML = topbar() + `
    <div class="row">
      <div class="kpi"><span class="mut">순위</span><b>${myRank ? myRank.rank + '위' : '-'}</b></div>
      <div class="kpi"><span class="mut">전적</span><b>${t.w}-${t.l}-${t.d}</b></div>
      <div class="kpi"><span class="mut">득/실</span><b style="font-size:15px">${t.rf}/${t.ra}</b></div>
      <div class="kpi"><span class="mut">연속</span><b style="font-size:15px">${t.streak > 0 ? t.streak + '연승' : t.streak < 0 ? (-t.streak) + '연패' : '-'}</b></div>
      <div class="kpi"><span class="mut">예산</span><b style="font-size:15px">${t.budget}억</b></div>
    </div>
    ${matchCard}
    <div class="row" style="align-items:flex-start">
      <div class="panel" style="flex:1;min-width:300px">
        <div class="sec-title">순위표</div>
        ${standingsTable(true)}
      </div>
      <div class="panel" style="flex:1;min-width:300px">
        <div class="sec-title">최근 뉴스</div>
        ${news.length ? news.map(n => newsItem(n)).join('') : '<p class="mut">소식 없음</p>'}
      </div>
    </div>`;
}

UIH.meeting = (when) => {
  // 팀 미팅: 사기 진작 (전 선수 폼 소폭 변동, 약간의 리스크)
  const t = LEAGUE.teams[LEAGUE.userTeam];
  let up = 0, down = 0;
  t.players.forEach(p => {
    const r = Math.random();
    if (r < 0.6) { p.form = Math.min(5, p.form + 1); up++; }
    else if (r > 0.9) { p.form = Math.max(-5, p.form - 1); down++; }
  });
  showModal(`<h2>🗣️ 팀 미팅 (${when === 'pre' ? '경기 전' : '경기 후'})</h2>
    <p>감독의 메시지가 라커룸에 전달되었습니다.</p>
    <p class="good">${up}명 사기 상승</p>${down ? `<p class="bad">${down}명 부담감 상승</p>` : ''}
    <div class="row" style="justify-content:flex-end;margin-top:12px"><button class="btn-primary" onclick="closeModal()">확인</button></div>`);
};
UIH.quickSimDay = () => {
  const m = userMatchToday();
  if (m) { const g = simAIGame(m); }
  const others = m ? simRestOfSlate(m) : simRestOfSlate(null);
  const farm = sim2gunGame(LEAGUE.userTeam);
  const dayResults = collectDayResults();
  advanceDay(); saveGame();
  renderPostGame(null, dayResults, farm);
};

// ============================================================
//  순위표 컴포넌트
// ============================================================
function standingsTable(mini) {
  const s = standings();
  return `<table><thead><tr><th>순위</th><th class="l">팀</th><th>승</th><th>패</th><th>무</th><th>승률</th><th>GB</th>${mini ? '' : '<th>득</th><th>실</th><th>연속</th><th class="l">최근10</th>'}</tr></thead><tbody>
    ${s.map(x => {
      const gb = ((s[0].t.w - x.t.w) + (x.t.l - s[0].t.l)) / 2;
      return `<tr class="${x.t.id === LEAGUE.userTeam ? 'me' : ''} hl clickrow" onclick="renderTeamView('${x.t.id}')">
        <td>${x.rank <= 5 && LEAGUE.phase !== 'preseason' ? '<span class="acc">' + x.rank + '</span>' : x.rank}</td>
        <td class="l">${badgeName(x.t.id, '<b>' + x.t.name + '</b>', 20)}</td>
        <td>${x.t.w}</td><td>${x.t.l}</td><td>${x.t.d}</td><td>${x.pct.toFixed(3).replace(/^0/, '')}</td>
        <td>${x.rank === 1 ? '-' : gb.toFixed(1)}</td>
        ${mini ? '' : `<td>${x.t.rf}</td><td>${x.t.ra}</td><td>${x.t.streak > 0 ? '<span class="good">' + x.t.streak + '연승</span>' : x.t.streak < 0 ? '<span class="bad">' + (-x.t.streak) + '연패</span>' : '-'}</td><td class="l">${formStrip(x.t.id)}</td>`}
      </tr>`;
    }).join('')}
  </tbody></table>`;
}
function renderStandings() {
  UI.screen = 'standings';
  APP().innerHTML = topbar() + `<div class="panel"><div class="sec-title">2026 정규시즌 순위</div>${standingsTable(false)}</div>`;
}

// ============================================================
//  뉴스
// ============================================================
function newsItem(n) {
  return `<div class="news-item ${n.important ? 'imp' : ''}"><span class="tag">${n.tag}</span> <span class="mut" style="font-size:11px">${n.date}</span><br>${n.msg}</div>`;
}
function renderNews() {
  UI.screen = 'news';
  APP().innerHTML = topbar() + `
    <div class="panel"><div class="sec-title">리그 뉴스 · 사건사고</div>
    ${LEAGUE.news.slice(0, 60).map(newsItem).join('') || '<p class="mut">소식 없음</p>'}</div>
    <div class="panel"><div class="sec-title">선수 이동/등록 이력</div>
    ${LEAGUE.transactions.slice(0, 40).map(t => `<div class="news-item"><span class="tag">${LEAGUE.teams[t.team] ? LEAGUE.teams[t.team].short : t.team}</span> <span class="mut" style="font-size:11px">${t.date}</span> — ${t.msg}</div>`).join('') || '<p class="mut">이력 없음</p>'}</div>`;
}

// ============================================================
//  3. 스쿼드
// ============================================================
function renderSquad() {
  UI.screen = 'squad';
  const t = LEAGUE.teams[LEAGUE.userTeam];
  const lv = UI.squadTab;
  const players = t.players.filter(p => p.level === lv);
  const groups = [['P', '투수'], ['C', '포수'], ['IF', '내야수'], ['OF', '외야수']];
  const entryCount = LEAGUE.level1[LEAGUE.userTeam].size;
  APP().innerHTML = topbar() + `
    <div class="panel">
      <div class="row">
        <div class="subtabs row">
          <button class="${lv === 1 ? 'active' : ''}" onclick="UIH.squadTab(1)">1군 (${entryCount}/${ENTRY_MAX})</button>
          <button class="${lv === 2 ? 'active' : ''}" onclick="UIH.squadTab(2)">2군 (${t.players.filter(p => p.level === 2).length})</button>
        </div>
        <div class="spacer"></div>
        <span class="mut" style="font-size:12px">OVR 옆 막대 = 세부스탯</span>
      </div>
      ${groups.map(([g, label]) => {
        const ps = players.filter(p => p.group === g).sort((a, b) => b.ovr - a.ovr);
        if (!ps.length) return '';
        return `<div class="sec-title">${label} (${ps.length})</div>
          <table><thead><tr><th>#</th><th class="l">이름</th><th>나이</th><th>OVR</th>
          ${g === 'P' ? '<th>구속</th><th>제구</th><th>구위</th><th>역할</th>' : '<th>파워</th><th>주루</th><th>컨택</th><th>수비</th><th class="l">포지션 숙련도</th>'}
          <th>상태</th></tr></thead><tbody>
          ${ps.map(p => `<tr class="hl clickrow" onclick="UIH.openPlayer(${p.pid})">
            <td>${fmtNum(p)}</td><td class="l"><b>${p.name}</b>${p.cur < p.peak ? ` <span class="mut" style="font-size:10px">▲${p.peak}</span>` : ''}</td>
            <td>${p.age}</td><td>${ovrBadge(p.ovr)}</td>
            ${g === 'P'
              ? `<td>${bar(p.stats.velo)}</td><td>${bar(p.stats.control)}</td><td>${bar(p.stats.stuff)}</td><td><span class="tag">${roleK(p.role)}</span></td>`
              : `<td>${bar(p.stats.power)}</td><td>${bar(p.stats.speed)}</td><td>${bar(p.stats.contact)}</td><td>${bar(p.stats.defense)}</td><td class="l">${profChips(p)}</td>`}
            <td>${injTag(p)}</td>
          </tr>`).join('')}
          </tbody></table>`;
      }).join('')}
    </div>`;
}
UIH.squadTab = (n) => { UI.squadTab = n; renderSquad(); };

// ============================================================
//  4. 콜업 / 말소
// ============================================================
function renderRoster() {
  UI.screen = 'roster';
  const t = LEAGUE.teams[LEAGUE.userTeam];
  const set = LEAGUE.level1[LEAGUE.userTeam];
  const lv1 = t.players.filter(p => p.level === 1).sort((a, b) => b.ovr - a.ovr);
  const lv2 = t.players.filter(p => p.level === 2).sort((a, b) => b.ovr - a.ovr);
  const rowP = (p, action, label, cls) => `<div class="list-row">
      <span class="tag">${{ P: '투', C: '포', IF: '내', OF: '외' }[p.group]}</span>
      <b>#${fmtNum(p)} ${p.name}</b> <span class="mut">${p.age}세 ${p.isPitcher ? roleK(p.role) : p.primary}</span>
      ${ovrBadge(p.ovr)} ${injTag(p)}
      <span class="spacer"></span>
      <button class="${cls}" onclick="${action}(${p.pid})">${label}</button>
    </div>`;
  APP().innerHTML = topbar() + `
    <div class="panel"><p class="mut">규칙: 1군 등록 선수는 2군 경기 출전 불가 · 2군 선수는 콜업 전 1군 출전 불가 · 말소 즉시 2군 배치 · 1군 최대 ${ENTRY_MAX}명</p></div>
    <div class="row" style="align-items:flex-start">
      <div class="panel" style="flex:1;min-width:320px">
        <div class="sec-title">1군 엔트리 (${set.size}/${ENTRY_MAX})</div>
        ${lv1.map(p => rowP(p, 'UIH.demote', '말소▼', 'btn-ghost')).join('')}
      </div>
      <div class="panel" style="flex:1;min-width:320px">
        <div class="sec-title">2군</div>
        ${lv2.map(p => rowP(p, 'UIH.callup', '콜업▲', 'btn-good')).join('')}
      </div>
    </div>`;
}
UIH.callup = (pid) => { const r = callup(LEAGUE.userTeam, pid); if (!r.ok) toast(r.msg); renderRoster(); };
UIH.demote = (pid) => { const r = demote(LEAGUE.userTeam, pid); if (!r.ok) toast(r.msg); renderRoster(); };

// ============================================================
//  5. 라인업 편성 (경기 전)
// ============================================================
function rebuildBullpen(draft, teamId) {
  const t = LEAGUE.teams[teamId];
  const set = LEAGUE.level1[teamId];
  const pitchers = t.players.filter(p => p.isPitcher && set.has(p.pid) && !p.injury && p.pid !== draft.pitcher);
  const closer = pitchers.find(p => p.role === 'CL');
  const pen = pitchers.filter(p => p.role !== 'CL').sort((a, b) => a.ovr - b.ovr);
  draft.bullpen = (closer ? [...pen, closer] : pen).map(p => p.pid);
}
function renderLineup() {
  UI.screen = 'lineup';
  const m = userMatchToday(); if (!m) return renderHub();
  const teamId = LEAGUE.userTeam;
  const ns = nextStarter(teamId);
  if (!UI.draft || UI.draft._for !== LEAGUE.date) {
    UI.draft = buildAutoLineup(LEAGUE.teams[teamId], LEAGUE.level1[teamId], getP, ns && ns.pid);
    UI.draft._for = LEAGUE.date;
  }
  const d = UI.draft;
  const set = LEAGUE.level1[teamId];
  const t = LEAGUE.teams[teamId];
  const pitcherOpts = t.players.filter(p => p.isPitcher && set.has(p.pid) && !p.injury)
    .sort((a, b) => b.ovr - a.ovr)
    .map(p => `<option value="${p.pid}" ${p.pid === d.pitcher ? 'selected' : ''}>#${fmtNum(p)} ${p.name} (${p.ovr}, ${roleK(p.role)}${p.restDays > 0 ? ', 휴식필요' : ''})</option>`).join('');

  APP().innerHTML = topbar() + `
    <div class="panel">
      <div class="row"><div class="sec-title">선발 라인업 — vs ${LEAGUE.teams[m.home === teamId ? m.away : m.home].short}</div>
      <div class="spacer"></div>
      <button class="btn-ghost" onclick="UIH.autoLineup()">🔄 자동편성</button></div>
      <div class="row" style="margin:8px 0">
        <span>선발투수:</span>
        <select onchange="UIH.setStarter(this.value)">${pitcherOpts}</select>
      </div>
      <table><thead><tr><th>타순</th><th>POS</th><th class="l">선수</th><th>OVR</th><th>주요스탯</th><th>변경</th><th>순서</th></tr></thead><tbody>
        ${d.battingOrder.map((pid, i) => {
          const p = getP(pid); const pos = d.posByPid[pid];
          const main = `P:${p.stats.power} C:${p.stats.contact} S:${p.stats.speed} D:${p.stats.defense}`;
          return `<tr>
            <td><b>${i + 1}</b></td><td><span class="tag">${pos}</span></td>
            <td class="l"><span class="clickrow" style="text-decoration:underline" onclick="UIH.openPlayer(${pid})">#${fmtNum(p)} ${p.name}</span> <span style="color:${gradeColor(p.prof[pos])}">(${p.prof[pos]})</span></td>
            <td>${ovrBadge(p.ovr)}</td><td class="mut" style="font-size:11px">${main}</td>
            <td><button class="btn-ghost" onclick="UIH.swapSlot(${i})">교체</button></td>
            <td>${i > 0 ? `<button class="btn-ghost" onclick="UIH.moveOrder(${i},-1)">▲</button>` : ''}${i < 8 ? `<button class="btn-ghost" onclick="UIH.moveOrder(${i},1)">▼</button>` : ''}</td>
          </tr>`;
        }).join('')}
      </tbody></table>
      <div class="sec-title">수비 배치도</div>
      ${lineupField(d)}
      <div class="sec-title">대기 (벤치 ${d.bench.length} · 불펜 ${d.bullpen.length})</div>
      <div class="flex-wrap">${d.bench.map(pid => { const p = getP(pid); return `<span class="tag">${p.name} ${ovrBadge(p.ovr)} ${p.primary}</span>`; }).join('')}</div>
      <div class="flex-wrap" style="margin-top:6px">${d.bullpen.map(pid => { const p = getP(pid); return `<span class="tag">${p.name} ${ovrBadge(p.ovr)} ${roleK(p.role)}</span>`; }).join('')}</div>
      <div class="row" style="margin-top:14px"><button class="btn-primary" onclick="UIH.startGame()">▶ 경기 시작</button>
      <button class="btn-ghost" onclick="renderHub()">취소</button></div>
    </div>`;
}
UIH.autoLineup = () => { UI.draft = null; renderLineup(); };
UIH.setStarter = (pid) => { pid = +pid; const d = UI.draft;
  // 기존 선발이 타순에 없고, 새 선발이 타순/벤치에 있으면 처리 불필요(투수는 타순 외)
  d.usedPitchers = new Set([pid]); d.pitcher = pid; rebuildBullpen(d, LEAGUE.userTeam); renderLineup(); };
UIH.moveOrder = (i, dir) => { const d = UI.draft; const j = i + dir; const a = d.battingOrder;
  [a[i], a[j]] = [a[j], a[i]]; renderLineup(); };
UIH.swapSlot = (i) => {
  const d = UI.draft; const oldPid = d.battingOrder[i]; const pos = d.posByPid[oldPid];
  const teamId = LEAGUE.userTeam; const set = LEAGUE.level1[teamId];
  const used = new Set(d.battingOrder);
  const cand = LEAGUE.teams[teamId].players.filter(p => !p.isPitcher && set.has(p.pid) && !p.injury && !used.has(p.pid) && p.prof[pos] !== 'E')
    .sort((a, b) => b.ovr - a.ovr);
  showModal(`<h2>${pos} 자리 교체</h2><p class="mut">현재: ${getP(oldPid).name}. ${pos} 소화 가능한 대기 선수를 선택하세요.</p>
    ${cand.length ? cand.map(p => `<div class="list-row" onclick="UIH.doSwap(${i},${p.pid})">
      <b>#${fmtNum(p)} ${p.name}</b> ${ovrBadge(p.ovr)} <span style="color:${gradeColor(p.prof[pos])}">${pos}:${p.prof[pos]}</span>
      <span class="mut">P:${p.stats.power} C:${p.stats.contact} S:${p.stats.speed} D:${p.stats.defense}</span></div>`).join('') : '<p class="mut">교체 가능한 선수가 없습니다.</p>'}
    <div class="row" style="justify-content:flex-end;margin-top:10px"><button class="btn-ghost" onclick="closeModal()">닫기</button></div>`);
};
UIH.doSwap = (i, newPid) => {
  const d = UI.draft; const oldPid = d.battingOrder[i]; const pos = d.posByPid[oldPid];
  d.battingOrder[i] = newPid; d.posByPid[newPid] = pos; delete d.posByPid[oldPid];
  d.bench = d.bench.filter(x => x !== newPid); d.bench.push(oldPid);
  closeModal(); renderLineup();
};
UIH.startGame = () => {
  const g = createUserGame(UI.draft);
  if (!g) return toast('경기를 생성할 수 없습니다.');
  UI.game = g; UI.draft = null; renderGame();
};

// ============================================================
//  6. 경기 화면
// ============================================================
function renderGame() {
  UI.screen = 'game'; const g = UI.game;
  const us = g.userSide, them = us === 'home' ? 'away' : 'home';
  const battingSide = g.battingSide(), fieldingSide = g.fieldingSide();
  const userBatting = battingSide === us, userFielding = fieldingSide === us;
  const halfK = g.half === 'top' ? '초' : '말';
  const bat = g.curBatter(), pit = g.curPitcher();
  const mustReplace = userFielding && pit._mustReplace;

  APP().innerHTML = `
    <div class="scoreboard">
      <div style="text-align:center">
        <div class="mut">${teamBadge(g.awayTeam.id, 26)}<br>${g.awayTeam.short} <span style="font-size:11px">원정</span></div>
        <div class="ovrbig">${g.score.away}</div>
      </div>
      <div style="text-align:center">
        <div class="acc" style="font-weight:800;margin-bottom:2px">${g.finished ? '🏁 경기종료' : `${g.inning}회 ${halfK} ${g.half === 'top' ? '▲' : '▼'}`}</div>
        ${gameField(g)}
        <div class="countbox"><span>OUT ${[0, 1, 2].map(o => `<span class="outdot ${o < g.outs ? 'on' : ''}"></span>`).join('')}</span></div>
      </div>
      <div style="text-align:center">
        <div class="mut">${teamBadge(g.homeTeam.id, 26)}<br>${g.homeTeam.short} <span style="font-size:11px">홈</span></div>
        <div class="ovrbig">${g.score.home}</div>
      </div>
    </div>

    <div class="panel" style="padding:8px;overflow-x:auto">${lineScoreTable(g)}</div>

    ${g.finished ? '' : `<div class="panel" style="padding:10px">
      <div class="row">
        <div>🏏 타석: <b class="clickrow" style="text-decoration:underline" onclick="UIH.openPlayer(${bat.pid})">${bat.name}</b> <span class="mut">(${g.lineups[battingSide].posByPid[bat.pid] || ''}, OVR ${bat.ovr})</span></div>
        <div class="spacer"></div>
        <div>⚾ 투수: <b class="clickrow" style="text-decoration:underline" onclick="UIH.openPlayer(${pit.pid})">${pit.name}</b> <span class="mut">${pit.team === LEAGUE.userTeam ? '' : LEAGUE.teams[pit.team].short + ' '}투구수 ${g.pitchCount[pit.pid]}</span> ${staminaBar(pit, g.pitchCount[pit.pid])}</div>
      </div>
      ${mustReplace ? `<p class="bad" style="margin-top:6px">⚠️ 내 투수가 부상! 진행하려면 투수를 교체하세요.</p>` : ''}
    </div>`}

    <div class="row">
      <div class="col" style="flex:1;min-width:160px">
        <button class="btn-primary" style="font-size:16px;padding:14px" onclick="UIH.step()" ${g.finished ? 'disabled' : ''}>▶ 진행 (1타석)</button>
        <div class="row">
          <button onclick="UIH.autoHalf()" ${g.finished ? 'disabled' : ''}>⏩ 이닝 자동(위임)</button>
          <button onclick="UIH.autoFinish()" ${g.finished ? 'disabled' : ''}>⏭️ 경기 끝까지(위임)</button>
        </div>
        <div class="row">
          <button class="btn-blue" onclick="UIH.pinch()" ${!userBatting || g.finished ? 'disabled' : ''}>대타</button>
          <button class="btn-blue" onclick="UIH.defSubUI()" ${!userFielding || g.finished ? 'disabled' : ''}>대수비</button>
          <button class="btn-blue" onclick="UIH.pitchChangeUI()" ${!userFielding || g.finished ? 'disabled' : ''}>투수교체</button>
        </div>
        ${g.finished ? `<button class="btn-good" onclick="UIH.endGame()">경기 결과 정리 →</button>` : ''}
      </div>
      <div style="flex:2;min-width:300px">
        <div class="gamelog" id="gamelog">${g.log.map(l => l.startsWith('▶') || l.startsWith('■') || l.startsWith('—') ? `<span class="hl">${l}</span>` : l).join('\n')}</div>
      </div>
    </div>`;
  const lg = $('#gamelog'); if (lg) lg.scrollTop = lg.scrollHeight;
}

UIH.step = () => {
  const g = UI.game; const us = g.userSide, them = us === 'home' ? 'away' : 'home';
  if (g.fieldingSide() === us && g.curPitcher()._mustReplace) { toast('부상 투수를 먼저 교체하세요'); return UIH.pitchChangeUI(); }
  g.autoManage(them);
  g.step();
  if (g.finished) renderGame(); else renderGame();
};
UIH.autoHalf = () => {
  const g = UI.game; const us = g.userSide, them = us === 'home' ? 'away' : 'home';
  const startInning = g.inning, startHalf = g.half; let guard = 0;
  while (!g.finished && guard++ < 200 && g.inning === startInning && g.half === startHalf) {
    g.autoManage(them); g.autoManage(us); g.step();
  }
  renderGame();
};
UIH.autoFinish = () => {
  const g = UI.game; const us = g.userSide, them = us === 'home' ? 'away' : 'home'; let guard = 0;
  while (!g.finished && guard++ < 2000) { g.autoManage(them); g.autoManage(us); g.step(); }
  renderGame();
};
UIH.pinch = () => {
  const g = UI.game; const us = g.userSide; const lu = g.lineups[us];
  const cur = g.curBatter();
  const cand = lu.bench.map(getP).filter(p => !p.usedOut && !p.injury).sort((a, b) => b.ovr - a.ovr);
  showModal(`<h2>대타 (${cur.name} 대신)</h2>
    ${cand.length ? cand.map(p => `<div class="list-row" onclick="UIH.doPinch(${p.pid})"><b>${p.name}</b> ${ovrBadge(p.ovr)} <span class="mut">${p.primary} P:${p.stats.power} C:${p.stats.contact}</span></div>`).join('') : '<p class="mut">대타 가능 선수 없음</p>'}
    <div class="row" style="justify-content:flex-end"><button class="btn-ghost" onclick="closeModal()">닫기</button></div>`);
};
UIH.doPinch = (pid) => { UI.game.pinchHit(UI.game.userSide, pid); closeModal(); renderGame(); };
UIH.pitchChangeUI = () => {
  const g = UI.game; const us = g.userSide; const lu = g.lineups[us];
  const cand = lu.bullpen.map(getP).filter(p => !p.usedOut && !p.injury);
  showModal(`<h2>투수 교체 (현재: ${g.curPitcher().name})</h2>
    ${cand.length ? cand.map(p => `<div class="list-row" onclick="UIH.doPitch(${p.pid})"><b>${p.name}</b> ${ovrBadge(p.ovr)} <span class="mut">${roleK(p.role)} 구위 ${p.stats.stuff} 제구 ${p.stats.control}${p.fatigue > 40 ? ' · 피로' + Math.round(p.fatigue) : ''}</span></div>`).join('') : '<p class="mut">불펜에 가용 투수 없음</p>'}
    <div class="row" style="justify-content:flex-end"><button class="btn-ghost" onclick="closeModal()">닫기</button></div>`);
};
UIH.doPitch = (pid) => { UI.game.changePitcher(UI.game.userSide, pid); closeModal(); renderGame(); };
UIH.defSubUI = () => {
  const g = UI.game; const us = g.userSide; const lu = g.lineups[us];
  const fielders = lu.battingOrder.map(getP);
  showModal(`<h2>대수비 — 교체할 야수 선택</h2>
    ${fielders.map(p => `<div class="list-row" onclick="UIH.defSubPick(${p.pid})"><span class="tag">${lu.posByPid[p.pid]}</span> <b>${p.name}</b> ${ovrBadge(p.ovr)} <span class="mut">수비 ${p.stats.defense}</span></div>`).join('')}
    <div class="row" style="justify-content:flex-end"><button class="btn-ghost" onclick="closeModal()">닫기</button></div>`);
};
UIH.defSubPick = (outPid) => {
  const g = UI.game; const us = g.userSide; const lu = g.lineups[us];
  const pos = lu.posByPid[outPid];
  const cand = lu.bench.map(getP).filter(p => !p.usedOut && !p.injury);
  showModal(`<h2>${getP(outPid).name} (${pos}) 대신 투입</h2>
    ${cand.length ? cand.map(p => `<div class="list-row" onclick="UIH.doDefSub(${outPid},${p.pid},'${pos}')"><b>${p.name}</b> ${ovrBadge(p.ovr)} <span style="color:${gradeColor(p.prof[pos])}">${pos}:${p.prof[pos]}</span> <span class="mut">수비 ${p.stats.defense}</span></div>`).join('') : '<p class="mut">대기 선수 없음</p>'}
    <div class="row" style="justify-content:flex-end"><button class="btn-ghost" onclick="closeModal()">닫기</button></div>`);
};
UIH.doDefSub = (outPid, inPid, pos) => { UI.game.defSub(UI.game.userSide, outPid, inPid, pos); closeModal(); renderGame(); };

// 경기 결과 정리
function collectDayResults() {
  const slate = currentDaySlate();
  return slate.games.map(m => {
    const r = LEAGUE.results.find(x => x.date === LEAGUE.date && x.home === m.home && x.away === m.away);
    return r ? { m, r } : null;
  }).filter(Boolean);
}
UIH.endGame = () => {
  const g = UI.game;
  finalizeGame(g, g._match);
  simRestOfSlate(g._match);
  const farm = sim2gunGame(LEAGUE.userTeam);
  const dayResults = collectDayResults();
  advanceDay(); saveGame();
  UI.game = null;
  renderPostGame(g, dayResults, farm);
};

// ============================================================
//  7. 경기 후 요약
// ============================================================
function renderPostGame(userGame, dayResults, farm) {
  UI.screen = 'postgame';
  const newsToday = LEAGUE.news.filter(n => n.date === (userGame ? userGame._matchDate || LEAGUE.results[0] && LEAGUE.results[0].date : LEAGUE.date)).slice(0, 6);
  const recentNews = LEAGUE.news.slice(0, 6);
  if (LEAGUE.phase === 'postseason') return renderPostseason();
  APP().innerHTML = topbar() + `
    <div class="panel">
      <div class="sec-title">오늘의 경기 결과</div>
      <table class="score-tbl"><tbody>
      ${dayResults.map(({ m, r }) => {
        const win = r.winner;
        const mine = r.user;
        return `<tr class="${mine ? 'me' : 'hl'}">
          <td class="l" style="${win === 'away' ? 'font-weight:800' : 'opacity:.7'}">${badgeName(m.away, teamShort(m.away), 18)} ${r.as}</td>
          <td class="mut">:</td>
          <td class="l" style="${win === 'home' ? 'font-weight:800' : 'opacity:.7'}">${r.hs} ${badgeName(m.home, teamShort(m.home), 18)}</td>
          <td class="mut">${r.winner === 'draw' ? '무' : ''}</td></tr>`;
      }).join('')}
      </tbody></table>
    </div>
    <div class="panel">
      <div class="sec-title">⚾ 우리 2군 경기 결과 (vs ${farm.opp})</div>
      <p><b>${farm.us} : ${farm.them}</b> ${farm.result === '승' ? '<span class="good">승리</span>' : farm.result === '패' ? '<span class="bad">패배</span>' : '무승부'}</p>
      ${farm.stars.length ? `<p class="mut">주요 활약: ${farm.stars.join(' · ')}</p>` : '<p class="mut">특이사항 없음</p>'}
    </div>
    <div class="panel">
      <div class="sec-title">📰 리그 소식</div>
      ${recentNews.map(newsItem).join('') || '<p class="mut">소식 없음</p>'}
    </div>
    <div class="row"><button class="btn-primary" onclick="renderHub()">다음 경기로 →</button>
    <button class="btn-ghost" onclick="UIH.meeting('post')">🗣️ 경기 후 미팅</button></div>`;
}

// ============================================================
//  8. 기록실 (리더보드)
// ============================================================
function renderLeaders() {
  UI.screen = 'leaders';
  const all = Object.values(LEAGUE.playersById);
  const bat = all.filter(p => !p.isPitcher && p.season.pa >= 10);
  const pit = all.filter(p => p.isPitcher && p.pseason.outs >= 15);
  const top = (arr, fn, fmt, color, n = 10) => {
    const sorted = arr.slice().sort((a, b) => fn(b) - fn(a)).slice(0, n);
    const mx = sorted.length ? fn(sorted[0]) || 1 : 1;
    return sorted.map((p, i) => `<tr class="${p.team === LEAGUE.userTeam ? 'me' : ''} clickrow" onclick="UIH.openPlayer(${p.pid})">
      <td>${i + 1}</td><td class="l">${badgeName(p.team, p.name, 18)}</td><td style="white-space:nowrap"><b>${fmt(p)}</b></td><td>${lbar(fn(p), mx, color)}</td></tr>`).join('');
  };
  const tbl = (title, rows) => `<div class="panel" style="flex:1;min-width:240px"><div class="sec-title">${title}</div><table><tbody>${rows}</tbody></table></div>`;
  const eraRows = pit.slice().sort((a, b) => era(a.pseason) - era(b.pseason)).slice(0, 10);
  const eraWorst = eraRows.length ? era(eraRows[eraRows.length - 1].pseason) || 1 : 1;
  APP().innerHTML = topbar() + `
    <div class="row" style="align-items:flex-start">
      ${tbl('🏏 타율', top(bat, p => avg(p.season), p => fmt3(avg(p.season)), '#3fb950'))}
      ${tbl('💥 홈런', top(bat, p => p.season.hr, p => p.season.hr, '#f0a500'))}
      ${tbl('🎯 타점', top(bat, p => p.season.rbi, p => p.season.rbi, '#f0883e'))}
      ${tbl('📊 OPS', top(bat, p => ops(p.season), p => ops(p.season).toFixed(3).replace(/^0/, ''), '#388bfd'))}
      ${tbl('👟 도루', top(bat, p => p.season.sb, p => p.season.sb, '#7bc96f'))}
    </div>
    <div class="row" style="align-items:flex-start">
      ${tbl('🛡️ 평균자책 (낮을수록)', eraRows.map((p, i) => `<tr class="${p.team === LEAGUE.userTeam ? 'me' : ''} clickrow" onclick="UIH.openPlayer(${p.pid})"><td>${i + 1}</td><td class="l">${badgeName(p.team, p.name, 18)}</td><td style="white-space:nowrap"><b>${era(p.pseason).toFixed(2)}</b></td><td>${lbar(eraWorst - era(p.pseason) + 0.3, eraWorst, '#3fb950')}</td></tr>`).join(''))}
      ${tbl('🏆 다승', top(pit, p => p.pseason.w, p => p.pseason.w, '#f0a500'))}
      ${tbl('⚾ 탈삼진', top(pit, p => p.pseason.k, p => p.pseason.k, '#388bfd'))}
      ${tbl('🔒 세이브', top(pit, p => p.pseason.sv, p => p.pseason.sv, '#c30452'))}
      ${tbl('🤝 홀드', top(pit, p => p.pseason.hld, p => p.pseason.hld, '#7bc96f'))}
    </div>`;
}

// ============================================================
//  9. 트레이드
// ============================================================
function renderTrade() {
  UI.screen = 'trade';
  if (!UI._tradeOther) UI._tradeOther = TEAM_IDS.find(id => id !== LEAGUE.userTeam);
  if (!UI._give) UI._give = new Set(); if (!UI._get) UI._get = new Set();
  const other = UI._tradeOther;
  const deadlinePassed = new Date(LEAGUE.date) > new Date(LEAGUE.tradeDeadline);
  const myP = LEAGUE.teams[LEAGUE.userTeam].players.slice().sort((a, b) => b.ovr - a.ovr);
  const otP = LEAGUE.teams[other].players.slice().sort((a, b) => b.ovr - a.ovr);
  const row = (p, set, fn) => `<div class="list-row" onclick="${fn}(${p.pid})" style="${set.has(p.pid) ? 'background:rgba(240,165,0,.15)' : ''}">
    <input type="checkbox" ${set.has(p.pid) ? 'checked' : ''} onclick="event.stopPropagation();${fn}(${p.pid})">
    <span class="tag">${{ P: '투', C: '포', IF: '내', OF: '외' }[p.group]}</span> <b>${p.name}</b> ${ovrBadge(p.ovr)}
    <span class="mut">${p.age}세 가치 ${playerValue(p).toFixed(0)}</span></div>`;
  const gv = [...UI._give].reduce((s, pid) => s + playerValue(getP(pid)), 0);
  const rv = [...UI._get].reduce((s, pid) => s + playerValue(getP(pid)), 0);
  APP().innerHTML = topbar() + `
    <div class="panel">
      <div class="row"><div class="sec-title">트레이드 (마감 ${LEAGUE.tradeDeadline})</div><div class="spacer"></div>
        <select onchange="UIH.tradeOther(this.value)">${TEAM_IDS.filter(id => id !== LEAGUE.userTeam).map(id => `<option value="${id}" ${id === other ? 'selected' : ''}>${LEAGUE.teams[id].name}</option>`).join('')}</select>
      </div>
      ${deadlinePassed ? '<p class="bad">트레이드 마감일이 지났습니다.</p>' : ''}
      <div class="row" style="align-items:flex-start">
        <div style="flex:1;min-width:280px"><div class="sec-title">내보낼 선수 (${LEAGUE.teams[LEAGUE.userTeam].short}) — 가치 ${gv.toFixed(0)}</div>${myP.map(p => row(p, UI._give, 'UIH.toggleGive')).join('')}</div>
        <div style="flex:1;min-width:280px"><div class="sec-title">받을 선수 (${LEAGUE.teams[other].short}) — 가치 ${rv.toFixed(0)}</div>${otP.map(p => row(p, UI._get, 'UIH.toggleGet')).join('')}</div>
      </div>
      <div class="row" style="margin-top:12px">
        <button class="btn-primary" onclick="UIH.doTrade()" ${deadlinePassed ? 'disabled' : ''}>트레이드 제안</button>
        <span class="mut">상대는 제시 가치가 충분해야 수락합니다.</span>
      </div>
    </div>`;
}
UIH.tradeOther = (id) => { UI._tradeOther = id; UI._get = new Set(); renderTrade(); };
UIH.toggleGive = (pid) => { UI._give.has(pid) ? UI._give.delete(pid) : UI._give.add(pid); renderTrade(); };
UIH.toggleGet = (pid) => { UI._get.has(pid) ? UI._get.delete(pid) : UI._get.add(pid); renderTrade(); };
UIH.doTrade = () => {
  if (!UI._give.size || !UI._get.size) return toast('양 팀 선수를 선택하세요');
  const r = executeTrade(UI._tradeOther, [...UI._give], [...UI._get]);
  toast(r.msg);
  if (r.ok) { UI._give = new Set(); UI._get = new Set(); saveGame(); renderTrade(); }
};

// ============================================================
//  10. 훈련 (포지션 숙련도)
// ============================================================
function renderTraining() {
  UI.screen = 'training';
  const hitters = LEAGUE.teams[LEAGUE.userTeam].players.filter(p => !p.isPitcher).sort((a, b) => b.ovr - a.ovr);
  APP().innerHTML = topbar() + `
    <div class="panel"><p class="mut">포지션 훈련: 본 포지션과 연관된 자리만 숙련도가 성장합니다(최대 B). 연관 없는 포지션은 습득이 거의 불가능합니다.</p>
      <table><thead><tr><th class="l">선수</th><th>OVR</th><th class="l">현재 숙련도</th><th>훈련</th></tr></thead><tbody>
      ${hitters.map(p => `<tr><td class="l"><b>${p.name}</b></td><td>${ovrBadge(p.ovr)}</td><td class="l">${profChips(p)}</td>
        <td><select id="tr_${p.pid}">${POS_LIST.filter(x => x !== 'DH').map(x => `<option value="${x}">${x}</option>`).join('')}</select>
        <button class="btn-blue" onclick="UIH.train(${p.pid})">훈련</button></td></tr>`).join('')}
      </tbody></table>
    </div>`;
}
UIH.train = (pid) => { const pos = $('#tr_' + pid).value; const r = trainPosition(pid, pos); toast(r.msg); saveGame(); renderTraining(); };

// ============================================================
//  11. 포스트시즌
// ============================================================
function renderPostseason() {
  UI.screen = 'postseason'; const ps = LEAGUE.postseason;
  const roundK = { WC: '와일드카드 결정전', SEMI: '준플레이오프', PO: '플레이오프', KS: '한국시리즈', DONE: '시즌 종료' };
  const next = ps.round !== 'DONE';
  APP().innerHTML = `<div class="topbar"><b>🍂 2026 포스트시즌</b><div class="spacer"></div><button class="btn-ghost" onclick="UIH.save()">💾 저장</button><button onclick="renderStandings()">최종순위</button></div>
    <div class="panel">
      <div class="sec-title">대진 (정규 1~5위)</div>
      <p>${ps.seeds.map((id, i) => `${i + 1}위 <b>${LEAGUE.teams[id].name}</b>`).join(' · ')}</p>
      <div class="sec-title">진행</div>
      ${ps.log.map(l => `<div class="news-item">${l}</div>`).join('')}
      ${next ? `<div class="row" style="margin-top:14px"><button class="btn-primary" onclick="UIH.advancePS()">${roundK[ps.round]} 진행 ▶</button></div>`
        : `<div class="panel" style="text-align:center;margin-top:14px"><h2>🏆 ${LEAGUE.teams[ps.champion].name} 우승!</h2>
           <button class="btn-good" onclick="UIH.newSeason()" style="margin-top:10px">새 시즌 시작 (오프시즌 → 2027)</button></div>`}
    </div>`;
}
UIH.advancePS = () => { advancePostseason(); saveGame(); renderPostseason(); };
UIH.newSeason = () => {
  // 간이 오프시즌: 나이+1, 시즌기록 리셋, 일정 재생성, 시범경기부터
  for (const id of TEAM_IDS) {
    const t = LEAGUE.teams[id]; t.w = t.l = t.d = t.rf = t.ra = t.streak = 0; t.rotationIdx = 0;
    t.players.forEach(p => { p.age++; p.season = emptyBatLine(); p.pseason = emptyPitchLine(); p.fatigue = 0; p.injury = null; });
    autoSetLevel1(id);
  }
  LEAGUE.schedule = generateSchedule(TEAM_IDS); LEAGUE.phase = 'preseason'; LEAGUE.dayIdx = 0;
  LEAGUE.date = LEAGUE.schedule.preseason[0].date; LEAGUE.postseason = null; LEAGUE.lastMonth = 3;
  pushNews('리그', '새 시즌 준비 — 스프링캠프 시작', true);
  saveGame(); renderHub();
};

// ============================================================
//  모달 / 토스트
// ============================================================
function showModal(html) { $('#modal-root').innerHTML = `<div class="modal-bg" onclick="if(event.target===this)closeModal()"><div class="modal">${html}</div></div>`; }
function closeModal() { $('#modal-root').innerHTML = ''; }
function toast(msg) {
  const d = document.createElement('div');
  d.textContent = msg;
  d.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#222d;border:1px solid #444;color:#fff;padding:10px 18px;border-radius:8px;z-index:99;font-size:13px';
  document.body.appendChild(d); setTimeout(() => d.remove(), 2200);
}

/* ============================================================
 *  ⚾ 시각화 헬퍼 (엠블럼 · 레이더 · 야구장 · 스코어보드 등)
 * ============================================================ */
function teamColor(id) { const r = TEAMS_RAW[id]; const c = (LEAGUE.teams && LEAGUE.teams[id]) ? LEAGUE.teams[id].color : r.color; return c === '#000000' ? '#3b3b3b' : c; }
function teamShort(id) { return (LEAGUE.teams && LEAGUE.teams[id]) ? LEAGUE.teams[id].short : TEAMS_RAW[id].short; }
// 팀 엠블럼 — 이미지 로고(img/logos/<id>.png) 우선, 없으면 SVG 크레스트 폴백
const LOGO_EXT = 'png';
function teamCrestSVG(id, size) {
  const color = (LEAGUE.teams && LEAGUE.teams[id]) ? LEAGUE.teams[id].color : TEAMS_RAW[id].color;
  const short = teamShort(id);
  const fs = short.length >= 3 ? 11 : 15;
  return `<svg width="${size}" height="${size}" viewBox="0 0 40 40" style="vertical-align:middle;flex:0 0 auto">
    <circle cx="20" cy="20" r="18.5" fill="${color}" stroke="#0d1117" stroke-width="2.5"/>
    <circle cx="20" cy="20" r="18.5" fill="none" stroke="#ffffff66" stroke-width="1"/>
    <path d="M6 12 Q20 18 34 12 M6 28 Q20 22 34 28" fill="none" stroke="#ffffff33" stroke-width="1"/>
    <text x="20" y="21" text-anchor="middle" dominant-baseline="middle" fill="#fff" font-weight="800" font-size="${fs}" font-family="GameFont,sans-serif">${short}</text>
  </svg>`;
}
function teamBadge(id, size = 30) {
  return `<span class="emblem" style="width:${size}px;height:${size}px">` +
    `<img src="img/logos/${id}.${LOGO_EXT}" alt="${teamShort(id)}" loading="lazy" ` +
    `onerror="this.style.display='none';this.nextElementSibling.style.display='inline-flex'">` +
    `<span class="emblem-fb" style="display:none">${teamCrestSVG(id, size)}</span></span>`;
}
function badgeName(id, txt, size = 22) { return `<span class="badge-name">${teamBadge(id, size)}<span>${txt}</span></span>`; }

// 능력치 레이더 차트 (타자 4축 / 투수 3축)
function radarChart(p, size = 130) {
  const cx = size / 2, cy = size / 2, R = size * 0.32;
  const axes = p.isPitcher ? [['구속', 'velo'], ['제구', 'control'], ['구위', 'stuff']]
    : [['파워', 'power'], ['컨택', 'contact'], ['주루', 'speed'], ['수비', 'defense']];
  const n = axes.length;
  const ang = i => (-Math.PI / 2) + (i * 2 * Math.PI / n);
  const pt = (i, r) => [cx + Math.cos(ang(i)) * r, cy + Math.sin(ang(i)) * r];
  const norm = v => Math.max(0.08, Math.min(1, (v - 45) / 37));
  const col = ovrColor(p.ovr);
  let grid = '';
  [0.33, 0.66, 1].forEach(g => { grid += `<polygon points="${axes.map((_, i) => pt(i, R * g).join(',')).join(' ')}" fill="none" stroke="#2a3340" stroke-width="1"/>`; });
  let axl = '', lab = '';
  axes.forEach(([label, key], i) => {
    const [x, y] = pt(i, R); axl += `<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" stroke="#2a3340"/>`;
    const [lx, ly] = pt(i, R + 12);
    lab += `<text x="${lx}" y="${ly}" text-anchor="middle" dominant-baseline="middle" fill="#8b98a8" font-size="9">${label}</text>`;
    lab += `<text x="${lx}" y="${ly + 9}" text-anchor="middle" fill="${col}" font-size="9" font-weight="800">${p.stats[key]}</text>`;
  });
  const poly = axes.map(([_, key], i) => pt(i, R * norm(p.stats[key])).join(',')).join(' ');
  const dots = axes.map(([_, key], i) => { const [x, y] = pt(i, R * norm(p.stats[key])); return `<circle cx="${x}" cy="${y}" r="2.5" fill="${col}"/>`; }).join('');
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${grid}${axl}<polygon points="${poly}" fill="${col}55" stroke="${col}" stroke-width="2"/>${dots}${lab}</svg>`;
}

// 야구장 베이스 SVG (공통)
function ballField(extra, max = 220) {
  return `<div class="field-wrap" style="max-width:${max}px;margin:0 auto"><svg width="100%" viewBox="0 0 200 180">
    <path d="M100 158 L20 74 A114 114 0 0 1 180 74 Z" fill="#1d3f1f" stroke="#13280f"/>
    <path d="M100 158 L150 112 L100 66 L50 112 Z" fill="#6b4a2f"/>
    <path d="M100 150 L142 112 L100 74 L58 112 Z" fill="#235024"/>
    <path d="M100 158 L156 112 M100 158 L44 112" stroke="#e8e8e8" stroke-width="1.4" fill="none"/>
    <circle cx="100" cy="116" r="9" fill="#7a5232"/>
    ${extra}</svg></div>`;
}
function baseRect(x, y, on) { return `<rect x="${x - 7}" y="${y - 7}" width="14" height="14" transform="rotate(45 ${x} ${y})" fill="${on ? '#f0a500' : '#cfd6df'}" stroke="#0d1117" stroke-width="1"/>`; }
function gameField(g) {
  const b = g.bases;
  const extra = baseRect(150, 112, b[0]) + baseRect(100, 66, b[1]) + baseRect(50, 112, b[2])
    + `<polygon points="100,152 106,156 106,162 94,162 94,156" fill="#e8e8e8" stroke="#0d1117"/>`;
  return ballField(extra, 220);
}
const FIELD_POS = { C: [100, 156], '1B': [150, 110], '2B': [126, 86], SS: [74, 86], '3B': [50, 110], LF: [46, 50], CF: [100, 32], RF: [154, 50], P: [100, 116] };
function fieldDot(x, y, pos, name, c) {
  const nm = name && name.length > 4 ? name.slice(0, 4) : (name || '');
  return `<g><circle cx="${x}" cy="${y}" r="3.2" fill="${c}" stroke="#0d1117"/>
    <text x="${x}" y="${y - 6}" text-anchor="middle" font-size="7" fill="#cfd6df" font-weight="700">${pos}</text>
    ${name ? `<text x="${x}" y="${y + 11}" text-anchor="middle" font-size="7.5" fill="#fff">${nm}</text>` : ''}</g>`;
}
function lineupField(draft) {
  let extra = fieldDot(100, 116, 'P', getP(draft.pitcher).name, '#388bfd');
  for (const [pid, pos] of Object.entries(draft.posByPid)) {
    if (pos === 'DH' || !FIELD_POS[pos]) continue;
    const [x, y] = FIELD_POS[pos]; extra += fieldDot(x, y, pos, getP(+pid).name, '#f0a500');
  }
  return ballField(extra, 300);
}
function proficiencyField(p, max = 190) {
  let extra = '';
  for (const pos of ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF']) {
    const [x, y] = FIELD_POS[pos]; const g = p.prof[pos]; const c = gradeColor(g);
    extra += `<g><circle cx="${x}" cy="${y}" r="10.5" fill="${g === 'E' ? '#1c2330' : c}" stroke="${c}" stroke-width="1.5"/>
      <text x="${x}" y="${y - 1}" text-anchor="middle" dominant-baseline="middle" font-size="7.5" fill="${g === 'E' ? '#566' : '#0d1117'}" font-weight="800">${pos}</text>
      <text x="${x}" y="${y + 7}" text-anchor="middle" font-size="6.5" fill="${g === 'E' ? '#566' : '#0d1117'}" font-weight="700">${g}</text></g>`;
  }
  return ballField(extra, max);
}

// 이닝별 스코어보드
function lineScoreTable(g) {
  const maxInn = Math.max(9, g.inning, g.lineScore.home.length, g.lineScore.away.length);
  let head = '<th></th>';
  for (let i = 1; i <= maxInn; i++) head += `<th>${i}</th>`;
  head += '<th>R</th><th>H</th><th>E</th>';
  const cell = (side, i) => {
    const v = g.lineScore[side][i];
    if (v != null) return v;
    const inn = i + 1;
    const started = side === 'away' ? (g.inning >= inn) : (g.inning > inn || (g.inning === inn && g.half === 'bot') || g.finished);
    return started ? (g.inning === inn && !g.finished && ((side === 'away' && g.half === 'top') || (side === 'home' && g.half === 'bot')) ? '·' : 0) : '';
  };
  const row = (side) => { let r = `<td class="l">${badgeName(side === 'home' ? g.homeTeam.id : g.awayTeam.id, teamShort(side === 'home' ? g.homeTeam.id : g.awayTeam.id), 18)}</td>`;
    for (let i = 0; i < maxInn; i++) r += `<td>${cell(side, i)}</td>`;
    r += `<td>${g.score[side]}</td><td>${g.hits[side]}</td><td>${g.errors[side]}</td>`; return r; };
  return `<table class="linescore"><thead><tr>${head}</tr></thead><tbody><tr>${row('away')}</tr><tr>${row('home')}</tr></tbody></table>`;
}

// 최근 전적 스트립
function formStrip(teamId) {
  const res = LEAGUE.results.filter(r => r.phase === 'regular' && (r.home === teamId || r.away === teamId)).slice(0, 10).reverse();
  if (!res.length) return '<span class="mut" style="font-size:11px">-</span>';
  return res.map(r => { const home = r.home === teamId; const my = home ? r.hs : r.as, op = home ? r.as : r.hs;
    const c = my > op ? '#3fb950' : my < op ? '#f85149' : '#8b98a8';
    return `<span title="${teamShort(home ? r.away : r.home)} ${my}:${op}" style="display:inline-block;width:9px;height:9px;border-radius:2px;background:${c};margin-right:2px"></span>`; }).join('');
}
// 기록 막대
function lbar(v, max, color) { const pct = max ? Math.max(4, (v / max) * 100) : 0; return `<span class="lbar"><i style="width:${pct}%;background:${color || 'var(--acc)'}"></i></span>`; }
// 스태미나/피로 바
function staminaBar(p, used) {
  const pct = Math.max(0, Math.min(100, (1 - used / (p.stamina + 30)) * 100));
  const c = pct > 50 ? '#3fb950' : pct > 25 ? '#f0a500' : '#f85149';
  return `<span class="stamina"><i style="width:${pct}%;background:${c}"></i></span>`;
}

// 선수 상세 모달
function batterLine(p) {
  const b = p.season;
  return `<table style="font-size:12px"><thead><tr><th>G</th><th>타석</th><th>타율</th><th>HR</th><th>타점</th><th>득점</th><th>도루</th><th>OBP</th><th>SLG</th><th>OPS</th><th>BB</th><th>K</th></tr></thead>
    <tbody><tr><td>${b.g || 0}</td><td>${b.pa}</td><td>${fmt3(avg(b))}</td><td>${b.hr}</td><td>${b.rbi}</td><td>${b.r}</td><td>${b.sb}</td><td>${fmt3(obp(b))}</td><td>${fmt3(slg(b))}</td><td><b>${ops(b).toFixed(3).replace(/^0/, '')}</b></td><td>${b.bb}</td><td>${b.k}</td></tr></tbody></table>`;
}
function pitcherLine(p) {
  const s = p.pseason;
  return `<table style="font-size:12px"><thead><tr><th>G</th><th>선발</th><th>승</th><th>패</th><th>S</th><th>H</th><th>이닝</th><th>ERA</th><th>WHIP</th><th>K</th><th>BB</th></tr></thead>
    <tbody><tr><td>${s.g}</td><td>${s.gs}</td><td>${s.w}</td><td>${s.l}</td><td>${s.sv}</td><td>${s.hld}</td><td>${ipStr(s)}</td><td><b>${era(s).toFixed(2)}</b></td><td>${whip(s).toFixed(2)}</td><td>${s.k}</td><td>${s.bb}</td></tr></tbody></table>`;
}
UIH.openPlayer = (pid) => {
  const p = getP(pid); if (!p) return;
  showModal(`<div class="row" style="align-items:center;gap:10px">
      ${teamBadge(p.team, 42)}
      <div><h2 style="margin:0">#${fmtNum(p)} ${p.name}</h2>
        <span class="mut">${LEAGUE.teams[p.team].name} · ${p.age}세 · ${p.isPitcher ? roleK(p.role) : p.primary} · ${p.level}군</span></div>
      <span class="spacer"></span>${ovrBadge(p.ovr)} ${p.cur < p.peak ? `<span class="tag">잠재 ${p.peak}</span>` : ''}
    </div>
    <div style="margin:6px 0">${injTag(p) || (p.fatigue > 0 ? `<span class="mut" style="font-size:11px">피로도 ${Math.round(p.fatigue)}</span>` : '')}</div>
    <div class="radar-grid">
      <div style="text-align:center">${radarChart(p, 158)}<div class="mut" style="font-size:11px">세부 능력치</div></div>
      ${p.isPitcher ? '' : `<div style="text-align:center">${proficiencyField(p, 180)}<div class="mut" style="font-size:11px">포지션 숙련도 (A~E)</div></div>`}
    </div>
    <div class="sec-title">2026 시즌 성적</div>${p.isPitcher ? pitcherLine(p) : batterLine(p)}
    <div class="row" style="justify-content:flex-end;margin-top:12px"><button class="btn-primary" onclick="closeModal()">닫기</button></div>`);
};

// 구단 스카우트 뷰 (read-only)
function renderTeamView(teamId) {
  UI.screen = 'teamview';
  const t = LEAGUE.teams[teamId]; const lv = UI._tvTab || 1;
  const players = t.players.filter(p => p.level === lv);
  const groups = [['P', '투수'], ['C', '포수'], ['IF', '내야수'], ['OF', '외야수']];
  APP().innerHTML = topbar() + `
    <div class="panel">
      <div class="row" style="align-items:center">
        ${teamBadge(teamId, 44)}
        <div><h2 style="margin:0">${t.name}</h2><span class="mut">오버롤 ${t.ovr} · 난이도 ${t.difficulty} · 주장 ${t.captain}</span></div>
        <span class="spacer"></span><button class="btn-ghost" onclick="renderStandings()">← 순위로</button>
      </div>
      <div class="mut" style="font-size:12px;margin-top:6px">선발: ${t.rotationNames.join(' · ')} / 마무리: ${t.closerName}</div>
      <div class="subtabs row" style="margin-top:8px">
        <button class="${lv === 1 ? 'active' : ''}" onclick="UIH.tvTab('${teamId}',1)">1군</button>
        <button class="${lv === 2 ? 'active' : ''}" onclick="UIH.tvTab('${teamId}',2)">2군</button>
      </div>
      ${groups.map(([g, label]) => {
        const ps = players.filter(p => p.group === g).sort((a, b) => b.ovr - a.ovr);
        if (!ps.length) return '';
        return `<div class="sec-title">${label}</div><div class="flex-wrap">
          ${ps.map(p => `<span class="tag clickrow" onclick="UIH.openPlayer(${p.pid})">#${fmtNum(p)} ${p.name} ${ovrBadge(p.ovr)}${p.isPitcher ? ' ' + roleK(p.role) : ' ' + p.primary}</span>`).join('')}
        </div>`;
      }).join('')}
    </div>`;
}
UIH.tvTab = (id, n) => { UI._tvTab = n; renderTeamView(id); };
