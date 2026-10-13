// The vault's device key (native side: VaultKeyPlugin.java). On Android the
// Argon2id root is passed through HMAC with a key that lives in the Keystore
// (StrongBox or TEE) and cannot be copied out, so the vault can only be opened
// on this phone: a copy of the app's data gives nothing to guess a PIN against.
// In a browser (and in tests) there is no such key and the root is used as is.

import { registerPlugin } from '@capacitor/core';
import { fromB64, toB64, wipe } from './bytes';
import { can } from '../platform';

interface VaultKeyPlugin {
	available(): Promise<{ available: boolean }>;
	mix(o: { data: string }): Promise<{ out: string }>;
}

const VaultKey = registerPlugin<VaultKeyPlugin>('VaultKey');

let known: Promise<boolean> | null = null;

/** Whether new records can be bound to this device. */
export function deviceKeyAvailable(): Promise<boolean> {
	if (!can.hwKey) return Promise.resolve(false);
	return (known ??= VaultKey.available()
		.then((r) => r.available)
		.catch(() => false));
}

/** HMAC-SHA256(device key, root). Throws when the record needs the key and the device has none. */
export async function bindToDevice(root: Uint8Array): Promise<Uint8Array> {
	if (!can.hwKey) throw new Error('This wallet can only be opened on the phone it was made on.');
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
