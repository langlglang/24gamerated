/**
 * Migrations are embedded as strings rather than .sql files so the compiled
 * server in dist/ is self-contained — nothing to copy at build time and
 * nothing to resolve at runtime.
 *
 * Append new migrations; never edit an applied one.
 */
export interface Migration {
  readonly name: string;
  readonly sql: string;
}

export const MIGRATIONS: readonly Migration[] = [
  {
    name: '001_accounts_and_ratings',
    sql: `
      CREATE TABLE IF NOT EXISTS users (
        id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        email          text NOT NULL,
        email_lower    text GENERATED ALWAYS AS (lower(email)) STORED,
        username       text NOT NULL,
        username_lower text GENERATED ALWAYS AS (lower(username)) STORED,
        password_hash  text NOT NULL,
        rating         integer NOT NULL DEFAULT 1200,
        rated_games    integer NOT NULL DEFAULT 0,
        wins           integer NOT NULL DEFAULT 0,
        losses         integer NOT NULL DEFAULT 0,
        draws          integer NOT NULL DEFAULT 0,
        created_at     timestamptz NOT NULL DEFAULT now(),
        last_seen_at   timestamptz NOT NULL DEFAULT now()
      );

      -- Case-insensitive uniqueness enforced by the database, not by app code,
      -- so two concurrent signups cannot both win.
      CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_key ON users (email_lower);
      CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_key ON users (username_lower);
      CREATE INDEX IF NOT EXISTS users_rating_idx ON users (rating DESC, rated_games DESC);

      CREATE TABLE IF NOT EXISTS matches (
        id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        kind             text NOT NULL CHECK (kind IN ('ranked', 'challenge')),
        player_a         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        player_b         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        score_a          numeric(5,1) NOT NULL,
        score_b          numeric(5,1) NOT NULL,
        winner           uuid REFERENCES users(id) ON DELETE SET NULL,
        rating_a_before  integer NOT NULL,
        rating_b_before  integer NOT NULL,
        rating_a_after   integer NOT NULL,
        rating_b_after   integer NOT NULL,
        went_to_tiebreak boolean NOT NULL DEFAULT false,
        played_at        timestamptz NOT NULL DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS matches_player_a_idx ON matches (player_a, played_at DESC);
      CREATE INDEX IF NOT EXISTS matches_player_b_idx ON matches (player_b, played_at DESC);

      CREATE TABLE IF NOT EXISTS challenges (
        id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        from_user    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        to_user      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        status       text NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending','accepted','declined','cancelled','expired')),
        room_code    text,
        created_at   timestamptz NOT NULL DEFAULT now(),
        responded_at timestamptz,
        CONSTRAINT challenge_not_self CHECK (from_user <> to_user)
      );

      CREATE INDEX IF NOT EXISTS challenges_to_user_idx ON challenges (to_user, status, created_at DESC);
      CREATE INDEX IF NOT EXISTS challenges_from_user_idx ON challenges (from_user, status, created_at DESC);
    `,
  },
];
