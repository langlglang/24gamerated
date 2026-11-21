// End-to-end check of the daily puzzle API. Usage: BASE=http://localhost:3300 node scripts/smoke-daily-puzzle.mjs
// Run only against a local server backed by a throwaway database.
import { applyCombine, checkPuzzleSolution, dailyPuzzle, tableFromCards, PUZZLE_RULES, OPS } from '../shared/dist/index.js';

const BASE = process.env.BASE ?? 'http://localhost:3300';
let failed = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'} ${msg}`); if (!cond) failed++; };
async function api(method, path, body, token) {
  const r = await fetch(BASE + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null; try { json = await r.json(); } catch {}
  return { status: r.status, json };
}

function solve(puzzle) {
  const rec = (table, steps) => {
    if (table.length === 1) return checkPuzzleSolution(puzzle, steps).ok ? steps : null;
    for (let i = 0; i < table.length; i++) for (let j = 0; j < table.length; j++) {
      if (i === j) continue;
      for (const op of OPS) {
        const step = { aId: table[i].id, bId: table[j].id, op };
        const r = applyCombine(table, step, PUZZLE_RULES, steps.length);
        if (!r.ok) continue;
        const s = rec(r.table, [...steps, step]);
        if (s) return s;
      }
    }
    return null;
  };
  return rec(tableFromCards(puzzle.cards), []);
}

const pz = await api('GET', '/api/daily/puzzle');
ok(pz.status === 200 && pz.json.cards.length >= 5 && pz.json.target >= 100, `puzzle no auth (${pz.json?.cards?.length} cards, target ${pz.json?.target})`);
ok(pz.json && !('ways' in pz.json), 'puzzle has no ways/solution');
const day = pz.json.day;
const steps = solve(dailyPuzzle(day));
ok(!!steps, 'brute-force found a solution');

const tag = Date.now();
const reg = async (name, domain = 'example.com') => {
  const r = await api('POST', '/api/auth/register', { email: `${name}${tag}@${domain}`, username: `${name}${tag}`.slice(0, 20), password: 'pw-local-123456' });
  if (r.status >= 300) console.log(r);
  return r.json.token;
};
const [a, b, c, t] = [await reg('pa'), await reg('pb'), await reg('pc'), await reg('pt', 'example.test')];

const wrong = [...steps]; wrong[wrong.length - 1] = { ...wrong.at(-1), op: wrong.at(-1).op === '+' ? '-' : '+' };
let r = await api('POST', '/api/daily/solve', { day, steps: wrong, timeMs: 10000 }, a);
ok(r.status === 400, `wrong solution -> 400 (${r.json?.error})`);
r = await api('POST', '/api/daily/solve', { day, steps, timeMs: 1000 }, a);
ok(r.status === 400, `timeMs 1000 -> 400 (${r.json?.error})`);
r = await api('POST', '/api/daily/solve', { day, steps, timeMs: 10000 });
ok(r.status === 401, 'solve unauthenticated -> 401');
r = await api('POST', '/api/daily/solve', { day: '2020-01-01', steps, timeMs: 10000 }, a);
ok(r.status === 400, 'closed day -> 400');

r = await api('POST', '/api/daily/solve', { day, steps, timeMs: 10000 }, a);
ok(r.status === 200 && r.json.mine.timeMs === 10000 && r.json.solvers === 1 && r.json.mine.fasterThanPct === 100, `a solves 10s: ${JSON.stringify(r.json.mine)}`);
r = await api('POST', '/api/daily/solve', { day, steps, timeMs: 20000 }, b);
ok(r.status === 200 && r.json.solvers === 2 && r.json.mine.fasterThanPct === 0 && r.json.medianMs === 15000, `b 20s: pct ${r.json.mine?.fasterThanPct} median ${r.json.medianMs}`);
r = await api('POST', '/api/daily/solve', { day, steps, timeMs: 40000 }, c);
ok(r.status === 200 && r.json.solvers === 3 && r.json.mine.fasterThanPct === 0 && r.json.medianMs === 20000, `c 40s: pct ${r.json.mine?.fasterThanPct} median ${r.json.medianMs}`);
r = await api('POST', '/api/daily/solve', { day, steps, timeMs: 5000 }, t);
ok(r.status === 200 && r.json.solvers === 3 && r.json.mine.timeMs === 5000, `test account excluded from solvers (${r.json.solvers}), own pct ${r.json.mine?.fasterThanPct}`);
r = await api('POST', '/api/daily/solve', { day, steps, timeMs: 3500 }, a);
ok(r.status === 200 && r.json.mine.timeMs === 10000, 'repeat submit keeps first time');

for (const [name, tok, pct] of [['a', a, 100], ['b', b, 50], ['c', c, 0]]) {
  r = await api('GET', `/api/daily/stats?day=${day}`, null, tok);
  ok(r.status === 200 && r.json.mine.fasterThanPct === pct, `stats ${name}: fasterThan ${r.json.mine?.fasterThanPct} (want ${pct})`);
}
r = await api('GET', '/api/daily/stats');
const total = r.json.buckets.reduce((s, x) => s + x.count, 0);
ok(r.status === 200 && r.json.mine === null && total === 3 && r.json.medianMs === 20000, `unauth stats: mine null, buckets sum ${total}, ${r.json.buckets.length} buckets`);
r = await api('GET', '/api/daily/stats', null, 'garbage');
ok(r.status === 200 && r.json.mine === null, 'bad token stats -> 200 mine null');
r = await api('GET', '/api/daily/stats?day=2020-01-01');
ok(r.status === 400, 'stats old day -> 400');

for (const [m, p] of [['GET', '/api/daily/today'], ['POST', '/api/daily/submit'], ['GET', '/api/daily/leaderboard'], ['POST', '/api/friends'], ['DELETE', '/api/friends/00000000-0000-0000-0000-000000000000']]) {
  r = await api(m, p, m === 'GET' ? null : {}, a);
  ok(r.status === 404, `${m} ${p} -> ${r.status}`);
}
console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
process.exit(failed ? 1 : 0);
