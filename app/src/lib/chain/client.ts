import { SecretNetworkClient, type Wallet } from 'secretjs';
import { CHAIN_ID, LCD_URLS } from '../config';
import { kv } from '../storage';
import { pinnedEncryption } from './enigma';

export { encryptionFor } from './enigma';

// generous: a slow node (or Tor) still counts; the probes run side by side, so a
// fast node answers long before a slow one times out
const PROBE_TIMEOUT_MS = 15000;

async function probe(url: string): Promise<boolean> {
	const ctl = new AbortController();
	const timer = setTimeout(() => ctl.abort(), PROBE_TIMEOUT_MS);
	try {
		const r = await fetch(`${url}/cosmos/base/tendermint/v1beta1/node_info`, { signal: ctl.signal, headers: { Accept: 'application/json' } });
		if (!r.ok) return false;
		const j = (await r.json()) as { default_node_info?: { network?: string } };
		return j.default_node_info?.network === CHAIN_ID;
	} catch {
		return false;
	} finally {
		clearTimeout(timer);
	}
}

let resolved: Promise<string> | null = null;

/** First endpoint that answers for the right chain; a user override in settings goes first. */
export function lcdUrl(): Promise<string> {
	return (resolved ??= (async () => {
		const custom = (await kv.get<string>('settings.lcd'))?.trim();
		// a node set in Settings is used when it answers; otherwise the first public one to answer
		if (custom && (await probe(custom.replace(/\/+$/, '')))) return custom.replace(/\/+$/, '');
		try {
			return await Promise.any(LCD_URLS.map(async (url) => ((await probe(url)) ? url : Promise.reject(new Error(url)))));
		} catch {
			resolved = null;
			throw new Error('No Secret Network node is reachable right now. Check your connection.');
		}
	})());
}

export function resetEndpoint(): void {
	resolved = null;
}

export async function readClient(): Promise<SecretNetworkClient> {
	const url = await lcdUrl();
	return new SecretNetworkClient({ url, chainId: CHAIN_ID, encryptionUtils: pinnedEncryption(url) });
}

/**
 * The wallet's client. Opening the wallet never waits on the network: with no
 * node answering, it uses the first public one, and the balance shows the error
 * (with a retry) instead of the lock screen refusing the PIN.
 */
export async function signingClient(wallet: Wallet, encryptionSeed: Uint8Array): Promise<SecretNetworkClient> {
	const url = await lcdUrl().catch(() => LCD_URLS[0]!);
	return new SecretNetworkClient({
		url,
		chainId: CHAIN_ID,
		wallet,
		walletAddress: wallet.address,
		encryptionUtils: pinnedEncryption(url, encryptionSeed),
	});
}

// Contract queries are encrypted against the code hash, and a migration changes
// it, so it is read from the chain and cached for this page load only.
const codeHashes = new Map<string, Promise<string>>();

export function codeHash(client: SecretNetworkClient, contract: string): Promise<string> {
	let p = codeHashes.get(contract);
	if (!p) {
		p = client.query.compute.codeHashByContractAddress({ contract_address: contract }).then((r) => {
			if (!r.code_hash) throw new Error(`no code hash for ${contract}`);
			return r.code_hash;
		});
		p.catch(() => codeHashes.delete(contract));
		codeHashes.set(contract, p);
	}
	return p;
}

export async function nativeBalance(client: SecretNetworkClient, address: string): Promise<bigint> {
	const r = await client.query.bank.balance({ address, denom: 'uscrt' });
	return BigInt(r.balance?.amount ?? '0');
}
