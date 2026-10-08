// FixedFloat (ff.io) API v2 client. Every request is signed with
// HMAC-SHA256(body, API secret). In the Android app requests go through
// Capacitor's native HTTP (no CORS, the body string is sent byte-for-byte);
// in a browser, plain fetch.
//
// Credentials: the user's own (Settings, stored in the vault) win over the
// ones built into the app (VITE_FF_KEY / VITE_FF_SECRET at build time).

import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { te } from '../crypto/bytes';
import { ffCredentials } from '../wallet.svelte';

const BASE = 'https://ff.io/api/v2/';

export interface FfCredentials {
	key: string;
	secret: string;
}

export function builtInFf(): FfCredentials | undefined {
	const key = import.meta.env.VITE_FF_KEY as string | undefined;
	const secret = import.meta.env.VITE_FF_SECRET as string | undefined;
	return key && secret ? { key, secret } : undefined;
}

export function ffConfigured(): boolean {
	return !!(ffCredentials() ?? builtInFf());
}

export class FfError extends Error {
	constructor(
		message: string,
		public code?: number,
	) {
		super(message);
	}
}

export async function hmacHex(secret: string, body: string): Promise<string> {
	const key = await crypto.subtle.importKey('raw', te.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
	const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, te.encode(body)));
	return [...sig].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Low-level call; `transport` is injectable for tests. */
export async function ffCall<T>(
	method: string,
	params: object,
	creds: FfCredentials | undefined = ffCredentials() ?? builtInFf(),
	transport: (url: string, headers: Record<string, string>, body: string) => Promise<unknown> = post,
): Promise<T> {
	if (!creds) throw new FfError('No FixedFloat API key. Add one in Settings → Lightning (FixedFloat).');
	const body = JSON.stringify(params);
	const headers = {
		Accept: 'application/json',
		'Content-Type': 'application/json; charset=UTF-8',
		'X-API-KEY': creds.key,
		'X-API-SIGN': await hmacHex(creds.secret, body),
	};
	const reply = (await transport(BASE + method, headers, body)) as { code?: number; msg?: string; data?: T };
	if (!reply || typeof reply !== 'object') throw new FfError('FixedFloat sent an unreadable answer.');
	if (reply.code !== 0) throw new FfError(reply.msg || `FixedFloat error ${reply.code}`, reply.code);
	return reply.data as T;
}

async function post(url: string, headers: Record<string, string>, body: string): Promise<unknown> {
	if (Capacitor.isNativePlatform()) {
		const r = await CapacitorHttp.post({ url, headers, data: body, responseType: 'json', connectTimeout: 15_000, readTimeout: 20_000 });
		return typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
	}
	try {
		const r = await fetch(url, { method: 'POST', headers, body });
		return await r.json();
	} catch {
		// ff.io sends no CORS headers, so browsers block it; the Android app uses native HTTP
		throw new FfError('Lightning payments work in the DarkShell Android app (FixedFloat cannot be reached from a browser).');
	}
}

/* ------------------------------------ API ----------------------------------- */

export interface FfSide {
	code: string;
	network?: string;
	coin?: string;
	amount: string;
	rate?: string;
	precision?: number;
	min?: string;
	max?: string;
	usd?: string;
}

export interface FfPrice {
	from: FfSide;
	to: FfSide;
	/** empty = an order can be created */
	errors: string[];
}

export interface FfOrderSide {
	code: string;
	amount: string;
	address: string;
	tag?: string | null;
	tagName?: string | null;
	addressMix?: string;
	tx?: { id?: string | null; amount?: string | null; confirmations?: number | null } | null;
}

export type FfStatus = 'NEW' | 'PENDING' | 'EXCHANGE' | 'WITHDRAW' | 'DONE' | 'EXPIRED' | 'EMERGENCY';

export interface FfOrder {
	id: string;
	token: string;
	type: 'fixed' | 'float';
	status: FfStatus;
	time: { reg: number; start?: number; finish?: number; update?: number; expiration: number; left: number };
	from: FfOrderSide;
	to: FfOrderSide;
	back?: FfOrderSide;
	emergency?: { status: string[]; choice: 'NONE' | 'EXCHANGE' | 'REFUND'; repeat?: string };
}

/** FixedFloat sends amounts as JSON numbers; keep them as decimal strings. */
function str(v: unknown): string {
	if (typeof v === 'number') return v.toLocaleString('en-US', { useGrouping: false, maximumFractionDigits: 12 });
	return v == null ? '' : String(v);
}

function side<T extends { amount: string; min?: string; max?: string; tag?: string | null; address?: string }>(x: T | undefined): T {
	if (!x) return x as unknown as T;
	return {
		...x,
		amount: str(x.amount),
		...(x.min !== undefined ? { min: str(x.min) } : {}),
		...(x.max !== undefined ? { max: str(x.max) } : {}),
		...(x.tag != null ? { tag: str(x.tag) } : {}),
		...(x.address != null ? { address: str(x.address) } : {}),
	};
}

function order(o: FfOrder): FfOrder {
	return { ...o, id: str(o.id), from: side(o.from), to: side(o.to), ...(o.back ? { back: side(o.back) } : {}) };
}

/** What `amountTo` of `toCcy` costs in `fromCcy` at a fixed rate. */
export async function price(fromCcy: string, toCcy: string, amountTo: string): Promise<FfPrice> {
	const p = await ffCall<FfPrice>('price', { type: 'fixed', fromCcy, toCcy, direction: 'to', amount: Number(amountTo) });
	return { ...p, from: side(p.from), to: side(p.to), errors: p.errors ?? [] };
}

let lastCreate = 0;

/** Creates a fixed-rate order that pays `toAddress` (a bolt11 invoice for BTCLN). */
export async function createOrder(fromCcy: string, toCcy: string, amountTo: string, toAddress: string): Promise<FfOrder> {
	// `create` costs 50 of the 250-per-minute budget; keep well clear of it
	if (Date.now() - lastCreate < 15_000) throw new FfError('Please wait a few seconds before creating another order.');
	lastCreate = Date.now();
	return order(await ffCall<FfOrder>('create', { type: 'fixed', fromCcy, toCcy, direction: 'to', amount: Number(amountTo), toAddress }));
}

export async function getOrder(id: string, token: string): Promise<FfOrder> {
	return order(await ffCall<FfOrder>('order', { id, token }));
}

export function refundOrder(id: string, token: string, address: string, tag?: string): Promise<boolean> {
	return ffCall<boolean>('emergency', { id, token, choice: 'REFUND', address, ...(tag ? { tag } : {}) });
}

/** sats → BTC string with 8 decimals, the unit FixedFloat quotes BTCLN in. */
export function satsToBtc(sats: bigint): string {
	const s = sats.toString().padStart(9, '0');
	return `${s.slice(0, -8)}.${s.slice(-8)}`;
}
