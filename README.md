# 24 Rated

Real-time multiplayer **24**: four cards, combine them with `+ − × ÷` using each exactly once to
make 24. Accounts with **Elo ratings**, 1v1 **ranked matchmaking**, and **rated friend challenges** —
on top of the original guest room-code game, free-for-all rooms for 2 to 10 players, 2v2 teams, and a solo training arena.

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

**Accounts.** Register with an email, a username, and the password typed twice. *Forgot password?*
emails a reset link that works once, for 30 minutes; opening it shows a *Choose a new password*
screen and signs you straight in. Email needs `RESEND_API_KEY`, `MAIL_FROM`, and `APP_URL` (see
[Configuration](#configuration)); in dev without them the link is printed to the server console.

**Ranked queue.** Press *Play ranked* and the matchmaker looks for someone within ±100 rating. The
window widens by 50 every 5 seconds up to ±1200, and **both** players must find the gap acceptable —
so a fresh arrival is never dragged into a lopsided game just because someone else has waited a long
time. A quiet queue still matches eventually.

**Friend challenges.** Type a username, they get an invite. Accepting starts a rated match
immediately. Challenges are rated exactly like ranked games; they just skip the queue. The target
has to be online and not already in a game, and unanswered invites expire after 10 minutes (checked
when someone answers, not just by the periodic sweep). New challenges are limited to 5 per 30 s and
20 per 10 minutes per sender (refused with `rate-limited` while the cap is reached), and attempts of
any kind to 30 a minute, and there is at most one pending challenge per pair of players.
Accepting claims the challenge in the database first, so a double tap or two tabs start one match.

**Ratings.** Standard Elo, starting at **1200**:

| | |
| --- | --- |
| First 30 games | K=40 — provisional, rating moves fast while it settles |
| After that | K=24 |
| Rating ≥ 2400 | K=16 — slower churn at the top |
| Floor | 100 — a losing streak cannot spiral forever |

A decided game always moves the rating by at least 1 point (rounding is away from zero). Each side's
change is computed with **its own** K-factor from the ratings both players held *before* the match,
so order of processing cannot change the outcome. The exchange is zero-sum only when both players
have the same K-factor and neither is held up by the floor: a provisional player (K=40) beating an
established one (K=24) gains more than the other loses, and a player at 100 loses nothing more.
Rounding away from zero on both sides can also add a point.

### Rated matches use one fixed ruleset

Rated play is always **fractions OFF, negatives OFF**. Ratings earned under easier and harder
rulesets are not the same skill, so a single pool keeps the number meaningful. Guest rooms and
practice start with both OFF too, and the toggles turn them on. The Daily 24 is the exception: it
always plays with both ON.

### A rated match is one match

No rematch button. Another rated game means requeuing or a fresh challenge — so both players
consent to putting their rating up again. The series tally is a guest-room feature.

### Leaving a rated match is a loss

Leaving mid-match — *Leave*, signing out, or creating/joining another room — loses the match by
forfeit straight away. A dropped connection gets the usual 60 s to come back (the match resumes as
if nothing happened); if it does not, that is a forfeit too. The player who stayed wins and gets
the result screen and rating change at once. Ratings move exactly as for a normal result: the
current scores are recorded, but the winner is whoever stayed, even if the leaver was ahead. The
match row is marked `forfeit`, and the result carries it (`matchResult.forfeitedBy`,
`ratedResult.forfeit`, `forfeit` in match history) so the client can say "… left — you win by
forfeit". If both players are gone when the grace runs out, nothing is recorded: no contest, and
nobody is penalised.

---

## Daily puzzle

One puzzle a day, the same for everyone. Solve time is the only measure.

- **The puzzle.** 5 cards Monday–Thursday, 6 cards Friday–Sunday (UTC). Combine them with + − × ÷,
  every card used exactly once, to hit a 3-digit target. The deal comes from the UTC date
  (`dailyPuzzle` in `shared/src/puzzle.ts`); the target is picked by an exhaustive search so it is
  always reachable but has only a few solutions. A new puzzle arrives at midnight UTC.
- **Unlimited retries.** Wrong answers cost nothing but time. There is no score beyond the time.
- **The curve.** After solving you see a distribution curve of everyone's solve times for the day
  (log-scale buckets; a time on a bucket edge belongs to the bucket that starts there), the median,
  and the share of other solvers you were faster than. With nobody else in the pool there is no
  percentage: the screen says you're the first to solve and the share text leaves it out.
- **Server-measured time, always.** Every `GET /api/daily/puzzle`, guest or signed in, returns a
  `startTicket`: an HMAC (key derived from `JWT_SECRET`) over the day and the issue time
  (`server/src/daily/ticket.ts`). The client keeps the first ticket of the day with its local run
  and sends it with the solve. A signed-in fetch also records when the account first opened the
  puzzle (`daily_starts`). On solve, the stored time is now minus the earliest trustworthy start:
  the earlier of the account's recorded start and a valid ticket's issue time for that day. The
  client's claimed `timeMs` is ignored. Because the ticket travels with the run, a guest who signs in
  halfway through is timed from when they really began. A guest who finishes posts the solve to
  `POST /api/daily/guest-solve`, which checks it and returns a signed receipt (start and finish);
  after signing in the client posts that receipt (before its signed-in fetch), and the stored time
  ends at the receipt's finish, so time spent on the sign-in form doesn't count.
- **No start, no count.** With neither a recorded start nor a valid ticket for that day, the solve is
  refused (400, `code: 'no-start'`) and not stored, so it never reaches the curve. Under 3 s of
  server-measured time is refused (`code: 'too-fast'`; the client may retry, which only measures
  longer); over 24 h (only possible on yesterday's puzzle) is recorded as 24 h. The first correct
  solve stands.
- **Never cached.** Puzzle responses are `Cache-Control: private, no-store` (each carries its own
  ticket, and a cached copy could outlive midnight UTC); the client fetches with `cache: 'no-store'`.
- **Test accounts** (`@example.test`, any subdomain, trailing dot allowed) are left out of the curve
  and solver count; they still see where their own time would place.

API: `GET /api/daily/puzzle` (no account needed; returns `{ day, number, cards, target, startTicket }`;
with a bearer token it also starts your account's clock), `POST /api/daily/solve` (account; today's
or yesterday's puzzle; body `{ day, steps, startTicket, solveReceipt? }`; refusals carry `code`: `closed`,
`bad-steps`, `not-target`, `no-start` are final, `too-fast` is not), `GET /api/daily/stats?day=`
(public; includes your own time and faster-than % when signed in, `fasterThanPct: null` when nobody
else has solved), `POST /api/daily/guest-solve` (no account; body `{ day, steps, startTicket }`;
returns `{ timeMs, solveReceipt }`; stores nothing). Tables: `daily_solves` (migration `004`) and `daily_starts` (migration `005`).
The old 13-hand daily's `daily_results` and `follows` tables are left in place, unused.

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

**Free-for-all (2 to 10 players)** — one rule set for any table size. "Still in" means every
other player who has not already buzzed and failed this hand.

- Buzz correct: +1 buzzer, hand ends.
- Buzz failed on a hand with **no solution**: **+1 to everyone still in**, hand ends. The buzzer
  claimed a 24 that does not exist.
- Buzz failed on a **solvable** hand: the buzzer is locked out and the hand continues for everyone
  else on the same cards. When only one player is still in, the hand ends and that player gets the
  point without having to buzz.
- No-solution call correct: +1 caller. Wrong: **+1 to everyone still in**.

With two players every failure gives the opponent the point, which is the classic head-to-head rule.

**4-player (2v2)** — like head-to-head but scored per team; any member may act for their team, and a
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

**Disconnects** pause the room with a `waiting for player` state; the seat is held for 60 s. After
the grace period the room closes. Dropping mid-answer is resolved as a failed attempt *before*
pausing, so disconnecting is never a way to escape a bad buzz. Someone *else* dropping does not
cancel a buzz either: the answer in progress is frozen and resumes (with a fresh answer window) when
everyone is back. Open play resumes on the hand clock that was left, with a 15 s floor.

**Seats are claimed with a secret.** Player ids are public (they are in every state broadcast), so
creating or joining a room also returns a per-seat `reconnectToken` that only that player gets. The
client keeps both in `localStorage`; `room:join` with `playerId` + `reconnectToken` reclaims the
seat after a refresh. Without the right token the request is refused. If the seat is still held by
another live socket, the newest connection wins and the old one gets `seatReplaced` (that is the
same player's new tab or refresh; refusing would lock them out of their own seat until the old
socket times out). New seats always get a server-chosen id. A socket holds at most one seat:
creating or joining another room leaves the current one first.

**Host.** The host role moves to a connected player whenever the host leaves a lobby or a finished
match. During a paused match the host keeps the role, since the game cannot continue (or reach a
host-only screen) until every seat is back. When a player leaves a finished guest match their seat
is freed (at once for *Leave*, after the 60 s grace for a dropped connection); if too few players are
left for another match, the room returns to the lobby so others can join with the same code.

**Abuse limits.** Failed joins are limited per socket (10 a minute) and per IP (60 a minute), which
stops room-code guessing; room creation is limited too. Rooms whose players have all gone stop being
"active" (only player actions count, not timers), and seats whose socket is gone are dropped by the
minute sweep, so abandoned rooms close instead of dealing sudden death forever.

**Matches are a series.** Finishing a match leaves the room in `match-result` with per-match scores
reset but a `series.wins` tally that persists. The host's *Play again* reshuffles a fresh deck and
deals hand 1; it is refused while any player is disconnected, since a match with an absent seat
deals hands nobody can answer.

Rooms are in-memory and ephemeral; idle ones are swept after 10 minutes.

### Rated internals

**Ratings are read under a row lock.** `recordRatedMatch` locks both players' rows
(`SELECT … FOR UPDATE`, in id order) inside **one transaction**, computes the Elo change from the
ratings read there, and writes the match row plus both rating updates in that same transaction. Two
matches finishing at once for the same player are applied one after the other, never over each
other, and a crash cannot record a game without moving the ratings, or vice versa.

**One live game per player.** Queueing, sending and accepting challenges are refused while the player
(or, for challenges, the opponent) is seated in any game still being played, guest rooms included and
in any tab. A finished rated room only shows the result; it does not count, and its sockets leave it
when the next match starts. The queue entry belongs to the tab that queued: closing or signing out in
another tab does not drop it.

**Socket sign-in is checked like REST.** A token on the socket handshake is only trusted after the
account lookup and password-version check `auth:identify` does; the socket's events wait until that
has settled.

**Recording a rated match never affects the game.** The match has already finished correctly by the
time the rating layer runs, so persistence failures are logged and swallowed rather than thrown.
Players see "Recording your rating…" instead of a broken result screen.

**In rated rooms, seat id = user id.** No extra mapping. Only a socket signed in as that user can
reclaim the seat, and rejoining a finished rated room re-sends that player's `ratedResult`.

**Sessions are stateless JWTs**, presented on REST calls via `Authorization` and on the socket
handshake via `auth.token`, so both transports agree on who you are. The tradeoff: a token cannot be
revoked before it expires. Fine for a game leaderboard; anything touching payments would want
server-side sessions.

**Passwords** are bcrypt at cost 10, from 8 characters up to 72 **bytes** of UTF-8. bcrypt ignores
everything past byte 72, so a longer new password is refused rather than silently cut short (72
plain characters, fewer with accents or emoji). Accounts created before the limit still sign in with
their full password. Login failures return one message whether the account exists or not, and an
unknown account is still checked against a dummy bcrypt hash of the same cost, so neither the reply
nor its timing can be used to enumerate accounts. Repeated failures are throttled per IP +
identifier. The auth endpoints accept only JSON strings in their fields (an array or object gets a
400 instead of being coerced), and an email or login name containing control characters is
rejected before it reaches the database.

**Password resets** follow the same rule: `POST /api/auth/forgot` answers identically whether or not
the email has an account, and replies *before* the lookup and the email send, so response time
cannot give it away either. It is throttled per IP (10 an hour), then per address (5 an hour).
A request already blocked per IP does not count against the address, so a blocked sender cannot use
up someone else's quota. A sender with many IPs can still exhaust one address's hourly quota, but
each of its requests mails the real owner a working link (the newest stays valid for 30 minutes), so
that is a nuisance, not a takeover. The server sets `trust proxy` so the IP is the player's, not Render's proxy. Requesting a new link
cancels earlier ones. Tokens are 32 random bytes; only their
SHA-256 is stored (`password_resets`, migration `003_password_resets`, applied on boot), so a
database leak yields no working links. A token expires after 30 minutes, is spent by
`POST /api/auth/reset`, and spending one voids every other outstanding link for that account. Links
are built from `APP_URL`, never from the request's `Host` header, so a forged Host cannot point a
victim's email at another site.

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
| `RESEND_API_KEY` | For reset emails | [Resend](https://resend.com) API key. Mail is sent only when this and `MAIL_FROM` are both set. |
| `MAIL_FROM` | For reset emails | Sender, e.g. `24 Rated <no-reply@yourdomain.com>`, on a domain verified in Resend. |
| `APP_URL` | **In production** | Public base URL for links in emails, e.g. `https://two4gamerated.onrender.com`. Dev falls back to the Vite origin. |

Without mail configured, development prints each email (link included) to the server console.
Production sends nothing and logs an error, but `/api/auth/forgot` still answers the same way, so
the gap is invisible to players — check the logs after setting it up.

### Setting up email

1. Create an account at [Resend](https://resend.com) and an API key with sending access.
2. Verify a sending domain (Resend → Domains, then add the DNS records it lists). For a quick test,
   Resend's onboarding sender `onboarding@resend.dev` works without a domain, but only delivers to
   your own Resend account address.
3. On Render, set `RESEND_API_KEY`, `MAIL_FROM`, and `APP_URL` in the service's **Environment**
   tab and redeploy.

---

## Testing

```bash
npm test                        # unit tests (shared + server)
npm run build && npm start      # terminal 1
npm run smoke                   # terminal 2 — guest play
node scripts/smoke-seats.mjs    # terminal 2 — seat tokens, one seat per socket, pauses
node scripts/smoke-rated.mjs    # terminal 2 — rated play (needs DATABASE_URL)
```

> **Never run the rated smoke test against the production database.** It creates real accounts and
> real rated matches in whatever `DATABASE_URL` the server uses. If your `.env` holds the production
> Neon string, a local run writes test accounts into production — that is how `smoke_a_…` /
> `smoke_b_…` accounts ended up on the live leaderboard. Point the server at a separate database
> first: a [Neon branch](https://neon.tech/docs/introduction/branching) or a local Postgres.

Unit tests cover exact rational arithmetic, the solver under **all four rule combinations**, the
validator's rejection paths (division by zero, non-integer with fractions OFF, negative with
negatives OFF, reused card, unknown card, wrong step count, complete-but-not-24), every 3-player
scoring edge case including the 0.5/0.5 split, score maps that stay correct for any player id
(even `__proto__`), and Elo — symmetry, zero-sum exchange between equal K-factors, K-factor tiers,
the rating floor, order independence, and that a long series stays bounded. Server tests
(`server/src/*.test.ts`, fake timers) cover seat tokens, pause/resume of an answer in progress, the
resumed hand clock, host handoff, sudden-death numbering, idle/ghost-room handling, queue ownership
and the rate limiter.

**`npm run smoke`** drives two socket clients through create → join → start → buzz → solve, and
asserts the round locks to the buzzer, a second buzz is refused, the score moves, and the solver
verdict is not leaked in the state payload. It passes with `DATABASE_URL` unset, which is how
guest-only mode stays honest.

**`scripts/smoke-seats.mjs`** checks guest seats over real sockets: a public player id alone cannot
take a seat, the reconnect token reclaims it (and the old socket gets `seatReplaced`), client-chosen
ids are ignored, one socket holds one seat, someone else dropping does not cancel a buzz, and failed
joins are throttled. Run it last against a server you are also testing by hand: it trips the
failed-join limit for its own socket.

**`scripts/smoke-rated.mjs`** registers throwaway accounts and checks the rated path end to end:
duplicate usernames rejected, wrong passwords rejected, match history requires a token, a friend
challenge reaches the target and starts a match, the matchmaker pairs two queued players, a full
13-hand ranked match runs, and the resulting Elo change is non-zero, zero-sum, correctly signed, and
written through to `/api/auth/me`, match history, and the leaderboard. It then checks the multi-tab and
one-live-game rules: a refresh on the result screen gets the rating result again, a finished rated
room does not block the queue but a guest seat does, closing another tab keeps the queue entry, a
double-tapped accept starts one match, and a player in a live match cannot be challenged or queue. It leaves its test accounts
behind on purpose. They use `@example.test` emails, which the public leaderboard filters out — a
safety net, not a reason to aim it at production.

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
   It also asks for `RESEND_API_KEY`, `MAIL_FROM`, and `APP_URL`; leave them blank to skip reset
   emails for now (see [Setting up email](#setting-up-email)).
5. Wait for the first build, then open the `*.onrender.com` URL.

Migrations run automatically on boot, so there is no separate deploy step for the schema.

Every later `git push` to `main` redeploys automatically.

The free plan sleeps after 15 minutes of inactivity. A sleeping service loses all in-memory rooms
and takes roughly 50 seconds to wake, so a match interrupted by sleep is gone. Upgrade the service
to a paid instance type to stay warm for real play.

Render injects `PORT`; the server already reads it.

---

## Known gaps

- No spectator seats beyond the players in the room, and no bots or substitutes for dropped players.
- **Rate-limited room requests reuse an existing error** (`wrong-phase`, "not available right now"),
  because a new rejection code needs a client release first. Challenges get `rate-limited`.
- **No Content-Security-Policy header yet.** The other security headers are set; a CSP needs testing
  against the Vite build and Google Fonts first.

### Rated play specifically

- **Sessions cannot be revoked individually** before their 30-day expiry, since they are stateless
  JWTs. Changing the password does sign out every other session: each token carries a short
  fingerprint of the password hash (`pwv`), checked on REST calls and socket sign-in. A socket
  that is already connected keeps its session until it reconnects. Tokens issued before this
  shipped have no fingerprint and stay valid until they expire.
- **No email verification**, so signups are not proof of a real address.
- **The queue is per-instance.** Two instances would maintain two separate queues that never see
  each other — another reason for the single-instance rule.
- **Ranked is 1v1 only.** Rated 3-player and team play would each need their own rating pool and a
  different rating model; the Elo here assumes two sides.
