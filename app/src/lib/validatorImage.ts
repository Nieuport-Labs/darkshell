// Validator pictures from Keybase. A validator's on-chain `identity` is a
// Keybase key suffix; Keplr and the explorers resolve it the same way (the
// endpoint allows CORS). After Secret_Dashboard `src/lib/validatorImage.ts`.
// Answers (a picture or none) are kept for 30 days, so a list of validators
// costs one lookup each per month.

import { kv } from './storage';

const LOOKUP = 'https://keybase.io/_/api/1.0/user/lookup.json';
const TTL_MS = 30 * 86_400_000;
const KEY = 'validator.images';

type Cache = Record<string, { url: string | null; at: number }>;

let cache: Promise<Cache> | null = null;
const inFlight = new Map<string, Promise<string | null>>();

function load(): Promise<Cache> {
	return (cache ??= kv.get<Cache>(KEY).then((c) => c ?? {}).catch(() => ({})));
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;
function save(c: Cache) {
	clearTimeout(saveTimer);
	saveTimer = setTimeout(() => void kv.set(KEY, c).catch(() => {}), 1000);
}

/** The picture URL for a Keybase identity, or null when it has none. */
export async function validatorImage(identity: string | undefined): Promise<string | null> {
	const id = identity?.trim();
	if (!id) return null;
	const c = await load();
	const hit = c[id];
	if (hit && Date.now() - hit.at < TTL_MS) return hit.url;
	const pending = inFlight.get(id);
	if (pending) return pending;
	const p = (async () => {
		try {
			const r = await fetch(`${LOOKUP}?key_suffix=${encodeURIComponent(id)}&fields=pictures`, { signal: AbortSignal.timeout(10_000) });
			if (!r.ok) return hit?.url ?? null;
			const j = (await r.json()) as { them?: Array<{ pictures?: { primary?: { url?: string } } } | null> | null };
			const url = j.them?.[0]?.pictures?.primary?.url;
			const safe = url && url.startsWith('https://') ? url : null;
			c[id] = { url: safe, at: Date.now() };
			save(c);
			return safe;
		} catch {
			// offline or blocked: try again next time
			return hit?.url ?? null;
		} finally {
			inFlight.delete(id);
		}
	})();
	inFlight.set(id, p);
	return p;
}
