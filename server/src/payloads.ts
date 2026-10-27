import { MODE_PLAYER_COUNT, OPS } from '@24game/shared';

/**
 * Shape checks for everything a client can send. The handlers in index.ts
 * trust their typed payloads, but types vanish at runtime and anyone can open
 * a socket by hand — a `null` payload or a missing ack would otherwise throw
 * inside a handler and take the whole process (and every live room) down.
 * A well-behaved client never fails these, so failures are simply dropped.
 */

type Check = (args: unknown[]) => boolean;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const isString = (v: unknown): v is string => typeof v === 'string';
const isOptionalString = (v: unknown): boolean => v === undefined || isString(v);
const isFunction = (v: unknown): boolean => typeof v === 'function';

const isGameMode = (v: unknown): boolean => isString(v) && Object.hasOwn(MODE_PLAYER_COUNT, v);

const isRuleSet = (v: unknown): boolean =>
  isObject(v) && typeof v['fractions'] === 'boolean' && typeof v['negatives'] === 'boolean';

const isCombineStep = (v: unknown): boolean =>
  isObject(v) &&
  isString(v['aId']) &&
  isString(v['bId']) &&
  (OPS as readonly unknown[]).includes(v['op']);

/** A payload object as the first argument, checked by `fields`. */
const payload =
  (fields: (p: Record<string, unknown>) => boolean): Check =>
  ([p]) =>
    isObject(p) && fields(p);

/** As `payload`, plus a callable ack as the second argument. */
const payloadWithAck =
  (fields: (p: Record<string, unknown>) => boolean): Check =>
  ([p, ack]) =>
    isObject(p) && fields(p) && isFunction(ack);

const anything: Check = () => true;

const CHECKS: Readonly<Record<string, Check>> = {
  'room:create': payloadWithAck((p) => isString(p['name']) && isGameMode(p['mode']) && isRuleSet(p['rules'])),
  'room:join': payloadWithAck(
    (p) => isString(p['name']) && isString(p['roomCode']) && isOptionalString(p['playerId']),
  ),
  'room:configure': payload(
    (p) => (p['mode'] === undefined || isGameMode(p['mode'])) && (p['rules'] === undefined || isRuleSet(p['rules'])),
  ),
  'room:setTeam': payload((p) => isString(p['playerId']) && (p['team'] === 'A' || p['team'] === 'B')),
  'room:start': anything,
  'room:leave': anything,
  'game:buzz': anything,
  'game:callNoSolution': anything,
  'game:combine': payload((p) => isCombineStep(p['step'])),
  'game:playAgain': anything,
  'auth:identify': payloadWithAck((p) => isString(p['token'])),
  'auth:signOut': anything,
  'queue:join': ([ack]) => isFunction(ack),
  'queue:leave': anything,
  'challenge:send': payloadWithAck((p) => isString(p['username'])),
  'challenge:respond': payloadWithAck((p) => isString(p['id']) && typeof p['accept'] === 'boolean'),
  'challenge:cancel': payload((p) => isString(p['id'])),
};

/** True when an incoming event has the arguments its handler expects. */
export function isWellFormed(event: unknown, args: unknown[]): boolean {
  if (!isString(event)) return false;
  const check = CHECKS[event];
  // Events nobody listens for are harmless; let Socket.IO ignore them.
  return check ? check(args) : true;
}
