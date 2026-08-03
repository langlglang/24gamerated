import { useState } from 'react';
import {
  MODE_PLAYER_COUNT,
  describeRules,
  type GameMode,
  type PublicGameState,
  type RuleSet,
  type TeamId,
} from '@24game/shared';
import { RuleToggles } from '../components/RuleToggles.js';

interface Props {
  state: PublicGameState;
  selfId: string | null;
  onConfigure: (mode?: GameMode, rules?: RuleSet) => void;
  onSetTeam: (playerId: string, team: TeamId) => void;
  onStart: () => void;
  onLeave: () => void;
}

const MODES: GameMode[] = ['p2', 'p3', 'p4team'];
const MODE_LABEL: Record<GameMode, string> = {
  p2: '2 players',
  p3: '3 players',
  p4team: '4 players (2v2)',
  solo: 'Solo',
};

export function Lobby({ state, selfId, onConfigure, onSetTeam, onStart, onLeave }: Props) {
  const isHost = selfId === state.hostId;
  const seats = MODE_PLAYER_COUNT[state.mode];
  const ready = state.players.length === seats;
  const teamsBalanced =
    state.mode !== 'p4team' ||
    (state.players.filter((p) => p.team === 'A').length === 2 &&
      state.players.filter((p) => p.team === 'B').length === 2);
  const [copied, setCopied] = useState(false);

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
        <p className="text-xs uppercase tracking-widest text-slate-400">Room code</p>
        <p className="my-1 text-5xl font-black tracking-[0.3em] text-emerald-400">
          {state.roomCode}
        </p>
        <button type="button" className="text-xs text-slate-400 underline" onClick={() => void copyCode()}>
          {copied ? 'Copied' : 'Tap to copy'}
        </button>
      </div>

      <div className="panel">
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="font-semibold">Players</h2>
          <span className="text-xs text-slate-400">
            {state.players.length} / {seats}
          </span>
        </div>
        <ul className="space-y-2">
          {state.players.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-2">
              <span className="truncate">
                {p.name}
                {p.id === selfId && <span className="text-slate-500"> (you)</span>}
                {p.isHost && <span className="ml-1 text-xs text-amber-400">host</span>}
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
                        'h-8 w-8 rounded-lg text-sm font-bold transition disabled:opacity-30',
                        p.team === team
                          ? 'bg-emerald-500 text-slate-950'
                          : 'bg-slate-800 text-slate-300',
                      ].join(' ')}
                    >
                      {team}
                    </button>
                  ))}
                </span>
              )}
            </li>
          ))}
          {Array.from({ length: Math.max(seats - state.players.length, 0) }).map((_, i) => (
            <li key={`empty-${i}`} className="text-sm italic text-slate-600">
              waiting for a player…
            </li>
          ))}
        </ul>
      </div>

      <div className="panel space-y-4">
        <div>
          <p className="mb-2 text-sm font-semibold text-slate-300">Mode</p>
          <div className="grid grid-cols-3 gap-2">
            {MODES.map((m) => (
              <button
                key={m}
                type="button"
                disabled={!isHost}
                onClick={() => onConfigure(m, undefined)}
                className={[
                  'rounded-xl px-2 py-2 text-xs font-semibold transition disabled:opacity-50',
                  state.mode === m ? 'bg-emerald-500 text-slate-950' : 'bg-slate-800 text-slate-300',
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
          <p className="text-sm text-slate-400">Rules: {describeRules(state.rules)}</p>
        )}

        <p className="text-xs text-slate-500">
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
            ? `Waiting for ${seats - state.players.length} more`
            : !teamsBalanced
              ? 'Teams must be 2 and 2'
              : 'Start match'}
        </button>
      ) : (
        <p className="text-center text-sm text-slate-400">Waiting for the host to start…</p>
      )}

      <button type="button" className="btn-secondary" onClick={onLeave}>
        Leave room
      </button>
    </div>
  );
}
