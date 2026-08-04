import 'dotenv/config';
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
  ServerToClientEvents,
} from '@24game/shared';
import { isValidRoomCode, normalizeRoomCode } from '@24game/shared';
import { CLIENT_DIST_RELATIVE, DEV_CLIENT_ORIGIN, IS_PRODUCTION, PORT } from './config.js';
import { RoomManager } from './rooms.js';
import type { RatedMatchOutcome, Room } from './room.js';
import { Matchmaker } from './matchmaking.js';
import { createAuthRouter } from './auth/routes.js';
import { verifyToken } from './auth/tokens.js';
import { isDatabaseConfigured, pingDatabase } from './db/pool.js';
import { runMigrations } from './db/migrate.js';
import { findById, findByUsername, toPublicUser, touchLastSeen } from './db/users.js';
import { recordRatedMatch } from './db/matches.js';
import { createChallenge, expireOlderThan, getChallenge, resolveChallenge } from './db/challenges.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.resolve(here, CLIENT_DIST_RELATIVE);

const app = express();
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
/** userId -> socket.id, so challenges reach whoever is currently online. */
const online = new Map<string, string>();

function sessionOf(socketId: string): SocketSession {
  return sessions.get(socketId) ?? {};
}

// ------------------------------------------------------------------ room layer

const manager = new RoomManager({
  onChange: (room) => broadcast(room),
  onCombineRejected: (room, playerId, error) => {
    const socketId = socketIdFor(room, playerId);
    if (socketId) io.to(socketId).emit('combineRejected', { error });
  },
  onClosed: (room, reason) => {
    io.to(room.code).emit('roomClosed', { reason });
    io.socketsLeave(room.code);
  },
  onRatedMatchComplete: (room, outcome) => {
    void persistRatedMatch(room, outcome);
  },
});

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
    const [rowA, rowB] = await Promise.all([
      findById(outcome.playerAId),
      findById(outcome.playerBId),
    ]);
    if (!rowA || !rowB) {
      console.error('[rated] a player vanished before the match could be recorded');
      return;
    }

    const recorded = await recordRatedMatch({
      kind: outcome.kind,
      playerA: rowA,
      playerB: rowB,
      scoreA: outcome.scoreA,
      scoreB: outcome.scoreB,
      wentToTiebreak: outcome.wentToTiebreak,
    });

    const send = (
      selfId: string,
      selfChange: { before: number; after: number; delta: number },
      other: { username: string; before: number; after: number; delta: number },
    ) => {
      const socketId = socketIdFor(room, selfId) ?? online.get(selfId);
      if (!socketId) return;
      io.to(socketId).emit('ratedResult', {
        matchId: recorded.matchId,
        kind: outcome.kind,
        result: recorded.winnerId === null ? 'draw' : recorded.winnerId === selfId ? 'win' : 'loss',
        you: selfChange,
        opponent: other,
      });
    };

    send(rowA.id, recorded.outcome.a, { username: rowB.username, ...recorded.outcome.b });
    send(rowB.id, recorded.outcome.b, { username: rowA.username, ...recorded.outcome.a });

    await Promise.all([pushProfile(rowA.id), pushProfile(rowB.id)]);
  } catch (err) {
    console.error('[rated] failed to record match:', err);
  }
}

