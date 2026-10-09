// Encrypted-at-rest storage for the wallet secret.
//
// Design adapted from StarShell's vault (src/crypto/vault.ts, MIT, © Blake
// Regalia / Solar Republic — see THIRD_PARTY.md):
//   PIN/password ─Argon2id(salt)→ root ─HKDF-SHA256(hkdfSalt)→ AES-GCM-256 key
//   plaintext = len(u32) ‖ data ‖ random padding, sized to 512-byte blocks so
//   the ciphertext length does not reveal what is stored.
// Differences: IndexedDB instead of chrome.storage, one record, a fresh random
// IV on every write, and the unlocked AES key kept (non-extractable) for the
// session so account names and settings can be saved without asking again.

import { kv } from '../storage';
import { buf, fromB64, randomBytes, td, te, toB64, wipe } from './bytes';
import { DEFAULT_KDF, deriveRoot, type KdfParams } from './kdf';

const KEY = 'vault';
const BLOCK = 512;
const GCM_TAG = 16;
const AAD = te.encode('darkshell/vault/v1');

export interface AccountEntry {
	/** address index in m/44'/529'/0'/0/{index} */
	index: number;
	name: string;
}

/** An address book entry. Shared by every account of the wallet. */
export interface Contact {
	name: string;
	address: string;
}

export interface WalletSecrets {
	mnemonic: string;
	accounts?: AccountEntry[];
	/** the address book (names are as private as the seed's accounts) */
	contacts?: Contact[];
	active?: number;
	/** user's own FixedFloat API credentials (override the built-in ones) */
	ff?: { key: string; secret: string };
	/** emergency PIN: its record's AES key, so account changes can be copied into it */
	duress?: { key: string; to?: string; decoy?: string; action?: 'wipe' | 'sweep' };
}

export type SecretKind = 'pin' | 'password';

export interface VaultRecord {
	v: 1;
	kdf: KdfParams;
	hkdfSalt: string;
	iv: string;
	ct: string;
	/** public: active account address, shown on the lock screen */
	address: string;
	/** how the vault is unlocked; absent on vaults made before PINs existed */
	kind?: SecretKind;
	created: number;
}

export class WrongPasswordError extends Error {
	constructor() {
		super('Wrong PIN');
	}
}

/** The open vault: decrypted secrets plus the key to save changes with. */
export interface OpenVault {
	secrets: WalletSecrets;
	key: CryptoKey;
}

export async function aesKey(secret: string, kdf: KdfParams, hkdfSalt: Uint8Array, extractable = false): Promise<CryptoKey> {
	const pw = te.encode(secret.normalize('NFKC'));
	const root = await deriveRoot(pw, fromB64(kdf.salt), kdf);
	wipe(pw);
	try {
		const base = await crypto.subtle.importKey('raw', buf(root), 'HKDF', false, ['deriveKey']);
		return await crypto.subtle.deriveKey(
			{ name: 'HKDF', hash: 'SHA-256', salt: buf(hkdfSalt), info: te.encode('darkshell/vault/aes') },
			base,
			{ name: 'AES-GCM', length: 256 },
			extractable,
			['encrypt', 'decrypt'],
		);
	} finally {
		wipe(root);
	}
}

export function pad(data: Uint8Array): Uint8Array {
	const total = Math.ceil((data.length + 4 + GCM_TAG) / BLOCK) * BLOCK - GCM_TAG;
	const out = new Uint8Array(total);
	new DataView(out.buffer).setUint32(0, data.length);
	out.set(data, 4);
	out.set(randomBytes(total - 4 - data.length), 4 + data.length);
	return out;
}

export function unpad(padded: Uint8Array): Uint8Array {
	const len = new DataView(padded.buffer, padded.byteOffset).getUint32(0);
	if (len > padded.length - 4) throw new Error('corrupt vault payload');
	return padded.subarray(4, 4 + len);
}

export async function seal(secrets: object, key: CryptoKey): Promise<{ iv: string; ct: string }> {
	const plain = te.encode(JSON.stringify(secrets));
	const padded = pad(plain);
	const iv = randomBytes(12);
	const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: buf(iv), additionalData: AAD }, key, buf(padded)));
	wipe(plain, padded);
	return { iv: toB64(iv), ct: toB64(ct) };
}

/** Decrypts a sealed JSON payload; throws WrongPasswordError when the key does not fit. */
export async function unseal<T>(iv: string, ct: string, key: CryptoKey): Promise<T> {
	let padded: Uint8Array;
	try {
		padded = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: buf(fromB64(iv)), additionalData: AAD }, key, buf(fromB64(ct))));
	} catch {
		throw new WrongPasswordError();
	}
	try {
		return JSON.parse(td.decode(unpad(padded))) as T;
	} finally {
		wipe(padded);
	}
}

export async function vaultRecord(): Promise<VaultRecord | undefined> {
	return kv.get<VaultRecord>(KEY);
}

export async function hasVault(): Promise<boolean> {
	return (await vaultRecord()) !== undefined;
}

export async function vaultAddress(): Promise<string | null> {
	return (await vaultRecord())?.address ?? null;
}

export async function vaultKind(): Promise<SecretKind> {
	return (await vaultRecord())?.kind ?? 'password';
}

export async function createVault(
	secret: string,
	secrets: WalletSecrets,
	address: string,
	kind: SecretKind = 'pin',
	cost: { t: number; m: number; p: number } = DEFAULT_KDF,
): Promise<OpenVault> {
	const kdf: KdfParams = { alg: 'argon2id', ...cost, salt: toB64(randomBytes(32)) };
	const hkdfSalt = randomBytes(32);
	const key = await aesKey(secret, kdf, hkdfSalt);
	const record: VaultRecord = { v: 1, kdf, hkdfSalt: toB64(hkdfSalt), ...(await seal(secrets, key)), address, kind, created: Date.now() };
	await kv.set(KEY, record);
	return { secrets, key };
}

export async function openVault(secret: string): Promise<OpenVault> {
	const record = await vaultRecord();
	if (!record) throw new Error('No wallet on this device');
	const key = await aesKey(secret, record.kdf, fromB64(record.hkdfSalt));
	return { secrets: await unseal<WalletSecrets>(record.iv, record.ct, key), key };
}

/** Kept for callers that only need the secrets. */
export async function unlockVault(secret: string): Promise<WalletSecrets> {
	return (await openVault(secret)).secrets;
}

/** Re-encrypts changed secrets under the already unlocked key (no PIN prompt). */
export async function saveVault(open: OpenVault, address?: string): Promise<void> {
	const record = (await vaultRecord())!;
	await kv.set(KEY, { ...record, ...(await seal(open.secrets, open.key)), ...(address ? { address } : {}) });
}

/** Re-encrypts under a new PIN/password with a fresh salt. */
export async function changeSecret(oldSecret: string, newSecret: string, kind: SecretKind = 'pin', cost = DEFAULT_KDF): Promise<OpenVault> {
	const record = (await vaultRecord())!;
	const { secrets } = await openVault(oldSecret);
	return createVault(newSecret, secrets, record.address, kind, cost);
}

/** Removes the wallet from this device. Funds stay on chain; only the seed can restore it. */
export async function destroyVault(): Promise<void> {
	await kv.clear();
}
