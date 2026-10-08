// Emergency ("duress") PIN. Entered on the lock screen instead of the real
// PIN, it either erases the wallet from the phone or sends everything to a
// safe address the user chose — and in both cases looks like an ordinary
// unlock (or an ordinary fresh install).
//
// Stored like the vault itself: its own Argon2id salt, AES-GCM, padded to the
// same 512-byte blocks, so the record does not reveal which action it holds.
// Unlock derives both keys in parallel every time, so the time it takes does
// not reveal which PIN was typed either.

import { kv } from '../storage';
import { buf, fromB64, randomBytes, toB64 } from './bytes';
import { DEFAULT_KDF, type KdfParams } from './kdf';
import { aesKey, seal, unseal, type AccountEntry } from './vault';

const KEY = 'vault.alt';

export type DuressAction = 'wipe' | 'sweep';

export interface DuressPayload {
	action: DuressAction;
	/** sweep: what to sign with, where to send, and which accounts to empty */
	mnemonic?: string;
	to?: string;
	accounts?: AccountEntry[];
	active?: number;
}

interface DuressRecord {
	kdf: KdfParams;
	hkdfSalt: string;
	iv: string;
	ct: string;
}

export async function hasDuress(): Promise<boolean> {
	return (await kv.get<DuressRecord>(KEY)) !== undefined;
}

/** Creates the record; returns its raw key (kept inside the real vault for later updates). */
export async function setDuress(pin: string, payload: DuressPayload, cost: { t: number; m: number; p: number } = DEFAULT_KDF): Promise<string> {
	const kdf: KdfParams = { alg: 'argon2id', ...cost, salt: toB64(randomBytes(32)) };
	const hkdfSalt = randomBytes(32);
	const key = await aesKey(pin, kdf, hkdfSalt, true);
	await kv.set(KEY, { kdf, hkdfSalt: toB64(hkdfSalt), ...(await seal(payload, key)) } satisfies DuressRecord);
	return toB64(new Uint8Array(await crypto.subtle.exportKey('raw', key)));
}

/** Rewrites the payload (e.g. after accounts changed) without knowing the emergency PIN. */
export async function resealDuress(rawKey: string, payload: DuressPayload): Promise<void> {
	const record = await kv.get<DuressRecord>(KEY);
	if (!record) return;
	const key = await crypto.subtle.importKey('raw', buf(fromB64(rawKey)), 'AES-GCM', false, ['encrypt', 'decrypt']);
	await kv.set(KEY, { ...record, ...(await seal(payload, key)) });
}

/** The payload when `pin` is the emergency PIN, otherwise null. */
export async function openDuress(pin: string): Promise<DuressPayload | null> {
	const record = await kv.get<DuressRecord>(KEY);
	if (!record) return null;
	try {
		const key = await aesKey(pin, record.kdf, fromB64(record.hkdfSalt));
		return await unseal<DuressPayload>(record.iv, record.ct, key);
	} catch {
		return null;
	}
}

export async function clearDuress(): Promise<void> {
	await kv.del(KEY);
}
