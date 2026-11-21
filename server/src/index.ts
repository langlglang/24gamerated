import './env.js';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import express from 'express';
import { Server } from 'socket.io';
import type {
  ActionRejection,
  ClientToServerEvents,
  PublicUserView,
  RatedRejection,
  RatedResultView,
  ServerToClientEvents,
} from '@24game/shared';
import { isValidRoomCode, normalizeRoomCode } from '@24game/shared';
import { CLIENT_DIST_RELATIVE, DEV_CLIENT_ORIGIN, IS_PRODUCTION, PORT } from './config.js';
import { RoomManager } from './rooms.js';
import type { RatedMatchOutcome, Room } from './room.js';
import { Matchmaker } from './matchmaking.js';
import { createAuthRouter } from './auth/routes.js';
import { createDailyRouter, warmDailyPuzzles } from './daily/routes.js';
import { tokenMatchesPassword, verifyToken } from './auth/tokens.js';
import { appUrl, isMailConfigured } from './auth/mailer.js';
import { pruneExpiredResets } from './db/resets.js';
import { isDatabaseConfigured, pingDatabase } from './db/pool.js';
import { runMigrations } from './db/migrate.js';
import { findById, findByUsername, toPublicUser, touchLastSeen } from './db/users.js';
import { MissingPlayerError, recordRatedMatch } from './db/matches.js';
import {
  CHALLENGE_EXPIRY_MINUTES,
  abandonClaim,
  attachRoom,
  claimChallenge,
  createChallenge,
  expireIfStale,
  expireOlderThan,
  getChallenge,
  isChallengeId,
  resolveChallenge,
  type ChallengeView,
} from './db/challenges.js';
import { isWellFormed } from './payloads.js';
import { SlidingWindowLimiter } from './throttle.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.resolve(here, CLIENT_DIST_RELATIVE);

const app = express();
// Render (and most hosts) sit behind one proxy; without this req.ip is the
// proxy's address and every per-IP throttle collapses into one bucket.
app.set('trust proxy', 1);
const httpServer = createServer(app);

const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: IS_PRODUCTION ? undefined : { origin: DEV_CLIENT_ORIGIN, methods: ['GET', 'POST'] },
});

// --------------------------------------------------------------- session state

interface SocketSession {
  roomCode?: string;
  /** Seat id inside a room. For rated rooms this equals userId. */
  playerId?: string;
  /** Set once the socket presents a valid token. */
  userId?: string;
  username?: string;
}

const sessions = new Map<string, SocketSession>();
/**
 * userId -> every signed-in socket of that user, oldest first. A player can
 * have several tabs open; closing one must not make them look offline.
 */
const online = new Map<string, string[]>();

function sessionOf(socketId: string): SocketSession {
  return sessions.get(socketId) ?? {};
}

/**
 * Handshake sign-ins still being checked, by the user id their token claims.
 * A user who just connected is not "online" until the check passes, so
 * anything that needs them online waits for these first.
 */
const pendingSignIns = new Map<string, Set<Promise<void>>>();

async function settledOnline(userId: string): Promise<boolean> {
  if (online.has(userId)) return true;
  const pending = pendingSignIns.get(userId);
  if (pending) await Promise.all([...pending]);
  return online.has(userId);
}

function addOnline(userId: string, socketId: string): void {
  const list = (online.get(userId) ?? []).filter((id) => id !== socketId);
  list.push(socketId);
  online.set(userId, list);
}

function removeOnline(userId: string, socketId: string): void {
  const list = (online.get(userId) ?? []).filter((id) => id !== socketId);
  if (list.length > 0) online.set(userId, list);
  else online.delete(userId);
}

/** The user's most recently signed-in socket, which gets their new games. */
function latestSocket(userId: string): string | undefined {
  const list = online.get(userId);
  return list?.[list.length - 1];
}

/** Send to every tab a user has open. (Never `io.to([])`: that is everyone.) */
function emitToUser(
  userId: string,
  event: 'challengeIncoming' | 'challengeUpdated',
  payload: ChallengeView,
): void {
  for (const socketId of online.get(userId) ?? []) {
    if (event === 'challengeIncoming') io.to(socketId).emit('challengeIncoming', payload);
    else io.to(socketId).emit('challengeUpdated', payload);
  }
}

/**
 * True while the user is seated in anything still being played: a rated room
 * (seat id = user id) or a guest room any of their signed-in sockets sits in
 * (guest seats use random ids, so they are found through the sessions).
 * Finished rated rooms are only a result screen and do not count.
 */