/** Re-send a player's own record after anything that could have changed it. */
async function pushProfile(userId: string): Promise<void> {
  const socketId = online.get(userId);
  if (!socketId || !isDatabaseConfigured()) return;
  const row = await findById(userId);
  io.to(socketId).emit('profile', row ? (toPublicUser(row) as PublicUserView) : null);
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

  const room = manager.createRated(a, b, kind);

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
    const room = startRatedMatch(a, b, 'ranked');
    if (!room) {
      // Someone dropped between pairing and seating. Return whoever is still
      // connected to the queue rather than silently losing their place.
      for (const entry of [a, b]) {
        if (io.sockets.sockets.get(entry.socketId)) matchmaker.join(entry);
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

io.on('connection', (socket) => {
  sessions.set(socket.id, {});

  // A token on the handshake signs the socket in without a round trip.
  const handshakeToken = socket.handshake.auth?.['token'];
  if (typeof handshakeToken === 'string') {
    const claims = verifyToken(handshakeToken);
    if (claims) {
      sessions.set(socket.id, { userId: claims.userId, username: claims.username });
      online.set(claims.userId, socket.id);
      matchmaker.updateSocket(claims.userId, socket.id);
      void pushProfile(claims.userId);
    }
  }

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

  // ---- guest rooms: unchanged from the unrated game ----

  socket.on('room:create', ({ name, mode, rules }, ack) => {
    const trimmed = name.trim().slice(0, 20) || 'Player';
    const { room, playerId } = manager.create(trimmed, socket.id, mode, rules);
    sessions.set(socket.id, { ...sessionOf(socket.id), roomCode: room.code, playerId });
    void socket.join(room.code);
    ack({ ok: true, roomCode: room.code, playerId });
    broadcast(room);
  });

  socket.on('room:join', ({ name, roomCode, playerId }, ack) => {
    const code = normalizeRoomCode(roomCode);
    if (!isValidRoomCode(code)) {
      ack({ ok: false, error: 'room-not-found' });
      return;
    }
    const room = manager.get(code);
    if (!room) {
      ack({ ok: false, error: 'room-not-found' });
      return;
    }
    const trimmed = name.trim().slice(0, 20) || 'Player';
    const id = playerId ?? manager.newPlayerId();
    const result = room.join({ id, name: trimmed, socketId: socket.id });
    if (!result.ok) {
      ack({ ok: false, error: result.error });
      return;
    }
    sessions.set(socket.id, { ...sessionOf(socket.id), roomCode: room.code, playerId: id });
    void socket.join(room.code);
    ack({ ok: true, roomCode: room.code, playerId: id });
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
    const ctx = context();
    if (ctx.ok) {
      ctx.room.disconnect(socket.id);
      void socket.leave(ctx.room.code);
    }
    // Leaving a room must not sign the player out.
    const { userId, username } = sessionOf(socket.id);
    sessions.set(socket.id, { userId, username });
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
      const row = await findById(claims.userId);
      if (!row) {
        ack({ ok: false, error: 'not-signed-in' });
        return;
      }
      sessions.set(socket.id, { ...sessionOf(socket.id), userId: row.id, username: row.username });
      online.set(row.id, socket.id);
      matchmaker.updateSocket(row.id, socket.id);
      await touchLastSeen(row.id);
      ack({ ok: true, user: toPublicUser(row) as PublicUserView });
    })();
  });

  socket.on('auth:signOut', () => {
    const { userId, roomCode, playerId } = sessionOf(socket.id);
    if (userId) {
      matchmaker.leave(userId);
      if (online.get(userId) === socket.id) online.delete(userId);
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
    const existing = manager.findByPlayer(guard.userId);
    if (existing && existing.phase !== 'match-result' && existing.phase !== 'lobby') {
      ack({ ok: false, error: 'already-in-room' });
      return;
    }
    void (async () => {
      const row = await findById(guard.userId);
      if (!row) {
        ack({ ok: false, error: 'not-signed-in' });
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
    })();
  });

  socket.on('queue:leave', () => {
    const { userId } = sessionOf(socket.id);
    if (!userId) return;
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
        const targetSocket = online.get(target.id);
        if (!targetSocket) {
          ack({ ok: false, error: 'opponent-offline' });
          return;
        }
        const challenge = await createChallenge(guard.userId, target.id);
        io.to(targetSocket).emit('challengeIncoming', challenge);
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
    void (async () => {
      try {
        const challenge = await getChallenge(id);
        if (!challenge || challenge.status !== 'pending' || challenge.toUserId !== guard.userId) {
          ack({ ok: false, error: 'challenge-not-found' });
          return;
        }

        if (!accept) {
          const declined = await resolveChallenge(id, 'declined');
          const fromSocket = online.get(challenge.fromUserId);
          if (fromSocket && declined) io.to(fromSocket).emit('challengeUpdated', declined);
          ack({ ok: true });
          return;
        }

        const challengerSocket = online.get(challenge.fromUserId);
        if (!challengerSocket) {
          await resolveChallenge(id, 'expired');
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

        const room = startRatedMatch(
          {
            userId: challenger.id,
            username: challenger.username,
            rating: challenger.rating,
            socketId: challengerSocket,
          },
          { userId: target.id, username: target.username, rating: target.rating, socketId: socket.id },
          'challenge',
        );
        if (!room) {
          ack({ ok: false, error: 'opponent-offline' });
          return;
        }

        // Neither player should still be hunting for a different game.
        matchmaker.leave(challenger.id);
        matchmaker.leave(target.id);

        const accepted = await resolveChallenge(id, 'accepted', room.code);
        if (accepted) io.to(challengerSocket).emit('challengeUpdated', accepted);
        ack({ ok: true });
      } catch (err) {
        console.error('[challenge] respond failed:', err);
        ack({ ok: false, error: 'accounts-unavailable' });
      }
    })();
  });

  socket.on('challenge:cancel', ({ id }) => {
    const guard = ratedGuard(socket.id);
    if (!guard.ok) return;
    void (async () => {
      const challenge = await getChallenge(id);
      if (!challenge || challenge.fromUserId !== guard.userId) return;
      const cancelled = await resolveChallenge(id, 'cancelled');
      const toSocket = online.get(challenge.toUserId);
      if (toSocket && cancelled) io.to(toSocket).emit('challengeUpdated', cancelled);
    })();
  });

  socket.on('disconnect', () => {
    const { userId } = sessionOf(socket.id);
    if (userId) {
      matchmaker.leave(userId);
      if (online.get(userId) === socket.id) online.delete(userId);
    }
    const ctx = context();
    if (ctx.ok) ctx.room.disconnect(socket.id);
    sessions.delete(socket.id);
  });
});

// ----------------------------------------------------------------- http layer

app.use('/api', createAuthRouter());

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

app.use(express.static(clientDist));
app.get(/^(?!\/(api|healthz|socket\.io)).*/, (_req, res) => {
  res.sendFile(path.join(clientDist, 'index.html'), (err) => {
    if (err) res.status(404).send('Client build not found. Run `npm run build` first.');
  });
});

// Challenges nobody answered should not pile up in an inbox forever.
if (isDatabaseConfigured()) {
  const sweeper = setInterval(
    () => {
      void expireOlderThan(10).catch((err) => console.error('[challenges] sweep failed:', err));
    },
    5 * 60_000,
  );
  sweeper.unref?.();
}

async function boot(): Promise<void> {
  if (isDatabaseConfigured()) {
    try {
      const report = await runMigrations();
      if (report.applied.length > 0) {
        console.log(`[db] applied ${report.applied.length} migration(s)`);
      }
      console.log('[db] connected — rated play enabled');
    } catch (err) {
      console.error('[db] migration failed, rated play will not work:', err);
    }
  } else {
    console.warn('[db] DATABASE_URL not set — guest play only, rated features disabled');
  }

  httpServer.listen(PORT, () => {
    console.log(`24gamerated server listening on http://localhost:${PORT}`);
  });
}

void boot();
