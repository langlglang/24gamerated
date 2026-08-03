import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  describeValidationError,
  type ActionRejection,
  type CombineStep,
  type GameMode,
  type PublicGameState,
  type RuleSet,
  type TeamId,
} from '@24game/shared';
import { createSocket, type GameSocket } from './socket.js';

const SESSION_KEY = '24game.session';

interface StoredSession {
  roomCode: string;
  playerId: string;
  name: string;
}

function loadSession(): StoredSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as StoredSession) : null;
  } catch {
    return null;
  }
}

function saveSession(session: StoredSession | null): void {
  try {
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    // Private-mode browsers: reconnect just won't survive a refresh.
  }
}

const REJECTION_TEXT: Record<ActionRejection, string> = {
  'not-in-room': 'You are not in a room.',
  'not-host': 'Only the host can do that.',
  'wrong-phase': 'That is not available right now.',
  'too-late': 'Too late — someone beat you to it.',
  'locked-out': 'You are locked out of this hand.',
  'not-your-turn': 'It is not your turn.',
  'room-full': 'That room is full.',
  'room-not-found': 'No room with that code.',
  'name-taken': 'That name is already taken in this room.',
  'wrong-player-count': 'The player count does not match the selected mode.',
  'teams-unbalanced': 'Teams must be 2 and 2.',
  'player-offline': 'Everyone has to be connected to start another match.',
  'invalid-combine': 'That move is not legal.',
};

export interface GameApi {
  connected: boolean;
  state: PublicGameState | null;
  playerId: string | null;
  notice: string | null;
  combineError: { message: string; nonce: number } | null;
  createRoom: (name: string, mode: GameMode, rules: RuleSet) => Promise<string | null>;
  joinRoom: (name: string, roomCode: string) => Promise<string | null>;
  configure: (mode?: GameMode, rules?: RuleSet) => void;
  setTeam: (playerId: string, team: TeamId) => void;
  start: () => void;
  buzz: () => void;
  callNoSolution: () => void;
  combine: (step: CombineStep) => void;
  playAgain: () => void;
  leave: () => void;
  clearNotice: () => void;
}

export function useGame(): GameApi {
  const socketRef = useRef<GameSocket | null>(null);
  if (!socketRef.current) socketRef.current = createSocket();
  const socket = socketRef.current;

  const [connected, setConnected] = useState(socket.connected);
  const [state, setState] = useState<PublicGameState | null>(null);
  const [playerId, setPlayerId] = useState<string | null>(() => loadSession()?.playerId ?? null);
  const [notice, setNotice] = useState<string | null>(null);
  const [combineError, setCombineError] = useState<{ message: string; nonce: number } | null>(null);
  const errorNonce = useRef(0);

  useEffect(() => {
    function onConnect() {
      setConnected(true);
      // Reclaim the same seat after a refresh or a dropped connection.
      const session = loadSession();
      if (session) {
        socket.emit(
          'room:join',
          { name: session.name, roomCode: session.roomCode, playerId: session.playerId },
          (res) => {
            if (res.ok) setPlayerId(res.playerId);
            else {
              saveSession(null);
              setPlayerId(null);
              setState(null);
            }
          },
        );
      }
    }

    function onDisconnect() {
      setConnected(false);
    }

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('state', setState);
    socket.on('rejected', ({ reason }) => setNotice(REJECTION_TEXT[reason] ?? 'Action rejected.'));
    socket.on('combineRejected', ({ error }) => {
      errorNonce.current += 1;
      setCombineError({ message: describeValidationError(error), nonce: errorNonce.current });
    });
    socket.on('roomClosed', ({ reason }) => {
      setNotice(`Room closed: ${reason}`);
      saveSession(null);
      setState(null);
      setPlayerId(null);
    });

    if (socket.connected) onConnect();

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('state');
      socket.off('rejected');
      socket.off('combineRejected');
      socket.off('roomClosed');
    };
  }, [socket]);

  // A new hand clears any stale illegal-move message.
  const handNumber = state?.handNumber;
  useEffect(() => {
    setCombineError(null);
  }, [handNumber]);

  const createRoom = useCallback(
    (name: string, mode: GameMode, rules: RuleSet) =>
      new Promise<string | null>((resolve) => {
        socket.emit('room:create', { name, mode, rules }, (res) => {
          if (res.ok) {
            saveSession({ roomCode: res.roomCode, playerId: res.playerId, name });
            setPlayerId(res.playerId);
            resolve(null);
          } else {
            resolve(REJECTION_TEXT[res.error]);
          }
        });
      }),
    [socket],
  );

  const joinRoom = useCallback(
    (name: string, roomCode: string) =>
      new Promise<string | null>((resolve) => {
        socket.emit('room:join', { name, roomCode }, (res) => {
          if (res.ok) {
            saveSession({ roomCode: res.roomCode, playerId: res.playerId, name });
            setPlayerId(res.playerId);
            resolve(null);
          } else {
            resolve(REJECTION_TEXT[res.error]);
          }
        });
      }),
    [socket],
  );

  const leave = useCallback(() => {
    socket.emit('room:leave');
    saveSession(null);
    setState(null);
    setPlayerId(null);
  }, [socket]);

  return useMemo<GameApi>(
    () => ({
      connected,
      state,
      playerId,
      notice,
      combineError,
      createRoom,
      joinRoom,
      configure: (mode, rules) => socket.emit('room:configure', { mode, rules }),
      setTeam: (id, team) => socket.emit('room:setTeam', { playerId: id, team }),
      start: () => socket.emit('room:start'),
      buzz: () => socket.emit('game:buzz'),
      callNoSolution: () => socket.emit('game:callNoSolution'),
      combine: (step) => socket.emit('game:combine', { step }),
      playAgain: () => socket.emit('game:playAgain'),
      leave,
      clearNotice: () => setNotice(null),
    }),
    [connected, state, playerId, notice, combineError, createRoom, joinRoom, leave, socket],
  );
}
