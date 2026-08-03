import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@24game/shared';

export type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/**
 * Always same-origin: in dev Vite proxies /socket.io to the server, in prod the
 * server serves the client. The client never needs to know a server URL.
 */
export function createSocket(): GameSocket {
  return io({ autoConnect: true, transports: ['websocket', 'polling'] });
}
