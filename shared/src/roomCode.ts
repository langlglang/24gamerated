import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from './constants.js';
import type { RandomFn } from './cards.js';

/**
 * Room codes use an alphabet with no O/0 and no I/1, because players read
 * these aloud and type them from memory.
 */
export function generateRoomCode(random: RandomFn = Math.random): string {
  let code = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    code += ROOM_CODE_ALPHABET[Math.floor(random() * ROOM_CODE_ALPHABET.length)]!;
  }
  return code;
}

/** Uppercase and strip anything not in the alphabet, so "abc-def" still works. */
export function normalizeRoomCode(input: string): string {
  return input
    .toUpperCase()
    .split('')
    .filter((ch) => ROOM_CODE_ALPHABET.includes(ch))
    .join('');
}

export function isValidRoomCode(input: string): boolean {
  return normalizeRoomCode(input).length === ROOM_CODE_LENGTH;
}
