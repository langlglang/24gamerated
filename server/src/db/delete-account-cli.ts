import '../env.js';
import { closePool, isDatabaseConfigured, query, queryOne } from './pool.js';

/**
 * `npm run delete-account -- <username or email> [--yes]`
 *
 * Deletes a player's account for a privacy request (see /privacy). Without
 * --yes it only shows what would be deleted. Matches, daily results, follows,
 * challenges and reset links go with it (ON DELETE CASCADE). Their opponents'
 * ratings are left as they are; those matches disappear from the opponents'
 * history too. Any signed-in session of the account stops working at once.
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const confirmed = args.includes('--yes');
  const who = args.find((a) => a !== '--yes')?.trim();
  if (!who) {
    console.error('Usage: npm run delete-account -- <username or email> [--yes]');
    process.exit(1);
  }
  if (!isDatabaseConfigured()) {
    console.error('DATABASE_URL is not set. Put it in .env or the environment first.');
    process.exit(1);
  }

  const user = await queryOne<{ id: string; username: string; email: string; rating: number; rated_games: number; created_at: Date }>(
    `SELECT id, username, email, rating, rated_games, created_at FROM users
      WHERE username_lower = lower($1) OR email_lower = lower($1)`,
    [who],
  );
  if (!user) {
    console.log(`No account with the username or email "${who}". Nothing deleted.`);
    return;
  }

  const counts = await queryOne<{ matches: string; solves: string; follows: string }>(
    `SELECT (SELECT count(*) FROM matches WHERE player_a = $1 OR player_b = $1) AS matches,
            (SELECT count(*) FROM daily_solves WHERE user_id = $1) AS solves,
            (SELECT count(*) FROM follows WHERE follower = $1 OR followee = $1) AS follows`,
    [user.id],
  );

  console.log(`Account:  ${user.username} <${user.email}>`);
  console.log(`Created:  ${user.created_at.toISOString().slice(0, 10)}`);
  console.log(`Rating:   ${user.rating} over ${user.rated_games} rated game(s)`);
  console.log(`Removes:  ${counts?.matches ?? 0} match(es), ${counts?.solves ?? 0} daily solve(s), ${counts?.follows ?? 0} follow link(s)`);

  if (!confirmed) {
    console.log('\nNothing deleted. Run again with --yes to delete this account permanently.');
    return;
  }
  await query('DELETE FROM users WHERE id = $1', [user.id]);
  console.log(`\nDeleted ${user.username}. This cannot be undone.`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => closePool().catch(() => {}));
