// SCRT price in USD from the Osmosis sidecar query server (public, CORS-open):
// SCRT's IBC denom on Osmosis priced against Osmosis' alloyed USDC. Read when
// the wallet unlocks and every 2 minutes while it is open; the last price is
// kept so the balance has a value at once on the next start.
//
// Shown in the currency chosen at setup (settings.currency): USD as is, EUR
// and CZK through the ECB's daily rates (Frankfurter, public and CORS-open,
// asked once a day and only when a currency other than USD is chosen).

import { kv } from './storage';
import { locale } from './i18n/index.svelte';

export type Fiat = 'USD' | 'EUR' | 'CZK';
export const FIATS: { code: Fiat; symbol: string; name: string }[] = [
	{ code: 'EUR', symbol: '€', name: 'Euro' },
	{ code: 'CZK', symbol: 'Kč', name: 'Koruna' },
	{ code: 'USD', symbol: '$', name: 'Dollar' },
];

const FX_URL = 'https://api.frankfurter.dev/v1/latest?base=USD&symbols=EUR,CZK';
const FX_MAX_AGE = 24 * 3600_000;

/** the chosen currency and how many of it one US dollar buys */
export const fiat = $state({ code: 'USD' as Fiat, perUsd: 1 as number | null });

let fx: { EUR?: number; CZK?: number; at: number } = { at: 0 };

async function loadFx(): Promise<void> {
	if (fiat.code === 'USD' || Date.now() - fx.at < FX_MAX_AGE) return applyFx();
	try {
		const r = await fetch(FX_URL);
		if (r.ok) {
			const j = (await r.json()) as { rates?: { EUR?: number; CZK?: number } };
			if (j.rates?.EUR && j.rates.CZK) {
				fx = { EUR: j.rates.EUR, CZK: j.rates.CZK, at: Date.now() };
				await kv.set('price.fx', fx);
			}
		}
	} catch {
		/* offline: keep the last rate */
	}
	applyFx();
}

function applyFx() {
	fiat.perUsd = fiat.code === 'USD' ? 1 : (fx[fiat.code] ?? null);
}

/** Reads the chosen currency (and the last rates) at start. */
export async function loadFiat(): Promise<void> {
	const [code, cached] = await Promise.all([kv.get<Fiat>('settings.currency'), kv.get<typeof fx>('price.fx')]);
	if (cached) fx = cached;
	if (code && FIATS.some((f) => f.code === code)) fiat.code = code;
	void loadFx();
}

export async function setFiat(code: Fiat): Promise<void> {
	fiat.code = code;
	await kv.set('settings.currency', code);
	await loadFx();
}

/** One SCRT in the chosen currency, or null while unknown. */
export function scrtFiat(): number | null {
	return price.usd === null || fiat.perUsd === null ? null : price.usd * fiat.perUsd;
}

/** "1 234,56 Kč" for a number in the chosen currency. */
export function formatFiat(v: number, digits = 2): string {
	return v.toLocaleString(locale(), { style: 'currency', currency: fiat.code, minimumFractionDigits: 2, maximumFractionDigits: Math.max(2, digits) });
}

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
	void loadFx();
	timer = setInterval(() => (void load(), void loadFx()), EVERY_MS);
}

export function stopPrice(): void {
	clearInterval(timer);
	timer = undefined;
}

/** "$1,234.56" / "1 234,56 Kč" for an amount of SCRT in base units (6 decimals); small values keep more digits. */
export function fiatValue(base: bigint | null, usd = price.usd): string | null {
	if (base === null || usd === null || fiat.perUsd === null) return null;
	const v = (Number(base) / 1e6) * usd * fiat.perUsd;
	return formatFiat(v, v !== 0 && v < 1 ? 4 : 2);
}
