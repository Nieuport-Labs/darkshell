import { SecretNetworkClient, type Wallet } from 'secretjs';
import { CHAIN_ID, LCD_URLS } from '../config';
import { kv } from '../storage';

const PROBE_TIMEOUT_MS = 8000;

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
		const list = [...(custom ? [custom.replace(/\/+$/, '')] : []), ...LCD_URLS];
		for (const url of list) if (await probe(url)) return url;
		resolved = null;
		throw new Error('No Secret Network node is reachable right now. Check your connection.');
	})());
}

export function resetEndpoint(): void {
	resolved = null;
}

export async function readClient(): Promise<SecretNetworkClient> {
	return new SecretNetworkClient({ url: await lcdUrl(), chainId: CHAIN_ID });
}

export async function signingClient(wallet: Wallet, encryptionSeed: Uint8Array): Promise<SecretNetworkClient> {
	return new SecretNetworkClient({
		url: await lcdUrl(),
		chainId: CHAIN_ID,
		wallet,
		walletAddress: wallet.address,
		encryptionSeed,
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
