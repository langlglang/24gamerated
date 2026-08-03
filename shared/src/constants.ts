/**
 * Every tunable number in the game lives here. Timers are enforced by the
 * server; the client renders countdowns from server broadcasts but never
 * decides that time is up.
 */

/** Target value a hand must be combined down to. */
export const TARGET_VALUE = 24;

/** Cards dealt per hand. */
export const CARDS_PER_HAND = 4;

/** Combine steps required to reduce 4 cards to 1. */
export const REQUIRED_COMBINE_STEPS = CARDS_PER_HAND - 1;

/** A match is exactly one 52-card deck: 13 hands x 4 cards. */
export const HANDS_PER_MATCH = 13;

/** After buzzing, how long the buzzer has to make their FIRST card click. */
export const BUZZ_START_TIMEOUT_MS = 3_000;

/** From that first click, how long they have to finish combining to one card. */
export const ANSWER_TIMEOUT_MS = 10_000;

/**
 * Wall clock for a whole hand when nobody buzzes and nobody calls no-solution.
 * On expiry the hand is a wash: no points, reveal a solution if one exists.
 */
export const HAND_IDLE_TIMEOUT_MS = 60_000;

/** How long the post-hand result overlay stays up before the next deal. */
export const HAND_RESULT_DISPLAY_MS = 5_000;

/** A disconnected player keeps their seat this long before the room ends. */
export const RECONNECT_GRACE_MS = 60_000;

/** Rooms with no activity at all are garbage-collected after this. */
export const ROOM_IDLE_TIMEOUT_MS = 10 * 60_000;

/** How often the server pushes remaining-time updates to clients. */
export const TIMER_BROADCAST_INTERVAL_MS = 100;

/** Room code shape. Alphabet excludes O/0 and I/1 to avoid misreads. */
export const ROOM_CODE_LENGTH = 6;
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
