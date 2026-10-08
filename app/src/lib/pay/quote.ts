// Cheapest ShadeSwap route to get an exact amount out, with slippage padding.
// Ported from Secret_Dashboard `src/lib/gasPurchase.ts` (quoteInto and helpers).

import type { SecretNetworkClient } from 'secretjs';
import {
	bestSimulated,
	findRoutes,
	isSimulated,
	listPairs,
	pairsOf,
	quoteOut,
	reservesFor,
	type Quote,
	type Reserves,
	type Route,
} from '../chain/shadeSwap';

export const MIN_SLIPPAGE_BPS = 100;
export const MAX_SLIPPAGE_BPS = 500;

export function slippageFor(impactBps: number): bigint {
	return BigInt(Math.min(MAX_SLIPPAGE_BPS, Math.max(MIN_SLIPPAGE_BPS, Math.ceil(impactBps))));
}

export type PaddedQuote = Quote & { slippageBps: bigint };

function cheapest(quotes: Quote[]): Quote | undefined {
	return [...quotes].sort((a, b) => (a.amountIn === b.amountIn ? 0 : a.amountIn < b.amountIn ? -1 : 1))[0];
}

/** Constant-product routes priced by arithmetic, padded by the slippage their impact calls for. */
export function bestExactOut(routes: Route[], reserves: Map<string, Reserves>, amount: bigint): PaddedQuote | undefined {
	const quotesFor = (rs: Route[], out: bigint) => rs.map((r) => quoteOut(r, reserves, out)).filter((q): q is Quote => q !== undefined);
	const bare = cheapest(quotesFor(routes, amount));
	if (!bare) return undefined;
	const slippageBps = slippageFor(bare.impactBps);
	const [padded] = quotesFor([bare.route], (amount * 10_000n) / (10_000n - slippageBps));
	return padded ? { ...padded, slippageBps } : undefined;
}

export async function bestExactOutAnywhere(
	client: SecretNetworkClient,
	routes: Route[],
	reserves: Map<string, Reserves>,
	amount: bigint,
): Promise<PaddedQuote | undefined> {
	const local = bestExactOut(routes.filter((r) => !isSimulated(r)), reserves, amount);
	const stable = routes.filter(isSimulated);
	if (!stable.length) return local;
	const simulated = await bestSimulated(client, stable, reserves, amount, slippageFor, local?.amountIn).catch(() => undefined);
	if (!simulated) return local;
	if (!local) return simulated;
	return simulated.amountIn < local.amountIn ? simulated : local;
}

/** Reads the pools between two tokens ahead of time, so the quote itself is quicker. */
export async function prefetchQuote(client: SecretNetworkClient, token: string, target: string): Promise<void> {
	const routes = findRoutes(await listPairs(client), token, target);
	if (routes.length) await reservesFor(client, pairsOf(routes));
}

/** What it costs in `token` to get `amount` of `target` out, slippage included. */
export async function quoteInto(client: SecretNetworkClient, token: string, target: string, amount: bigint): Promise<PaddedQuote | undefined> {
	const routes = findRoutes(await listPairs(client), token, target);
	if (!routes.length) return undefined;
	return bestExactOutAnywhere(client, routes, await reservesFor(client, pairsOf(routes)), amount);
}
