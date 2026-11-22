import { useState } from 'react';
import {
  MODE_SEATS,
  describeRules,
  type GameMode,
  type PublicGameState,
  type RuleSet,
  type TeamId,
} from '@24game/shared';
import { RuleToggles } from '../components/RuleToggles.js';
import { canNativeShare, shareOrCopy } from '../share.js';

interface Props {
  state: PublicGameState;
  selfId: string | null;
  onConfigure: (mode?: GameMode, rules?: RuleSet) => void;
  onSetTeam: (playerId: string, team: TeamId) => void;
  onStart: () => void;
  onLeave: () => void;
}

const MODES: GameMode[] = ['ffa', 'p4team'];
const MODE_LABEL: Record<GameMode, string> = {
  ffa: 'Everyone for themselves',
  p4team: 'Teams, 2 v 2',
  solo: 'Solo',
};

export function Lobby({ state, selfId, onConfigure, onSetTeam, onStart, onLeave }: Props) {
  const isHost = selfId === state.hostId;
  const seats = MODE_SEATS[state.mode];
  const count = state.players.length;
  const ready = count >= seats.min && count <= seats.max;
  const short = Math.max(seats.min - count, 0);
  const teamsBalanced =
    state.mode !== 'p4team' ||
    (state.players.filter((p) => p.team === 'A').length === 2 &&
      state.players.filter((p) => p.team === 'B').length === 2);
  const [copied, setCopied] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);

  async function invite() {
    const outcome = await shareOrCopy({
      text: `Play 24 with me. Room ${state.roomCode}:`,
      url: `${window.location.origin}/room/${state.roomCode}`,
    });
    if (outcome === 'copied') {
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 1500);
    }
  }

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(state.roomCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked — the code is on screen anyway.
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-5 p-5">
      <div className="panel text-center">
        <p className="text-xs uppercase tracking-widest text-muted">Room code</p>
        <p className="my-1 font-display text-5xl font-extrabold tracking-[0.2em]">
          {state.roomCode}
        </p>
        <button type="button" className="min-h-[44px] px-3 text-sm text-muted underline" onClick={() => void copyCode()}>
          {copied ? 'Copied' : 'Tap to copy'}
        </button>
        <button type="button" className="btn-secondary mt-2 h-12 w-full" onClick={() => void invite()}>
          {linkCopied ? 'Link copied' : canNativeShare() ? 'Share invite link' : 'Copy invite link'}
        </button>
      </div>

      <div className="panel">
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="font-semibold">Players</h2>
          <span className="text-xs text-muted">
            {seats.min === seats.max ? `${count} / ${seats.max}` : `${count} joined · up to ${seats.max}`}
          </span>
        </div>
        <ul className="space-y-2">
          {state.players.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-2">
              <span className="truncate">
                {p.name}
                {p.id === selfId && <span className="text-muted"> (you)</span>}
                {p.isHost && <span className="ml-1 text-xs text-ink">host</span>}
              </span>
              {state.mode === 'p4team' && (
                <span className="flex gap-1">
                  {(['A', 'B'] as const).map((team) => (
                    <button
                      key={team}
                      type="button"
                      disabled={!isHost && p.id !== selfId}
                      onClick={() => onSetTeam(p.id, team)}
                      className={[
                        'h-11 w-11 rounded-md text-sm font-bold transition-colors disabled:opacity-40',
                        p.team === team
                          ? 'bg-ink text-paper'
                          : 'bg-tile text-ink',
                      ].join(' ')}
                    >
                      {team}
                    </button>
                  ))}
                </span>
              )}
            </li>
          ))}
          {Array.from({ length: short }).map((_, i) => (
            <li key={`empty-${i}`} className="text-sm italic text-muted">
              waiting for a player…
            </li>
          ))}
        </ul>
      </div>

      <div className="panel space-y-4">
        <div>
          <p className="mb-2 text-sm font-semibold text-ink">Mode</p>
          <div className="grid grid-cols-2 gap-2">
            {MODES.map((m) => (
              <button
                key={m}
                type="button"
                disabled={!isHost}
                onClick={() => onConfigure(m, undefined)}
                className={[
                  'min-h-[44px] rounded-md px-2 py-2 text-sm font-semibold transition-colors disabled:opacity-50',
                  state.mode === m ? 'bg-ink text-paper' : 'bg-tile text-ink',
                ].join(' ')}
              >
                {MODE_LABEL[m]}
              </button>
            ))}
          </div>
        </div>

        {isHost ? (
          <RuleToggles rules={state.rules} onChange={(r) => onConfigure(undefined, r)} disabled={false} />
        ) : (
          <p className="text-sm text-muted">Rules: {describeRules(state.rules)}</p>
        )}

        <p className="text-xs text-muted">
          Every match is {state.totalHands} hands — one full deck.
        </p>
      </div>

      {isHost ? (
        <button
          type="button"
          className="btn-primary text-lg"
          disabled={!ready || !teamsBalanced}
          onClick={onStart}
        >
          {!ready
            ? `Waiting for ${short} more`
            : !teamsBalanced
              ? 'Teams must be 2 and 2'
              : 'Start match'}
        </button>
      ) : (
        <p className="text-center text-sm text-muted">Waiting for the host to start…</p>
      )}

      <button type="button" className="btn-secondary" onClick={onLeave}>
        Leave room
      </button>
    </div>
  );
}
