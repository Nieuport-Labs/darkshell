// Paying an Ethereum, Bitcoin or Monero address from sSCRT, in one Secret
// transaction, through FixedFloat — the same route as Lightning: swap sSCRT →
// ATOM on ShadeSwap, redeem, IBC to FixedFloat's deposit address with the
// order memo; FixedFloat sends the coin (an exchange: it sees the payment).

import type { SecretNetworkClient } from 'secretjs';
import { toBaseUnits } from 'secret-pay';
import { SSCRT_ADDRESS } from '../config';
import { createOrder, ffConfigured, price, type FfOrder, type FfPrice } from '../ff/fixedfloat';
import { DECIMALS, EVM_NETWORKS, fromBase, type Coin, type EvmNetwork } from './external';
import { ATOM_TOKEN, lightningPayment, type PaymentPlan } from './payments';
import { quoteInto, type PaddedQuote } from './quote';

export interface Destination {
	coin: Coin;
	network?: EvmNetwork;
	address: string;
	/** base units of `coin` */
	amount: bigint;
}

export const FF_CODE = (d: Pick<Destination, 'coin' | 'network'>): string =>
	d.coin === 'ETH' ? ({ ethereum: 'ETH', arbitrum: 'ETHARBITRUM', base: 'ETHBASE', optimism: 'ETHOP' } as const)[d.network ?? 'ethereum'] : d.coin;

export const networkName = (d: Pick<Destination, 'coin' | 'network'>): string =>
	d.coin === 'ETH' ? (EVM_NETWORKS.find((n) => n.id === (d.network ?? 'ethereum'))?.name ?? 'Ethereum') : d.coin === 'BTC' ? 'Bitcoin' : 'Monero';

export interface CrossQuote {
	sscrt: bigint;
	minutes: number;
	price: FfPrice;
	quote: PaddedQuote;
	atom: bigint;
	via: string;
}

/** FixedFloat quotes ATOM with up to 6 decimals; round up so the order is covered. */
export function atomBase(amount: string): bigint {
	const [i, f = ''] = amount.split('.');
	const base = toBaseUnits(`${i}.${(f + '000000').slice(0, 6)}`.replace(/\.$/, ''), 6);
	return f.length > 6 && /[1-9]/.test(f.slice(6)) ? base + 1n : base;
}

export function ffPriceError(p: FfPrice, d: Pick<Destination, 'coin' | 'network'>): string {
	if (p.errors.includes('LIMIT_MIN')) return `Too small for FixedFloat: the minimum is about ${p.to.min ?? '?'} ${d.coin}.`;
	if (p.errors.includes('LIMIT_MAX')) return `Too large for FixedFloat: the maximum is about ${p.to.max ?? '?'} ${d.coin}.`;
	if (p.errors.some((e) => e.startsWith('MAINTENANCE') || e.startsWith('OFFLINE'))) return `FixedFloat is under maintenance for ATOM or ${d.coin}. Try later.`;
	if (p.errors.some((e) => e.startsWith('RESERVE'))) return `FixedFloat does not have enough ${d.coin} right now.`;
	return `FixedFloat cannot take this order (${p.errors.join(', ')}).`;
}

/** What the recipient's amount costs in sSCRT, through FixedFloat. */
export async function quoteCross(client: SecretNetworkClient, d: Destination): Promise<CrossQuote> {
	if (!ffConfigured()) throw new Error('Payments to other chains need a FixedFloat API key. Add one in Settings → Lightning (FixedFloat).');
	const p = await price('ATOM', FF_CODE(d), fromBase(d.amount, DECIMALS[d.coin]));
	if (p.errors.length) throw new Error(ffPriceError(p, d));
	const atom = atomBase(p.from.amount);
	const q = await quoteInto(client, SSCRT_ADDRESS, ATOM_TOKEN, atom);
	if (!q) throw new Error('There is no ShadeSwap route from sSCRT to ATOM right now.');
	return { sscrt: q.amountIn, minutes: d.coin === 'BTC' ? 40 : d.coin === 'XMR' ? 30 : 15, price: p, quote: q, atom, via: `FixedFloat · ${p.from.amount} ATOM` };
}

/** Creates the order (fixes the ATOM amount, deposit address and memo), then the plan that pays it. */
export async function ffPlan(
	client: SecretNetworkClient,
	sender: string,
	d: Destination,
	shown: PaddedQuote,
): Promise<{ order: FfOrder; plan: PaymentPlan; atom: bigint; quote: PaddedQuote }> {
	const order = await createOrder('ATOM', FF_CODE(d), fromBase(d.amount, DECIMALS[d.coin]), d.address);
	const atom = atomBase(order.from.amount);
	const q = shown.amountOut >= atom ? shown : await quoteInto(client, SSCRT_ADDRESS, ATOM_TOKEN, atom);
	if (!q) throw new Error('There is no ShadeSwap route from sSCRT to ATOM right now.');
	const plan = await lightningPayment(client, sender, q, atom, order.from.address, order.from.tag ?? '');
	return { order, plan, atom, quote: q };
}
