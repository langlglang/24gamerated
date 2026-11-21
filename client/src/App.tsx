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

/** Each screen has its own address, so refresh and the back button work. */
const PATHS: Record<Screen, string> = {
  home: '/',
  auth: '/signin',
  ranked: '/ranked',
  training: '/practice',
  daily: '/daily',
};

function screenFromPath(pathname: string): Screen {
  const clean = pathname.replace(/\/+$/, '') || '/';
  const hit = (Object.keys(PATHS) as Screen[]).find((s) => PATHS[s] === clean);
  return hit ?? 'home';
}

/** A shared /room/CODE link, read once on load. */
const ROOM_PATH = /^\/room\/([A-Za-z0-9]{4,8})\/?$/;
const initialRoomCode =
  typeof window === 'undefined'
    ? null
    : (ROOM_PATH.exec(window.location.pathname)?.[1]?.toUpperCase() ?? null);

export default function App() {
  const auth = useAuth();
  const game = useGame(auth.token);
  const [screen, setScreen] = useState<Screen>(() => screenFromPath(window.location.pathname));
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

  // Keep the address bar in step with what's on screen. In a room or match
  // the URL is /room/CODE; elsewhere it's the screen's own path.
  const roomCode = game.state?.roomCode ?? null;
  useEffect(() => {
    if (resetToken) return;
    const path = roomCode ? `/room/${roomCode}` : PATHS[screen];
    if (window.location.pathname === path) return;
    // Leaving a /room/ address before the game state has loaded (e.g. on a
    // refresh) replaces it rather than stacking history entries.
    const replace = !roomCode && ROOM_PATH.test(window.location.pathname);
    window.history[replace ? 'replaceState' : 'pushState'](null, '', path);
  }, [screen, roomCode, resetToken]);

  // Back / forward buttons.
  useEffect(() => {
    const onPop = () => setScreen(screenFromPath(window.location.pathname));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // Opening /ranked while signed out goes to sign-in, then back to ranked.
  useEffect(() => {
    if (screen === 'ranked' && !auth.loading && !auth.user) {
      setAfterAuth('ranked');
      setScreen('auth');
    }
  }, [screen, auth.loading, auth.user]);

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
  if (screen === 'training' && !game.state) return <Training onExit={() => setScreen('home')} />;
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
          initialJoinCode={initialRoomCode}
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
