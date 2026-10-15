// The vault's device key. The Argon2id root is passed through HMAC with a key
// this device keeps and never hands out, so a copy of the wallet's data gives
// nothing to guess a PIN against:
// - Android: a Keystore key (StrongBox or TEE), VaultKeyPlugin.java;
// - iOS: a Secure Enclave key, VaultKeyPlugin.swift;
// - the browser extension: a non-extractable WebCrypto key in its own
//   IndexedDB. Not hardware: it binds the vault to this browser profile, so a
//   copy of the vault alone is not enough, but a copy of the whole profile is.
// On a plain web page (and in tests) there is no such key and the root is used as is.

import { registerPlugin } from '@capacitor/core';
import { can, platform } from '../platform';
import { buf, fromB64, toB64, wipe } from './bytes';
import { t } from '../i18n/index.svelte';

interface VaultKeyPlugin {
	available(): Promise<{ available: boolean }>;
	mix(o: { data: string }): Promise<{ out: string }>;
}

const VaultKey = registerPlugin<VaultKeyPlugin>('VaultKey');

let known: Promise<boolean> | null = null;

/** Whether new records can be bound to this device. */
export function deviceKeyAvailable(): Promise<boolean> {
	if (platform === 'extension') return Promise.resolve(true);
	if (!can.hwKey) return Promise.resolve(false);
	return (known ??= VaultKey.available()
		.then((r) => r.available)
		.catch(() => false));
}

/** HMAC-SHA256(device key, root). Throws when the record needs the key and the device has none. */
export async function bindToDevice(root: Uint8Array): Promise<Uint8Array> {
	if (platform === 'extension') return webMix(root);
	if (!can.hwKey) throw new Error(t('This wallet can only be opened on the device it was made on.'));
	const data = toB64(root);
	const { out } = await VaultKey.mix({ data });
	return fromB64(out);
}

/** Wipes `root` and returns the device-bound root in its place. */
export async function mixRoot(root: Uint8Array, hw: boolean | undefined): Promise<Uint8Array> {
	if (!hw) return root;
	try {
		return await bindToDevice(root);
	} finally {
		wipe(root);
	}
}

/* ------------------------------ browser profile ------------------------------ */

// Its own database: wiping the wallet (kv.clear) must not drop the key a new
// vault (the emergency PIN's decoy) is about to be sealed under.
const DB = 'darkshell-device';
const STORE = 'keys';
const ID = 'vault';

function idb<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
	return new Promise((resolve, reject) => {
		const open = indexedDB.open(DB, 1);
		open.onupgradeneeded = () => open.result.createObjectStore(STORE);
		open.onerror = () => reject(open.error);
		open.onsuccess = () => {
			const tx = open.result.transaction(STORE, mode);
			const req = fn(tx.objectStore(STORE));
			tx.oncomplete = () => {
				open.result.close();
				resolve(req.result as T);
			};
			tx.onerror = () => reject(tx.error);
		};
	});
}

let webKey: Promise<CryptoKey> | null = null;

function browserKey(): Promise<CryptoKey> {
	return (webKey ??= (async () => {
		const have = await idb<CryptoKey | undefined>('readonly', (s) => s.get(ID));
		if (have) return have;
		// non-extractable: page code can use it, never read it
		const k = await crypto.subtle.generateKey({ name: 'HMAC', hash: 'SHA-256', length: 256 }, false, ['sign']);
		// `add`, never `put`: another window may have stored one at the same
		// moment (and sealed a vault under it); then that one is used
		await idb('readwrite', (s) => s.add(k, ID)).catch(() => {});
		const stored = await idb<CryptoKey | undefined>('readonly', (s) => s.get(ID));
		if (!stored) throw new Error(t('Could not keep the device key in this browser.'));
		return stored;
	})().catch((e) => {
		webKey = null;
		throw e;
	}));
}

async function webMix(root: Uint8Array): Promise<Uint8Array> {
	return new Uint8Array(await crypto.subtle.sign('HMAC', await browserKey(), buf(root)));
}
