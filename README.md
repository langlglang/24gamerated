# 24 Rated

Real-time multiplayer **24**: four cards, combine them with `+ − × ÷` using each exactly once to
make 24. Accounts with **Elo ratings**, 1v1 **ranked matchmaking**, and **rated friend challenges** —
on top of the original guest room-code game, four game modes, and a solo training arena.

> Built on top of [24gameonline](https://github.com/langlglang/24gameonline), which stays as the
> unrated game. That repo is still `upstream` here, so fixes can flow forward.
>
> **Everything unrated still works exactly as before** — guest rooms need no account and no
> database. If `DATABASE_URL` is unset the server runs guest-only and simply hides the rated
> surface, rather than failing.

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
cp .env.example .env      # then fill in DATABASE_URL and JWT_SECRET
npm run dev
```

**`.env` is optional.** Without it you get the full guest game — rooms, all four modes, training —
just no accounts, ratings, or matchmaking. With it, migrations run automatically on boot and the
rated surface switches on.

Get a free Postgres connection string from [Neon](https://neon.tech) (no card, no expiry). Generate
a secret with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

`npm run dev` builds the shared package, then runs the API on **:3000** and Vite on **:5173**.
Open <http://localhost:5173>. Vite proxies `/socket.io` to the server, so the client is always
same-origin and CORS never comes into it.

To play across devices on your LAN, run `npm run build && npm start` and hit `http://<your-ip>:3000`.

### Other commands

| Command | What it does |
| --- | --- |
| `npm test` | Unit tests for the solver, validator, rationals, scoring, and Elo |
| `npm run build` | Builds shared → client → server |
| `npm start` | Runs the built server, which also serves the built client |
| `npm run migrate` | Applies database migrations (the server also does this on boot) |
| `npm run smoke` | End-to-end check of guest play against a running server |
| `npm run smoke -- --rated` / `node scripts/smoke-rated.mjs` | End-to-end check of the rated surface |
| `npm run typecheck` | Typechecks every workspace |

---

## Rated play

Sign in, and three things unlock. Everything rated is **1v1 only**.

**Ranked queue.** Press *Play ranked* and the matchmaker looks for someone within ±100 rating. The
window widens by 50 every 5 seconds up to ±1200, and **both** players must find the gap acceptable —
so a fresh arrival is never dragged into a lopsided game just because someone else has waited a long
time. A quiet queue still matches eventually.

**Friend challenges.** Type a username, they get an invite. Accepting starts a rated match
immediately. Challenges are rated exactly like ranked games; they just skip the queue. The target
has to be online, and unanswered invites expire after 10 minutes.

**Ratings.** Standard Elo, starting at **1200**:

| | |
| --- | --- |
| First 30 games | K=40 — provisional, rating moves fast while it settles |
| After that | K=24 |
| Rating ≥ 2400 | K=16 — slower churn at the top |
| Floor | 100 — a losing streak cannot spiral forever |

A decided game always moves the rating by at least 1 point (rounding is away from zero), and the
exchange is zero-sum: what the winner gains, the loser loses. Both sides are computed from the
ratings held *before* the match, so order of processing cannot change the outcome.

### Rated matches use one fixed ruleset

Rated play is always **fractions ON, negatives ON**. Ratings earned under easier and harder rulesets
are not the same skill, so a single pool keeps the number meaningful. Guest rooms keep the full rule
toggles.

### A rated match is one match

No rematch button. Another rated game means requeuing or a fresh challenge — so both players
consent to putting their rating up again. The series tally is a guest-room feature.

---

## Layout

```
shared/         deck, exact-rational arithmetic, solver, validator, scoring,
                Elo, wire protocol
server/
  db/           Postgres pool, embedded migrations, users/matches/challenges
  auth/         bcrypt hashing, JWT sessions, REST routes
  room.ts       authoritative game state machine (rated and unrated)
  matchmaking.ts  rating-banded queue
client/         React + Vite + Tailwind UI, plus the offline training arena
scripts/        end-to-end smoke tests (guest and rated)
```

`shared/` is the single source of truth for game rules. The server imports it, and so does the
training arena — so solo practice and a real match can never disagree about what counts as a legal
move. Elo lives there too, kept pure and dependency-free so it can be tested exhaustively without a
database.

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

### Rated internals

**Ratings are computed from pre-match values.** `recordRatedMatch` takes both players' rows as read
at the end of the match and writes the match row plus both rating updates in **one transaction**, so
a crash cannot record a game without moving the ratings, or vice versa.

**Recording a rated match never affects the game.** The match has already finished correctly by the
time the rating layer runs, so persistence failures are logged and swallowed rather than thrown.
Players see "Recording your rating…" instead of a broken result screen.

**In rated rooms, seat id = user id.** No extra mapping, and a reconnect lands the right account
back in the right seat.

**Sessions are stateless JWTs**, presented on REST calls via `Authorization` and on the socket
handshake via `auth.token`, so both transports agree on who you are. The tradeoff: a token cannot be
revoked before it expires. Fine for a game leaderboard; anything touching payments would want
server-side sessions.

**Passwords** are bcrypt at cost 10. Login failures return one message whether the account exists or
not, so the endpoint cannot be used to enumerate accounts, and repeated failures are throttled per
IP + identifier.

**Case-insensitive uniqueness for email and username is enforced by unique indexes**, not by app
code, so two simultaneous signups cannot both succeed.

The queue is in memory like rooms. Accounts, ratings, and match history are in Postgres and survive
restarts, redeploys, and sleep.

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

Elo constants live in `shared/src/elo.ts` (`STARTING_RATING`, `PROVISIONAL_GAMES`, the three
K-factors, `RATING_FLOOR`); matchmaking bands live in `server/src/matchmaking.ts`.

| Env var | Required? | What it does |
| --- | --- | --- |
| `DATABASE_URL` | For rated play | Postgres connection string. Unset ⇒ guest-only mode. |
| `JWT_SECRET` | **In production** | Signs session tokens; 16+ chars. Dev generates a throwaway. |
| `PORT` | No | Defaults to 3000. |
| `NODE_ENV` | No | `production` tightens CORS and requires `JWT_SECRET`. |
| `DEV_CLIENT_ORIGIN` | No | Vite origin allowed in dev. |

---

## Testing

```bash
npm test                        # 72 unit tests
npm run build && npm start      # terminal 1
npm run smoke                   # terminal 2 — guest play
node scripts/smoke-rated.mjs    # terminal 2 — rated play (needs DATABASE_URL)
```

Unit tests cover exact rational arithmetic, the solver under **all four rule combinations**, the
validator's rejection paths (division by zero, non-integer with fractions OFF, negative with
negatives OFF, reused card, unknown card, wrong step count, complete-but-not-24), every 3-player
scoring edge case including the 0.5/0.5 split, and Elo — symmetry, zero-sum exchange, K-factor
tiers, the rating floor, order independence, and that a long series stays bounded.

