# 24 Online

Real-time multiplayer **24**: four cards, combine them with `+ − × ÷` using each exactly once to
make 24. Room-code matchmaking, four game modes, and a solo training arena.

A match is exactly one 52-card deck — **13 hands of 4 cards** — so no physical card repeats within
a match (four of the same rank can still land together, e.g. 7♠ 7♥ 7♦ 7♣). Ties at the top after
hand 13 go to sudden-death hands from a freshly shuffled deck.

When a match ends, **the room stays open**. The host can start another match with the same players,
and the room keeps a running **series tally** of matches won across all of them.

---

## Quick start

Requires Node 20+ (developed on Node 24).

```bash
npm install
npm run dev
```

`npm run dev` builds the shared package, then runs the API on **:3000** and Vite on **:5173**.
Open <http://localhost:5173>. Vite proxies `/socket.io` to the server, so the client is always
same-origin and CORS never comes into it.

To play across devices on your LAN, run `npm run build && npm start` and hit `http://<your-ip>:3000`.

### Other commands

| Command | What it does |
| --- | --- |
| `npm test` | Unit tests for the solver, validator, rationals, and scoring |
| `npm run build` | Builds shared → client → server |
| `npm start` | Runs the built server, which also serves the built client |
| `npm run smoke` | End-to-end check against a running server (see below) |
| `npm run typecheck` | Typechecks every workspace |

---

## Layout

```
shared/    deck, exact-rational arithmetic, solver, validator, scoring, wire protocol
server/    Socket.IO server, room registry, authoritative game state machine
client/    React + Vite + Tailwind UI, plus the offline training arena
scripts/   end-to-end smoke test
```

`shared/` is the single source of truth for game rules. The server imports it, and so does the
training arena — so solo practice and a real match can never disagree about what counts as a legal
move.

---

## Rules

### The two toggles

Set by the host in the lobby, independent, giving four combinations. Both apply to gameplay **and**
to the solver's verdict, so a cached solvability result is only valid for the rules it was computed
under.

- **Fractions ON/OFF** — ON allows non-integer intermediates, so `8 / (3 − 8/3) = 24` solves 3 3 8 8.
  OFF makes any division that doesn't divide evenly an illegal move.
- **Negatives ON/OFF** — ON allows intermediates below zero. OFF blocks any step producing a
  negative value, so `3 − 8` is refused.

All arithmetic is exact rational (integer numerator/denominator), never floating point. Division by
zero is always illegal.

#### A finding worth knowing about the negatives toggle

The test suite scans all 1820 distinct 4-card multisets from a 1–13 deck and asserts a result that
came out of building this:

> **Allowing negative intermediates never makes an unsolvable hand solvable** — under either
> fractions setting. Solvable counts are identical: 1362 with fractions, 1346 without.

So the negatives toggle is a **difficulty knob, not a solvability knob**. With negatives OFF the
server refuses negative combines, so a player can't travel a route that dips below zero and has to
find another one — but it never changes the right answer to a "no solution" call.

The fractions toggle *does* change solvability, for exactly **16 hands**:

```
1 3 4 6 · 1 4 5 6 · 1 5 5 5 · 1 6 6 8 · 1 8 12 12 · 2 2 11 11 · 2 2 13 13 · 2 3 5 12
2 4 10 10 · 2 5 5 10 · 2 7 7 10 · 3 3 7 7 · 3 3 8 8 · 4 4 7 7 · 5 5 7 11 · 5 7 7 11
```

That this matches the documented set for a 1–13 deck is a useful independent check on the solver.

### Hand flow

1. Four cards are revealed to everyone at once.
2. Any eligible player may **Buzz** or **Call No Solution**.
3. **Buzz** → the buzzer has **5 s** to touch their first card, then **10 s** from that first touch
   to combine down to one card. Everyone else's input is locked while they answer.
