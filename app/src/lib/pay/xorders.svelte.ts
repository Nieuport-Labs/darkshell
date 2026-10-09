// Payments to other chains in flight (Skip transfers and FixedFloat orders),
// kept per account so their progress survives closing the app.

import { addrKey, kv } from '../storage';
import { wallet } from '../wallet.svelte';
import { getOrder, type FfStatus } from '../ff/fixedfloat';
import { skipStatus, skipTrack, type SkipState } from './skip';
import type { Coin, EvmNetwork } from './external';

export type XStatus = 'SENDING' | 'NEW' | 'PENDING' | 'EXCHANGE' | 'WITHDRAW' | 'DONE' | 'EXPIRED' | 'EMERGENCY' | 'FAILED';

export interface XOrder {
	/** FixedFloat order id, or the Secret tx hash for Skip */
	id: string;
	provider: 'skip' | 'ff';
	coin: Coin;
	network?: EvmNetwork;
	address: string;
	/** coin units, as asked ("0.015") */
	amount: string;
	note?: string;
	/** sSCRT spent, base units */
	sscrt?: string;
	hash?: string;
	status: XStatus;
	created: number;
	error?: string;
	/** the payment's transaction on the destination chain, when known (Skip) */
	destTx?: string;
	ff?: { token: string; deposit: string; memo?: string; atom: string; expires: number };
}

export const xOrders = $state({ list: [] as XOrder[] });

const key = () => addrKey('x-orders', wallet.address);

export async function loadXOrders(): Promise<void> {
	xOrders.list = (await kv.get<XOrder[]>(key())) ?? [];
}

export async function saveXOrder(o: XOrder): Promise<void> {
	const rest = xOrders.list.filter((x) => x.id !== o.id);
	xOrders.list = [o, ...rest].slice(0, 50);
	await kv.set(key(), $state.snapshot(xOrders.list));
}

export const isFinalX = (s: XStatus) => s === 'DONE' || s === 'EXPIRED' || s === 'FAILED';

const SKIP: Record<SkipState, XStatus> = {
	STATE_SUBMITTED: 'PENDING',
	STATE_PENDING: 'EXCHANGE',
	STATE_PENDING_ERROR: 'EMERGENCY',
	STATE_COMPLETED_SUCCESS: 'DONE',
	STATE_COMPLETED_ERROR: 'FAILED',
	STATE_ABANDONED: 'FAILED',
	STATE_UNKNOWN: 'PENDING',
};

let tracked = new Set<string>();

/** Reads where the payment is from Skip or FixedFloat, and stores it. */
export async function syncXOrder(o: XOrder): Promise<XOrder> {
	let next: XOrder;
	if (o.provider === 'skip') {
		if (!o.hash) return o;
		if (!tracked.has(o.hash)) {
			await skipTrack(o.hash).catch(() => {});
			tracked = new Set([...tracked, o.hash]);
		}
		const s = await skipStatus(o.hash);
		next = { ...o, status: SKIP[s.state] ?? 'PENDING', error: s.error, destTx: s.destTx ?? o.destTx };
	} else {
		if (!o.ff) return o;
		const f = await getOrder(o.id, o.ff.token);
		next = { ...o, status: f.status as FfStatus };
	}
	if (next.status !== o.status || next.destTx !== o.destTx) await saveXOrder(next);
	return next;
}

export const X_STEPS: Record<'skip' | 'ff', XStatus[]> = {
	skip: ['PENDING', 'EXCHANGE', 'DONE'],
	ff: ['NEW', 'PENDING', 'EXCHANGE', 'WITHDRAW', 'DONE'],
};

export function statusText(o: Pick<XOrder, 'provider' | 'coin'>, s: XStatus): string {
	if (o.provider === 'skip')
		return { PENDING: 'Sent from Secret', EXCHANGE: 'Swapping on Osmosis and bridging', DONE: `Arrived`, FAILED: 'Did not go through', EMERGENCY: 'Stuck on the way', SENDING: 'Sending', NEW: 'Sent from Secret', WITHDRAW: 'Bridging', EXPIRED: 'Expired' }[s];
	return {
		SENDING: 'Sending ATOM to FixedFloat',
		NEW: 'Waiting for the deposit to arrive',
		PENDING: 'Deposit received, confirming',
		EXCHANGE: 'Exchanging',
		WITHDRAW: `Sending the ${o.coin}`,
		DONE: 'Sent',
		EXPIRED: 'Expired',
		EMERGENCY: 'Needs attention',
		FAILED: 'Failed',
	}[s];
}
