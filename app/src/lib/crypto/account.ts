import { generateMnemonic, mnemonicToSeed, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { Wallet } from 'secretjs';
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

/**
 * m/44'/529'/0'/0/{index}. Index 0 is the account Keplr and other Secret
 * wallets show for this seed; further accounts increment the address index
 * (secretjs calls it `hdAccountIndex`).
 */
export function walletFromMnemonic(mnemonic: string, index = 0): Wallet {
	return new Wallet(normalizeMnemonic(mnemonic), { coinType: COIN_TYPE, bech32Prefix: BECH32_PREFIX, hdAccountIndex: index });
}

/**
 * Deterministic seed for Secret contract-message encryption, so the wallet can
 * decrypt its own past transactions after a restore. Same idea as StarShell's
 * "utility key": derived from the wallet secret, never random per session.
 */
export async function encryptionSeedFor(mnemonic: string, index = 0): Promise<Uint8Array> {
	const seed = await mnemonicToSeed(normalizeMnemonic(mnemonic));
	try {
		const key = await crypto.subtle.importKey('raw', buf(seed), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
		return new Uint8Array(await crypto.subtle.sign('HMAC', key, te.encode(index === 0 ? 'darkshell/tx-encryption-seed/v1' : `darkshell/tx-encryption-seed/v1/${index}`)));
	} finally {
		wipe(seed);
	}
}
