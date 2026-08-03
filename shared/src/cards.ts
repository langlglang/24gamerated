import { CARDS_PER_HAND, HANDS_PER_MATCH } from './constants.js';

export type Suit = 'S' | 'H' | 'D' | 'C';

export const SUITS: readonly Suit[] = ['S', 'H', 'D', 'C'];

export const SUIT_SYMBOL: Readonly<Record<Suit, string>> = {
  S: '♠',
  H: '♥',
  D: '♦',
  C: '♣',
};

export const SUIT_IS_RED: Readonly<Record<Suit, boolean>> = {
  S: false,
  H: true,
  D: true,
  C: false,
};

export interface Card {
  /** Stable per-deck identity, e.g. "S7". Steps reference cards by id. */
  readonly id: string;
  /** 1..13. Ace = 1, J = 11, Q = 12, K = 13. Suits are cosmetic. */
  readonly rank: number;
  readonly suit: Suit;
}

/** "A", "2".."10", "J", "Q", "K" — display only; math always uses `rank`. */
export function rankLabel(rank: number): string {
  switch (rank) {
    case 1:
      return 'A';
    case 11:
      return 'J';
    case 12:
      return 'Q';
    case 13:
      return 'K';
    default:
      return String(rank);
  }
}

export function buildDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (let rank = 1; rank <= 13; rank++) {
      deck.push({ id: `${suit}${rank}`, rank, suit });
    }
  }
  return deck;
}

export type RandomFn = () => number;

/** Fisher-Yates. Takes an injectable RNG so tests can be deterministic. */
export function shuffle<T>(items: readonly T[], random: RandomFn = Math.random): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const a = out[i]!;
    const b = out[j]!;
    out[i] = b;
    out[j] = a;
  }
  return out;
}

/**
 * Slice a shuffled deck into the match's hands. Dealing off the top of one
 * deck is what guarantees no physical card repeats within a match — though
 * four cards of the same rank can still land together (7S 7H 7D 7C).
 */
export function dealHands(deck: readonly Card[], hands = HANDS_PER_MATCH): Card[][] {
  const needed = hands * CARDS_PER_HAND;
  if (deck.length < needed) {
    throw new Error(`deck of ${deck.length} cannot deal ${hands} hands`);
  }
  const out: Card[][] = [];
  for (let h = 0; h < hands; h++) {
    out.push(deck.slice(h * CARDS_PER_HAND, (h + 1) * CARDS_PER_HAND));
  }
  return out;
}

/** A freshly shuffled match's worth of hands. */
export function dealMatch(random: RandomFn = Math.random): Card[][] {
  return dealHands(shuffle(buildDeck(), random));
}
