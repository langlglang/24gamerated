import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  RATED_REJECTION_TEXT,
  describeValidationError,
  type ActionRejection,
  type ChallengeView,
  type CombineStep,
  type GameMode,
  type PublicGameState,
  type PublicUserView,
  type QueueStatusView,
  type RatedKind,
  type RatedResultView,
  type RuleSet,
  type TeamId,
} from '@24game/shared';
import { createSocket, type GameSocket } from './socket.js';

const SESSION_KEY = '24game.session';

interface StoredSession {
  roomCode: string;
  playerId: string;
  /** Secret the server issued for this seat; required to reclaim it. */
  reconnectToken?: string;
  name: string;
  /** Rated seat: rejoin only after the socket has been identified. */
  rated?: boolean;
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
  'room-not-found': 'No room with that code. Check it with the host; the game may have ended.',
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

  // ---- rated play ----
  /** Live rating record, refreshed by the server after each rated match. */
  profile: PublicUserView | null;
  queue: QueueStatusView;
  challenges: ChallengeView[];
  ratedResult: RatedResultView | null;
  matchFound: { roomCode: string; kind: RatedKind; opponent: { username: string; rating: number } } | null;
  joinQueue: () => Promise<string | null>;
  leaveQueue: () => void;
  sendChallenge: (username: string) => Promise<string | null>;
  respondChallenge: (id: string, accept: boolean) => Promise<string | null>;
  dismissRatedResult: () => void;
}

const IDLE_QUEUE: QueueStatusView = { inQueue: false, waitingMs: 0, searching: 0, band: 0 };