function userBusy(userId: string): boolean {
  if (manager.hasLiveSeat(userId)) return true;
  for (const session of sessions.values()) {
    if (session.userId !== userId || !session.roomCode || !session.playerId) continue;
    const room = manager.get(session.roomCode);
    if (room && !room.closed && !room.finished && room.hasSeat(session.playerId)) return true;
  }
  return false;
}

/**
 * Take this socket out of whatever room it is seated in, so one socket never
 * holds two seats. Mid-match the seat is held for the reconnect grace like any
 * disconnect; in a lobby or a finished guest match it is freed.
 */
function leaveCurrentRoom(socketId: string): void {
  const session = sessionOf(socketId);
  if (session.roomCode) {
    // Leave the broadcast group first: the leaver must not receive the state
    // update their own departure causes.
    void io.sockets.sockets.get(socketId)?.leave(session.roomCode);
    manager.get(session.roomCode)?.disconnect(socketId, { leaving: true });
  }
  sessions.set(socketId, { userId: session.userId, username: session.username });
}

// ------------------------------------------------------------------ room layer

const manager = new RoomManager({
  onChange: (room) => broadcast(room),
  onCombineRejected: (room, playerId, error) => {
    const socketId = socketIdFor(room, playerId);
    if (socketId) io.to(socketId).emit('combineRejected', { error });
  },
  onClosed: (room, reason) => {
    ratedResults.delete(room.code);
    io.to(room.code).emit('roomClosed', { reason });
    io.socketsLeave(room.code);
  },
  onRatedMatchComplete: (room, outcome) => {
    void persistRatedMatch(room, outcome);
  },
}, (socketId) => io.sockets.sockets.has(socketId));

/**
 * roomCode -> userId -> that player's recorded rating change. Kept while the
 * finished rated room exists, so a refresh on the result screen gets it again.
 */
const ratedResults = new Map<string, Map<string, RatedResultView>>();

function broadcast(room: Room): void {
  io.to(room.code).emit('state', room.publicState());
}

function socketIdFor(room: Room, playerId: string): string | null {
  return room.players.find((p) => p.id === playerId)?.socketId ?? null;
}

// ------------------------------------------------------------------ rated flow

/**
 * Record a finished rated match and tell both players what it did to their
 * ratings. A failure here must not take the room down — the game itself
 * already finished correctly — so problems are logged, not thrown.
 */
async function persistRatedMatch(room: Room, outcome: RatedMatchOutcome): Promise<void> {
  if (!isDatabaseConfigured()) return;
  try {
    // Ratings are read, locked and updated inside one transaction there, so
    // two matches finishing at once for the same player cannot lose an update.
    const recorded = await recordRatedMatch({
      kind: outcome.kind,
      playerAId: outcome.playerAId,
      playerBId: outcome.playerBId,
      scoreA: outcome.scoreA,
      scoreB: outcome.scoreB,
      wentToTiebreak: outcome.wentToTiebreak,
      forfeitedBy: outcome.forfeitedBy,
    });
    const rowA = { id: outcome.playerAId, username: recorded.usernameA };
    const rowB = { id: outcome.playerBId, username: recorded.usernameB };

    const send = (
      selfId: string,
      selfChange: { before: number; after: number; delta: number },
      other: { username: string; before: number; after: number; delta: number },
    ) => {
      const view: RatedResultView = {
        matchId: recorded.matchId,
        kind: outcome.kind,
        result: recorded.winnerId === null ? 'draw' : recorded.winnerId === selfId ? 'win' : 'loss',
        forfeit: outcome.forfeitedBy !== null,
        you: selfChange,
        opponent: other,
      };
      if (!room.closed) {
        const forRoom = ratedResults.get(room.code) ?? new Map<string, RatedResultView>();
        forRoom.set(selfId, view);
        ratedResults.set(room.code, forRoom);
      }
      const socketId = socketIdFor(room, selfId) ?? latestSocket(selfId);
      if (!socketId) return;
      io.to(socketId).emit('ratedResult', view);
    };

    send(rowA.id, recorded.outcome.a, { username: rowB.username, ...recorded.outcome.b });
    send(rowB.id, recorded.outcome.b, { username: rowA.username, ...recorded.outcome.a });

    await Promise.all([pushProfile(rowA.id), pushProfile(rowB.id)]);
  } catch (err) {
    if (err instanceof MissingPlayerError) console.error('[rated]', err.message);
    else console.error('[rated] failed to record match:', err);
  }
}

/**
 * Re-send a player's own record after anything that could have changed it.
 * Callers fire and forget, so a database error is logged here, never thrown.
 */
