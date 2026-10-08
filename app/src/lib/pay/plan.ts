// From a classified target + amount to a ready transaction plan.

import type { PaymentRequest } from 'secret-pay';
import { SSCRT_ADDRESS } from '../config';
import { invoiceAsset, type InvoiceAsset } from '../tokens';
import { client, wallet } from '../wallet.svelte';
import type { Target } from './classify';
import { ibcPayment, needsSwap, requestPayment, sscrtTransfer, type PaymentPlan } from './payments';
import { quoteInto, type PaddedQuote } from './quote';

export type QuoteState = { kind: 'none' } | { kind: 'loading' } | { kind: 'ready'; quote: PaddedQuote } | { kind: 'unavailable' };

/** sSCRT needed to deliver `amount` of `asset` (a swap quote when it isn't sSCRT itself). */
export async function quoteFor(asset: InvoiceAsset, amount: bigint): Promise<QuoteState> {
	if (!needsSwap(asset)) return { kind: 'none' };
	try {
		const q = await quoteInto(client(), SSCRT_ADDRESS, asset.token.address, amount);
		return q ? { kind: 'ready', quote: q } : { kind: 'unavailable' };
	} catch {
		return { kind: 'unavailable' };
	}
}

export function assetOf(target: Target): InvoiceAsset | undefined {
	return target.kind === 'secret' ? target.asset : target.kind === 'ibc' ? invoiceAsset('uscrt') : undefined;
}

export async function buildPlan(target: Target, amount: bigint, memo: string | undefined, quote?: PaddedQuote): Promise<PaymentPlan> {
	const sender = wallet.address;
	if (target.kind === 'ibc') return ibcPayment(client(), sender, target.address, target.dest, amount, memo);
	if (target.kind !== 'secret') throw new Error('Nothing to pay.');
	const req: PaymentRequest = target.request;
	if (target.asset.token.address === SSCRT_ADDRESS && target.asset.private) {
		return sscrtTransfer(client(), sender, req.address, amount, (memo ?? req.memo ?? req.id) || undefined);
	}
	return requestPayment(client(), sender, req, target.asset, amount, quote, memo);
}