4. **Call No Solution** → correct if the hand genuinely has none; otherwise it costs them.
5. A result overlay shows who scored and, when the hand was solvable, one valid solution.
6. If nobody acts at all, a **120 s** hand clock expires and the hand is a wash — no points, solution
   revealed, next hand. (Not in the original spec; added so an AFK player can't freeze a match.)

There is no undo. Once two cards are combined the move stands, so a misclick costs you the hand —
part of the pressure.

### Scoring

**2-player** — buzz correct: +1 buzzer. Buzz failed: +1 opponent, hand ends. No-solution correct:
+1 caller. No-solution wrong: +1 opponent.

**3-player** — buzz correct: +1 buzzer, hand ends. Buzz failed: the buzzer is locked out and the
hand *continues* for the other two on the same cards. If a second player also buzzes and fails, the
hand ends immediately and **the point is auto-awarded to the player who stayed out** — they never
have to buzz to collect it, and this holds whether or not the hand was solvable. No-solution call
when nobody has buzzed yet — correct: +1 caller; wrong: **0.5 to each** of the other two.
No-solution call after someone has already buzzed and failed — correct: +1 caller; wrong: +1 to the
player who neither buzzed nor called.

Because two failed buzzes end the hand, a no-solution caller can face at most one locked-out
opponent, and no hand can reach a third buzz.

**4-player (2v2)** — like 2-player but scored per team; any member may act for their team, and a
team's failed attempt ends the hand.

**Solo training** — no scoring; tracks hands played, buzzes, solve rate, average solve time, and
no-solution call accuracy.

---

## Architecture notes

**The server is authoritative.** Deck, dealt cards, solver verdict, timers, buzz arbitration, and
scoring all live server-side. Clients send intents (`buzz`, `callNoSolution`, `combine`) and
render the state they're sent. The solver verdict for the live hand is never included in the state
sent to clients — that would give away whether "no solution" is the right call.

**Buzz arbitration** is first-message-wins: the handler flips the room to `answering` synchronously
before any await, so a second buzz that arrives a millisecond later is rejected with `too-late`.

**Answers are combine steps, not typed expressions.** Each step is `(cardA, operator, cardB)`
referencing card ids on the table. The id of a combine's result is derived from the step index
server-side, so a client can't forge or collide ids. The server applies steps as they stream in and
then re-validates the whole sequence from the dealt cards when the table reaches one card.

**The solver enumerates combine sequences, not expression strings.** That matters: with fractions or
negatives OFF, legality is defined per intermediate step, so "solvable" has to mean "reachable by
three legal combines". Both the solver and the validator route every step through the same
`computeCombine`, so they cannot drift apart. A test asserts every solution the solver returns
replays cleanly through the validator.

**Timers** are enforced by the server. Clients interpolate between broadcasts for a smooth
countdown but never decide that time is up.

**Disconnects** pause the room with a `waiting for player` state; the seat is held for 60 s and
reclaimed via the same room code (the client stores its player id in `localStorage`, so a refresh
also gets the seat back). After the grace period the room closes. Dropping mid-answer is resolved as
a failed attempt *before* pausing, so disconnecting is never a way to escape a bad buzz.

**Matches are a series.** Finishing a match leaves the room in `match-result` with per-match scores
reset but a `series.wins` tally that persists. The host's *Play again* reshuffles a fresh deck and
deals hand 1; it is refused while any player is disconnected, since a match with an absent seat
deals hands nobody can answer.

Rooms are in-memory and ephemeral; idle ones are swept after 10 minutes.

---

## Configuration

Every tunable lives in `shared/src/constants.ts`:

| Constant | Default |
| --- | --- |
| `BUZZ_START_TIMEOUT_MS` | 5 000 |
| `ANSWER_TIMEOUT_MS` | 10 000 |
| `HAND_IDLE_TIMEOUT_MS` | 120 000 |
| `HAND_RESULT_DISPLAY_MS` | 5 000 |
| `RECONNECT_GRACE_MS` | 60 000 |
| `ROOM_IDLE_TIMEOUT_MS` | 600 000 |
| `HANDS_PER_MATCH` | 13 |
| `ROOM_CODE_LENGTH` / `ROOM_CODE_ALPHABET` | 6 / no `O`,`0`,`I`,`1` |

Server env vars: `PORT` (default 3000), `NODE_ENV`, `DEV_CLIENT_ORIGIN`.

---

## Testing

```bash
npm test          # 52 unit tests
npm run smoke     # end-to-end, needs a server running
```

Unit tests cover exact rational arithmetic, the solver under **all four rule combinations**, the
validator's rejection paths (division by zero, non-integer with fractions OFF, negative with
negatives OFF, reused card, unknown card, wrong step count, complete-but-not-24), and every
3-player scoring edge case including the 0.5/0.5 split.

The smoke test drives two real socket clients through create → join → start → buzz → solve, and
asserts the round locks to the buzzer, a second buzz is refused, the score moves, and the solver
verdict is not leaked in the state payload:

```bash
npm run build && npm start      # terminal 1
npm run smoke                   # terminal 2
```

---

## Deploying

One process serves everything:

```bash
npm ci --include=dev
npm run build
NODE_ENV=production PORT=3000 npm start
```

Any host that runs a long-lived Node process with WebSocket support works. Two rules apply
everywhere:

- **`--include=dev` at install time.** With `NODE_ENV=production` set, npm skips devDependencies —
  which is where `typescript` and `vite` live — and the build dies with `vite: not found`.
- **Exactly one instance.** Rooms are in-memory, so a second instance would serve players who
  cannot see each other. No autoscaling. Scaling out means adding sticky sessions plus a shared
  room store first.

### Render

`render.yaml` in the repo root is a Blueprint, so there is no form to fill in:

1. Push to GitHub.
2. Render dashboard → **New → Blueprint** → pick the repo → **Apply**.
3. Wait for the first build, then open the `*.onrender.com` URL.

Every later `git push` to `main` redeploys automatically.

The free plan sleeps after 15 minutes of inactivity. A sleeping service loses all in-memory rooms
and takes roughly 50 seconds to wake, so a match interrupted by sleep is gone. Upgrade the service
to a paid instance type to stay warm for real play.

Render injects `PORT`; the server already reads it.

---

## Known gaps

- **Resume after a pause** returns the hand to open play with a fresh idle clock rather than
  restoring the exact remaining time.
- No spectator seats beyond the players in the room, no bots or substitutes for dropped players,
  and no persistence — all deliberate, per the spec.
