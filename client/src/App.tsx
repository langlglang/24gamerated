import { useEffect, useState } from 'react';
import { Auth } from './screens/Auth.js';
import { Game } from './screens/Game.js';
import { Home } from './screens/Home.js';
import { Lobby } from './screens/Lobby.js';
import { Ranked } from './screens/Ranked.js';
import { Training } from './screens/Training.js';
import { useAuth } from './useAuth.js';
import { useGame } from './useGame.js';

type Screen = 'home' | 'auth' | 'ranked' | 'training';

export default function App() {
  const auth = useAuth();
  const game = useGame(auth.token);
  const [screen, setScreen] = useState<Screen>('home');

  // The socket is the authority on the player's record once connected, so a
  // rating change mid-session flows straight back into the auth cache.
  const { profile } = game;
  const { setUser } = auth;
  useEffect(() => {
    if (profile) setUser(profile);
  }, [profile, setUser]);

  // A found match takes over the screen; nobody wants to still be looking at
  // the queue while their opponent is already buzzing.
  useEffect(() => {
    if (game.matchFound) setScreen('home');
  }, [game.matchFound]);

  if (screen === 'training') return <Training onExit={() => setScreen('home')} />;

  const { state } = game;

  return (
    <div className="min-h-full">
      {game.notice && (
        <button
          type="button"
          onClick={game.clearNotice}
          className="fixed inset-x-0 top-0 z-30 bg-rose-600 px-4 py-2 text-center text-sm font-semibold text-white"
        >
          {game.notice} — tap to dismiss
        </button>
      )}

      {/*
        An incoming challenge has to be visible from anywhere, not just the
        ranked screen — otherwise a friend's invite goes unanswered while you
        sit on the home page.
      */}
      {!state && screen !== 'ranked' && game.challenges.length > 0 && (
        <div className="fixed inset-x-0 top-0 z-30 bg-amber-500 px-4 py-2 text-center text-sm font-semibold text-slate-950">
          {game.challenges[0]!.fromUsername} challenged you
          <button
            type="button"
            className="ml-3 rounded bg-slate-950 px-3 py-1 text-white"
            onClick={() => void game.respondChallenge(game.challenges[0]!.id, true)}
          >
            Accept
          </button>
          <button
            type="button"
            className="ml-2 rounded bg-slate-800 px-3 py-1 text-white"
            onClick={() => void game.respondChallenge(game.challenges[0]!.id, false)}
          >
            Decline
          </button>
        </div>
      )}

      {state ? (
        state.phase === 'lobby' ? (
          <Lobby
            state={state}
            selfId={game.playerId}
            onConfigure={game.configure}
            onSetTeam={game.setTeam}
            onStart={game.start}
            onLeave={game.leave}
          />
        ) : (
          <Game
            state={state}
            selfId={game.playerId}
            combineError={game.combineError}
            ratedResult={game.ratedResult}
            opponent={game.matchFound?.opponent ?? null}
            onBuzz={game.buzz}
            onCallNoSolution={game.callNoSolution}
            onCombine={game.combine}
            onPlayAgain={game.playAgain}
            onLeave={() => {
              game.dismissRatedResult();
              game.leave();
            }}
          />
        )
      ) : screen === 'auth' ? (
        <Auth auth={auth} onDone={() => setScreen('ranked')} onCancel={() => setScreen('home')} />
      ) : screen === 'ranked' ? (
        <Ranked game={game} auth={auth} onBack={() => setScreen('home')} />
      ) : (
        <Home
          connected={game.connected}
          user={game.profile ?? auth.user}
          authLoading={auth.loading}
          onCreate={game.createRoom}
          onJoin={game.joinRoom}
          onTraining={() => setScreen('training')}
          onRanked={() => setScreen(auth.user ? 'ranked' : 'auth')}
        />
      )}
    </div>
  );
}
