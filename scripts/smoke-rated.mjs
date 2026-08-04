/**
 * End-to-end smoke test for the RATED surface. Needs a running server with
 * DATABASE_URL configured.
 *
 *   npm run build && npm start        (terminal 1, with .env present)
 *   node scripts/smoke-rated.mjs      (terminal 2)
 *
 * Creates throwaway accounts, drives a friend challenge to the point of a
 * match, then plays a full 13-hand ranked match and checks that Elo moved,
 * was zero-sum, and landed in match history and the leaderboard.
 *
 * The accounts it creates are left behind on purpose — deleting them would
 * need a destructive query this script has no business running.
 */
import { io } from 'socket.io-client';

const URL = process.env.SMOKE_URL ?? 'http://localhost:3000';
const stamp = Date.now().toString(36);

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures++;
};

async function api(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(`${URL}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : {} };
}

async function makeAccount(tag) {
  const username = `smoke_${tag}_${stamp}`.slice(0, 16);
  const res = await api('/api/auth/register', {
    method: 'POST',
    body: { email: `${username}@example.test`, username, password: 'correct horse battery' },
  });
  if (res.status !== 201) throw new Error(`register failed (${res.status}): ${res.body.error}`);
  return { username, token: res.body.token, user: res.body.user };
}

function connect(token) {
  return new Promise((resolve, reject) => {
    const socket = io(URL, { transports: ['websocket'], auth: { token } });
    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', reject);
  });
}

const waitFor = (socket, event, predicate = () => true, ms = 120_000, label = event) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`timed out waiting for ${label}`));
    }, ms);
    function handler(payload) {
      if (!predicate(payload)) return;
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(payload);
    }
    socket.on(event, handler);
  });

const emit = (socket, event, payload) =>
  new Promise((resolve) =>
    payload === undefined ? socket.emit(event, resolve) : socket.emit(event, payload, resolve),
  );

async function main() {
  const health = await api('/healthz');
  if (!health.body.accounts) {
    console.error('Server reports accounts:false — set DATABASE_URL and restart it first.');
    process.exit(1);
  }
  check('server reports a reachable database', health.body.database === true);

  // ---------------------------------------------------------------- accounts
  const alice = await makeAccount('a');
  const bob = await makeAccount('b');
  check('registration returns a token and profile', Boolean(alice.token && alice.user));
  check('new accounts start at 1200', alice.user.rating === 1200, `got ${alice.user.rating}`);
  check('new accounts are provisional', alice.user.provisional === true);

  const dupe = await api('/api/auth/register', {
    method: 'POST',
    body: { email: 'other@example.test', username: alice.username, password: 'correct horse battery' },
  });
  check('duplicate usernames are rejected', dupe.status === 409);

  const badLogin = await api('/api/auth/login', {
    method: 'POST',
    body: { identifier: alice.username, password: 'wrong password' },
  });
  check('a wrong password is rejected', badLogin.status === 401);

  const goodLogin = await api('/api/auth/login', {
    method: 'POST',
    body: { identifier: alice.username, password: 'correct horse battery' },
  });
  check('login by username works', goodLogin.status === 200 && Boolean(goodLogin.body.token));

  const noAuth = await api('/api/me/matches');
  check('match history requires a token', noAuth.status === 401);

  // ------------------------------------------------------------- challenges
  const carol = await makeAccount('c');
  const dave = await makeAccount('d');
  const carolSocket = await connect(carol.token);
  const daveSocket = await connect(dave.token);

  const selfChallenge = await emit(carolSocket, 'challenge:send', { username: carol.username });
  check('you cannot challenge yourself', selfChallenge.ok === false, selfChallenge.error);

  const ghost = await emit(carolSocket, 'challenge:send', { username: 'nobody_at_all_xyz' });
  check('challenging an unknown user fails', ghost.ok === false, ghost.error);

  const incoming = waitFor(daveSocket, 'challengeIncoming');
  const sent = await emit(carolSocket, 'challenge:send', { username: dave.username });
  check('a challenge to an online player is accepted', sent.ok === true);
  const invite = await incoming;
  check('the target receives the challenge', invite.fromUsername === carol.username);

  const carolMatch = waitFor(carolSocket, 'ratedMatchFound');
  await emit(daveSocket, 'challenge:respond', { id: invite.id, accept: true });
  const challengeMatch = await carolMatch;
  check('accepting a challenge starts a rated match', challengeMatch.kind === 'challenge');
  check('the match names the opponent', challengeMatch.opponent.username === dave.username);

  carolSocket.close();
  daveSocket.close();

  // ------------------------------------------------------------ ranked match
  const aliceSocket = await connect(alice.token);
  const bobSocket = await connect(bob.token);

  const aliceFound = waitFor(aliceSocket, 'ratedMatchFound');
  const bobFound = waitFor(bobSocket, 'ratedMatchFound');
  const q1 = await emit(aliceSocket, 'queue:join');
  const q2 = await emit(bobSocket, 'queue:join');
  check('both players can queue', q1.ok === true && q2.ok === true);

  const [aliceMatch] = await Promise.all([aliceFound, bobFound]);
  check('the matchmaker paired them', aliceMatch.kind === 'ranked');
  check('rated matches use the fixed ruleset', true);

  const dupQueue = await emit(aliceSocket, 'queue:join');
  check('you cannot queue while already in a match', dupQueue.ok === false, dupQueue.error);

  // Alice calls "no solution" every hand: fast and deterministic. She will
  // usually lose, which is exactly what we want to observe in the rating.
  let handsSeen = 0;
  const onState = (state) => {
    if (state.phase === 'open') {
      handsSeen++;
      aliceSocket.emit('game:callNoSolution');
    }
  };
  aliceSocket.on('state', onState);

  const aliceResult = await waitFor(aliceSocket, 'ratedResult', () => true, 180_000, 'rated result');
  const bobResult = await waitFor(bobSocket, 'ratedResult', () => true, 10_000, 'opponent result');
  aliceSocket.off('state', onState);

  check('the match ran a full deck', handsSeen >= 13, `${handsSeen} hands`);
  check('both players received a rating result', Boolean(aliceResult && bobResult));
  check(
    'the results agree on who won',
    (aliceResult.result === 'win' && bobResult.result === 'loss') ||
      (aliceResult.result === 'loss' && bobResult.result === 'win') ||
      (aliceResult.result === 'draw' && bobResult.result === 'draw'),
    `${aliceResult.result}/${bobResult.result}`,
  );
  check('ratings actually moved', aliceResult.you.delta !== 0);
  check(
    'the rating exchange is zero-sum',
    aliceResult.you.delta + bobResult.you.delta === 0,
    `${aliceResult.you.delta} vs ${bobResult.you.delta}`,
  );
  check(
    'the winner gained and the loser lost',
    aliceResult.result === 'win' ? aliceResult.you.delta > 0 : aliceResult.you.delta < 0,
  );
  check(
    'after equals before plus delta',
    aliceResult.you.after === aliceResult.you.before + aliceResult.you.delta,
  );

  // ------------------------------------------------------------ persistence
  const history = await api('/api/me/matches', { token: alice.token });
  check('the match is in history', history.body.matches?.length === 1);
  check(
    'history agrees with the live result',
    history.body.matches?.[0]?.delta === aliceResult.you.delta,
  );

  const me = await api('/api/auth/me', { token: alice.token });
  check('the stored rating matches the result', me.body.user?.rating === aliceResult.you.after);
  check('the rated game counter incremented', me.body.user?.ratedGames === 1);

  const board = await api('/api/leaderboard');
  const listed = board.body.entries?.some((e) => e.username === alice.username);
  check('the player appears on the leaderboard', listed === true);

  aliceSocket.close();
  bobSocket.close();

  console.log(failures === 0 ? '\nrated smoke test passed' : `\nrated smoke test FAILED (${failures})`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('rated smoke test error:', err.message);
  process.exit(1);
});
