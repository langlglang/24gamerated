/**
 * Regression smoke test for guest-room seats, against a running server.
 *
 *   npm run build && npm start          (terminal 1)
 *   node scripts/smoke-seats.mjs        (terminal 2; SMOKE_URL to override)
 *
 * Covers: a seat cannot be taken with its (public) player id alone; the
 * reconnect token reclaims it and detaches the old socket; client-chosen ids
 * are ignored; one socket holds one seat; someone else dropping does not
 * cancel a buzz; the remaining player takes over as host at match-result is
 * covered by the server unit tests. Runs with or without DATABASE_URL.
 *
 * The last check (room-code guessing) trips the per-socket failed-join limit,
 * so it runs last.
 */
import { io } from 'socket.io-client';
import { solveCards } from '@24game/shared';

const URL = process.env.SMOKE_URL ?? 'http://localhost:3000';
const RULES = { fractions: false, negatives: false };

let failures = 0;
function check(label, ok, detail = '') {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures++;
}

function connect() {
  return new Promise((resolve, reject) => {
    const socket = io(URL, { transports: ['websocket'], forceNew: true, reconnection: false });
    const c = { socket, latest: null, waiters: [], events: [] };
    socket.on('state', (s) => {
      c.latest = s;
      c.waiters = c.waiters.filter((w) => (w.p(s) ? (w.res(s), false) : true));
    });
    socket.on('seatReplaced', (p) => c.events.push(['seatReplaced', p]));
    socket.on('connect', () => resolve(c));
    socket.on('connect_error', reject);
  });
}

const ack = (c, ev, payload) => new Promise((res) => c.socket.emit(ev, payload, res));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function waitState(c, p, label, ms = 10_000) {
  if (c.latest && p(c.latest)) return Promise.resolve(c.latest);
  return new Promise((res, rej) => {
    const w = { p, res: (s) => (clearTimeout(t), res(s)) };
    const t = setTimeout(() => rej(new Error(`timed out: ${label}`)), ms);
    c.waiters.push(w);
  });
}

async function main() {
  // ---- seat credentials
  const A = await connect();
  const B = await connect();
  const created = await ack(A, 'room:create', { name: 'Ann', mode: 'ffa', rules: RULES });
  check('room:create returns a reconnect token', typeof created.reconnectToken === 'string' && created.reconnectToken.length >= 20);
  const joined = await ack(B, 'room:join', { name: 'Ben', roomCode: created.roomCode });
  check('room:join returns its own token', joined.ok && joined.reconnectToken && joined.reconnectToken !== created.reconnectToken);

  const evil = await connect();
  const noToken = await ack(evil, 'room:join', { name: 'x', roomCode: created.roomCode, playerId: joined.playerId });
  check('a public player id alone cannot take a seat', noToken.ok === false, noToken.error);
  const wrongToken = await ack(evil, 'room:join', {
    name: 'x',
    roomCode: created.roomCode,
    playerId: joined.playerId,
    reconnectToken: created.reconnectToken,
  });
  check("another seat's token does not work", wrongToken.ok === false, wrongToken.error);

  const chosen = await ack(evil, 'room:join', { name: 'Eve', roomCode: created.roomCode, playerId: 'my-own-id' });
  check('a client-chosen id is ignored for a new seat', chosen.ok && chosen.playerId !== 'my-own-id');
  evil.socket.emit('room:leave');
  await sleep(200);

  // The same player in a new tab reclaims the seat; the old socket is detached.
  const B2 = await connect();
  const reclaimed = await ack(B2, 'room:join', {
    name: 'Ben',
    roomCode: created.roomCode,
    playerId: joined.playerId,
    reconnectToken: joined.reconnectToken,
  });
  check('the reconnect token reclaims the seat', reclaimed.ok && reclaimed.playerId === joined.playerId);
  await sleep(200);
  check('the old socket is told its seat moved', B.events.some(([e]) => e === 'seatReplaced'));
  const s = await waitState(A, (x) => x.players.length === 2 && x.players.every((p) => p.connected), 'two seats');
  check('still exactly two seats, both connected', s.players.length === 2);

  // ---- one seat per socket
  const C = await connect();
  const c1 = await ack(C, 'room:create', { name: 'Cat', mode: 'ffa', rules: RULES });
  const c2 = await ack(C, 'room:create', { name: 'Cat', mode: 'ffa', rules: RULES });
  check('creating a second room works', c1.ok && c2.ok && c1.roomCode !== c2.roomCode);
  const probe = await connect();
  const firstRoom = await ack(probe, 'room:join', { name: 'Probe', roomCode: c1.roomCode });
  check('the first room was left (empty lobby closed)', firstRoom.ok === false && firstRoom.error === 'room-not-found', firstRoom.error);

  // ---- someone else dropping does not cancel a buzz
  const P = [await connect(), await connect(), await connect()];
  const r = await ack(P[0], 'room:create', { name: 'P0', mode: 'ffa', rules: RULES });
  const seats = [r];
  for (let i = 1; i < 3; i++) seats.push(await ack(P[i], 'room:join', { name: `P${i}`, roomCode: r.roomCode }));
  await waitState(P[0], (x) => x.players.length === 3, 'three seats');
  P[0].socket.emit('room:start');
  let st = await waitState(P[0], (x) => x.phase === 'open', 'first hand');
  for (let i = 0; i < 20 && !solveCards(st.cards, st.rules).solvable; i++) {
    const hand = st.handNumber;
    P[2].socket.emit('game:callNoSolution');
    st = await waitState(P[0], (x) => x.phase === 'open' && x.handNumber > hand, 'next hand', 15_000);
  }
  const sol = solveCards(st.cards, st.rules);
  P[1].socket.emit('game:buzz');
  await waitState(P[0], (x) => x.phase === 'answering', 'answering');
  P[1].socket.emit('game:combine', { step: sol.steps[0] });
  await sleep(200);
  P[2].socket.close();
  await waitState(P[0], (x) => x.phase === 'paused', 'paused');
  const back = await connect();
  const rj = await ack(back, 'room:join', {
    name: 'P2',
    roomCode: r.roomCode,
    playerId: seats[2].playerId,
    reconnectToken: seats[2].reconnectToken,
  });
  const resumed = await waitState(P[0], (x) => x.phase !== 'paused', 'resumed');
  check(
    'the answer in progress survives someone else dropping',
    rj.ok && resumed.phase === 'answering' && resumed.activePlayerId === seats[1].playerId && resumed.table.length === 3,
    `${resumed.phase}`,
  );

  // ---- room-code guessing is throttled (per socket)
  const G = await connect();
  const answers = {};
  for (let i = 0; i < 30; i++) {
    const res = await ack(G, 'room:join', { name: 'g', roomCode: 'ZZZZZZ' });
    answers[res.error ?? 'ok'] = (answers[res.error ?? 'ok'] ?? 0) + 1;
  }
  check('failed joins are throttled per socket', (answers['room-not-found'] ?? 0) <= 10, JSON.stringify(answers));

  for (const c of [A, B, B2, C, probe, evil, ...P, back, G]) c.socket.close();
  console.log(failures === 0 ? '\nseat smoke test passed' : `\nseat smoke test FAILED (${failures})`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('seat smoke test error:', err.message);
  process.exit(1);
});
