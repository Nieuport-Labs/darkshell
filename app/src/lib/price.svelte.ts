// SCRT price in USD from the Osmosis sidecar query server (public, CORS-open):
// SCRT's IBC denom on Osmosis priced against Osmosis' alloyed USDC. Read when
// the wallet unlocks and every 2 minutes while it is open; the last price is
// kept so the balance has a value at once on the next start.

import { kv } from './storage';

const SCRT_ON_OSMOSIS = 'ibc/0954E1C28EB7AF5B72D24F3BC2B47BBB2FDF91BDDFD57B74B99E133AED40972A';
const URL_ = `https://sqs.osmosis.zone/tokens/prices?base=${SCRT_ON_OSMOSIS}`;
const EVERY_MS = 2 * 60_000;

export const price = $state({ usd: null as number | null, at: 0 });

let timer: ReturnType<typeof setInterval> | undefined;

async function load(): Promise<void> {
	try {
		const r = await fetch(URL_);
		if (!r.ok) return;
		const j = (await r.json()) as Record<string, Record<string, string>>;
		const v = Number(Object.values(j[SCRT_ON_OSMOSIS] ?? {})[0]);
		if (!Number.isFinite(v) || v <= 0) return;
		price.usd = v;
		price.at = Date.now();
		await kv.set('price.scrt', { usd: v, at: price.at });
	} catch {
		/* offline: keep the last price */
	}
}

export function startPrice(): void {
	if (timer) return;
	void kv.get<{ usd: number; at: number }>('price.scrt').then((c) => {
		if (c && price.usd === null) Object.assign(price, c);
	});
	void load();
	timer = setInterval(() => void load(), EVERY_MS);
}

export function stopPrice(): void {
	clearInterval(timer);
	timer = undefined;
}

/** "$1,234.56" for an amount in base units (6 decimals); small values keep more digits. */
export function usdValue(base: bigint | null, usd = price.usd): string | null {
	if (base === null || usd === null) return null;
	const v = (Number(base) / 1e6) * usd;
	const digits = v !== 0 && v < 1 ? 4 : 2;
	return v.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: digits });
}
