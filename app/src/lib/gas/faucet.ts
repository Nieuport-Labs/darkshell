// First use without any SCRT: a fee-grant faucet (SecretSaturn/FeeGrantFaucet2.0,
// `GET /claim/<address>`) grants the address a small fee allowance, which pays
// the fee of the first gas-credit refill — bought straight from sSCRT.
//
// The faucet sends no CORS headers, so the app calls it through native HTTP
// (Capacitor); in a browser the call only works if the faucet allows it.

import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { FAUCET_URL } from '../config';
import { addrKey, kv } from '../storage';

/** the faucet hands out one grant a day per address */
const COOLDOWN_MS = 24 * 3600_000;

export class FaucetError extends Error {}

export function faucetConfigured(): boolean {
	return !!FAUCET_URL;
}

/** When this address last asked the faucet (0 = never). */
export async function lastClaim(address: string): Promise<number> {
	return (await kv.get<number>(addrKey('faucet.at', address))) ?? 0;
}

/**
 * Asks the faucet for a fee grant. Resolves once the faucet answered with a
 * grant (it may take a block to show up on chain); throws FaucetError otherwise.
 */
export async function claimFaucet(address: string): Promise<void> {
	if (!FAUCET_URL) throw new FaucetError('No faucet is configured.');
	if (Date.now() - (await lastClaim(address)) < COOLDOWN_MS) throw new FaucetError('The faucet was already used today.');
	const url = `${FAUCET_URL.replace(/\/+$/, '')}/claim/${encodeURIComponent(address)}`;
	let status: number;
	let data: unknown;
	try {
		if (Capacitor.isNativePlatform()) {
			const r = await CapacitorHttp.get({ url, connectTimeout: 30_000, readTimeout: 60_000 });
			status = r.status;
			data = r.data;
		} else {
			const r = await fetch(url);
			status = r.status;
			data = await r.json().catch(() => null);
		}
	} catch (e) {
		throw new FaucetError(`The faucet could not be reached (${e instanceof Error ? e.message : String(e)}).`);
	}
	const body = (typeof data === 'string' ? safeJson(data) : data) as { feegrant?: unknown; error?: unknown } | null;
	if (status !== 200 || !body?.feegrant) {
		const why = body?.error ? (typeof body.error === 'string' ? body.error : JSON.stringify(body.error)) : `HTTP ${status}`;
		throw new FaucetError(`The faucet did not grant fees (${why}).`);
	}
	await kv.set(addrKey('faucet.at', address), Date.now());
}

function safeJson(s: string): unknown {
	try {
		return JSON.parse(s);
	} catch {
		return null;
	}
}
