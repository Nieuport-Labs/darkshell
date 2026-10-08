// Wrong-PIN throttling. Argon2id already makes every guess cost a couple of
// seconds; on top of that, after 5 wrong PINs the app makes you wait 30 s,
// doubling each time (max 1 h). Nothing is ever wiped.

import { kv } from '../storage';

const FREE_TRIES = 5;
const BASE_MS = 30_000;
const MAX_MS = 60 * 60_000;

interface State {
	fails: number;
	until: number;
}

async function read(): Promise<State> {
	return (await kv.get<State>('unlock.lockout')) ?? { fails: 0, until: 0 };
}

/** Milliseconds left before the next attempt is allowed (0 = go ahead). */
export async function waitMs(now = Date.now()): Promise<number> {
	return Math.max(0, (await read()).until - now);
}

export function delayFor(fails: number): number {
	if (fails < FREE_TRIES) return 0;
	return Math.min(MAX_MS, BASE_MS * 2 ** (fails - FREE_TRIES));
}

export async function recordFailure(now = Date.now()): Promise<number> {
	const s = await read();
	const fails = s.fails + 1;
	const delay = delayFor(fails);
	await kv.set('unlock.lockout', { fails, until: now + delay });
	return delay;
}

export async function resetFailures(): Promise<void> {
	await kv.del('unlock.lockout');
}
