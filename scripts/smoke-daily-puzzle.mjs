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
  return { status: r.status, json, headers: r.headers.get('cache-control') };
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
let r;
const reg = async (name, domain = 'example.com') => {
  const r = await api('POST', '/api/auth/register', { email: `${name}${tag}@${domain}`, username: `${name}${tag}`.slice(0, 20), password: 'pw-local-123456' });
  if (r.status >= 300) console.log(r);
  return r.json.token;
};
const [a, b, c, t, s, n] = [await reg('pa'), await reg('pb'), await reg('pc'), await reg('pt', 'example.test'), await reg('ps'), await reg('pn')];
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

// Solve times are measured by the server from when each player first opened
// the puzzle (a signed-in GET records the start). The client's timeMs is ignored.
r = await api('POST', '/api/daily/solve', { day, steps, timeMs: 10000 }, n);
ok(r.status === 400 && r.json?.code === 'no-start', `never opened the puzzle -> 400 no-start (${r.json?.code})`);

for (const tok of [a, b, c, t, s]) await api('GET', '/api/daily/puzzle', null, tok);
const opened = Date.now();

const wrong = [...steps]; wrong[wrong.length - 1] = { ...wrong.at(-1), op: wrong.at(-1).op === '+' ? '-' : '+' };
r = await api('POST', '/api/daily/solve', { day, steps: wrong, timeMs: 10000 }, a);
ok(r.status === 400, `wrong solution -> 400 (${r.json?.error})`);
r = await api('POST', '/api/daily/solve', { day, steps, timeMs: 10000 }, a);
ok(r.status === 400 && r.json?.code === 'too-fast', `solved under 3 s of server time -> 400 too-fast (${r.json?.code})`);
r = await api('POST', '/api/daily/solve', { day, steps, timeMs: 10000 });
ok(r.status === 401, 'solve unauthenticated -> 401');
r = await api('POST', '/api/daily/solve', { day: '2020-01-01', steps, timeMs: 10000 }, a);
ok(r.status === 400, 'closed day -> 400');
r = await api('POST', '/api/daily/solve', { day: '2026-13-01', steps, timeMs: 10000 }, a);
ok(r.status === 400, 'impossible date -> 400 (used to crash the server)');

await sleep(3400);
r = await api('POST', '/api/daily/solve', { day, steps, timeMs: 1 }, a);
const aMs = r.json?.mine?.timeMs;
ok(r.status === 200 && aMs >= 3400 && aMs <= Date.now() - opened + 300 && r.json.solvers === 1 && r.json.mine.fasterThanPct === null,
  `a: claimed 1 ms, stored server time ${aMs}; first solver has no "faster than" figure`);
await sleep(1500);
r = await api('POST', '/api/daily/solve', { day, steps, timeMs: 1 }, b);
const bMs = r.json?.mine?.timeMs;
ok(r.status === 200 && bMs > aMs && r.json.solvers === 2 && r.json.mine.fasterThanPct === 0, `b slower (${bMs}): pct ${r.json.mine?.fasterThanPct}`);
r = await api('POST', '/api/daily/solve', { day, steps, timeMs: 1 }, t);
ok(r.status === 200 && r.json.solvers === 2, `test account left out of the solver count (${r.json?.solvers})`);
await sleep(1500);
r = await api('POST', '/api/daily/solve', { day, steps, timeMs: 1 }, c);
const cMs = r.json?.mine?.timeMs;
ok(r.status === 200 && cMs > bMs && r.json.solvers === 3 && r.json.mine.fasterThanPct === 0 && r.json.medianMs === bMs,
  `c slowest (${cMs}): median is b's time (${r.json.medianMs})`);
r = await api('POST', '/api/daily/solve', { day, steps, timeMs: 1 }, a);
ok(r.status === 200 && r.json.mine.timeMs === aMs, 'repeat submit keeps the first time');

for (const [name, tok, pct] of [['a', a, 100], ['b', b, 50], ['c', c, 0]]) {
  r = await api('GET', `/api/daily/stats?day=${day}`, null, tok);
  ok(r.status === 200 && r.json.mine.fasterThanPct === pct, `stats ${name}: fasterThan ${r.json.mine?.fasterThanPct} (want ${pct})`);
}
r = await api('GET', '/api/daily/stats');
const total = r.json.buckets.reduce((sum, x) => sum + x.count, 0);
ok(r.status === 200 && r.json.mine === null && total === 3 && r.json.medianMs === bMs, `unauth stats: mine null, buckets sum ${total}`);
r = await api('GET', '/api/daily/stats', null, 'garbage');
ok(r.status === 200 && r.json.mine === null, 'bad token stats -> 200 mine null');
r = await api('GET', '/api/daily/stats?day=2020-01-01');
ok(r.status === 400, 'stats old day -> 400');
r = await api('GET', '/api/daily/stats?day=2026-13-01');
ok(r.status === 400, 'stats impossible date -> 400');

// Refetching the puzzle must not restart an account's clock.
const pr = await api('GET', '/api/daily/puzzle', null, s);
ok(pr.status === 200 && /no-store/.test(pr.headers ?? '') && typeof pr.json?.startTicket === 'string', 'puzzle -> 200, no-store, with a start ticket');
r = await api('POST', '/api/daily/solve', { day, steps, timeMs: 1 }, s);
ok(r.status === 200 && r.json.mine.timeMs >= Date.now() - opened - 500, `refetch did not reset s's clock (${r.json?.mine?.timeMs})`);

for (const [m, p] of [['GET', '/api/daily/today'], ['POST', '/api/daily/submit'], ['GET', '/api/daily/leaderboard'], ['POST', '/api/friends'], ['DELETE', '/api/friends/00000000-0000-0000-0000-000000000000']]) {
  r = await api(m, p, m === 'GET' ? null : {}, a);
  ok(r.status === 404, `${m} ${p} -> ${r.status}`);
}
console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
process.exit(failed ? 1 : 0);
