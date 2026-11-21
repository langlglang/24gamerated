import { randomUUID } from 'node:crypto';
import {
  RATED_RULES,
  ROOM_IDLE_TIMEOUT_MS,
  generateRoomCode,
  normalizeRoomCode,
  type GameMode,
  type RatedKind,
  type RuleSet,
} from '@24game/shared';
import { Room, type RoomEvents } from './room.js';

/** In-memory room registry. Rooms are ephemeral by design. */
export class RoomManager {
  private rooms = new Map<string, Room>();
  private sweeper: NodeJS.Timeout;

  constructor(
    private readonly events: RoomEvents,
    /** Whether the server still has this socket. Seats on dead sockets get dropped. */
    private readonly isSocketAlive: (socketId: string) => boolean = () => true,
  ) {
    this.sweeper = setInterval(() => this.sweepIdleRooms(), 60_000);
    // Never hold the process open just to run the sweeper.
    this.sweeper.unref?.();
  }

  private uniqueCode(): string {
    for (let attempt = 0; attempt < 50; attempt++) {
      const code = generateRoomCode();
      if (!this.rooms.has(code)) return code;
    }
    throw new Error('could not allocate a free room code');
  }

  create(
    hostName: string,
    socketId: string,
    mode: GameMode,
    rules: RuleSet,
  ): { room: Room; playerId: string } {
    const code = this.uniqueCode();
    const playerId = randomUUID();
    const room = new Room(code, { id: playerId, name: hostName, socketId }, mode, rules, {
      ...this.events,
      onClosed: (r, reason) => {
        this.rooms.delete(r.code);
        this.events.onClosed(r, reason);
      },
    });
    this.rooms.set(code, room);
    return { room, playerId };
  }

  /**
   * A rated 1v1, seated and ready to start. Player ids ARE user ids here, so
   * a reconnect lands the right account back in the right seat, and the rating
   * layer needs no extra mapping.
   */
  createRated(
    a: { userId: string; username: string; socketId: string },
    b: { userId: string; username: string; socketId: string },
    kind: RatedKind,
  ): Room {
    const code = this.uniqueCode();
    const room = new Room(
      code,
      { id: a.userId, name: a.username, socketId: a.socketId },
      'ffa',
      RATED_RULES,
      {
        ...this.events,
        onClosed: (r, reason) => {
          this.rooms.delete(r.code);
          this.events.onClosed(r, reason);
        },
      },
      kind,
    );
    const joined = room.join({ id: b.userId, name: b.username, socketId: b.socketId });
    if (!joined.ok) throw new Error(`could not seat rated opponent: ${joined.error}`);
    this.rooms.set(code, room);
    return room;
  }

  /** Every room with a seat for this id (a user id, for rated seats). */
  roomsWithPlayer(playerId: string): Room[] {
    return [...this.rooms.values()].filter((room) => room.hasSeat(playerId));
  }

  /**
   * True when this id holds a seat in any room that is still being played.
   * Finished rated rooms (result screen only) do not count. Guest seats use
   * random ids, so callers check a user's guest seats separately.
   */
  hasLiveSeat(playerId: string): boolean {
    return this.roomsWithPlayer(playerId).some((room) => !room.closed && !room.finished);
  }

  get(code: string): Room | undefined {
    return this.rooms.get(normalizeRoomCode(code));
  }

  /** A fresh, server-chosen seat id. Clients never pick their own. */
  newPlayerId(): string {
    return randomUUID();
  }

  remove(code: string): void {
    this.rooms.delete(code);
  }

  get size(): number {
    return this.rooms.size;
  }

  private sweepIdleRooms(): void {
    const now = Date.now();
    for (const room of [...this.rooms.values()]) {
      // Belt and braces: a seat whose socket is gone without its disconnect
      // being seen still pauses the room (and closes it after the grace).
      room.dropDeadSockets(this.isSocketAlive);
      if (room.closed) continue;
      if (room.isIdle(now, ROOM_IDLE_TIMEOUT_MS)) {
        room.close('room was idle for too long');
      }
    }
  }
}
