// Other tokens on the account — anything but sSCRT and public SCRT, private
// (SNIP-20) or public (IBC) — and swapping them into sSCRT on ShadeSwap
// ("Swap to sSCRT"). Only tokens ShadeSwap can sell are looked at: the rest
// could not be swapped anyway. Small amounts ("dust", under a cent by default)
// can be left out, and the reminder on Home turned off.

import type { Msg } from 'secretjs';
import { batchQuery } from '../chain/batchQuery';
import { codeHash } from '../chain/client';
import { listPairs, swapGas, swapMessage, type Pair } from '../chain/shadeSwap';
import { snip20Msg } from '../chain/sscrt';
import type { TxOutcome } from '../chain/tx';
import { GAS, SSCRT_ADDRESS } from '../config';
import { MSG_EXECUTE } from '../gas/feePayer';
import { price } from '../price.svelte';
import { kv } from '../storage';
import { tokenByAddress, tokenForBankDenom, type TokenInfo } from '../tokens';
import { client, pay, tokenPermit, wallet } from '../wallet.svelte';
import { quoteSell, type SellQuote } from './quote';

export interface OtherToken {
	/** `<address>` for a private balance, `bank:<denom>` for a public one */
	key: string;
	token: TokenInfo;
	/** base units */
	amount: bigint;
	/** a public IBC balance: deposited into its SNIP-20 first, in the same transaction */
	denom?: string;
	quote?: SellQuote;
	/** worth less than the dust limit */
	dust: boolean;
}

/** what counts as dust, in USD (when the SCRT price is known; otherwise in sSCRT) */
export const DUST_USD = 0.01;
const DUST_SSCRT = 1_000_000n;
/** swaps per transaction, to stay well under the block gas limit */
const PER_TX = 4;

export const others = $state({
	list: [] as OtherToken[],
	loading: false,
	/** account the list was read for */
	address: '',
	at: 0,
	/** leave dust out (default on) */
	ignoreDust: true,
	/** no reminder on Home */
	mute: false,
});

void kv.get<boolean>('sweep.ignoreDust').then((v) => (others.ignoreDust = v ?? true));
void kv.get<boolean>('sweep.mute').then((v) => (others.mute = !!v));

export async function setIgnoreDust(on: boolean): Promise<void> {
	others.ignoreDust = on;
	await kv.set('sweep.ignoreDust', on);
}

export async function setMute(on: boolean): Promise<void> {
	others.mute = on;
	await kv.set('sweep.mute', on);
}

/** sSCRT out → USD (6 decimals) */
export function usdOf(sscrt: bigint): number | null {
	return price.usd === null ? null : (Number(sscrt) / 1e6) * price.usd;
}

export function isDust(sscrt: bigint): boolean {
	const usd = usdOf(sscrt);
	return usd === null ? sscrt < DUST_SSCRT : usd < DUST_USD;
}

/** Tokens worth showing: all with a price, dust left out when that is chosen. */
export function swappable(list = others.list, ignoreDust = others.ignoreDust): OtherToken[] {
	return list.filter((t) => t.quote && (!ignoreDust || !t.dust));
}

/** SNIP-20s ShadeSwap has a pool for, with the code hash the pool records. */
function tradable(pairs: Pair[]): Map<string, string> {
	const out = new Map<string, string>();
	for (const p of pairs) for (const t of [p.token0, p.token1]) if (!out.has(t.address)) out.set(t.address, t.codeHash);
	out.delete(SSCRT_ADDRESS);
	return out;
}

interface BalanceReply {
	balance?: { amount?: string };
}

/** Private balances of the given tokens, one permit each, batched. */
async function privateBalances(tokens: Map<string, string>): Promise<Map<string, bigint>> {
	const c = client();
	const items = await Promise.all(
		[...tokens].map(async ([address, hash]) => ({
			id: address,
			contract: { address, codeHash: hash },
			query: { with_permit: { permit: await tokenPermit(address), query: { balance: {} } } },
		})),
	);
	const first = await batchQuery(c, items);
	// a pool's record of a token's code hash can be older than the token: those get its current one
	const retry = await Promise.all(
		items.filter((i) => !first.get(i.id)?.ok).map(async (i) => ({ ...i, contract: { address: i.id, codeHash: await codeHash(c, i.id).catch(() => '') } })),
	);
	const second = retry.length ? await batchQuery(c, retry.filter((i) => i.contract.codeHash)) : new Map();
	const out = new Map<string, bigint>();
	for (const i of items) {
		const r = first.get(i.id)?.ok ? first.get(i.id) : second.get(i.id);
		const amount = r?.ok ? (r.value as BalanceReply).balance?.amount : undefined;
		if (amount && /^\d+$/.test(amount) && BigInt(amount) > 0n) out.set(i.id, BigInt(amount));
	}
	return out;
}

