// Lightning payments in flight: FixedFloat orders this account created,
// kept per account so progress survives closing the app.

import { addrKey, kv } from '../storage';
import { wallet } from '../wallet.svelte';
import { getOrder, type FfStatus } from './fixedfloat';

export interface LnOrder {
	id: string;
	token: string;
	invoice: string;
	sats: string;
	description?: string;
	/** ATOM sent to FixedFloat, base units */
	atom: string;
	/** sSCRT spent, base units */
	sscrt?: string;
	hash?: string;
	status: FfStatus | 'SENDING';
	created: number;
	expires: number;
	deposit: string;
	memo?: string;
}

export const lnOrders = $state({ list: [] as LnOrder[] });

const key = () => addrKey('ln-orders', wallet.address);

export async function loadLnOrders(): Promise<void> {
	lnOrders.list = (await kv.get<LnOrder[]>(key())) ?? [];
}

export async function saveLnOrder(o: LnOrder): Promise<void> {
	const rest = lnOrders.list.filter((x) => x.id !== o.id);
	lnOrders.list = [o, ...rest].slice(0, 50);
	await kv.set(key(), $state.snapshot(lnOrders.list));
}

export function isFinal(s: LnOrder['status']): boolean {
	return s === 'DONE' || s === 'EXPIRED';
}

/** Reads the order's status from FixedFloat and stores it. */
export async function syncLnOrder(o: LnOrder): Promise<LnOrder> {
	const fresh = await getOrder(o.id, o.token);
	const next = { ...o, status: fresh.status };
	if (next.status !== o.status) await saveLnOrder(next);
	return next;
}

export const STATUS_TEXT: Record<LnOrder['status'], string> = {
	SENDING: 'Sending ATOM to FixedFloat',
	NEW: 'Waiting for the deposit to arrive',
	PENDING: 'Deposit received, confirming',
	EXCHANGE: 'Exchanging',
	WITHDRAW: 'Paying the Lightning invoice',
	DONE: 'Paid',
	EXPIRED: 'Expired',
	EMERGENCY: 'Needs attention',
};