async function pushProfile(userId: string): Promise<void> {
  if (!online.has(userId) || !isDatabaseConfigured()) return;
  try {
    const row = await findById(userId);
    const profile = row ? (toPublicUser(row) as PublicUserView) : null;
    for (const socketId of online.get(userId) ?? []) io.to(socketId).emit('profile', profile);
  } catch (err) {
    console.error('[rated] failed to load profile:', err);
  }
}

/** Seat two signed-in players in a fresh rated room and start it immediately. */
function startRatedMatch(
  a: { userId: string; username: string; rating: number; socketId: string },
  b: { userId: string; username: string; rating: number; socketId: string },
  kind: 'ranked' | 'challenge',
): Room | null {
  const socketA = io.sockets.sockets.get(a.socketId);
  const socketB = io.sockets.sockets.get(b.socketId);
  if (!socketA || !socketB) return null;

  // Callers have checked neither player is in a live game. Whatever these
  // sockets still sit in (a finished rated room's result screen) is left
  // first, so each socket holds exactly one seat.
  leaveCurrentRoom(socketA.id);
  leaveCurrentRoom(socketB.id);

  let room: Room;
  try {
    room = manager.createRated(a, b, kind);
  } catch (err) {
    console.error('[rated] could not create the room:', err);
    return null;
  }

  for (const [socket, self, other] of [
    [socketA, a, b],
    [socketB, b, a],
  ] as const) {
    sessions.set(socket.id, {
      ...sessionOf(socket.id),
      roomCode: room.code,
      playerId: self.userId,
    });
    void socket.join(room.code);
    socket.emit('ratedMatchFound', {
      roomCode: room.code,
      playerId: self.userId,
      reconnectToken: room.reconnectTokenFor(self.userId) ?? '',
      kind,
      opponent: { username: other.username, rating: other.rating },
    });
  }

  const started = room.start(a.userId);
  if (!started.ok) {
    console.error('[rated] could not start match:', started.error);
    room.close('could not start the rated match');
    return null;
  }
  return room;
}

const matchmaker = new Matchmaker(
  (a, b) => {
    // Someone may have sat down in another game since queueing.
    const busy = new Set([a, b].filter((e) => userBusy(e.userId)).map((e) => e.userId));
    const room = busy.size === 0 ? startRatedMatch(a, b, 'ranked') : null;
    if (!room) {
      // Return whoever is still connected and free to the queue rather than
      // silently losing their place. A busy player is dropped from it.
      for (const entry of [a, b]) {
        if (busy.has(entry.userId)) {
          io.to(entry.socketId).emit('queueStatus', matchmaker.statusFor(entry.userId));
        } else if (io.sockets.sockets.get(entry.socketId)) {
          matchmaker.join(entry);
        }
      }
    }
  },
  (entry, status) => {
    io.to(entry.socketId).emit('queueStatus', status);
  },
);

// ------------------------------------------------------------------- socket io

type RatedGuard =
  | { ok: true; userId: string; username: string }
  | { ok: false; error: RatedRejection };

function ratedGuard(socketId: string): RatedGuard {
  if (!isDatabaseConfigured()) return { ok: false, error: 'accounts-unavailable' };
  const session = sessionOf(socketId);
  if (!session.userId || !session.username) return { ok: false, error: 'not-signed-in' };
  return { ok: true, userId: session.userId, username: session.username };
}

// Abuse limits. Failed joins are what room-code guessing looks like; a real
// player mistypes a code a few times, not dozens.
const failedJoinsPerSocket = new SlidingWindowLimiter(10, 60_000);
const failedJoinsPerIp = new SlidingWindowLimiter(60, 60_000);
const createsPerSocket = new SlidingWindowLimiter(10, 60_000);
const createsPerIp = new SlidingWindowLimiter(120, 60_000);
// Challenges push a notification to someone else, so those pushes are capped
// per sender. Every attempt (typos, offline targets) has a looser cap too.
const challengeBurst = new SlidingWindowLimiter(5, 30_000);
const challengeHourly = new SlidingWindowLimiter(20, 10 * 60_000);
const challengeAttempts = new SlidingWindowLimiter(30, 60_000);

/**
 * The client address. Behind the one proxy `trust proxy` assumes in
 * production, that is the last X-Forwarded-For hop; locally, the socket peer.
 */
function clientIp(socket: { handshake: { address: string; headers: Record<string, unknown> } }): string {
  const forwarded = socket.handshake.headers['x-forwarded-for'];
  if (IS_PRODUCTION && typeof forwarded === 'string' && forwarded.trim()) {
    const hops = forwarded.split(',').map((h) => h.trim()).filter(Boolean);
    const last = hops[hops.length - 1];
    if (last) return last;
  }
  return socket.handshake.address;
}

