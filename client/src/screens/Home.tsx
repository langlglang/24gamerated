import { useState } from 'react';
import { MODE_PLAYER_COUNT, type GameMode, type RuleSet } from '@24game/shared';
import { RuleToggles } from '../components/RuleToggles.js';

interface Props {
  onCreate: (name: string, mode: GameMode, rules: RuleSet) => Promise<string | null>;
  onJoin: (name: string, code: string) => Promise<string | null>;
  onTraining: () => void;
  connected: boolean;
}

const MODES: { id: GameMode; label: string; blurb: string }[] = [
  { id: 'p2', label: '2 players', blurb: 'Head to head' },
  { id: 'p3', label: '3 players', blurb: 'Failed buzz keeps the hand alive' },
  { id: 'p4team', label: '4 players', blurb: '2 v 2 teams' },
];

export function Home({ onCreate, onJoin, onTraining, connected }: Props) {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [mode, setMode] = useState<GameMode>('p2');
  const [rules, setRules] = useState<RuleSet>({ fractions: true, negatives: true });
  const [tab, setTab] = useState<'create' | 'join'>('create');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!name.trim()) {
      setError('Enter a display name first.');
      return;
    }
    setBusy(true);
    setError(null);
    const result =
      tab === 'create' ? await onCreate(name.trim(), mode, rules) : await onJoin(name.trim(), code);
    setBusy(false);
    if (result) setError(result);
  }

  return (
    <div className="mx-auto flex min-h-full w-full max-w-md flex-col justify-center gap-6 p-5">
      <header className="text-center">
        <h1 className="text-6xl font-black tracking-tight text-emerald-400">24</h1>
        <p className="mt-1 text-sm text-slate-400">
          Four cards. Plus, minus, times, divide. Make exactly 24.
        </p>
      </header>

      <input
        className="field text-center text-lg"
        placeholder="Your name"
        maxLength={20}
        value={name}
        onChange={(e) => setName(e.target.value)}
      />

      <div className="grid grid-cols-2 gap-2">
        {(['create', 'join'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => {
              setTab(t);
              setError(null);
            }}
            className={`btn ${tab === t ? 'bg-slate-100 text-slate-900' : 'bg-slate-800 text-slate-300'}`}
          >
            {t === 'create' ? 'Create room' : 'Join room'}
          </button>
        ))}
      </div>

      {tab === 'create' ? (
        <div className="panel space-y-4">
          <div>
            <p className="mb-2 text-sm font-semibold text-slate-300">Mode</p>
            <div className="space-y-2">
              {MODES.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setMode(m.id)}
                  className={[
                    'flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left transition',
                    mode === m.id
                      ? 'border-emerald-500 bg-emerald-500/10'
                      : 'border-slate-700 hover:border-slate-600',
                  ].join(' ')}
                >
                  <span>
                    <span className="block font-semibold">{m.label}</span>
                    <span className="block text-xs text-slate-400">{m.blurb}</span>
                  </span>
                  <span className="text-xs text-slate-500">{MODE_PLAYER_COUNT[m.id]} seats</span>
                </button>
              ))}
            </div>
          </div>
          <RuleToggles rules={rules} onChange={setRules} disabled={false} />
        </div>
      ) : (
        <input
          className="field text-center text-2xl font-bold uppercase tracking-[0.4em]"
          placeholder="CODE"
          maxLength={7}
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
        />
      )}

      {error && <p className="text-center text-sm text-rose-400">{error}</p>}

      <button
        type="button"
        className="btn-primary text-lg"
        disabled={busy || !connected}
        onClick={() => void submit()}
      >
        {!connected ? 'Connecting…' : tab === 'create' ? 'Create room' : 'Join room'}
      </button>

      <div className="flex items-center gap-3 text-xs text-slate-600">
        <span className="h-px flex-1 bg-slate-800" />
        or
        <span className="h-px flex-1 bg-slate-800" />
      </div>

      <button type="button" className="btn-secondary" onClick={onTraining}>
        Solo training arena
      </button>
    </div>
  );
}
