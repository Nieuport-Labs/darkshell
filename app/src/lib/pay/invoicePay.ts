// Paying a Secret payment request with an amount (an invoice): what it costs
// in sSCRT, whether it can be paid, and paying it. Shared by the in-app
// payment page (PayModal) and the payment sheet over a browser (PaySheet).

import { isExpired, paymentMemo, toBaseUnits } from 'secret-pay';
import { BusyError, type TxOutcome } from '../chain/tx';
import { NoGasError } from '../gas/feePayer';
import { pay, wallet } from '../wallet.svelte';
import type { Target } from './classify';
import { buildPlan, type QuoteState } from './plan';
import { needsSwap } from './payments';

export type InvoiceTarget = Extract<Target, { kind: 'secret' }>;

export interface InvoiceFacts {
	/** what the payee receives, base units of the requested asset */
	amount: bigint;
	/** paid by swapping sSCRT on ShadeSwap (the request asks for another token) */
	swapping: boolean;
	expired: boolean;
	memo?: string;
	/** host of the page the payer goes back to afterwards */
	returnHost?: string;
}

export function invoiceFacts(t: InvoiceTarget): InvoiceFacts {
	const { request, asset } = t;
	let returnHost: string | undefined;
	try {
		if (request.return) returnHost = new URL(request.return).host;
	} catch {
		/* checked by the parser already */
	}
	return {
		amount: toBaseUnits(request.amount!, asset.decimals),
		swapping: needsSwap(asset),
		expired: isExpired(request),
		memo: paymentMemo(request),
		returnHost,
	};
}

/** sSCRT the payment spends: the amount itself, or the swap quote's input. Null while unknown. */
export function sscrtCost(f: InvoiceFacts, quote: QuoteState): bigint | null {
	return quote.kind === 'ready' ? quote.quote.amountIn : f.swapping ? null : f.amount;
}

/** Why it can't be paid now, or '' (balance checked only when `available` is known). */
export function blockReason(t: InvoiceTarget, f: InvoiceFacts, quote: QuoteState, available: bigint | null, me = wallet.address): string {
	if (f.expired) return 'This request has expired.';
	if (t.request.address === me) return 'This is your own request.';
	if (quote.kind === 'unavailable') return `There is no ShadeSwap route from sSCRT to ${t.asset.symbol} right now.`;
	const cost = sscrtCost(f, quote);
	if (cost !== null && available !== null && cost > available) return 'Not enough sSCRT.';
	return '';
}

/** Builds and sends the payment for exactly the shown cost (the quote it was shown with). */
export async function payInvoice(t: InvoiceTarget, f: InvoiceFacts, quote: QuoteState, onBroadcast?: (p: Extract<TxOutcome, { status: 'pending' }>) => void): Promise<TxOutcome> {
	const plan = await buildPlan(t, f.amount, undefined, quote.kind === 'ready' ? quote.quote : undefined);
	return pay(plan, 'invoice', onBroadcast, {
		to: t.request.address,
		amount: f.amount.toString(),
		symbol: t.asset.symbol,
		memo: t.request.id ?? t.request.memo,
	});
}

export function failureText(e: unknown): string {
	return e instanceof NoGasError
		? 'Nothing can pay the network fee: gas credits are empty. See Settings → Gas credits.'
		: e instanceof BusyError || e instanceof Error
			? e.message
			: String(e);
}
