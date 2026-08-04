/**
 * End-to-end smoke test against a running server.
 *
 *   npm run build && npm start          (in one terminal)
 *   node scripts/smoke.mjs              (in another)
 *
 * Drives two real socket clients through a 2-player room: create, join, start,
 * buzz, solve a live hand using the shared solver, and assert the score moved.
 * Complements the unit tests, which cover the pure logic but not the wiring.
 */
import { io } from 'socket.io-client';
import { solveCards } from '@24game/shared';

const URL = process.env.SMOKE_URL ?? 'http://localhost:3000';
const RULES = { fractions: true, negatives: true };

let failures = 0;
function check(label, condition) {
  console.log(`${condition ? 'ok  ' : 'FAIL'}  ${label}`);
  if (!condition) failures++;
}

function connect() {
  return new Promise((resolve, reject) => {
    const socket = io(URL, { transports: ['websocket'] });
    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', reject);
  });
}

/**
 * Track every state broadcast for a socket from the moment it connects.
 *
 * Attaching a listener only when you start waiting loses any broadcast that
 * already arrived — and the server often answers an ack and broadcasts in the
 * same tick, so the state can land before an `await` resumes. Keeping the
 * latest state means a wait can be satisfied by something already seen.
 */
function trackState(socket) {
  const tracker = { latest: null, waiters: [] };
  socket.on('state', (state) => {
    tracker.latest = state;
    tracker.waiters = tracker.waiters.filter((waiter) => {
      if (!waiter.predicate(state)) return true;
      waiter.settle(state);
      return false;
    });
  });
  return tracker;
}

function waitForState(tracker, predicate, label, timeoutMs = 15000) {
  if (tracker.latest && predicate(tracker.latest)) return Promise.resolve(tracker.latest);
  return new Promise((resolve, reject) => {
    const waiter = {
      predicate,
      settle: (state) => {
        clearTimeout(timer);
        resolve(state);
      },
    };
    const timer = setTimeout(() => {
      tracker.waiters = tracker.waiters.filter((w) => w !== waiter);
      reject(new Error(`timed out waiting for: ${label}`));
    }, timeoutMs);
    tracker.waiters.push(waiter);
  });
}

const emitWithAck = (socket, event, payload) =>
  new Promise((resolve) => socket.emit(event, payload, resolve));

async function main() {
  const host = await connect();
  const guest = await connect();
  // Start tracking before any action, so no broadcast can be missed.
  const hostState = trackState(host);

  const created = await emitWithAck(host, 'room:create', {
    name: 'Host',
    mode: 'p2',
    rules: RULES,
  });
  check('host created a room', created.ok === true);
  const roomCode = created.roomCode;
  check('room code is 6 characters', roomCode?.length === 6);

  const joined = await emitWithAck(guest, 'room:join', { name: 'Guest', roomCode });
  check('guest joined the room', joined.ok === true);

  const lobby = await waitForState(hostState, (s) => s.players.length === 2, 'two players in lobby');
  check('lobby shows both players', lobby.players.length === 2);
  check('solver verdict is not leaked to clients', !('solvable' in lobby));

  host.emit('room:start');
  let state = await waitForState(
    hostState,
    (s) => s.phase === 'open' && s.cards.length === 4,
    'first hand',
  );
  check('first hand dealt', state.handNumber === 1);
  check('13 hands in a match', state.totalHands === 13);
  check('48 cards left after the first deal', state.cardsRemaining === 48);

  // Find a hand the host can actually solve, calling "no solution" otherwise.
  let solvedHand = null;
  for (let attempt = 0; attempt < 13 && !solvedHand; attempt++) {
    const solution = solveCards(state.cards, RULES);
    if (!solution.solvable) {
      host.emit('game:callNoSolution');
      state = await waitForState(
        hostState,
        (s) => s.phase === 'open' && s.handNumber === state.handNumber + 1,
        'next hand after no-solution call',
      );
      continue;
    }

    host.emit('game:buzz');
    const answering = await waitForState(
      hostState,
      (s) => s.phase === 'answering',
      'answering phase',
    );
    check('buzz locked the round to the host', answering.activePlayerId === created.playerId);
    check('the buzz-start timer is running', answering.timer?.kind === 'buzz-start');

    // Guest must not be able to steal the round mid-answer.
    const stolen = await new Promise((resolve) => {
      guest.once('rejected', (r) => resolve(r));
      guest.emit('game:buzz');
      setTimeout(() => resolve(null), 500);
    });
    check('a second buzz is rejected while answering', stolen?.reason === 'too-late');

    for (const step of solution.steps) host.emit('game:combine', { step });
    const result = await waitForState(hostState, (s) => s.phase === 'hand-result', 'hand result');
    check('solving the hand scored a point', (result.scores[created.playerId] ?? 0) >= 1);
    check('the result reveals a solution', typeof result.lastResult?.solution === 'string');
    solvedHand = result;
  }

  check('found and solved at least one hand', solvedHand !== null);

  host.close();
  guest.close();

  console.log(failures === 0 ? '\nsmoke test passed' : `\nsmoke test FAILED (${failures})`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('smoke test error:', err.message);
  process.exit(1);
});
