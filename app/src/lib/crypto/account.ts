import { HDKey } from '@scure/bip32';
import { generateMnemonic, mnemonicToSeedSync, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { pubkeyToAddress, Wallet } from 'secretjs';
import { BECH32_PREFIX, COIN_TYPE } from '../config';
import { buf, te, wipe } from './bytes';

/** 24 words, 256 bits of entropy from crypto.getRandomValues. */
export function newMnemonic(): string {
	return generateMnemonic(wordlist, 256);
}

export function normalizeMnemonic(input: string): string {
	return input.trim().toLowerCase().split(/\s+/).join(' ');
}

export function isValidMnemonic(input: string): boolean {
	const m = normalizeMnemonic(input);
	const n = m.split(' ').length;
	return (n === 12 || n === 15 || n === 18 || n === 21 || n === 24) && validateMnemonic(m, wordlist);
}

export function englishWordlist(): readonly string[] {
	return wordlist;
}

/*
 * The BIP39 seed (PBKDF2-SHA512, 2048 rounds) is the slow part of every key:
 * secretjs's Wallet computes it again in plain JS for each account, which took
 * seconds on a phone while the wallet opened. It is computed once instead —
 * with WebCrypto when there is time to wait (`warmSeed`), in JS otherwise —
 * and kept only while the wallet is open (`forgetSeeds` on lock).
 */
const seeds = new Map<string, Uint8Array>();

function seedSync(mnemonic: string): Uint8Array {
	const m = normalizeMnemonic(mnemonic);
	let seed = seeds.get(m);
	if (!seed) {
		seed = mnemonicToSeedSync(m);
		remember(m, seed);
	}
	return seed;
}

function remember(m: string, seed: Uint8Array) {
	// the open wallet's, and at most one more (a decoy being made, a phrase being restored)
	if (seeds.size >= 2) forgetSeeds();
	seeds.set(m, seed);
}

/** Computes the seed natively (WebCrypto PBKDF2), so the next keys of this phrase are instant. */
export async function warmSeed(mnemonic: string): Promise<void> {
	const m = normalizeMnemonic(mnemonic);
	if (seeds.has(m) || !globalThis.crypto?.subtle) return;
	const key = await crypto.subtle.importKey('raw', te.encode(m.normalize('NFKD')), 'PBKDF2', false, ['deriveBits']);
	const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-512', salt: te.encode('mnemonic'), iterations: 2048 }, key, 512);
	if (!seeds.has(m)) remember(m, new Uint8Array(bits));
}

/** A copy of the phrase's BIP39 seed (the caller may wipe it). */
export async function seedOf(mnemonic: string): Promise<Uint8Array> {
	await warmSeed(mnemonic);
	return seedSync(mnemonic).slice();
}

export function forgetSeeds(): void {
	for (const s of seeds.values()) wipe(s);
	seeds.clear();
}

/**
 * m/44'/529'/0'/0/{index}. Index 0 is the account Keplr and other Secret
 * wallets show for this seed; further accounts increment the address index
 * (secretjs calls it `hdAccountIndex`). The same keys secretjs's own
 * constructor derives (test/account.test.ts), from the cached seed.
 */
export function walletFromMnemonic(mnemonic: string, index = 0): Wallet {
	const m = normalizeMnemonic(mnemonic);
	const node = HDKey.fromMasterSeed(seedSync(m)).derive(`m/44'/${COIN_TYPE}'/0'/0/${index}`);
	if (!node.privateKey || !node.publicKey) throw new Error('Failed to derive key pair');
	const w = Object.create(Wallet.prototype) as Wallet;
	Object.assign(w, {
		mnemonic: m,
		hdAccountIndex: index,
		coinType: COIN_TYPE,
		bech32Prefix: BECH32_PREFIX,
		privateKey: new Uint8Array(node.privateKey),
		publicKey: new Uint8Array(node.publicKey),
		address: pubkeyToAddress(node.publicKey, BECH32_PREFIX),
	});
	return w;
}

/**
 * Deterministic seed for Secret contract-message encryption, so the wallet can
 * decrypt its own past transactions after a restore. Same idea as StarShell's
 * "utility key": derived from the wallet secret, never random per session.
 */
export async function encryptionSeedFor(mnemonic: string, index = 0): Promise<Uint8Array> {
	const seed = await seedOf(mnemonic);
	try {
		const key = await crypto.subtle.importKey('raw', buf(seed), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
		return new Uint8Array(await crypto.subtle.sign('HMAC', key, te.encode(index === 0 ? 'darkshell/tx-encryption-seed/v1' : `darkshell/tx-encryption-seed/v1/${index}`)));
	} finally {
		wipe(seed);
	}
}
