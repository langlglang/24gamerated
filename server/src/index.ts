import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import express from 'express';
import { Server } from 'socket.io';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  ActionRejection,
} from '@24game/shared';
import { isValidRoomCode, normalizeRoomCode } from '@24game/shared';
import { CLIENT_DIST_RELATIVE, DEV_CLIENT_ORIGIN, IS_PRODUCTION, PORT } from './config.js';
import { RoomManager } from './rooms.js';
import type { Room } from './room.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.resolve(here, CLIENT_DIST_RELATIVE);

const app = express();
const httpServer = createServer(app);

const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: IS_PRODUCTION ? undefined : { origin: DEV_CLIENT_ORIGIN, methods: ['GET', 'POST'] },
});

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
});

function broadcast(room: Room): void {
  io.to(room.code).emit('state', room.publicState());
}

function socketIdFor(room: Room, playerId: string): string | null {
  return room.players.find((p) => p.id === playerId)?.socketId ?? null;
}

interface SocketSession {
  roomCode?: string;
  playerId?: string;
}

const sessions = new Map<string, SocketSession>();

io.on('connection', (socket) => {
  sessions.set(socket.id, {});

  const session = () => sessions.get(socket.id) ?? {};

  /** Resolve the room+player this socket is acting as, or a rejection. */
  function context():
    | { ok: true; room: Room; playerId: string }
    | { ok: false; error: ActionRejection } {
    const { roomCode, playerId } = session();
    if (!roomCode || !playerId) return { ok: false, error: 'not-in-room' };
    const room = manager.get(roomCode);
    if (!room) return { ok: false, error: 'room-not-found' };
    return { ok: true, room, playerId };
  }

  function run(action: string, fn: (room: Room, playerId: string) => { ok: boolean; error?: ActionRejection }): void {
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

  socket.on('room:create', ({ name, mode, rules }, ack) => {
    const trimmed = name.trim().slice(0, 20) || 'Player';
    const { room, playerId } = manager.create(trimmed, socket.id, mode, rules);
    sessions.set(socket.id, { roomCode: room.code, playerId });
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
    sessions.set(socket.id, { roomCode: room.code, playerId: id });
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
    sessions.set(socket.id, {});
  });

  socket.on('disconnect', () => {
    const ctx = context();
    if (ctx.ok) ctx.room.disconnect(socket.id);
    sessions.delete(socket.id);
  });
});

app.get('/healthz', (_req, res) => {
  res.json({ ok: true, rooms: manager.size });
});

// Serve the built client, with an SPA fallback so deep links work.
app.use(express.static(clientDist));
app.get(/^(?!\/(healthz|socket\.io)).*/, (_req, res) => {
  res.sendFile(path.join(clientDist, 'index.html'), (err) => {
    if (err) res.status(404).send('Client build not found. Run `npm run build` first.');
  });
});

httpServer.listen(PORT, () => {
  console.log(`24gameonline server listening on http://localhost:${PORT}`);
});
