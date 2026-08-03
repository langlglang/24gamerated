import { useState } from 'react';
import { Game } from './screens/Game.js';
import { Home } from './screens/Home.js';
import { Lobby } from './screens/Lobby.js';
import { Training } from './screens/Training.js';
import { useGame } from './useGame.js';

export default function App() {
  const game = useGame();
  const [training, setTraining] = useState(false);

  if (training) return <Training onExit={() => setTraining(false)} />;

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

      {!state ? (
        <Home
          connected={game.connected}
          onCreate={game.createRoom}
          onJoin={game.joinRoom}
          onTraining={() => setTraining(true)}
        />
      ) : state.phase === 'lobby' ? (
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
          onBuzz={game.buzz}
          onCallNoSolution={game.callNoSolution}
          onCombine={game.combine}
          onPlayAgain={game.playAgain}
          onLeave={game.leave}
        />
      )}
    </div>
  );
}