/** Display names are trimmed and capped; blank becomes Player. */
function sanitizeName(name: string): string {
  return name.trim().slice(0, 20) || 'Player';
}

io.on('connection', (socket) => {
  sessions.set(socket.id, {});
  const ip = clientIp(socket);

  // A token on the handshake signs the socket in without a round trip, but
  // only after the same checks `auth:identify` makes: the account must still
  // exist and the token must not predate a password change. Until that lookup
  // settles, this socket's events wait (see the middleware below), so nothing
  // runs against a half-known identity.
  let identitySettled: Promise<void> = Promise.resolve();
  const handshakeToken = socket.handshake.auth?.['token'];
  if (typeof handshakeToken === 'string' && isDatabaseConfigured()) {
    const claims = verifyToken(handshakeToken);
    if (claims) {
      const check = (async () => {
        try {
          const row = await findById(claims.userId);
          if (!socket.connected) return;
          if (!row || !tokenMatchesPassword(claims, row.password_hash)) return;
          sessions.set(socket.id, { ...sessionOf(socket.id), userId: row.id, username: row.username });
          addOnline(row.id, socket.id);
          void pushProfile(row.id);
        } catch (err) {
          console.error('[auth] handshake sign-in failed:', err);
        }
      })();
      const set = pendingSignIns.get(claims.userId) ?? new Set<Promise<void>>();
      set.add(check);
      pendingSignIns.set(claims.userId, set);
      void check.finally(() => {
        set.delete(check);
        if (set.size === 0 && pendingSignIns.get(claims.userId) === set) pendingSignIns.delete(claims.userId);
      });
      identitySettled = check;
    }
  }

  // Drop malformed packets before any handler sees them. Not calling next()
  // discards the packet quietly; passing an error would surface as an
  // unhandled 'error' event on the socket. Well-formed packets wait for the
  // handshake identity; they all wait on one promise, so order is kept.
  socket.use(([event, ...args], next) => {
    if (!isWellFormed(event, args)) return;
    void identitySettled.then(() => next());
  });

  function context():
    | { ok: true; room: Room; playerId: string }
    | { ok: false; error: ActionRejection } {
    const { roomCode, playerId } = sessionOf(socket.id);
    if (!roomCode || !playerId) return { ok: false, error: 'not-in-room' };
    const room = manager.get(roomCode);
    if (!room) return { ok: false, error: 'room-not-found' };
    return { ok: true, room, playerId };
  }

  function run(
    action: string,
    fn: (room: Room, playerId: string) => { ok: boolean; error?: ActionRejection },
  ): void {
    const ctx = context();
    if (!ctx.ok) {
      socket.emit('rejected', { action, reason: ctx.error });
      return;
    }
    const result = fn(ctx.room, ctx.playerId);
    if (!result.ok && result.error) {
      socket.emit('rejected', { action, reason: result.error });
    }
  }

  /** Bind this socket to a seat it has just been granted. */
  function seat(room: Room, playerId: string): void {
    sessions.set(socket.id, { ...sessionOf(socket.id), roomCode: room.code, playerId });
    void socket.join(room.code);
  }

  // ---- guest rooms ----

  socket.on('room:create', ({ name, mode, rules }, ack) => {
    // 'wrong-phase' reads "not available right now" on the client; a
    // dedicated code would need a client release first.
    if (!createsPerSocket.hit(socket.id) || !createsPerIp.hit(ip)) {
      ack({ ok: false, error: 'wrong-phase' });
      return;
    }
    leaveCurrentRoom(socket.id);
    let created: { room: Room; playerId: string };
    try {
      created = manager.create(sanitizeName(name), socket.id, mode, rules);
    } catch (err) {
      console.error('[rooms] could not create a room:', err);
      ack({ ok: false, error: 'wrong-phase' });
      return;
    }
    const { room, playerId } = created;
    seat(room, playerId);
    ack({
      ok: true,
      roomCode: room.code,
      playerId,
      reconnectToken: room.reconnectTokenFor(playerId) ?? '',
    });
    broadcast(room);
  });

  socket.on('room:join', ({ name, roomCode, playerId, reconnectToken }, ack) => {
    if (failedJoinsPerSocket.blocked(socket.id) || failedJoinsPerIp.blocked(ip)) {
      ack({ ok: false, error: 'wrong-phase' });
      return;
    }
    const refuse = (error: ActionRejection) => {
      failedJoinsPerSocket.hit(socket.id);
      failedJoinsPerIp.hit(ip);
      ack({ ok: false, error });
    };

    const code = normalizeRoomCode(roomCode);
    const room = isValidRoomCode(code) ? manager.get(code) : undefined;
    if (!room) {
      refuse('room-not-found');
      return;
    }
    const session = sessionOf(socket.id);

    if (playerId !== undefined && room.hasSeat(playerId)) {
      // Reclaiming a seat. Player ids are public (every state broadcast
      // carries them), so the id alone proves nothing: guest seats need the
      // reconnect token issued with the seat, and rated seats (id = user id)
      // need a socket signed in as that user.
      const authorized = room.rated
        ? session.userId === playerId
        : room.checkReconnectToken(playerId, reconnectToken);
      if (!authorized) {
        refuse('not-in-room');
        return;
      }
      if (session.roomCode !== room.code || session.playerId !== playerId) {
        leaveCurrentRoom(socket.id);
      }
      const result = room.reconnect(playerId, socket.id);
      if (!result.ok) {
        refuse(result.error);
        return;
      }
      if (result.replacedSocketId) {
        // The newest connection holding the seat's credentials wins (the
        // same player's refresh or new tab). The old socket is detached and
        // told, so it can never act for the seat again.
        const old = io.sockets.sockets.get(result.replacedSocketId);
        const oldSession = sessions.get(result.replacedSocketId);
        if (oldSession && oldSession.roomCode === room.code) {
          sessions.set(result.replacedSocketId, {
            userId: oldSession.userId,
            username: oldSession.username,
          });
        }
        if (old) {
          void old.leave(room.code);
          old.emit('seatReplaced', { roomCode: room.code });
        }
      }
      seat(room, playerId);
      ack({ ok: true, roomCode: room.code, playerId, reconnectToken: result.reconnectToken });
      broadcast(room);
      // A refresh on a finished rated match: the result was already sent to
      // the old socket, so send it again (once it has been recorded).
      const recorded = room.finished ? ratedResults.get(room.code)?.get(playerId) : undefined;
      if (recorded) socket.emit('ratedResult', recorded);
      return;
    }

    // A new seat. Rated rooms are never joined this way, and any id the
    // client suggested is ignored: the server picks seat ids.
    if (room.rated) {
      refuse('not-in-room');
      return;
    }
    const trimmed = sanitizeName(name);
    if (session.roomCode !== room.code) {
      // Check before leaving, so a refused join does not cost the old seat.
      const blocked = room.canJoin(trimmed);
      if (blocked) {
        refuse(blocked);
        return;
      }
    }
    leaveCurrentRoom(socket.id);
    if (room.closed) {
      refuse('room-not-found');
      return;
    }
    const id = manager.newPlayerId();
    const result = room.join({ id, name: trimmed, socketId: socket.id });
    if (!result.ok) {
      refuse(result.error);
      return;
    }
    seat(room, id);
    ack({ ok: true, roomCode: room.code, playerId: id, reconnectToken: result.reconnectToken });
    broadcast(room);
  });

  socket.on('room:configure', ({ mode, rules }) => {
    run('room:configure', (room, playerId) => room.configure(playerId, mode, rules));
  });
  socket.on('room:setTeam', ({ playerId, team }) => {
    run('room:setTeam', (room, actorId) => room.setTeam(actorId, playerId, team));
  });
  socket.on('room:start', () => {
    run('room:start', (room, playerId) => room.start(playerId));
  });
  socket.on('game:buzz', () => {
    run('game:buzz', (room, playerId) => room.buzz(playerId));
  });
  socket.on('game:callNoSolution', () => {
    run('game:callNoSolution', (room, playerId) => room.callNoSolution(playerId));
  });
  socket.on('game:combine', ({ step }) => {
    run('game:combine', (room, playerId) => room.combine(playerId, step));
  });
  socket.on('game:playAgain', () => {
    run('game:playAgain', (room, playerId) => room.playAgain(playerId));
  });

  socket.on('room:leave', () => {
    // Leaving a room must not sign the player out.
    leaveCurrentRoom(socket.id);
  });

  // ---- accounts ----

  socket.on('auth:identify', ({ token }, ack) => {
    if (!isDatabaseConfigured()) {
      ack({ ok: false, error: 'accounts-unavailable' });
      return;
    }
    const claims = verifyToken(token);
    if (!claims) {
      ack({ ok: false, error: 'not-signed-in' });
      return;
    }
    void (async () => {
      try {
        const row = await findById(claims.userId);
        if (!row || !tokenMatchesPassword(claims, row.password_hash)) {
          ack({ ok: false, error: 'not-signed-in' });
          return;
        }
        const previous = sessionOf(socket.id).userId;
        if (previous && previous !== row.id) {
          matchmaker.leaveIfOwner(previous, socket.id);
          removeOnline(previous, socket.id);
        }
        sessions.set(socket.id, { ...sessionOf(socket.id), userId: row.id, username: row.username });
        addOnline(row.id, socket.id);
        await touchLastSeen(row.id);
        ack({ ok: true, user: toPublicUser(row) as PublicUserView });
      } catch (err) {
        console.error('[auth] identify failed:', err);
        ack({ ok: false, error: 'accounts-unavailable' });
      }
    })();
  });

  socket.on('auth:signOut', () => {
    // Signing out mid rated match leaves it (a forfeit loss): the seat is
    // the account's, and this socket no longer speaks for that account.
    {
      const current = sessionOf(socket.id);
      const room = current.roomCode ? manager.get(current.roomCode) : undefined;
      if (room?.rated && !room.finished) leaveCurrentRoom(socket.id);
    }
    const { userId, roomCode, playerId } = sessionOf(socket.id);
    if (userId) {
      // Only this tab's search ends; another tab's stays queued.
      matchmaker.leaveIfOwner(userId, socket.id);
      removeOnline(userId, socket.id);
    }
    sessions.set(socket.id, { roomCode, playerId });
  });

  // ---- ranked queue ----

  socket.on('queue:join', (ack) => {
    const guard = ratedGuard(socket.id);
    if (!guard.ok) {
      ack({ ok: false, error: guard.error });
      return;
    }
    if (matchmaker.has(guard.userId)) {
      ack({ ok: false, error: 'already-queued' });
      return;
    }
    // Any game still being played counts, guest rooms included, in any tab.
    if (userBusy(guard.userId)) {
      ack({ ok: false, error: 'already-in-room' });
      return;
    }
    void (async () => {
      try {
        const row = await findById(guard.userId);
        if (!row) {
          ack({ ok: false, error: 'not-signed-in' });
          return;
        }
        if (!socket.connected) return;
        if (userBusy(guard.userId)) {
          ack({ ok: false, error: 'already-in-room' });
          return;
        }
        if (matchmaker.has(guard.userId)) {
          ack({ ok: false, error: 'already-queued' });
          return;
        }
        matchmaker.join({
          userId: guard.userId,
          username: guard.username,
          rating: row.rating,
          socketId: socket.id,
        });
        ack({ ok: true });
        socket.emit('queueStatus', matchmaker.statusFor(guard.userId));
      } catch (err) {
        console.error('[queue] join failed:', err);
        ack({ ok: false, error: 'accounts-unavailable' });
      }
    })();
  });

  socket.on('queue:leave', () => {
    const { userId } = sessionOf(socket.id);
    if (!userId) return;
    // An explicit "stop searching" from any of the user's tabs.
    matchmaker.leave(userId);
    socket.emit('queueStatus', matchmaker.statusFor(userId));
  });

  // ---- friend challenges ----

  socket.on('challenge:send', ({ username }, ack) => {
    const guard = ratedGuard(socket.id);
    if (!guard.ok) {
      ack({ ok: false, error: guard.error });
      return;
    }
    if (!challengeAttempts.hit(guard.userId)) {
      ack({ ok: false, error: 'rate-limited' });
      return;
    }
    if (userBusy(guard.userId)) {
      ack({ ok: false, error: 'already-in-room' });
      return;
    }
    void (async () => {
      try {
        const target = await findByUsername(username.trim());
        if (!target) {
          ack({ ok: false, error: 'user-not-found' });
          return;
        }
        if (target.id === guard.userId) {
          ack({ ok: false, error: 'cannot-challenge-self' });
          return;
        }
        if (!(await settledOnline(target.id))) {
          ack({ ok: false, error: 'opponent-offline' });
          return;
        }
        if (userBusy(target.id)) {
          ack({ ok: false, error: 'opponent-busy' });
          return;
        }
        // New challenges are capped; re-sending one that is still pending
        // just re-notifies (and only counts as an attempt).
        if (challengeBurst.blocked(guard.userId) || challengeHourly.blocked(guard.userId)) {
          ack({ ok: false, error: 'rate-limited' });
          return;
        }
        const { challenge, created } = await createChallenge(guard.userId, target.id);
        if (created) {
          challengeBurst.hit(guard.userId);
          challengeHourly.hit(guard.userId);
        }
        emitToUser(target.id, 'challengeIncoming', challenge);
        ack({ ok: true, challenge });
      } catch (err) {
        console.error('[challenge] send failed:', err);
        ack({ ok: false, error: 'accounts-unavailable' });
      }
    })();
  });

  socket.on('challenge:respond', ({ id, accept }, ack) => {
    const guard = ratedGuard(socket.id);
    if (!guard.ok) {
      ack({ ok: false, error: guard.error });
      return;
    }
    if (!isChallengeId(id)) {
      ack({ ok: false, error: 'challenge-not-found' });
      return;
    }
    void (async () => {
      try {
        // The sweeper only runs every few minutes; expiry is enforced here too.
        const stale = await expireIfStale(id);
        if (stale) {
          emitToUser(stale.fromUserId, 'challengeUpdated', stale);
          ack({ ok: false, error: 'challenge-not-found' });
          return;
        }
        const challenge = await getChallenge(id);
        if (!challenge || challenge.status !== 'pending' || challenge.toUserId !== guard.userId) {
          ack({ ok: false, error: 'challenge-not-found' });
          return;
        }

        if (!accept) {
          const declined = await resolveChallenge(id, 'declined');
          if (!declined) {
            ack({ ok: false, error: 'challenge-not-found' });
            return;
          }
          emitToUser(challenge.fromUserId, 'challengeUpdated', declined);
          ack({ ok: true });
          return;
        }

        // Busy players leave the challenge pending: it can still be taken up
        // once their current game is over.
        if (userBusy(guard.userId)) {
          ack({ ok: false, error: 'already-in-room' });
          return;
        }
        if (userBusy(challenge.fromUserId)) {
          ack({ ok: false, error: 'opponent-busy' });
          return;
        }
        if (!(await settledOnline(challenge.fromUserId))) {
          const expired = await resolveChallenge(id, 'expired');
          if (expired) emitToUser(challenge.fromUserId, 'challengeUpdated', expired);
          ack({ ok: false, error: 'opponent-offline' });
          return;
        }

        const [challenger, target] = await Promise.all([
          findById(challenge.fromUserId),
          findById(challenge.toUserId),
        ]);
        if (!challenger || !target) {
          ack({ ok: false, error: 'challenge-not-found' });
          return;
        }

        // Claim first, start second. Only one of several racing accepts (a
        // double tap, two tabs) gets the row, so at most one match starts.
        const claimed = await claimChallenge(id, guard.userId);
        if (!claimed) {
          ack({ ok: false, error: 'challenge-not-found' });
          return;
        }

        // Things may have moved during the awaits above. From here to the
        // room existing there is no await, so these checks hold for the start.
        const challengerSocket = latestSocket(challenger.id);
        let problem: RatedRejection | null = null;
        if (!socket.connected) problem = 'opponent-offline';
        else if (userBusy(target.id)) problem = 'already-in-room';
        else if (userBusy(challenger.id)) problem = 'opponent-busy';
        else if (!challengerSocket) problem = 'opponent-offline';

        const room =
          problem === null && challengerSocket
            ? startRatedMatch(
                {
                  userId: challenger.id,
                  username: challenger.username,
                  rating: challenger.rating,
                  socketId: challengerSocket,
                },
                { userId: target.id, username: target.username, rating: target.rating, socketId: socket.id },
                'challenge',
              )
            : null;
        if (!room) {
          const closed = await abandonClaim(id, problem === 'opponent-offline' || !problem ? 'expired' : 'cancelled');
          if (closed) emitToUser(challenger.id, 'challengeUpdated', closed);
          ack({ ok: false, error: problem ?? 'opponent-offline' });
          return;
        }

        // Neither player should still be hunting for a different game.
        matchmaker.leave(challenger.id);
        matchmaker.leave(target.id);
        ack({ ok: true });

        const accepted = await attachRoom(id, room.code);
        if (accepted) emitToUser(challenger.id, 'challengeUpdated', accepted);
      } catch (err) {
        console.error('[challenge] respond failed:', err);
        ack({ ok: false, error: 'accounts-unavailable' });
      }
    })();
  });

  socket.on('challenge:cancel', ({ id }) => {
    const guard = ratedGuard(socket.id);
    if (!guard.ok || !isChallengeId(id)) return;
    void (async () => {
      try {
        const challenge = await getChallenge(id);
        if (!challenge || challenge.fromUserId !== guard.userId) return;
        const cancelled = await resolveChallenge(id, 'cancelled');
        if (cancelled) emitToUser(challenge.toUserId, 'challengeUpdated', cancelled);
      } catch (err) {
        console.error('[challenge] cancel failed:', err);
      }
    })();
  });

  socket.on('disconnect', () => {
    const { userId } = sessionOf(socket.id);
    if (userId) {
      // Closing one tab must not end a search another tab started.
      matchmaker.leaveIfOwner(userId, socket.id);
      removeOnline(userId, socket.id);
    }
    const ctx = context();
    if (ctx.ok) ctx.room.disconnect(socket.id);
    sessions.delete(socket.id);
  });
});

