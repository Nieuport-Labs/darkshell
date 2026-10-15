// Per-account records on the phone (transaction log, invoices, swap and
// Lightning orders, refill and faucet times), encrypted. The key comes from the
// recovery phrase, so it is the same after a PIN change and the records stay
// readable; record names carry a keyed hash of the address, not the address,
// so the store doesn't list which accounts live here either.
//
// While the wallet is locked there is no key: reads and writes then go to
// memory only (nothing in the app writes these while locked; tests do).

import { kv } from '../storage';
import { seedOf } from './account';
import { buf, fromB64, randomBytes, td, te, toB64, wipe } from './bytes';

/** Records that belong to one account. */
export type AccountRecord = 'txlog' | 'invoices' | 'ln-orders' | 'x-orders' | 'refill.until' | 'faucet.at' | 'dapps' | 'walletconnect';
/** the ones that were once kept in the clear */
const RECORDS: AccountRecord[] = ['txlog', 'invoices', 'ln-orders', 'x-orders', 'refill.until', 'faucet.at'];

interface Sealed {
	iv: string;
	ct: string;
}

let keys: { aes: CryptoKey; names: CryptoKey } | null = null;
const memory = new Map<string, unknown>();

/** Derives the store's keys from the phrase (on unlock). */
export async function openLocalStore(mnemonic: string): Promise<void> {
	const seed = await seedOf(mnemonic);
	try {
		const base = await crypto.subtle.importKey('raw', buf(seed), 'HKDF', false, ['deriveKey']);
		const derive = (info: string, alg: AesKeyGenParams | HmacImportParams, usage: KeyUsage[]) =>
			crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: te.encode(info) }, base, alg, false, usage);
		keys = {
			aes: await derive('darkshell/local-store/aes', { name: 'AES-GCM', length: 256 }, ['encrypt', 'decrypt']),
			names: await derive('darkshell/local-store/names', { name: 'HMAC', hash: 'SHA-256', length: 256 }, ['sign']),
		};
	} finally {
		wipe(seed);
	}
}

export function closeLocalStore(): void {
	keys = null;
	memory.clear();
}

async function storeKey(name: AccountRecord, address: string): Promise<string> {
	const mac = new Uint8Array(await crypto.subtle.sign('HMAC', keys!.names, te.encode(address)));
	return `acct:${name}:${[...mac.subarray(0, 16)].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

export const accountKv = {
	async get<T>(name: AccountRecord, address: string): Promise<T | undefined> {
		if (!keys) return memory.get(`${name}:${address}`) as T | undefined;
		const k = await storeKey(name, address);
		const sealed = await kv.get<Sealed>(k);
		if (!sealed) return undefined;
		try {
			const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: buf(fromB64(sealed.iv)), additionalData: te.encode(k) }, keys.aes, buf(fromB64(sealed.ct)));
			return JSON.parse(td.decode(plain)) as T;
		} catch {
			return undefined;
		}
	},
	async set(name: AccountRecord, address: string, value: unknown): Promise<void> {
		if (!keys) {
			memory.set(`${name}:${address}`, value);
			return;
		}
		const k = await storeKey(name, address);
		const iv = randomBytes(12);
		const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: buf(iv), additionalData: te.encode(k) }, keys.aes, te.encode(JSON.stringify(value))));
		await kv.set(k, { iv: toB64(iv), ct: toB64(ct) } satisfies Sealed);
	},
	async del(name: AccountRecord, address: string): Promise<void> {
		if (!keys) {
			memory.delete(`${name}:${address}`);
			return;
		}
		await kv.del(await storeKey(name, address));
	},
};

/** Moves records kept in the clear (`<name>:<address>`, before this store) into it. */
export async function encryptPlainRecords(addresses: string[]): Promise<void> {
	if (!keys) return;
	for (const address of addresses) {
		for (const name of RECORDS) {
			const old = await kv.get<unknown>(`${name}:${address}`);
			if (old === undefined) continue;
			if ((await accountKv.get(name, address)) === undefined) await accountKv.set(name, address, old);
			await kv.del(`${name}:${address}`);
		}
	}
}