interface TokenInfoReply {
	token_info?: { name: string; symbol: string; decimals: number };
}

/** Name and decimals of a token this app has no entry for (held, and in a pool). */
async function tokenInfo(address: string, hash: string): Promise<TokenInfo | undefined> {
	const r = (await batchQuery(client(), [{ id: address, contract: { address, codeHash: hash }, query: { token_info: {} } }])).get(address);
	const info = r?.ok ? (r.value as TokenInfoReply).token_info : undefined;
	return info ? { symbol: info.symbol, name: info.name, address, decimals: info.decimals } : undefined;
}

/** Reads the account's other tokens and what each would bring in sSCRT. */
export async function loadOthers(force = false): Promise<void> {
	const me = wallet.address;
	if (!me || others.loading) return;
	if (!force && others.address === me && Date.now() - others.at < 10 * 60_000) return;
	others.loading = true;
	try {
		const c = client();
		const pairs = await listPairs(c);
		const tokens = tradable(pairs);
		const [priv, bank] = await Promise.all([
			privateBalances(tokens),
			c.query.bank.allBalances({ address: me }).then((r) => r.balances ?? []),
		]);
		const found: OtherToken[] = [];
		for (const [address, amount] of priv) {
			const token = tokenByAddress(address) ?? (await tokenInfo(address, tokens.get(address)!));
			if (token) found.push({ key: address, token, amount, dust: false });
		}
		for (const b of bank) {
			if (b.denom === 'uscrt' || !b.amount || BigInt(b.amount) <= 0n) continue;
			const token = b.denom ? tokenForBankDenom(b.denom) : undefined;
			if (!token || !tokens.has(token.address)) continue;
			found.push({ key: `bank:${b.denom}`, token, amount: BigInt(b.amount), denom: b.denom, dust: false });
		}
		await Promise.all(
			found.map(async (t) => {
				t.quote = await quoteSell(c, t.token.address, SSCRT_ADDRESS, t.amount, pairs).catch(() => undefined);
				t.dust = !t.quote || isDust(t.quote.amountOut);
			}),
		);
		if (wallet.address !== me) return;
		found.sort((a, b) => Number((b.quote?.amountOut ?? 0n) - (a.quote?.amountOut ?? 0n)));
		others.list = found;
		others.address = me;
		others.at = Date.now();
	} catch {
		/* the reminder simply doesn't show; Settings can try again */
	} finally {
		others.loading = false;
	}
}

/** The messages for one batch: a deposit for a public balance, then its swap. */
async function messagesFor(batch: OtherToken[]): Promise<{ msgs: Msg[]; gas: number; types: string[]; out: bigint }> {
	const c = client();
	const me = wallet.address;
	const msgs: Msg[] = [];
	let gas = 0;
	let out = 0n;
	for (const t of batch) {
		if (!t.quote) continue;
		if (t.denom) {
			msgs.push(await snip20Msg(c, me, t.token.address, { deposit: {} }, t.amount, t.denom));
			gas += GAS.wrap;
		}
		msgs.push(await swapMessage(c, me, t.quote.route, t.amount, t.quote.minOut));
		gas += swapGas(t.quote.route);
		out += t.quote.amountOut;
	}
	return { msgs, gas, types: [MSG_EXECUTE], out };
}

/** Swaps the chosen tokens into sSCRT, a few per transaction. Calls `progress` after each. */
export async function sweep(chosen: OtherToken[], progress?: (done: number, total: number) => void): Promise<TxOutcome[]> {
	const list = chosen.filter((t) => t.quote);
	const batches: OtherToken[][] = [];
	for (let i = 0; i < list.length; i += PER_TX) batches.push(list.slice(i, i + PER_TX));
	const outcomes: TxOutcome[] = [];
	for (const [i, batch] of batches.entries()) {
		const { msgs, gas, types, out } = await messagesFor(batch);
		const outcome = await pay({ msgs, gas, types, spends: 0n }, 'sweep', undefined, {
			amount: out.toString(),
			symbol: 'sSCRT',
			memo: batch.map((t) => t.token.symbol).join(', '),
		});
		outcomes.push(outcome);
		progress?.(i + 1, batches.length);
	}
	const swept = new Set(list.map((t) => t.key));
	others.list = others.list.filter((t) => !swept.has(t.key));
	return outcomes;
}
