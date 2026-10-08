// SNIP-52 private notifications for sSCRT, client side.
//
// sSCRT tags every execution with encrypted attributes. A transfer *to us*
// carries `snip52:<id>` where id = HMAC-SHA256(seed, "recvd:" + TXHASH) and
// only we (and the contract) know the seed. Batch transfers set a bit in the
// `snip52:#multirecvd` bloom filter instead. Nobody else can tell which, if
// any, of the attributes are ours.
//
// Spec: github.com/SolarRepublic/SNIPs/blob/master/SNIP-52.md (revision 2).
// sSCRT runs `recvd` in TxHash mode: the hash in the HMAC is upper-case hex.
//
// Pure functions and `fetch` only. The Android background service has a Java
// port of the same algorithms (android/.../Snip52.java, same test vectors).

import { chacha20poly1305 } from '@noble/ciphers/chacha.js';
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';

export const RECVD = 'recvd';
export const MULTIRECVD = 'multirecvd';

export interface BloomParams {
	m: number;
	k: number;
	packetSize: number;
}

/** What it takes to recognise one account's incoming transfers. */
export interface Watch {
	/** base64 notification seed from `channel_info` */
	seed: string;
	/** `multirecvd` bloom parameters, when the contract has that channel */
	bloom?: BloomParams;
}

export interface Received {
	/** index into the watch list that matched */
	watch: number;
	hash: string;
	height: number;
	/** base units; undefined when the payload could not be read */
	amount?: bigint;
	/** canonical (20-byte) sender address */
	sender?: Uint8Array;
	hasMemo?: boolean;
}

/* ----------------------------------- bytes ---------------------------------- */

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function toB64(b: Uint8Array): string {
	let s = '';
	for (let i = 0; i < b.length; i += 3) {
		const n = (b[i]! << 16) | ((b[i + 1] ?? 0) << 8) | (b[i + 2] ?? 0);
		s += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]! + (i + 1 < b.length ? B64[(n >> 6) & 63]! : '=') + (i + 2 < b.length ? B64[n & 63]! : '=');
	}
	return s;
}

export function fromB64(s: string): Uint8Array {
	const clean = s.replace(/[^A-Za-z0-9+/]/g, '');
	const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
	let bits = 0;
	let acc = 0;
	let j = 0;
	for (const ch of clean) {
		acc = (acc << 6) | B64.indexOf(ch);
		bits += 6;
		if (bits >= 8) {
			bits -= 8;
			out[j++] = (acc >> bits) & 0xff;
		}
	}
	return out.subarray(0, j);
}

function fromHex(h: string): Uint8Array {
	const out = new Uint8Array(h.length / 2);
	for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
	return out;
}

const utf8 = (s: string) => new TextEncoder().encode(s);

/* ----------------------------------- ids ------------------------------------ */

export function notificationId(seed: Uint8Array, channel: string, txHash: string): Uint8Array {
	return hmac(sha256, seed, utf8(`${channel}:${txHash.toUpperCase()}`));
}

/* ---------------------------------- payload --------------------------------- */

/** Minimal CBOR reader for the `recvd` tuple: [amount, sender, memo_len]. */
function readCbor(b: Uint8Array, at: { i: number }): bigint | Uint8Array | unknown[] | null {
	const head = b[at.i++]!;
	const major = head >> 5;
	const info = head & 31;
	let n = 0n;
	if (info < 24) n = BigInt(info);
	else if (info >= 24 && info <= 27) {
		const len = 1 << (info - 24);
		for (let k = 0; k < len; k++) n = (n << 8n) | BigInt(b[at.i++]!);
	} else return null;
	switch (major) {
		case 0:
			return n;
		case 2: {
			const v = b.subarray(at.i, at.i + Number(n));
			at.i += Number(n);
			return v;
		}
		case 4:
			return Array.from({ length: Number(n) }, () => readCbor(b, at));
		case 6: {
			// tag 2 = positive bignum (byte string)
			const v = readCbor(b, at);
			if (n === 2n && v instanceof Uint8Array) return v.reduce((a, x) => (a << 8n) | BigInt(x), 0n);
			return v;
		}
		default:
			return null;
	}
}

export function decryptRecvd(seed: Uint8Array, txHash: string, height: number, payloadB64: string): Pick<Received, 'amount' | 'sender' | 'hasMemo'> {
	const payload = fromB64(payloadB64);
	const hash = fromHex(txHash);
	const chan = sha256(utf8(RECVD));
	const nonce = new Uint8Array(12);
	for (let i = 0; i < 12; i++) nonce[i] = chan[i]! ^ hash[i]!;
	for (const h of [txHash.toUpperCase(), txHash.toLowerCase()]) {
		try {
			const plain = chacha20poly1305(seed, nonce, utf8(`${height}:${h}`)).decrypt(payload);
			const tuple = readCbor(plain, { i: 0 });
			if (!Array.isArray(tuple)) return {};
			const [amount, sender, memoLen] = tuple;
			return {
				amount: typeof amount === 'bigint' ? amount : undefined,
				sender: sender instanceof Uint8Array ? sender.slice() : undefined,
				hasMemo: typeof memoLen === 'bigint' ? memoLen > 0n : undefined,
			};
		} catch {
			/* try the other AAD spelling */
		}
	}
	return {};
}