// ----------------------------------------------------------------- http layer

app.disable('x-powered-by');

// Basic hardening on every response. No Content-Security-Policy yet: the
// client loads Google Fonts and a Vite build, and a wrong policy would blank
// the page; frame-ancestors is covered by X-Frame-Options instead.
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  if (IS_PRODUCTION) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});

app.use('/api', createAuthRouter());
app.use('/api', createDailyRouter());
// Unknown API routes and wrong methods answer in JSON like the rest of the API.
app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.get('/healthz', (_req, res) => {
  void (async () => {
    res.json({
      ok: true,
      rooms: manager.size,
      queue: matchmaker.size,
      accounts: isDatabaseConfigured(),
      database: await pingDatabase(),
    });
  })();
});

// Vite fingerprints everything under /assets, so those files never change and
// can be cached for good. A missing asset is a 404, never index.html (which
// would be served as JavaScript and fail confusingly).
app.use(
  '/assets',
  express.static(path.join(clientDist, 'assets'), { immutable: true, maxAge: '1y', index: false }),
  (_req, res) => {
    res.status(404).type('text/plain').send('Not found');
  },
);
app.use(express.static(clientDist, { index: false }));

function sendIndex(res: express.Response): void {
  // Always revalidate the page itself, so a deploy is picked up at once.
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(clientDist, 'index.html'), (err) => {
    if (err && !res.headersSent) {
      res.status(404).type('text/plain').send('Client build not found. Run `npm run build` first.');
    }
  });
}

