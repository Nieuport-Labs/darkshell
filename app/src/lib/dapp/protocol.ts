// What passes between a dApp's page and DarkShell. Every transport (the
// extension's content script, the in-app browser's message channel,
// WalletConnect) carries the same requests as JSON, so bytes and big integers
// travel tagged and come back as what they were.

export const DAPP_CHAIN_ID = 'secret-4';

export type DappMethod =
	| 'enable'
	| 'getKey'
	| 'signDirect'
	| 'signAmino'
	| 'signArbitrary'
	| 'enigma.getPubkey'
	| 'enigma.encrypt'
	| 'enigma.decrypt'
	| 'enigma.getTxEncryptionKey'
	| 'disable';

export interface DappRequest {
	id: string;
	method: DappMethod;
	params: unknown[];
}

export type DappResponse = { id: string; result: unknown } | { id: string; error: string };

/** What a page learns about the connected account (Keplr's `getKey`). */
export interface DappKey {
	name: string;
	algo: 'secp256k1';
	pubKey: Uint8Array;
	address: Uint8Array;
	bech32Address: string;
	isNanoLedger: false;
	isKeystone: false;
}

/** Bytes as `{ $b: base64 }`, bigint as `{ $n: "123" }`, a protobufjs Long as bigint. */
export function encode(v: unknown): unknown {
	if (v instanceof Uint8Array) return { $b: b64(v) };
	if (typeof v === 'bigint') return { $n: v.toString() };
	if (Array.isArray(v)) return v.map(encode);
	if (v && typeof v === 'object') {
		const o = v as Record<string, unknown>;
		if (typeof o.low === 'number' && typeof o.high === 'number' && typeof o.unsigned === 'boolean') return { $n: longToBigInt(o).toString() };
		const out: Record<string, unknown> = {};
		for (const [k, x] of Object.entries(o)) if (x !== undefined && typeof x !== 'function') out[k] = encode(x);
		return out;
	}
	return v;
}

export function decode(v: unknown): unknown {
	if (Array.isArray(v)) return v.map(decode);
	if (v && typeof v === 'object') {
		const o = v as Record<string, unknown>;
		const keys = Object.keys(o);
		if (keys.length === 1 && typeof o.$b === 'string') return unb64(o.$b);
		if (keys.length === 1 && typeof o.$n === 'string') return BigInt(o.$n);
		const out: Record<string, unknown> = {};
		for (const [k, x] of Object.entries(o)) out[k] = decode(x);
		return out;
	}
	return v;
}

function longToBigInt(l: Record<string, unknown>): bigint {
	const lo = BigInt((l.low as number) >>> 0);
	const hi = BigInt(l.high as number);
	return l.unsigned ? (BigInt.asUintN(32, hi) << 32n) | lo : (hi << 32n) | lo;
}

function b64(bytes: Uint8Array): string {
	let s = '';
	for (const b of bytes) s += String.fromCharCode(b);
	return btoa(s);
}

function unb64(s: string): Uint8Array {
	const bin = atob(s);
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
	return out;
}

/** Only https pages (and a local dev server) may connect; the origin is what the user approves. */
export function validOrigin(origin: string): boolean {
	try {
		const u = new URL(origin);
		if (u.origin !== origin) return false;
		return u.protocol === 'https:' || (u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1'));
	} catch {
		return false;
	}
}