/* ----------------------------------- bloom ---------------------------------- */

function bloomHit(filter: Uint8Array, id: Uint8Array, p: BloomParams): boolean {
	const h = sha256(id);
	const bitsPer = Math.log2(p.m);
	for (let i = 0; i < p.k; i++) {
		let v = 0;
		for (let b = 0; b < bitsPer; b++) {
			const pos = i * bitsPer + b;
			v = (v << 1) | ((h[pos >> 3]! >> (7 - (pos & 7))) & 1);
		}
		// bit 0 is the rightmost bit of the filter
		const byte = filter.length - 1 - (v >> 3);
		if (((filter[byte]! >> (v & 7)) & 1) === 0) return false;
	}
	return true;
}

/** Looks for our packet in a `multirecvd` value; amount is in the low 62 bits. */
function readPacket(data: Uint8Array, id: Uint8Array, p: BloomParams): bigint | undefined {
	const step = 8 + p.packetSize;
	for (let off = 0; off + step <= data.length; off += step) {
		if (!data.subarray(off, off + 8).every((x, i) => x === id[i])) continue;
		if (p.packetSize > 24) return undefined;
		const plain = data.subarray(off + 8, off + 8 + p.packetSize).map((x, i) => x ^ id[8 + i]!);
		let flagsAndAmount = 0n;
		for (let i = 0; i < 8; i++) flagsAndAmount = (flagsAndAmount << 8n) | BigInt(plain[i]!);
		return flagsAndAmount >> 2n;
	}
	return undefined;
}

/* --------------------------------- scanning --------------------------------- */

export interface ChainTx {
	hash: string;
	height: number;
	/** wasm attributes of the tx, key → value (first wins) */
	attrs: Map<string, string>;
}

/** Which of our accounts received something in this transaction. */
export function scanTx(tx: ChainTx, watches: Watch[]): Received[] {
	const hits: Received[] = [];
	watches.forEach((w, watch) => {
		const seed = fromB64(w.seed);
		const id = notificationId(seed, RECVD, tx.hash);
		const value = tx.attrs.get(`snip52:${toB64(id)}`);
		if (value !== undefined) {
			hits.push({ watch, hash: tx.hash, height: tx.height, ...decryptRecvd(seed, tx.hash, tx.height, value) });
			return;
		}
		const bloom = w.bloom && tx.attrs.get(`snip52:#${MULTIRECVD}`);
		if (w.bloom && bloom) {
			const bytes = fromB64(bloom);
			const mid = notificationId(seed, MULTIRECVD, tx.hash);
			const filter = bytes.subarray(0, w.bloom.m / 8);
			if (bloomHit(filter, mid, w.bloom)) {
				hits.push({ watch, hash: tx.hash, height: tx.height, amount: readPacket(bytes.subarray(w.bloom.m / 8), mid, w.bloom) });
			}
		}
	});
	return hits;
}

interface RpcTx {
	hash: string;
	height: string;
	tx_result: { events: { type: string; attributes: { key: string; value: string }[] }[] };
}

async function getJson<T>(url: string): Promise<T> {
	const r = await fetch(url);
	if (!r.ok) throw new Error(`HTTP ${r.status}`);
	return JSON.parse(await r.text()) as T;
}

export async function latestHeight(rpc: string): Promise<number> {
	const j = await getJson<{ result: { sync_info: { latest_block_height: string } } }>(`${rpc}/status`);
	return Number(j.result.sync_info.latest_block_height);
}

/** Every execution of `contract` after block `after`, oldest first (up to `maxPages` × 100). */
export async function txsSince(rpc: string, contract: string, after: number, maxPages = 5): Promise<ChainTx[]> {
	const out: ChainTx[] = [];
	for (let page = 1; page <= maxPages; page++) {
		const q = encodeURIComponent(`"wasm.contract_address='${contract}' AND tx.height>${after}"`);
		const j = await getJson<{ result?: { txs: RpcTx[]; total_count: string }; error?: { data?: string } }>(
			`${rpc}/tx_search?query=${q}&per_page=100&page=${page}&order_by=%22asc%22`,
		);
		if (!j.result) throw new Error(j.error?.data ?? 'tx_search failed');
		for (const t of j.result.txs) {
			const attrs = new Map<string, string>();
			for (const e of t.tx_result.events) {
				if (e.type !== 'wasm') continue;
				for (const a of e.attributes) if (!attrs.has(a.key)) attrs.set(a.key, a.value);
			}
			out.push({ hash: t.hash.toUpperCase(), height: Number(t.height), attrs });
		}
		if (page * 100 >= Number(j.result.total_count)) break;
	}
	return out;
}

/** Public RPC nodes that index contract events and answer browsers (CORS). */
export const RPC_URLS = ['https://rpc-secret.keplr.app', 'https://rpc.lavenderfive.com:443/secretnetwork'];

export async function firstRpc<T>(fn: (rpc: string) => Promise<T>, urls = RPC_URLS): Promise<T> {
	let last: unknown;
	for (const u of urls) {
		try {
			return await fn(u);
		} catch (e) {
			last = e;
		}
	}
	throw last instanceof Error ? last : new Error(String(last));
}