// Client-side routes. Anchored so /apiary or /healthzz are pages, not API paths.
app.get(/^(?!\/(api|healthz|socket\.io)(\/|$)).*/, (_req, res) => sendIndex(res));

app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Body-parser failures (malformed JSON, oversized body, bad charset) and
// anything a route passes to next(err): a JSON error with the right status,
// never Express's HTML page or a stack trace.
app.use((err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (res.headersSent) {
    next(err);
    return;
  }
  const e = (err ?? {}) as { status?: unknown; statusCode?: unknown; type?: unknown };
  const raw = typeof e.status === 'number' ? e.status : typeof e.statusCode === 'number' ? e.statusCode : 500;
  const status = raw >= 400 && raw < 600 ? raw : 500;
  let error: string;
  if (e.type === 'entity.parse.failed') error = 'Malformed JSON';
  else if (status === 413) error = 'Request body too large';
  else if (status === 415) error = 'Unsupported content encoding';
  else if (status < 500) error = 'Bad request';
  else error = 'Server error';
  if (status >= 500) console.error('[http] request failed:', err);
  res.status(status).json({ error });
});

// Challenges nobody answered should not pile up in an inbox forever.
if (isDatabaseConfigured()) {
  const sweeper = setInterval(
    () => {
      void expireOlderThan(CHALLENGE_EXPIRY_MINUTES).catch((err) => console.error('[challenges] sweep failed:', err));
      void pruneExpiredResets().catch((err) => console.error('[auth] reset sweep failed:', err));
    },
    5 * 60_000,
  );
  sweeper.unref?.();
}

