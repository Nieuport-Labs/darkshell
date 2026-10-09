// Addresses and payment requests on other chains: Ethereum (and its L2s),
// Bitcoin and Monero. Paid from sSCRT through Skip or FixedFloat
// (lib/pay/crosschain.ts). Every address is checked by its own checksum, so a
// typo is caught here and never becomes a payment.
//
//   ethereum:0xAbc…[@chainId]?value=<wei>        EIP-681 (native ETH only)
//   bitcoin:bc1…?amount=<BTC>&label=&message=     BIP-21 (a `lightning=` param wins)
//   monero:4…?tx_amount=<XMR>&tx_description=     Monero URI

import { keccak_256 } from '@noble/hashes/sha3.js';
import { sha256 } from '@noble/hashes/sha2.js';

export type Coin = 'ETH' | 'BTC' | 'XMR';
export type EvmNetwork = 'ethereum' | 'arbitrum' | 'base' | 'optimism';

export interface ExternalTarget {
	kind: 'external';
	coin: Coin;
	address: string;
	/** for ETH: the network, when the request names it (EIP-681 `@chainId`) */
	network?: EvmNetwork;
	/** requested amount in coin units ("0.05"), if any */
	amount?: string;
	/** label / message / description the request carries */
	note?: string;
}

export const DECIMALS: Record<Coin, number> = { ETH: 18, BTC: 8, XMR: 12 };

export const EVM_NETWORKS: { id: EvmNetwork; chainId: string; name: string }[] = [
	{ id: 'ethereum', chainId: '1', name: 'Ethereum' },
	{ id: 'arbitrum', chainId: '42161', name: 'Arbitrum' },
	{ id: 'base', chainId: '8453', name: 'Base' },
	{ id: 'optimism', chainId: '10', name: 'Optimism' },
];

export const COIN_NAME: Record<Coin, string> = { ETH: 'Ether', BTC: 'Bitcoin', XMR: 'Monero' };

export class ExternalError extends Error {}

/* --------------------------------- amounts -------------------------------- */

/** "2.014e18" / "1000" (base units, as EIP-681 writes them) → bigint. */
export function sciToBigInt(s: string): bigint {
	const m = s.trim().match(/^(\d+)(?:\.(\d+))?(?:e(\d+))?$/i);
	if (!m) throw new ExternalError('The amount in this request is not valid.');
	const [, int, frac = '', exp = '0'] = m;
	const e = Number(exp);
	if (frac.length > e) throw new ExternalError('The amount in this request is not a whole number of base units.');
	return BigInt(int + frac + '0'.repeat(e - frac.length));
}

/** base units → "0.0123" (no trailing zeros) */
export function fromBase(v: bigint, decimals: number): string {
	const s = v.toString().padStart(decimals + 1, '0');
	const f = s.slice(-decimals).replace(/0+$/, '');
	return f ? `${s.slice(0, -decimals)}.${f}` : s.slice(0, -decimals);
}

/** "0.0123" → base units; null when not a valid positive amount with at most `decimals` places */
export function toBase(v: string, decimals: number): bigint | null {
	const m = v.trim().replace(',', '.').match(/^(\d*)(?:\.(\d*))?$/);
	if (!m || (!m[1] && !m[2])) return null;
	const frac = m[2] ?? '';
	if (frac.length > decimals) return null;
	const b = BigInt((m[1] || '0') + frac.padEnd(decimals, '0'));
	return b > 0n ? b : null;
}

/* -------------------------------- addresses ------------------------------- */

const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');

/** EIP-55: all-lower or all-upper is accepted as is; mixed case must match its checksum. */
export function isEthAddress(a: string): boolean {
	if (!/^0x[0-9a-fA-F]{40}$/.test(a)) return false;
	const body = a.slice(2);
	if (body === body.toLowerCase() || body === body.toUpperCase()) return true;
	const h = hex(keccak_256(new TextEncoder().encode(body.toLowerCase())));
	return [...body].every((c, i) => (/[a-f]/i.test(c) ? (parseInt(h[i]!, 16) >= 8 ? c === c.toUpperCase() : c === c.toLowerCase()) : true));
}

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function b58decode(s: string): Uint8Array | null {
	let n = 0n;
	for (const c of s) {
		const i = B58.indexOf(c);
		if (i < 0) return null;
		n = n * 58n + BigInt(i);
	}
	const bytes: number[] = [];
	while (n > 0n) {
		bytes.unshift(Number(n % 256n));
		n /= 256n;
	}
	for (const c of s) {
		if (c !== '1') break;
		bytes.unshift(0);
	}
	return new Uint8Array(bytes);
}