export function useGame(token: string | null): GameApi {
  const socketRef = useRef<GameSocket | null>(null);
  if (!socketRef.current) socketRef.current = createSocket();
  const socket = socketRef.current;

  const [connected, setConnected] = useState(socket.connected);
  const [state, setState] = useState<PublicGameState | null>(null);
  const [playerId, setPlayerId] = useState<string | null>(() => loadSession()?.playerId ?? null);
  const [notice, setNotice] = useState<string | null>(null);
  const [combineError, setCombineError] = useState<{ message: string; nonce: number } | null>(null);
  const errorNonce = useRef(0);

  const [profile, setProfile] = useState<PublicUserView | null>(null);
  const [queue, setQueue] = useState<QueueStatusView>(IDLE_QUEUE);
  const [challenges, setChallenges] = useState<ChallengeView[]>([]);
  const [ratedResult, setRatedResult] = useState<RatedResultView | null>(null);
  const [matchFound, setMatchFound] = useState<GameApi['matchFound']>(null);

  /**
   * The room this client believes it is in, and the one it just left. The
   * server broadcasts the room's state to everyone (us included) while it
   * handles our room:leave, so that last snapshot arrives after we have
   * already cleared ours. Without this guard it put a dead seat back on
   * screen ("You lose", us listed offline, "Recording your rating…").
   */
  const currentRoomRef = useRef<string | null>(loadSession()?.roomCode ?? null);
  const leftRoomRef = useRef<string | null>(null);

  /**
   * The ONE place a seat is stored. Everything that identifies us to a room
   * on reconnect is saved here and sent back from rejoin() below.
   */
  const adoptSeat = useCallback((session: StoredSession | null) => {
    saveSession(session);
    setPlayerId(session?.playerId ?? null);
    currentRoomRef.current = session?.roomCode ?? null;
    if (session) leftRoomRef.current = null;
  }, []);

  const rejoin = useCallback(
    (session: StoredSession) => {
      socket.emit(
        'room:join',
        {
          name: session.name,
          roomCode: session.roomCode,
          playerId: session.playerId,
          ...(session.reconnectToken ? { reconnectToken: session.reconnectToken } : {}),
        },
        (res) => {
          if (res.ok) {
            adoptSeat({
              ...session,
              roomCode: res.roomCode,
              playerId: res.playerId,
              reconnectToken: res.reconnectToken,
            });
          }
          else {
            adoptSeat(null);
            setState(null);
          }
        },
      );
    },
    [socket, adoptSeat],
  );

  useEffect(() => {
    function onConnect() {
      setConnected(true);
      // Reclaim the same seat after a refresh or a dropped connection. A
      // rated seat waits for sign-in to be confirmed (see identify below).
      const session = loadSession();
      if (session && !session.rated) rejoin(session);
    }

    function onDisconnect() {
      setConnected(false);
    }

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('state', (next) => {
      // A late snapshot of the room we just walked out of: drop it.
      if (next.roomCode === leftRoomRef.current) return;
      currentRoomRef.current = next.roomCode;
      setState(next);
    });
    socket.on('rejected', ({ reason }) => setNotice(REJECTION_TEXT[reason] ?? 'Action rejected.'));
    socket.on('combineRejected', ({ error }) => {
      errorNonce.current += 1;
      setCombineError({ message: describeValidationError(error), nonce: errorNonce.current });
    });
    socket.on('roomClosed', ({ reason }) => {
      // A room we already left closing (e.g. we were the last one out of a
      // lobby) is not news to us.
      if (currentRoomRef.current) setNotice(`Room closed: ${reason}`);
      adoptSeat(null);
      setState(null);
    });

    socket.on('profile', setProfile);
    socket.on('queueStatus', setQueue);
    socket.on('challengeIncoming', (challenge) => {
      setChallenges((prev) => [challenge, ...prev.filter((c) => c.id !== challenge.id)]);
    });
    socket.on('challengeUpdated', (challenge) => {
      // Anything no longer pending leaves the inbox.
      setChallenges((prev) => prev.filter((c) => c.id !== challenge.id));
      if (challenge.status === 'declined') {
        setNotice(`${challenge.toUsername} declined your challenge.`);
      }
    });
    socket.on('ratedMatchFound', (payload) => {
      // The server has already seated us; record who we are up against and
      // clear any queue state so the UI stops showing "searching".
      setMatchFound(payload);
      setQueue(IDLE_QUEUE);
      setChallenges([]);
      setRatedResult(null);
      // Without our seat id the game can't tell which player we are, and
      // buzz / no-solution stay disabled. Saving it also lets a refresh
      // reclaim the seat (the server checks we're the signed-in owner).
      adoptSeat({
        roomCode: payload.roomCode,
        playerId: payload.playerId,
        reconnectToken: payload.reconnectToken,
        name: 'Player',
        rated: true,
      });
    });
    // Can arrive again after a refresh on the result screen; same match, same result.
    socket.on('ratedResult', (result) =>
      setRatedResult((prev) => (prev && prev.matchId === result.matchId ? prev : result)),
    );
    socket.on('seatReplaced', () => {
      // A newer connection (normally this player's other tab) took the seat.
      // Forget it here, but leave the stored session alone: that tab uses it.
      setPlayerId(null);
      currentRoomRef.current = null;
      setState(null);
      setMatchFound(null);
      setNotice('This game continued in another tab.');
    });

    if (socket.connected) onConnect();

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('state');
      socket.off('rejected');
      socket.off('combineRejected');
      socket.off('roomClosed');
      socket.off('profile');
      socket.off('queueStatus');
      socket.off('challengeIncoming');
      socket.off('challengeUpdated');
      socket.off('ratedMatchFound');
      socket.off('ratedResult');
      socket.off('seatReplaced');
    };
  }, [socket, rejoin, adoptSeat]);

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
            adoptSeat({ roomCode: res.roomCode, playerId: res.playerId, reconnectToken: res.reconnectToken, name });
            resolve(null);
          } else {
            resolve(REJECTION_TEXT[res.error]);
          }
        });
      }),
    [socket, adoptSeat],
  );

  const joinRoom = useCallback(
    (name: string, roomCode: string) =>
      new Promise<string | null>((resolve) => {
        socket.emit('room:join', { name, roomCode }, (res) => {
          if (res.ok) {
            adoptSeat({ roomCode: res.roomCode, playerId: res.playerId, reconnectToken: res.reconnectToken, name });
            resolve(null);
          } else {
            resolve(REJECTION_TEXT[res.error]);
          }
        });
      }),
    [socket, adoptSeat],
  );

  /**
   * Walk out of the current room for good: the server frees or pauses the
   * seat, the stored session is wiped (so a reload, a new tab or another
   * route no longer pulls us back in), and all room UI state is cleared in
   * the same render.
   */
  const leave = useCallback(() => {
    leftRoomRef.current = currentRoomRef.current;
    socket.emit('room:leave');
    adoptSeat(null);
    setState(null);
    setMatchFound(null);
    setRatedResult(null);
    setCombineError(null);
  }, [socket, adoptSeat]);

  // Bind the signed-in identity to this socket whenever the token changes, and
  // re-bind on reconnect so a dropped connection does not silently sign out.
  useEffect(() => {
    if (!token) {
      socket.emit('auth:signOut');
      setProfile(null);
      setQueue(IDLE_QUEUE);
      setChallenges([]);
      return;
    }
    const identify = () => {
      socket.emit('auth:identify', { token }, (res) => {
        if (!res.ok) return;
        setProfile(res.user);
        const session = loadSession();
        if (session?.rated) rejoin(session);
      });
    };
    identify();
    socket.on('connect', identify);
    return () => {
      socket.off('connect', identify);
    };
  }, [socket, token, rejoin]);

  const joinQueue = useCallback(
    () =>
      new Promise<string | null>((resolve) => {
        socket.emit('queue:join', (res) => {
          resolve(res.ok ? null : RATED_REJECTION_TEXT[res.error]);
        });
      }),
    [socket],
  );

  const sendChallenge = useCallback(
    (username: string) =>
      new Promise<string | null>((resolve) => {
        socket.emit('challenge:send', { username }, (res) => {
          resolve(res.ok ? null : RATED_REJECTION_TEXT[res.error]);
        });
      }),
    [socket],
  );

  const respondChallenge = useCallback(
    (id: string, accept: boolean) =>
      new Promise<string | null>((resolve) => {
        setChallenges((prev) => prev.filter((c) => c.id !== id));
        socket.emit('challenge:respond', { id, accept }, (res) => {
          resolve(res.ok ? null : RATED_REJECTION_TEXT[res.error]);
        });
      }),
    [socket],
  );

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

      profile,
      queue,
      challenges,
      ratedResult,
      matchFound,
      joinQueue,
      leaveQueue: () => socket.emit('queue:leave'),
      sendChallenge,
      respondChallenge,
      dismissRatedResult: () => setRatedResult(null),
    }),
    [
      connected,
      state,
      playerId,
      notice,
      combineError,
      createRoom,
      joinRoom,
      leave,
      socket,
      profile,
      queue,
      challenges,
      ratedResult,
      matchFound,
      joinQueue,
      sendChallenge,
      respondChallenge,
    ],
  );
}
