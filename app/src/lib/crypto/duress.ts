// Emergency ("duress") PIN. Entered on the lock screen instead of the real
// PIN, it erases the real wallet from the phone, sends everything to the safe
// address (when one was set) in the background, and opens a decoy wallet — a
// separate seed made at setup, never shown anywhere — as an ordinary unlock.
// From then on that same PIN simply unlocks the decoy.
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

export interface DuressPayload {
	/** the decoy wallet's recovery phrase (older records have none: one is made on use) */
	decoy?: string;
	/** safe address; with it, the real phrase so the funds can be moved */
	to?: string;
	mnemonic?: string;
	/** account names and the open one, mirrored by the decoy */
	accounts?: AccountEntry[];
	active?: number;
	/** records from before the decoy wallet */
	action?: 'wipe' | 'sweep';
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
