import {
  describeRules,
  formatDelta,
  type CombineStep,
  type PublicGameState,
  type RatedResultView,
} from '@24game/shared';
import { useEffect, useState } from 'react';
import { CombineBoard } from '../components/CombineBoard.js';
import { ConfirmDialog } from '../components/ConfirmDialog.js';
import { CountdownBar } from '../components/Countdown.js';
import { HandResultOverlay } from '../components/HandResultOverlay.js';
import { BuzzAlert } from '../components/BuzzAlert.js';
import { Scoreboard } from '../components/Scoreboard.js';
import { TurnUpright } from '../components/TurnUpright.js';

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
  const [confirmingLeave, setConfirmingLeave] = useState(false);
  // The match ending under an open dialog makes the question moot; don't
  // let it reappear when the next match starts.
  const matchOver = state.phase === 'match-result';
  useEffect(() => {
    if (matchOver) setConfirmingLeave(false);
  }, [matchOver]);
  const me =state.players.find((p) => p.id === selfId) ?? null;
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
        {matchResult.forfeitedBy ? (
          <p className="-mt-3 text-center text-sm text-muted">
            {matchResult.forfeitedBy === selfId
              ? 'You left the match, so it counts as a loss.'
              : `${state.players.find((p) => p.id === matchResult.forfeitedBy)?.name ?? 'Your opponent'} left — you win by forfeit.`}
          </p>
        ) : (
          matchResult.wentToTiebreak && (
            <p className="-mt-3 text-center text-xs text-muted">Decided in sudden death</p>
          )
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

  // Who we are waiting on while the match is paused (never ourselves: if we
  // were the one offline we would not be seeing this screen).
  const missing = state.players.filter((p) => !p.connected && p.id !== selfId);
  const missingNames =
    missing.length === 0
      ? 'a player'
      : missing.length === 1
        ? missing[0]!.name
        : `${missing.length} players`;
  const opponentName =
    opponent?.username ?? state.players.find((p) => p.id !== selfId)?.name ?? 'your opponent';
  const othersAway = state.phase === 'paused' && missing.length > 0;

  return (
    <div className="relative mx-auto flex min-h-full w-full max-w-md flex-col gap-4 px-5 pb-6 pt-3 short:gap-2 short:pb-3">
      <TurnUpright />
      {/* Above the hand-result overlay, so Leave is reachable at every moment. */}
      <header className="relative z-30 flex h-11 items-center justify-between border-b border-ink bg-paper text-sm">
        <span className="w-28">
          <button
            type="button"
            className="-ml-3 flex h-11 min-w-[44px] items-center gap-1.5 px-3 font-semibold"
            onClick={() => setConfirmingLeave(true)}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
            Leave
          </button>
        </span>
        <span className="font-display text-xl font-extrabold">24</span>
        <span className="w-28 text-right font-semibold tabular-nums">
          {state.isTiebreak ? 'Sudden death' : `${state.handNumber}/${state.totalHands}`}
        </span>
      </header>

      <p className="-mb-2 text-center text-xs text-muted">
        {state.rated ? (
          <>
            {state.rated === 'ranked' ? 'Ranked' : 'Rated challenge'}
            {opponent && ` · vs ${opponent.username} · ${opponent.rating}`}
          </>
        ) : (
          <>
            Room <span className="font-semibold tracking-widest text-ink">{state.roomCode}</span>
          </>
        )}
      </p>

      <Scoreboard state={state} selfId={selfId} />

      <div className="h-9">
        <CountdownBar timer={state.timer} />
      </div>

      <div className="flex flex-1 flex-col justify-center gap-4 short:gap-2">
        <p className="text-center font-display text-2xl font-semibold" aria-live="polite">
          {state.phase === 'paused' && `Waiting for ${missingNames} to reconnect…`}
          {someoneElseAnswering && `${activeName} buzzed in…`}
          {isAnswering && 'Your turn. Make 24.'}
          {state.phase === 'open' && me?.lockedOut && 'You’re out this hand.'}
          {state.phase === 'open' && !me?.lockedOut && 'Make 24.'}
          {state.phase === 'hand-result' && 'Make 24.'}
        </p>
        {othersAway && (
          <div className="flex flex-col items-center gap-3 text-center">
            <p className="max-w-[20rem] text-sm text-muted">
              {state.rated
                ? 'If they’re not back within a minute, you win by forfeit.'
                : 'If they’re not back within a minute, the room closes.'}
            </p>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setConfirmingLeave(true)}
            >
              {state.rated ? 'Leave match' : 'Leave game'}
            </button>
          </div>
        )}
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
          className="btn-primary col-span-2 h-16 short:h-14 text-xl font-bold"
          disabled={!canAct}
          onClick={onBuzz}
        >
          Buzz in
        </button>
        <button
          type="button"
          className="btn-secondary h-16 short:h-14 px-2 text-sm"
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

      {someoneElseAnswering && state.activePlayerId && (
        <BuzzAlert name={activeName} buzzerId={state.activePlayerId} />
      )}

      {state.phase === 'hand-result' && state.lastResult && (
        <HandResultOverlay result={state.lastResult} state={state} selfId={selfId} />
      )}

      {/*
        Copy below mirrors what the server does on room:leave mid-match. Rated:
        leaving is a forfeit loss, recorded at once (opponent wins, both ratings
        move). If the opponent is already away when you leave, nothing is
        recorded (no contest). Guest rooms: the seat goes offline, the room
        pauses, and closes after RECONNECT_GRACE_MS (60 s). The stored session
        is wiped on leave, so there is no way back into the seat.
      */}
      <ConfirmDialog
        open={confirmingLeave}
        title={
          state.rated
            ? `Leave this ${state.rated === 'ranked' ? 'ranked match' : 'rated challenge'}?`
            : 'Leave this game?'
        }
        confirmLabel={state.rated ? 'Leave match' : 'Leave game'}
        cancelLabel={othersAway ? 'Keep waiting' : 'Keep playing'}
        onCancel={() => setConfirmingLeave(false)}
        onConfirm={() => {
          setConfirmingLeave(false);
          onLeave();
        }}
      >
        {state.rated ? (
          othersAway ? (
            <p>
              {opponentName} has dropped. Stay, and you win by forfeit if they’re not back within
              a minute. If you leave now, the match ends with no result and neither rating changes.
            </p>
          ) : (
            <>
              <p>
                Leaving counts as a loss. {opponentName} wins by forfeit and both ratings change.
              </p>
              <p>You can’t come back to this match.</p>
            </>
          )
        ) : othersAway ? (
          <p>You can’t rejoin this game. The room closes within a minute for everyone.</p>
        ) : (
          <p>
            You can’t rejoin this game. It pauses for everyone else, and the room closes for
            everyone after 60 seconds.
          </p>
        )}
      </ConfirmDialog>
    </div>
  );
}