// Express 4 doesn't catch errors thrown inside async route handlers, and Node
// exits on an unhandled rejection by default. One bad request must never take
// the whole game down for everyone, so log it and keep serving.
process.on('unhandledRejection', (err) => {
  console.error('[server] unhandled rejection (kept running):', err);
});
// Same idea for synchronous throws inside socket/HTTP callbacks. A crashed
// process drops every live game, which is worse than one failed request.
process.on('uncaughtException', (err) => {
  console.error('[server] uncaught exception (kept running):', err);
});

async function boot(): Promise<void> {
  if (isDatabaseConfigured()) {
    try {
      const report = await runMigrations();
      if (report.applied.length > 0) {
        console.log(`[db] applied ${report.applied.length} migration(s)`);
      }
      console.log('[db] connected — rated play enabled');
      if (IS_PRODUCTION && (!isMailConfigured() || !appUrl())) {
        console.warn(
          '[mail] RESEND_API_KEY, MAIL_FROM and APP_URL must all be set — password reset emails are OFF',
        );
      }
    } catch (err) {
      console.error('[db] migration failed, rated play will not work:', err);
    }
  } else {
    console.warn('[db] DATABASE_URL not set — guest play only, rated features disabled');
  }

  warmDailyPuzzles();
  httpServer.listen(PORT, () => {
    console.log(`24gamerated server listening on http://localhost:${PORT}`);
  });
}

void boot();
