/* ============================================================
 *  일정 생성 — 시범경기 + 정규시즌 144경기 (월요일 휴식)
 * ============================================================ */

function addDaysSkipMon(start, count) {
  // start: Date, returns array of `count` date strings skipping Mondays
  const out = [];
  let d = new Date(start);
  while (out.length < count) {
    if (d.getDay() !== 1) out.push(d.toISOString().slice(0, 10)); // 1=Mon 휴식
    d.setDate(d.getDate() + 1);
  }
  return out;
}

// 서클 방식 라운드로빈: 9라운드(각 팀 1회씩 대결)
function roundRobinRounds(teams) {
  const arr = teams.slice();
  const n = arr.length;
  const rounds = [];
  for (let r = 0; r < n - 1; r++) {
    const games = [];
    for (let i = 0; i < n / 2; i++) {
      const a = arr[i], b = arr[n - 1 - i];
      games.push([a, b]);
    }
    rounds.push(games);
    // 회전 (첫 원소 고정)
    arr.splice(1, 0, arr.pop());
  }
  return rounds; // 9개 라운드
}

function generateSchedule(teamIds) {
  const base = roundRobinRounds(teamIds); // 9 rounds
  // 정규시즌: 16바퀴 → 144경기. 홈/원정 교대.
  const regularRounds = [];
  for (let rep = 0; rep < 16; rep++) {
    base.forEach((round, ri) => {
      const games = round.map(([a, b], gi) => {
        const swap = (rep % 2 === 0) ? false : true;
        return swap ? { home: a, away: b } : { home: b, away: a };
      });
      regularRounds.push(games);
    });
  }
  // 시범경기: 앞 2바퀴(18라운드 중 10라운드만 사용)
  const preRounds = [];
  for (let rep = 0; rep < 2; rep++) {
    base.forEach((round) => {
      preRounds.push(round.map(([a, b]) => ({ home: a, away: b, exhibition: true })));
    });
  }
  const preGames = preRounds.slice(0, 10);

  const preDates = addDaysSkipMon(new Date('2026-03-10'), preGames.length);
  const regDates = addDaysSkipMon(new Date('2026-03-28'), regularRounds.length);

  const preseason = preGames.map((g, i) => ({ date: preDates[i], games: g, type: 'pre' }));
  const regular = regularRounds.map((g, i) => ({ date: regDates[i], games: g, type: 'reg', round: i + 1 }));

  return { preseason, regular };
}

if (typeof module !== 'undefined') module.exports = { generateSchedule };
