import { useEffect, useState } from 'react';
import { Auth } from './screens/Auth.js';
import { Daily } from './screens/Daily.js';
import { ResetPassword } from './screens/ResetPassword.js';

const RESET_KEY = '24game.resetToken';

/**
 * Token from an emailed reset link (?reset=...). It is moved out of the
 * address bar immediately, so it never sits in history, gets synced, or is
 * shared by copying the URL; sessionStorage keeps it across a reload.
 */
function readResetToken(): string | null {
  try {
    const url = new URL(window.location.href);
    const fromUrl = url.searchParams.get('reset');
    if (fromUrl) {
      sessionStorage.setItem(RESET_KEY, fromUrl);
      url.searchParams.delete('reset');
      window.history.replaceState(null, '', url.pathname + url.search + url.hash);
      return fromUrl;
    }
    return sessionStorage.getItem(RESET_KEY);
  } catch {
    return null;
  }
}

function clearResetToken(): void {
  try {
    sessionStorage.removeItem(RESET_KEY);
  } catch {
    // Nothing stored.
  }
}
import { Game } from './screens/Game.js';
import { Home } from './screens/Home.js';
import { Lobby } from './screens/Lobby.js';
import { Ranked } from './screens/Ranked.js';
import { Training } from './screens/Training.js';
import { useAuth } from './useAuth.js';
import { useGame } from './useGame.js';

type Screen = 'home' | 'auth' | 'ranked' | 'training' | 'daily';

export default function App() {
  const auth = useAuth();
  const game = useGame(auth.token);
  const [screen, setScreen] = useState<Screen>('home');
  /** Where to land after signing in. */
  const [afterAuth, setAfterAuth] = useState<Screen>('ranked');
  const [resetToken, setResetToken] = useState<string | null>(readResetToken);
  const [authView, setAuthView] = useState<'login' | 'forgot'>('login');

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

  if (resetToken) {
    return (
      <ResetPassword
        auth={auth}
        token={resetToken}
        onDone={() => {
          clearResetToken();
          setResetToken(null);
          setScreen('home');
        }}
        onRequestNew={() => {
          clearResetToken();
          setResetToken(null);
          setAfterAuth('home');
          setAuthView('forgot');
          setScreen('auth');
        }}
        onCancel={() => {
          clearResetToken();
          setResetToken(null);
          setScreen('home');
        }}
      />
    );
  }
  if (screen === 'training') return <Training onExit={() => setScreen('home')} />;
  if (screen === 'daily' && !game.state) {
    return (
      <Daily
        auth={auth}
        onExit={() => setScreen('home')}
        onSignIn={() => {
          setAfterAuth('daily');
          setScreen('auth');
        }}
      />
    );
  }

  const { state } = game;

  return (
    <div className="min-h-full">
      {game.notice && (
        <button
          type="button"
          onClick={game.clearNotice}
          className="fixed inset-x-0 top-0 z-30 bg-bad px-4 py-2 text-center text-sm font-semibold text-white"
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
        <div className="fixed inset-x-0 top-0 z-30 bg-mark px-4 py-2 text-center text-sm font-semibold text-ink">
          {game.challenges[0]!.fromUsername} challenged you
          <button
            type="button"
            className="ml-3 min-h-[44px] rounded-full bg-ink px-4 text-paper"
            onClick={() => void game.respondChallenge(game.challenges[0]!.id, true)}
          >
            Accept
          </button>
          <button
            type="button"
            className="ml-2 min-h-[44px] rounded-full border-2 border-ink px-4 text-ink"
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
        <Auth
          key={authView}
          auth={auth}
          initialView={authView}
          onDone={() => {
            setAuthView('login');
            setScreen(afterAuth);
          }}
          onCancel={() => {
            setAuthView('login');
            setScreen(afterAuth === 'daily' ? 'daily' : 'home');
          }}
        />
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
          onDaily={() => setScreen('daily')}
          onRanked={() => {
            setAfterAuth('ranked');
            setScreen(auth.user ? 'ranked' : 'auth');
          }}
        />
      )}
    </div>
  );
}
