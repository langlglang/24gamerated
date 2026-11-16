import {
  describeRules,
  formatDelta,
  type CombineStep,
  type PublicGameState,
  type RatedResultView,
} from '@24game/shared';
import { CombineBoard } from '../components/CombineBoard.js';
import { CountdownBar } from '../components/Countdown.js';
import { HandResultOverlay } from '../components/HandResultOverlay.js';
import { Scoreboard } from '../components/Scoreboard.js';

interface Props {
  state: PublicGameState;
  selfId: string | null;
  combineError: { message: string; nonce: number } | null;
  /** Present only once a rated match has been recorded. */
  ratedResult: RatedResultView | null;
  opponent: { username: string; rating: number } | null;
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
  ratedResult,
  opponent,
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

  if (state.phase === 'match-result' && state.matchResult && state.rated) {
    // Rated matches are one-and-done: no series, no rematch button. What
    // matters is what happened to the rating.
    const { matchResult } = state;
    const won = matchResult.winners.some((key) => key === selfId);
    return (
      <div className="mx-auto flex w-full max-w-md flex-col justify-center gap-5 p-5">
        <p className="eyebrow text-center">
          {state.rated === 'ranked' ? 'Ranked match' : 'Rated challenge'}
        </p>
        <h1
          className={`text-center font-display text-6xl font-extrabold ${won ? 'text-good' : 'text-bad'}`}
        >
          {won ? 'You win' : 'You lose'}
        </h1>
        {matchResult.wentToTiebreak && (
          <p className="-mt-3 text-center text-xs text-muted">Decided in sudden death</p>
        )}

        <Scoreboard state={state} selfId={selfId} />

        {ratedResult ? (
          <div className="panel space-y-3 text-center">
            <p className="text-xs uppercase tracking-widest text-muted">Rating</p>
            <p className="flex items-baseline justify-center gap-3">
              <span className="text-2xl text-muted line-through">{ratedResult.you.before}</span>
              <span className="font-display text-5xl font-extrabold tabular-nums">
                {ratedResult.you.after}
              </span>
              <span
                className={`text-2xl font-bold tabular-nums ${
                  ratedResult.you.delta >= 0 ? 'text-good' : 'text-bad'
                }`}
              >
                {formatDelta(ratedResult.you.delta)}
              </span>
            </p>
            <p className="text-xs text-muted">
              {ratedResult.opponent.username}: {ratedResult.opponent.before} →{' '}
              {ratedResult.opponent.after} ({formatDelta(ratedResult.opponent.delta)})
            </p>
          </div>
        ) : (
          <p className="text-center text-sm text-muted">Recording your rating…</p>
        )}

        <button type="button" className="btn-primary" onClick={onLeave}>
          Back to home
        </button>
      </div>
    );
  }

  if (state.phase === 'match-result' && state.matchResult) {
    const { matchResult, series } = state;
    const winnerNames = matchResult.winners.map(labelFor);
    const everyoneHere = state.players.every((p) => p.connected);
    // Order the series table by wins so the standings read at a glance.
    const standings = Object.entries(series.wins).sort(([, a], [, b]) => b - a);

    return (
      <div className="mx-auto flex w-full max-w-md flex-col justify-center gap-5 p-5">
        <h1 className="text-center font-display text-5xl font-extrabold">Match over</h1>
        <p className="text-center text-xl font-semibold">
          {winnerNames.length === 1 ? `${winnerNames[0]} wins` : `Tied: ${winnerNames.join(', ')}`}
        </p>
        {matchResult.wentToTiebreak && (
          <p className="-mt-3 text-center text-xs text-muted">Decided in sudden death</p>
        )}

        <div>
          <p className="mb-2 text-xs uppercase tracking-widest text-muted">This match</p>
          <Scoreboard state={state} selfId={selfId} />
        </div>

        <div className="panel">
          <p className="mb-2 text-xs uppercase tracking-widest text-muted">
            Series · {series.matchesPlayed} {series.matchesPlayed === 1 ? 'match' : 'matches'} played
          </p>
          <ul className="space-y-1">
            {standings.map(([key, wins]) => (
              <li key={key} className="flex items-baseline justify-between">
                <span className={key === selfId ? 'font-semibold text-good' : ''}>
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
          <p className="text-center text-sm text-muted">
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
    <div className="relative mx-auto flex min-h-full w-full max-w-md flex-col gap-4 px-5 pb-6 pt-3">
      <header className="flex h-11 items-center justify-between border-b border-ink text-sm">
        <span className="w-24 truncate font-semibold">
          {state.rated ? (
            <>{state.rated === 'ranked' ? 'Ranked' : 'Challenge'}</>
          ) : (
            <span className="tracking-widest">{state.roomCode}</span>
          )}
        </span>
        <span className="font-display text-xl font-extrabold">24</span>
        <span className="w-24 text-right font-semibold tabular-nums">
          {state.isTiebreak ? 'Sudden death' : `${state.handNumber}/${state.totalHands}`}
        </span>
      </header>

      {opponent && state.rated && (
        <p className="-mb-2 text-center text-xs text-muted">
          vs {opponent.username} · {opponent.rating}
        </p>
      )}

      <Scoreboard state={state} selfId={selfId} />

      <div className="h-9">
        <CountdownBar timer={state.timer} />
      </div>

      <div className="flex flex-1 flex-col justify-center gap-4">
        <p className="text-center font-display text-2xl font-semibold" aria-live="polite">
          {state.phase === 'paused' && 'Waiting for a player to reconnect…'}
          {someoneElseAnswering && `${activeName} buzzed in…`}
          {isAnswering && 'Your turn. Make 24.'}
          {state.phase === 'open' && me?.lockedOut && 'You’re out this hand.'}
          {state.phase === 'open' && !me?.lockedOut && 'Make 24.'}
          {state.phase === 'hand-result' && 'Make 24.'}
        </p>
        <CombineBoard
          dealt={state.cards}
          table={state.table}
          interactive={isAnswering}
          onCombine={onCombine}
          errorNonce={combineError?.nonce ?? 0}
          errorMessage={combineError?.message ?? null}
        />
      </div>

      <div className="grid grid-cols-3 gap-3">
        <button
          type="button"
          className="btn-primary col-span-2 h-16 text-xl font-bold"
          disabled={!canAct}
          onClick={onBuzz}
        >
          Buzz in
        </button>
        <button
          type="button"
          className="btn-secondary h-16 px-2 text-sm"
          disabled={!canAct}
          onClick={onCallNoSolution}
        >
          No solution
        </button>
      </div>
      <p className="text-center text-xs text-muted">
        {describeRules(state.rules)} · {state.cardsRemaining} cards left
        {!state.rated && state.series.matchesPlayed > 0 && ` · match ${state.series.matchesPlayed + 1}`}
      </p>

      {state.phase === 'hand-result' && state.lastResult && (
        <HandResultOverlay result={state.lastResult} state={state} />
      )}
    </div>
  );
}
