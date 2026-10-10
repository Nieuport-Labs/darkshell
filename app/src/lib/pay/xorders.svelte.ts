// Payments to other chains in flight (FixedFloat orders),
// kept per account so their progress survives closing the app.

import { addrKey, kv } from '../storage';
import { wallet } from '../wallet.svelte';
import { getOrder, type FfStatus } from '../ff/fixedfloat';
import type { Coin, EvmNetwork } from './external';

export type XStatus = 'SENDING' | 'NEW' | 'PENDING' | 'EXCHANGE' | 'WITHDRAW' | 'DONE' | 'EXPIRED' | 'EMERGENCY' | 'FAILED';

export interface XOrder {
	/** FixedFloat order id */
	id: string;
	provider: 'ff';
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

/** Reads where the payment is from FixedFloat, and stores it. */
export async function syncXOrder(o: XOrder): Promise<XOrder> {
	if (!o.ff) return o;
	const f = await getOrder(o.id, o.ff.token);
	const next: XOrder = { ...o, status: f.status as FfStatus };
	if (next.status !== o.status || next.destTx !== o.destTx) await saveXOrder(next);
	return next;
}

export const X_STEPS: Record<'ff', XStatus[]> = {
	ff: ['NEW', 'PENDING', 'EXCHANGE', 'WITHDRAW', 'DONE'],
};

export function statusText(o: Pick<XOrder, 'coin'>, s: XStatus): string {
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
