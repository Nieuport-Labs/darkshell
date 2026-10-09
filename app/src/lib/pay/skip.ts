// Skip Go API (api.skip.build): routes SCRT from Secret to other chains in one
// Secret transaction — an IBC transfer whose memo swaps on Osmosis and
// forwards over a bridge (Axelar for ETH). No account, no key; nothing is
// custodied. Used for "send ETH" when it is the better deal (crosschain.ts).
//
// Intermediate chains need an address of ours for refunds: the same key under
// their prefix (rePrefix), like the Cosmos Hub refund address of FixedFloat orders.

import { MsgTransfer } from 'secretjs';
import { rePrefix } from '../chain/ibc';

const API = 'https://api.skip.build/v2';
export const SECRET_CHAIN = 'secret-4';

export class SkipError extends Error {}

async function call<T>(path: string, body?: object): Promise<T> {
	const r = await fetch(API + path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) } : { headers: { Accept: 'application/json' } });
	const d = (await r.json().catch(() => ({}))) as T & { message?: string; code?: number };
	if (!r.ok || (d.code !== undefined && d.code !== 0 && d.message)) throw new SkipError(d.message || `Skip error ${r.status}`);
	return d;
}

export interface SkipRoute {
	source_asset_denom: string;
	source_asset_chain_id: string;
	dest_asset_denom: string;
	dest_asset_chain_id: string;
	amount_in: string;
	amount_out: string;
	estimated_amount_out?: string;
	operations: unknown[];
	chain_ids: string[];
	required_chain_addresses: string[];
	txs_required: number;
	usd_amount_in?: string;
	usd_amount_out?: string;
	estimated_route_duration_seconds?: number;
	swap_price_impact_percent?: string;
}

/** Native coin of an EVM chain, in Skip's naming. */
export const nativeDenom = (chainId: string) => ({ '1': 'ethereum-native', '42161': 'arbitrum-native', '8453': 'base-native', '10': 'optimism-native' })[chainId];

/** Slippage the swap on the way may take; the SCRT sent is padded by it. */
export const SLIPPAGE_PERCENT = '1';

/** A one-transaction route that delivers exactly `amountOut` (base units) of `denom` on `chainId`. */
export async function skipRoute(chainId: string, denom: string, amountOut: bigint): Promise<SkipRoute> {
	const r = await call<SkipRoute>('/fungible/route', {
		amount_out: amountOut.toString(),
		source_asset_denom: 'uscrt',
		source_asset_chain_id: SECRET_CHAIN,
		dest_asset_denom: denom,
		dest_asset_chain_id: chainId,
		smart_relay: true,
		allow_multi_tx: false,
	});
	if (r.txs_required !== 1) throw new SkipError('Skip needs more than one transaction for this route.');
	return r;
}

let prefixes: Record<string, string> | null = null;

async function bech32Prefix(chainId: string): Promise<string> {
	if (!prefixes?.[chainId]) {
		const d = await call<{ chains: { chain_id: string; bech32_prefix?: string }[] }>(`/info/chains?chain_ids=${encodeURIComponent(chainId)}`);
		prefixes = { ...prefixes, ...Object.fromEntries(d.chains.map((c) => [c.chain_id, c.bech32_prefix ?? ''])) };
	}
	const p = prefixes[chainId];
	if (!p) throw new SkipError(`Skip did not say how addresses look on ${chainId}.`);
	return p;
}

/**
 * The transfer that runs `route` for `sender`, paying `recipient` at the end.
 * Checked before it is signed: one IBC transfer of uscrt from `sender`, no
 * more than the route said (plus its slippage padding).
 */