**`npm run smoke`** drives two socket clients through create → join → start → buzz → solve, and
asserts the round locks to the buzzer, a second buzz is refused, the score moves, and the solver
verdict is not leaked in the state payload. It passes with `DATABASE_URL` unset, which is how
guest-only mode stays honest.

**`scripts/smoke-rated.mjs`** registers throwaway accounts and checks the rated path end to end:
duplicate usernames rejected, wrong passwords rejected, match history requires a token, a friend
challenge reaches the target and starts a match, the matchmaker pairs two queued players, a full
13-hand ranked match runs, and the resulting Elo change is non-zero, zero-sum, correctly signed, and
written through to `/api/auth/me`, match history, and the leaderboard. It leaves its test accounts
behind on purpose.

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
- **Exactly one instance.** Live rooms and the matchmaking queue are in-memory, so a second instance
  would serve players who cannot see each other. No autoscaling. Scaling out means adding sticky
  sessions plus a shared room/queue store first. (Accounts, ratings, and history are in Postgres and
  are safe either way.)
- **Set `JWT_SECRET`.** The server refuses to start signing tokens without it in production.

### Render

`render.yaml` in the repo root is a Blueprint, so there is no form to fill in:

1. Create a free Postgres database at [Neon](https://neon.tech) and copy the connection string.
2. Push to GitHub.
3. Render dashboard → **New → Blueprint** → pick the repo → **Apply**.
4. Render prompts for **`DATABASE_URL`** — paste the Neon string. It generates `JWT_SECRET` itself.
5. Wait for the first build, then open the `*.onrender.com` URL.

Migrations run automatically on boot, so there is no separate deploy step for the schema.

Every later `git push` to `main` redeploys automatically.

The free plan sleeps after 15 minutes of inactivity. A sleeping service loses all in-memory rooms
and takes roughly 50 seconds to wake, so a match interrupted by sleep is gone. Upgrade the service
to a paid instance type to stay warm for real play.

Render injects `PORT`; the server already reads it.

---

## Known gaps

- **Resume after a pause** returns the hand to open play with a fresh idle clock rather than
  restoring the exact remaining time.
- No spectator seats beyond the players in the room, and no bots or substitutes for dropped players.

### Rated play specifically

- **Abandoning a rated match does not forfeit it.** Dropping mid-answer costs that hand, and after
  the reconnect grace the room closes — but with no `match-result` there is no Elo change either, so
  a player losing badly can currently rage-quit to avoid the loss. Fixing it properly means deciding
  what an abandonment is worth, which is a game-design call rather than a bug.
- **Sessions cannot be revoked** before their 30-day expiry, since they are stateless JWTs.
- **No password reset.** Emails are collected so it can be added, but there is no mail service
  wired up, so a forgotten password currently needs a new account.
- **No email verification**, so signups are not proof of a real address.
- **The queue is per-instance.** Two instances would maintain two separate queues that never see
  each other — another reason for the single-instance rule.
- **Ranked is 1v1 only.** Rated 3-player and team play would each need their own rating pool and a
  different rating model; the Elo here assumes two sides.
