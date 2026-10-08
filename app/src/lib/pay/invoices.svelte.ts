// Invoices this wallet issued. Nothing is stored on chain or on a server: the
// invoice is its link, and this list is only the issuer's own bookkeeping.

import { findSettlement, isExpired, type MatchStatus, type PaymentRequest, type ReceivedTransfer } from 'secret-pay';
import type { HistoryItem } from '../chain/sscrt';
import { SSCRT_ADDRESS } from '../config';
import { addrKey, kv } from '../storage';
import { wallet } from '../wallet.svelte';

export interface IssuedInvoice {
	request: PaymentRequest;
	created: number;
	/** last known status */
	status: MatchStatus | 'open' | 'expired';
	paidTx?: string;
}

const key = () => addrKey('invoices', wallet.address);

export const invoices = $state({ list: [] as IssuedInvoice[] });

export async function loadInvoices(): Promise<void> {
	invoices.list = (await kv.get<IssuedInvoice[]>(key())) ?? [];
}

async function save() {
	await kv.set(key(), $state.snapshot(invoices.list));
}

export async function addInvoice(request: PaymentRequest): Promise<IssuedInvoice> {
	const inv: IssuedInvoice = { request, created: Date.now(), status: 'open' };
	invoices.list = [inv, ...invoices.list];
	await save();
	return inv;
}

export async function removeInvoice(id: string): Promise<void> {
	invoices.list = invoices.list.filter((i) => i.request.id !== id);
	await save();
}

function toReceived(h: HistoryItem, me: string): ReceivedTransfer | null {
	if (h.kind !== 'in') return null;
	return { to: me, asset: SSCRT_ADDRESS, amount: h.amount, memo: h.memo, time: h.time, sender: h.counterparty, txHash: h.id };
}

/** Re-checks open invoices against the latest received transfers. */
export async function reconcile(history: HistoryItem[], me: string): Promise<void> {
	const received = history.map((h) => toReceived(h, me)).filter((x): x is ReceivedTransfer => x !== null);
	let changed = false;
	for (const inv of invoices.list) {
		if (inv.status === 'paid') continue;
		const s = findSettlement(inv.request, received);
		let next: IssuedInvoice['status'] = s.status === 'no_match' ? (isExpired(inv.request) ? 'expired' : 'open') : s.status;
		if (next !== inv.status) {
			inv.status = next;
			inv.paidTx = s.transfers[0]?.txHash;
			changed = true;
		}
	}
	if (changed) await save();
}
