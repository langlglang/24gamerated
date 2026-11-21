import express from 'express';
import {
  dailyKey,
  dailyNumber,
  isDailyKey,
  isDailyRecordList,
  previousDailyKey,
  scoreDaily,
  type DailyFriendView,
  type DailyResultView,
  type DailyTodayView,
} from '@24game/shared';
import { requireAuth, requireDatabase, type AuthedRequest } from '../auth/routes.js';
import {
  follow,
  friendsDaily,
  getDailyResult,
  saveDailyResult,
  unfollow,
  type DailyResultRow,
} from '../db/daily.js';
import { findByUsername } from '../db/users.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toView(row: DailyResultRow): DailyResultView {
  return { correct: row.correct, timeMs: row.time_ms, hands: row.hands };
}

async function todayView(userId: string, day: string): Promise<DailyTodayView> {
  const [mine, friends] = await Promise.all([getDailyResult(userId, day), friendsDaily(userId, day)]);
  return {
    day,
    number: dailyNumber(day),
    mine: mine ? toView(mine) : null,
    friends: friends.map(
      (f): DailyFriendView => ({
        userId: f.id,
        username: f.username,
        played: f.correct !== null,
        // No peeking at a friend's score before you have played yourself.
        result:
          mine && f.correct !== null && f.time_ms !== null && f.hands
            ? { correct: f.correct, timeMs: f.time_ms, hands: f.hands }
            : null,
        record: { wins: Number(f.wins), losses: Number(f.losses), ties: Number(f.ties) },
      }),
    ),
  };
}

/**
 * Daily 24 and follows. Every route needs an account: guests can still play
 * the daily (the deck is derived from the date on the client), they just
 * cannot save or compare.
 */
export function createDailyRouter(): express.Router {
  const router = express.Router();
  router.use(express.json({ limit: '32kb' }));

  router.get('/daily/today', requireDatabase, requireAuth, async (req: AuthedRequest, res) => {
    try {
      res.json(await todayView(req.user!.id, dailyKey()));
    } catch (err) {
      console.error('[daily] today failed:', err);
      res.status(500).json({ error: 'Could not load today’s daily.' });
    }
  });

  router.post('/daily/submit', requireDatabase, requireAuth, async (req: AuthedRequest, res) => {
    const day: unknown = req.body?.day;
    const records: unknown = req.body?.hands;
    const today = dailyKey();
    // Yesterday is accepted too, so a run that started before midnight UTC
    // still counts for the day it was dealt.
    if (!isDailyKey(day) || (day !== today && day !== previousDailyKey(today))) {
      res.status(400).json({ error: 'That daily is closed. Today’s is ready to play.' });
      return;
    }
    if (!isDailyRecordList(records)) {
      res.status(400).json({ error: 'That result could not be read. Play the daily again tomorrow.' });
      return;
    }
    try {
      const score = scoreDaily(day, records);
      const saved = await saveDailyResult(req.user!.id, day, score);
      if (!saved) {
        res.status(409).json({ error: 'You already played this daily. Your first result stands.' });
        return;
      }
      res.json(await todayView(req.user!.id, day));
    } catch (err) {
      console.error('[daily] submit failed:', err);
      res.status(500).json({ error: 'Could not save your result. Try again in a moment.' });
    }
  });

  router.post('/friends', requireDatabase, requireAuth, async (req: AuthedRequest, res) => {
    const username: unknown = req.body?.username;
    if (typeof username !== 'string' || !username.trim()) {
      res.status(400).json({ error: 'Enter your friend’s username.', field: 'username' });
      return;
    }
    try {
      const friend = await findByUsername(username.trim());
      if (!friend) {
        res.status(404).json({ error: `No player called “${username.trim()}”.`, field: 'username' });
        return;
      }
      if (friend.id === req.user!.id) {
        res.status(400).json({ error: 'That’s you. Add someone else.', field: 'username' });
        return;
      }
      await follow(req.user!.id, friend.id);
      res.json(await todayView(req.user!.id, dailyKey()));
    } catch (err) {
      console.error('[daily] follow failed:', err);
      res.status(500).json({ error: 'Could not add that friend. Try again in a moment.' });
    }
  });

  router.delete('/friends/:userId', requireDatabase, requireAuth, async (req: AuthedRequest, res) => {
    const friendId = String(req.params['userId']);
    if (!UUID.test(friendId)) {
      res.status(400).json({ error: 'That friend could not be found.' });
      return;
    }
    try {
      await unfollow(req.user!.id, friendId);
      res.json(await todayView(req.user!.id, dailyKey()));
    } catch (err) {
      console.error('[daily] unfollow failed:', err);
      res.status(500).json({ error: 'Could not remove that friend. Try again in a moment.' });
    }
  });

  return router;
}