export async function skipTransfer(route: SkipRoute, sender: string, recipient: string): Promise<{ msg: MsgTransfer; amount: bigint }> {
	const address_list = await Promise.all(
		route.required_chain_addresses.map(async (id, i) => {
			if (id === SECRET_CHAIN) return sender;
			if (i === route.required_chain_addresses.length - 1) return recipient;
			return rePrefix(sender, await bech32Prefix(id));
		}),
	);
	const d = await call<{ msgs: { multi_chain_msg?: { chain_id: string; msg: string; msg_type_url: string } }[] }>('/fungible/msgs', {
		source_asset_denom: route.source_asset_denom,
		source_asset_chain_id: route.source_asset_chain_id,
		dest_asset_denom: route.dest_asset_denom,
		dest_asset_chain_id: route.dest_asset_chain_id,
		amount_in: route.amount_in,
		amount_out: route.amount_out,
		estimated_amount_out: route.estimated_amount_out ?? route.amount_out,
		operations: route.operations,
		address_list,
		slippage_tolerance_percent: SLIPPAGE_PERCENT,
	});
	const m = d.msgs?.[0]?.multi_chain_msg;
	if (d.msgs?.length !== 1 || !m || m.chain_id !== SECRET_CHAIN || m.msg_type_url !== '/ibc.applications.transfer.v1.MsgTransfer') throw new SkipError('Skip returned an unexpected transaction; nothing was sent.');
	const x = JSON.parse(m.msg) as { source_port: string; source_channel: string; token: { denom: string; amount: string }; sender: string; receiver: string; timeout_timestamp: number | string; memo?: string };
	const amount = BigInt(x.token.amount);
	const ceiling = (BigInt(route.amount_in) * 103n) / 100n;
	if (x.sender !== sender || x.token.denom !== 'uscrt' || amount > ceiling) throw new SkipError('Skip returned a transaction that does not match the quote; nothing was sent.');
	if (!paysTo(x.memo ?? '', recipient)) throw new SkipError('Skip returned a transaction for another recipient; nothing was sent.');
	const msg = new MsgTransfer({
		sender,
		receiver: x.receiver,
		source_port: x.source_port,
		source_channel: x.source_channel,
		token: { denom: 'uscrt', amount: amount.toString() },
		// Skip gives nanoseconds; secretjs takes seconds
		timeout_timestamp: String(BigInt(x.timeout_timestamp) / 1_000_000_000n),
		memo: x.memo ?? '',
	});
	return { msg, amount };
}

/**
 * Whether the route's memo ends at `recipient`: named in it, or (Axelar to an
 * EVM chain) ABI-encoded in its `payload` bytes for Skip's contract there.
 */
export function paysTo(memo: string, recipient: string): boolean {
	if (memo.toLowerCase().includes(recipient.toLowerCase())) return true;
	if (!/^0x[0-9a-fA-F]{40}$/.test(recipient)) return false;
	const want = recipient.slice(2).toLowerCase();
	for (const m of memo.matchAll(/payload\\*"\s*:\s*\[([0-9,\s]+)\]/g)) {
		const hex = m[1]!.split(',').map((n) => Number(n.trim()).toString(16).padStart(2, '0')).join('');
		if (hex.includes(want)) return true;
	}
	return false;
}

export type SkipState = 'STATE_SUBMITTED' | 'STATE_PENDING' | 'STATE_COMPLETED_SUCCESS' | 'STATE_COMPLETED_ERROR' | 'STATE_ABANDONED' | 'STATE_PENDING_ERROR' | 'STATE_UNKNOWN';

/** Asks Skip to follow the transaction (needed before `skipStatus` knows it). */
export async function skipTrack(hash: string): Promise<void> {
	await call('/tx/track', { tx_hash: hash, chain_id: SECRET_CHAIN });
}

export async function skipStatus(hash: string): Promise<{ state: SkipState; error?: string; destTx?: string }> {
	const d = await call<{ state?: SkipState; error?: { message?: string }; transfers?: { state?: SkipState; error?: { message?: string } }[]; transfer_sequence?: unknown[] }>(
		`/tx/status?tx_hash=${encodeURIComponent(hash)}&chain_id=${SECRET_CHAIN}`,
	);
	const t = d.transfers?.[0];
	const state = t?.state ?? d.state ?? 'STATE_UNKNOWN';
	// the last hop's transaction on the destination chain, when Skip has it
	const seq = JSON.stringify(d.transfer_sequence ?? []);
	const destTx = seq.match(/"(?:dest|execute|receive)_tx"\s*:\s*\{[^}]*"tx_hash"\s*:\s*"(0x[0-9a-fA-F]{64})"/)?.[1];
	return { state, error: t?.error?.message ?? d.error?.message, destTx };
}
