import { randomUUID } from 'node:crypto';
import {
  ROOM_IDLE_TIMEOUT_MS,
  generateRoomCode,
  normalizeRoomCode,
  type GameMode,
  type RuleSet,
} from '@24game/shared';
import { Room, type RoomEvents } from './room.js';

/** In-memory room registry. Rooms are ephemeral by design. */
export class RoomManager {
  private rooms = new Map<string, Room>();
  private sweeper: NodeJS.Timeout;

  constructor(private readonly events: RoomEvents) {
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

  get(code: string): Room | undefined {
    return this.rooms.get(normalizeRoomCode(code));
  }

  /** Returns the id to use for this player — a new one, or their old seat. */
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
      if (room.isIdle(now, ROOM_IDLE_TIMEOUT_MS)) {
        room.close('room was idle for too long');
      }
    }
  }
}
