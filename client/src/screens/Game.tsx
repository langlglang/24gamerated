import {
  describeRules,
  type CombineStep,
  type PublicGameState,
} from '@24game/shared';
import { CombineBoard } from '../components/CombineBoard.js';
import { CountdownBar } from '../components/Countdown.js';
import { HandResultOverlay } from '../components/HandResultOverlay.js';
import { Scoreboard } from '../components/Scoreboard.js';

interface Props {
  state: PublicGameState;
  selfId: string | null;
  combineError: { message: string; nonce: number } | null;
  onBuzz: () => void;
  onCallNoSolution: () => void;
  onCombine: (step: CombineStep) => void;
  onPlayAgain: () => void;
  onLeave: () => void;
}

export function Game({
  state,
  selfId,
  combineError,
  onBuzz,
  onCallNoSolution,
  onCombine,
  onPlayAgain,
  onLeave,
}: Props) {
  const me = state.players.find((p) => p.id === selfId) ?? null;
  const isAnswering = state.phase === 'answering' && state.activePlayerId === selfId;
  const someoneElseAnswering = state.phase === 'answering' && state.activePlayerId !== selfId;
  const activeName =
    state.players.find((p) => p.id === state.activePlayerId)?.name ?? 'Someone';

  const canAct = state.phase === 'open' && !!me && !me.lockedOut;
  const isHost = selfId === state.hostId;
  const labelFor = (key: string) =>
    state.mode === 'p4team'
      ? `Team ${key}`
      : (state.players.find((p) => p.id === key)?.name ?? key);

  if (state.phase === 'match-result' && state.matchResult) {
    const { matchResult, series } = state;
    const winnerNames = matchResult.winners.map(labelFor);
    const everyoneHere = state.players.every((p) => p.connected);
    // Order the series table by wins so the standings read at a glance.
    const standings = Object.entries(series.wins).sort(([, a], [, b]) => b - a);

    return (
      <div className="mx-auto flex w-full max-w-md flex-col justify-center gap-5 p-5">
        <h1 className="text-center text-4xl font-black text-emerald-400">Match over</h1>
        <p className="text-center text-xl font-semibold">
          {winnerNames.length === 1 ? `${winnerNames[0]} wins` : `Tied: ${winnerNames.join(', ')}`}
        </p>
        {matchResult.wentToTiebreak && (
          <p className="-mt-3 text-center text-xs text-slate-400">Decided in sudden death</p>
        )}

        <div>
          <p className="mb-2 text-xs uppercase tracking-widest text-slate-500">This match</p>
          <Scoreboard state={state} selfId={selfId} />
        </div>

        <div className="panel">
          <p className="mb-2 text-xs uppercase tracking-widest text-slate-500">
            Series · {series.matchesPlayed} {series.matchesPlayed === 1 ? 'match' : 'matches'} played
          </p>
          <ul className="space-y-1">
            {standings.map(([key, wins]) => (
              <li key={key} className="flex items-baseline justify-between">
                <span className={key === selfId ? 'font-semibold text-emerald-400' : ''}>
                  {labelFor(key)}
                </span>
                <span className="text-xl font-bold tabular-nums">{wins}</span>
              </li>
            ))}
          </ul>
        </div>

        {isHost ? (
          <button
            type="button"
            className="btn-primary text-lg"
            disabled={!everyoneHere}
            onClick={onPlayAgain}
          >
            {everyoneHere ? 'Play again' : 'Waiting for everyone to reconnect'}
          </button>
        ) : (
          <p className="text-center text-sm text-slate-400">
            Waiting for the host to start another match…
          </p>
        )}

        <button type="button" className="btn-secondary" onClick={onLeave}>
          Leave room
        </button>
      </div>
    );
  }

  return (
    <div className="relative mx-auto flex min-h-full w-full max-w-md flex-col gap-4 p-4">
      <header className="flex items-baseline justify-between text-xs text-slate-400">
        <span className="font-mono tracking-widest text-slate-300">
          {state.roomCode}
          {state.series.matchesPlayed > 0 && (
            <span className="ml-2 font-sans tracking-normal text-slate-500">
              match {state.series.matchesPlayed + 1}
            </span>
          )}
        </span>
        <span>
          {state.isTiebreak ? (
            <span className="font-semibold text-amber-400">Sudden death</span>
          ) : (
            <>
              Hand {state.handNumber} / {state.totalHands}
            </>
          )}
        </span>
        <span>{state.cardsRemaining} cards left</span>
      </header>

      <Scoreboard state={state} selfId={selfId} />

      <div className="h-8">
        <CountdownBar timer={state.timer} />
      </div>

      <div className="flex-1">
        <CombineBoard
          dealt={state.cards}
          table={state.table}
          interactive={isAnswering}
          onCombine={onCombine}
          errorNonce={combineError?.nonce ?? 0}
          errorMessage={combineError?.message ?? null}
        />
      </div>

      <p className="min-h-6 text-center text-sm">
        {state.phase === 'paused' && (
          <span className="text-amber-400">Waiting for a player to reconnect…</span>
        )}
        {someoneElseAnswering && (
          <span className="text-amber-400">{activeName} buzzed — answering…</span>
        )}
        {isAnswering && <span className="text-emerald-400">Your answer — combine to 24</span>}
        {state.phase === 'open' && me?.lockedOut && (
          <span className="text-slate-500">You are locked out of this hand</span>
        )}
      </p>

      <div className="space-y-2 pb-2">
        <button
          type="button"
          className="btn-primary h-24 w-full text-3xl font-black tracking-wide"
          disabled={!canAct}
          onClick={onBuzz}
        >
          BUZZ
        </button>
        <button
          type="button"
          className="btn-secondary w-full text-sm"
          disabled={!canAct}
          onClick={onCallNoSolution}
        >
          No solution
        </button>
        <p className="text-center text-[11px] text-slate-600">{describeRules(state.rules)}</p>
      </div>

      {state.phase === 'hand-result' && state.lastResult && (
        <HandResultOverlay result={state.lastResult} state={state} />
      )}
    </div>
  );
}