const BECH32 = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';

function polymod(values: number[]): number {
	const G = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
	let chk = 1;
	for (const v of values) {
		const b = chk >> 25;
		chk = ((chk & 0x1ffffff) << 5) ^ v;
		for (let i = 0; i < 5; i++) if ((b >> i) & 1) chk ^= G[i]!;
	}
	return chk;
}

/** Segwit (bech32, v0) and taproot (bech32m, v1+) mainnet addresses. */
function isSegwit(a: string): boolean {
	const s = a.toLowerCase();
	if (a !== s && a !== a.toUpperCase()) return false;
	if (!/^bc1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{6,87}$/.test(s)) return false;
	const data = [...s.slice(3)].map((c) => BECH32.indexOf(c));
	const hrp = [...'bc'].map((c) => c.charCodeAt(0));
	const check = polymod([...hrp.map((c) => c >> 5), 0, ...hrp.map((c) => c & 31), ...data]);
	const version = data[0]!;
	if (version === 0 ? check !== 1 : check !== 0x2bc830a3) return false;
	const progLen = Math.floor(((data.length - 7) * 5) / 8);
	return version === 0 ? progLen === 20 || progLen === 32 : version <= 16 && progLen >= 2 && progLen <= 40;
}

/** Legacy P2PKH (1…) and P2SH (3…) mainnet addresses: base58check. */
function isBase58Btc(a: string): boolean {
	if (!/^[13][1-9A-HJ-NP-Za-km-z]{25,34}$/.test(a)) return false;
	const b = b58decode(a);
	if (!b || b.length !== 25 || (b[0] !== 0x00 && b[0] !== 0x05)) return false;
	const sum = sha256(sha256(b.slice(0, 21)));
	return sum.slice(0, 4).every((x, i) => x === b[21 + i]);
}

export function isBtcAddress(a: string): boolean {
	return isSegwit(a) || isBase58Btc(a);
}

/** Monero's base58: 8-byte blocks of 11 characters, the last block shorter. */
function xmrDecode(s: string): Uint8Array | null {
	const FULL = 11;
	const SIZES = [0, -1, 1, 2, -1, 3, 4, 5, -1, 6, 7, 8];
	const out: number[] = [];
	for (let i = 0; i < s.length; i += FULL) {
		const chunk = s.slice(i, i + FULL);
		const size = SIZES[chunk.length];
		if (size === undefined || size < 0) return null;
		let n = 0n;
		for (const c of chunk) {
			const d = B58.indexOf(c);
			if (d < 0) return null;
			n = n * 58n + BigInt(d);
		}
		if (n >= 1n << BigInt(size * 8)) return null;
		const bytes: number[] = [];
		for (let k = 0; k < size; k++) {
			bytes.unshift(Number(n & 0xffn));
			n >>= 8n;
		}
		out.push(...bytes);
	}
	return new Uint8Array(out);
}

/** Mainnet standard (4…), subaddress (8…) and integrated (4…, 106 chars) addresses. */
export function isXmrAddress(a: string): boolean {
	if (!/^[48][1-9A-HJ-NP-Za-km-z]{94}$/.test(a) && !/^4[1-9A-HJ-NP-Za-km-z]{105}$/.test(a)) return false;
	const b = xmrDecode(a);
	if (!b || b.length < 5) return false;
	if (![18, 19, 42].includes(b[0]!)) return false;
	const sum = keccak_256(b.slice(0, -4));
	return sum.slice(0, 4).every((x, i) => x === b[b.length - 4 + i]);
}

/* --------------------------------- parsing -------------------------------- */

function params(q: string | undefined): URLSearchParams {
	return new URLSearchParams(q ?? '');
}

