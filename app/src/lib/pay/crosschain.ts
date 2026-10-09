// Paying an Ethereum, Bitcoin or Monero address from sSCRT, in one Secret
// transaction, through whichever service gives the recipient their amount
// for less:
//
//   Skip        redeem sSCRT → SCRT, IBC transfer whose memo swaps on Osmosis
//               and bridges (Axelar) — non-custodial; only where Skip has a route
//   FixedFloat  swap sSCRT → ATOM on ShadeSwap, redeem, IBC to FixedFloat's
//               deposit address; FixedFloat sends the coin (an exchange: it sees the payment)
//
// Skip is preferred: FixedFloat is used when Skip has no route, or when Skip
// would cost noticeably more (SKIP_MARGIN).

import type { SecretNetworkClient } from 'secretjs';
import { snip20Msg } from '../chain/sscrt';
import { DENOM, GAS, SSCRT_ADDRESS } from '../config';
import { createOrder, ffConfigured, price, type FfOrder, type FfPrice } from '../ff/fixedfloat';
import { MSG_EXECUTE, MSG_TRANSFER } from '../gas/feePayer';
import { DECIMALS, EVM_NETWORKS, fromBase, type Coin, type EvmNetwork } from './external';
import { ATOM_TOKEN, lightningPayment, type PaymentPlan } from './payments';
import { quoteInto, type PaddedQuote } from './quote';
import { nativeDenom, skipRoute, skipTransfer, SLIPPAGE_PERCENT, type SkipRoute } from './skip';
import { toBaseUnits } from 'secret-pay';

/** Skip may cost up to this much more than FixedFloat and still be chosen (non-custodial). */
export const SKIP_MARGIN = 1.03;

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

export type CrossQuote =
	| { provider: 'skip'; sscrt: bigint; minutes: number; route: SkipRoute; via: string }
	| { provider: 'ff'; sscrt: bigint; minutes: number; price: FfPrice; quote: PaddedQuote; atom: bigint; via: string };

export interface Quotes {
	best: CrossQuote | null;
	/** why each provider could not quote, for the error shown when neither can */
	skipError?: string;
	ffError?: string;
}

/** FixedFloat quotes ATOM with up to 6 decimals; round up so the order is covered. */
export function atomBase(amount: string): bigint {
	const [i, f = ''] = amount.split('.');
	const base = toBaseUnits(`${i}.${(f + '000000').slice(0, 6)}`.replace(/\.$/, ''), 6);
	return f.length > 6 && /[1-9]/.test(f.slice(6)) ? base + 1n : base;
}

async function skipQuote(d: Destination): Promise<CrossQuote> {
	if (d.coin !== 'ETH') throw new Error('Skip has no route to this coin.');
	const chainId = EVM_NETWORKS.find((n) => n.id === (d.network ?? 'ethereum'))!.chainId;
	const route = await skipRoute(chainId, nativeDenom(chainId)!, d.amount);
	// the transfer pads the SCRT by the swap's slippage tolerance; that much sSCRT is unwrapped
	const sscrt = (BigInt(route.amount_in) * BigInt(100 + Number(SLIPPAGE_PERCENT))) / 100n;
	const hops = route.chain_ids.length > 2 ? 'Osmosis, then a bridge' : 'IBC';
	return { provider: 'skip', sscrt, minutes: Math.ceil((route.estimated_route_duration_seconds ?? 300) / 60), route, via: `Skip · ${hops}` };
}

async function ffQuote(client: SecretNetworkClient, d: Destination): Promise<CrossQuote> {
	if (!ffConfigured()) throw new Error('No FixedFloat API key.');
	const p = await price('ATOM', FF_CODE(d), fromBase(d.amount, DECIMALS[d.coin]));
	if (p.errors.length) throw new Error(ffPriceError(p, d));
	const atom = atomBase(p.from.amount);
	const q = await quoteInto(client, SSCRT_ADDRESS, ATOM_TOKEN, atom);
	if (!q) throw new Error('There is no ShadeSwap route from sSCRT to ATOM right now.');
	return { provider: 'ff', sscrt: q.amountIn, minutes: d.coin === 'BTC' ? 40 : d.coin === 'XMR' ? 30 : 15, price: p, quote: q, atom, via: `FixedFloat · ${p.from.amount} ATOM` };
}

export function ffPriceError(p: FfPrice, d: Pick<Destination, 'coin' | 'network'>): string {
	if (p.errors.includes('LIMIT_MIN')) return `Too small for FixedFloat: the minimum is about ${p.to.min ?? '?'} ${d.coin}.`;
	if (p.errors.includes('LIMIT_MAX')) return `Too large for FixedFloat: the maximum is about ${p.to.max ?? '?'} ${d.coin}.`;
	if (p.errors.some((e) => e.startsWith('MAINTENANCE') || e.startsWith('OFFLINE'))) return `FixedFloat is under maintenance for ATOM or ${d.coin}. Try later.`;
	if (p.errors.some((e) => e.startsWith('RESERVE'))) return `FixedFloat does not have enough ${d.coin} right now.`;
	return `FixedFloat cannot take this order (${p.errors.join(', ')}).`;
}

/** Asks both services; the better deal wins, Skip when it is close (see SKIP_MARGIN). */
export async function quoteCross(client: SecretNetworkClient, d: Destination): Promise<Quotes> {
	const [s, f] = await Promise.allSettled([skipQuote(d), ffQuote(client, d)]);
	const skip = s.status === 'fulfilled' ? s.value : null;
	const ff = f.status === 'fulfilled' ? f.value : null;
	const msg = (r: PromiseSettledResult<unknown>) => (r.status === 'rejected' ? (r.reason instanceof Error ? r.reason.message : String(r.reason)) : undefined);
	const best = skip && ff ? (Number(skip.sscrt) <= Number(ff.sscrt) * SKIP_MARGIN ? skip : ff) : (skip ?? ff);
	return { best, skipError: msg(s), ffError: msg(f) };
}

/** Skip: unwrap the SCRT, then the IBC transfer Skip built (checked in skipTransfer). */
export async function skipPlan(client: SecretNetworkClient, sender: string, route: SkipRoute, recipient: string): Promise<PaymentPlan> {
	const { msg, amount } = await skipTransfer(route, sender, recipient);
	const redeem = await snip20Msg(client, sender, SSCRT_ADDRESS, { redeem: { amount: amount.toString(), denom: DENOM } });
	return { msgs: [redeem, msg], gas: GAS.unwrap + GAS.ibcTransfer + 100_000, types: [MSG_EXECUTE, MSG_TRANSFER], spends: amount };
}

/** FixedFloat: create the order (fixes the ATOM amount, deposit address and memo), then the plan that pays it. */
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