/**
 * An Ethereum / Bitcoin / Monero address or request, or null when `raw` is
 * none of these. Throws ExternalError for one that is recognisably meant as
 * such but can't be paid (bad checksum, token request, unknown network…).
 * A BIP-21 request that carries a Lightning invoice returns `{ lightning }`.
 */
export function parseExternal(raw: string): ExternalTarget | { lightning: string } | null {
	const s = raw.trim();
	const [scheme, rest] = /^[a-z]+:/i.test(s) ? [s.slice(0, s.indexOf(':')).toLowerCase(), s.slice(s.indexOf(':') + 1).replace(/^\/\//, '')] : ['', s];

	// Ethereum
	if (scheme === 'ethereum' || (!scheme && /^0x[0-9a-fA-F]{40}$/.test(s))) {
		const m = rest.match(/^(?:pay-)?(0x[0-9a-fA-F]{40})(?:@(\d+))?(\/[A-Za-z]+)?(?:\?(.*))?$/);
		if (!m) throw new ExternalError(scheme ? 'This Ethereum request could not be read.' : 'This is not a valid Ethereum address.');
		const [, address, chainId, fn, q] = m;
		if (!isEthAddress(address!)) throw new ExternalError('This Ethereum address has a wrong checksum: it was probably mistyped.');
		if (fn) throw new ExternalError('This asks for a token payment. DarkShell can send ETH to an Ethereum address, not tokens yet.');
		let network: EvmNetwork | undefined;
		if (chainId) {
			network = EVM_NETWORKS.find((n) => n.chainId === chainId)?.id;
			if (!network) throw new ExternalError(`This request is for a network DarkShell can't pay on (chain id ${chainId}). Supported: Ethereum, Arbitrum, Base, Optimism.`);
		}
		const value = params(q).get('value');
		const amount = value ? fromBase(sciToBigInt(value), 18) : undefined;
		return { kind: 'external', coin: 'ETH', address: address!, network, amount: amount && amount !== '0' ? amount : undefined };
	}

	// Bitcoin
	if (scheme === 'bitcoin' || (!scheme && (/^(bc1|BC1)[a-zA-Z0-9]+$/.test(s) || /^[13][1-9A-HJ-NP-Za-km-z]{25,34}$/.test(s)))) {
		const [addr, q] = rest.split('?') as [string, string | undefined];
		const p = params(q);
		const ln = p.get('lightning');
		if (ln) return { lightning: ln };
		if (!addr && ln === null) throw new ExternalError('This Bitcoin request has no address.');
		if (!isBtcAddress(addr)) {
			if (/^(tb1|bcrt1|[mn2])/i.test(addr)) throw new ExternalError('This is a Bitcoin testnet address. DarkShell pays mainnet only.');
			if (!scheme && /^[13]/.test(addr)) return null; // could be anything base58
			throw new ExternalError('This Bitcoin address is not valid (checksum failed): it was probably mistyped.');
		}
		const amount = p.get('amount') ?? undefined;
		if (amount !== undefined && toBase(amount, 8) === null) throw new ExternalError('The amount in this Bitcoin request is not valid.');
		const note = p.get('message') ?? p.get('label') ?? undefined;
		return { kind: 'external', coin: 'BTC', address: /^bc1/i.test(addr) ? addr.toLowerCase() : addr, amount, note };
	}

	// Monero
	if (scheme === 'monero' || (!scheme && /^[48][1-9A-HJ-NP-Za-km-z]{94}(?:[1-9A-HJ-NP-Za-km-z]{11})?$/.test(s))) {
		const [addr, q] = rest.split('?') as [string, string | undefined];
		if (!isXmrAddress(addr)) {
			if (/^[579AB]/.test(addr)) throw new ExternalError('This is a Monero testnet or stagenet address. DarkShell pays mainnet only.');
			throw new ExternalError('This Monero address is not valid (checksum failed): it was probably mistyped.');
		}
		const p = params(q);
		const amount = p.get('tx_amount') ?? undefined;
		if (amount !== undefined && toBase(amount, 12) === null) throw new ExternalError('The amount in this Monero request is not valid.');
		const note = p.get('tx_description') ?? p.get('recipient_name') ?? undefined;
		return { kind: 'external', coin: 'XMR', address: addr, amount, note };
	}
	return null;
}
