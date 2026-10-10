// What an activity entry was, in words. sSCRT history only knows transfers,
// deposits and redeems; our own log (kept when we send) says what a redeem or
// a swap was for, matched by amount and time.

import type { HistoryItem } from './chain/sscrt';
import { SHADESWAP_ROUTER } from './chain/shadeSwap';
import { shortAddress } from './format';
import type { LoggedTx } from './wallet.svelte';
import type { Overall } from './txSteps';
import type { ChainActivity } from './chain/activity';
import { formatAmount } from './format';

export type Icon = 'in' | 'out' | 'swap' | 'gas' | 'shield' | 'bolt' | 'stake' | 'vote';

export interface Described {
	title: string;
	detail: string;
	sign: '+' | '−' | '';
	icon: Icon;
	/** our log entry for this transaction, when we sent it */
	link?: LoggedTx;
}

const WINDOW_MS = 15 * 60_000;

/**
 * The logged send `h` belongs to: the one in the same block when the log knows
 * its block, else by amount and time (the nearest in time). `used` holds entries
 * already matched to another history item, so two payments of the same amount
 * close together are not both tied to the first one.
 */
export function linkOf(h: HistoryItem, logged: LoggedTx[], used?: Set<LoggedTx>): LoggedTx | undefined {
	const free = used ? logged.filter((l) => !used.has(l)) : logged;
	// sSCRT coming back from a swap of other tokens ("Swap to sSCRT")
	if (h.kind === 'in') {
		const sweeps = free.filter((l) => l.kind === 'sweep');
		if (h.height) {
			const same = sweeps.find((l) => l.height === h.height);
			if (same) return same;
		}
		if (h.counterparty !== SHADESWAP_ROUTER || !h.time) return undefined;
		return sweeps.find((l) => l.height === undefined && Math.abs(l.time - h.time! * 1000) < WINDOW_MS);
	}
	const amount = h.amount.toString();
	const fits = (l: LoggedTx) =>
		h.kind === 'wrap' ? l.wrapped === amount || l.kind === 'wrap' : h.kind === 'unwrap' ? l.refilled === amount || l.spent === amount : l.spent === amount;
	if (h.height) {
		const same = free.filter((l) => l.height === h.height);
		const hit = same.find(fits) ?? (h.kind === 'out' ? same.find((l) => l.spent !== undefined) : undefined);
		if (hit) return hit;
	}
	if (!h.time) return undefined;
	const at = h.time * 1000;
	// a log entry with a known block belongs to that block only
	const near = (l: LoggedTx) => Math.abs(l.time - at) < WINDOW_MS && (l.height === undefined || !h.height);
	const closest = (ls: LoggedTx[]) => ls.filter(near).sort((a, b) => Math.abs(a.time - at) - Math.abs(b.time - at))[0];
	if (h.kind === 'unwrap') {
		const refill = closest(free.filter((l) => l.refilled === amount));
		if (refill) return refill;
	}
	if (h.kind === 'wrap') return closest(free.filter((l) => l.wrapped === amount)) ?? closest(free.filter((l) => l.kind === 'wrap'));
	return closest(free.filter((l) => l.spent === amount));
}

export function describe(h: HistoryItem, link?: LoggedTx): Described {
	const out = (title: string, detail: string, icon: Icon = 'out'): Described => ({ title, detail, sign: '−', icon, link });
	if (h.kind === 'in' && (link?.kind === 'sweep' || h.counterparty === SHADESWAP_ROUTER)) return { title: 'Swapped to sSCRT', detail: link?.memo ? `from ${link.memo}` : 'on ShadeSwap', sign: '+', icon: 'swap', link };
	if (h.kind === 'in') return { title: 'Received', detail: h.counterparty ? `from ${shortAddress(h.counterparty, 6, 4)}` : '', sign: '+', icon: 'in' };
	if (h.kind === 'wrap' && link?.wrapped === h.amount.toString()) {
		if (link.kind === 'stake' || link.kind === 'unstake' || link.kind === 'claim') return { title: 'Staking rewards', detail: 'claimed privately', sign: '+', icon: 'stake', link };
		return { title: 'Made private', detail: 'rewards and public SCRT, for a payment', sign: '+', icon: 'shield', link };
	}
	if (h.kind === 'wrap') return { title: 'Made private', detail: 'from public SCRT', sign: '+', icon: 'shield', link };
	if (link?.kind === 'stake') return out('Staked', 'SCRT with a validator', 'stake');
	if (link?.kind === 'lightning') return out('Lightning payment', 'via FixedFloat', 'bolt');
	if (link?.kind === 'external') return out(`Sent ${link.symbol ?? ''}`.trim(), link.to ? `to ${shortAddress(link.to, 6, 4)}` : 'to another chain');
	if (link?.kind === 'refill' || (h.kind === 'unwrap' && link?.refilled === h.amount.toString())) return out('Gas credits', 'refill', 'gas');
	if (link?.kind === 'invoice') return out('Paid invoice', link.to ? `to ${shortAddress(link.to, 6, 4)}` : '', h.counterparty === SHADESWAP_ROUTER ? 'swap' : 'out');
	if (link?.kind === 'ibc') return out('Sent', 'to another chain');
	if (h.kind === 'out' && h.counterparty === SHADESWAP_ROUTER) return out('Swapped', 'on ShadeSwap', 'swap');
	if (h.kind === 'out') return out('Sent', h.counterparty ? `to ${shortAddress(h.counterparty, 6, 4)}` : '');
	if (h.kind === 'unwrap') return link ? out('Sent', 'as public SCRT') : out('Unwrapped', 'to public SCRT');
	return { title: 'Other', detail: '', sign: '', icon: 'out' };
}

/** A logged send the chain history does not show yet (still in flight, or failed). */
export function unsettled(logged: LoggedTx[], history: HistoryItem[], chain: ChainActivity[] = []): LoggedTx[] {
	return logged.filter((l) => {
		if (l.status !== 'pending' && l.status !== 'failed') return false;
		if (l.status === 'failed' && Date.now() - l.time > 24 * 3600_000) return false;
		// already in a block: listed from the chain or the private history
		if (chain.some((c) => c.hash === l.hash)) return false;
		return !history.some((h) => linkOf(h, [l]) === l);
	});
}

export function describeLogged(l: LoggedTx, settled = false): Described {
	const to = l.to ? `to ${shortAddress(l.to, 6, 4)}` : '';
	const map: Record<LoggedTx['kind'], [string, Icon]> = {
		send: ['Sending', 'out'],
		invoice: ['Paying invoice', 'out'],
		ibc: ['Sending to another chain', 'out'],
		wrap: ['Making private', 'shield'],
		refill: ['Refilling gas credits', 'gas'],
		lightning: ['Lightning payment', 'bolt'],
		external: [`Sending ${l.symbol ?? ''}`.trim(), 'out'],
		stake: ['Staking', 'stake'],
		unstake: ['Unstaking', 'stake'],
		claim: ['Claiming rewards', 'stake'],
		vote: ['Voting', 'vote'],
		sweep: ['Swapping to sSCRT', 'swap'],
	};
	const done: Record<LoggedTx['kind'], string> = {
		send: 'Sent',
		invoice: 'Paid invoice',
		ibc: 'Sent to another chain',
		wrap: 'Made private',
		refill: 'Gas credits',
		lightning: 'Lightning payment',
		external: `Sent ${l.symbol ?? ''}`.trim(),
		stake: 'Staked',
		unstake: 'Unstaked',
		claim: 'Staking rewards',
		vote: l.memo?.replace(/ on proposal #\d+$/, '') || 'Voted',
		sweep: 'Swapped to sSCRT',
	};
	const [title0, icon] = map[l.kind];
	const title = settled ? done[l.kind] : title0;
	const sign = l.kind === 'wrap' || l.kind === 'claim' ? '+' : l.kind === 'vote' || l.kind === 'unstake' ? '' : '−';
	const detail = l.kind === 'stake' || l.kind === 'unstake' || l.kind === 'vote' ? '' : to;
	return { title: l.status === 'failed' ? `${title0} failed` : title, detail: settled && l.kind === 'vote' ? (l.memo?.match(/#\d+/)?.[0] ?? '') : detail, sign, icon, link: l };
}

/**
 * How private an entry was, for the list (the detail page has the steps).
 * Our own sends carry it from when they were built; history alone tells the
 * rest: transfers and swaps are private, wrapping and unwrapping are not.
 */
export function privacyOf(h: HistoryItem | undefined, link: LoggedTx | undefined): Overall {
	if (link?.privacy) return link.privacy;
	if (!h) return 'public';
	if (h.kind === 'wrap' || h.kind === 'unwrap') return 'public';
	return 'private';
}

/** A staking, governance or public-SCRT transaction read from the chain. */
export function describeChain(c: ChainActivity, validator: (a: string) => string = (a) => shortAddress(a, 10, 4), wrapped?: 'in' | 'out'): Described {
	const val = c.counterparty ? validator(c.counterparty) : '';
	const r = (title: string, detail: string, sign: Described['sign'], icon: Icon): Described => ({ title: c.failed ? `${title} failed` : title, detail, sign, icon });
	switch (c.kind) {
		case 'stake':
			return r('Staked', [val ? `with ${val}` : '', wrapped === 'out' ? 'from your balance' : ''].filter(Boolean).join(' · '), '', 'stake');
		case 'unstake':
			return r('Unstaked', val ? `from ${val} · back in 21 days` : 'back in 21 days', '', 'stake');
		case 'restake':
			return r('Moved stake', val ? `to ${val}` : '', '', 'stake');
		case 'claim':
			return r('Staking rewards', wrapped === 'in' ? 'collected into your private balance' : 'collected as public SCRT', '+', 'stake');
		case 'vote':
			return r(`Voted ${c.vote ?? ''}`.trim(), c.proposal ? `on proposal #${c.proposal}` : '', '', 'vote');
		case 'in':
			return r('Received public SCRT', c.counterparty ? `from ${shortAddress(c.counterparty, 6, 4)}` : '', '+', 'in');
		case 'out':
			return r('Sent public SCRT', c.counterparty ? `to ${shortAddress(c.counterparty, 6, 4)}` : '', '−', 'out');
		case 'ibc':
			return r('Sent to another chain', c.counterparty ? `to ${shortAddress(c.counterparty, 8, 4)}` : '', '−', 'out');
	}
}

export type Entry =
	| { type: 'history'; time: number; h: HistoryItem; link?: LoggedTx }
	/** `wrapped`: the same transaction also moved sSCRT in (rewards made private) or out (unwrapped to stake) */
	| { type: 'chain'; time: number; c: ChainActivity; link?: LoggedTx; wrapped?: 'in' | 'out' }
	| { type: 'logged'; time: number; l: LoggedTx };

/**
 * Everything the account did, newest first: the private sSCRT history, the
 * chain's staking/governance/public-SCRT transactions, and our own log for
 * what neither shows (a vote or unstake the node's index hasn't caught up on,
 * a refill paid from public SCRT). Unsettled sends are listed separately.
 */
export function timeline(history: HistoryItem[], chain: ChainActivity[], logged: LoggedTx[]): Entry[] {
	// One transaction, one entry. A stake made from sSCRT is an unwrap and a delegation in the
	// same transaction (so the same block): the private history sees the unwrap, the chain the
	// delegation. Matched by block height — works for transactions made on another device too.
	const atHeight = new Map<number, HistoryItem[]>();
	for (const h of history) if (h.height) atHeight.set(h.height, [...(atHeight.get(h.height) ?? []), h]);
	const hidden = new Set<HistoryItem>();
	const folded = new Map<HistoryItem, HistoryItem>();
	const ch: Entry[] = [];
	for (const c of chain) {
		const same = atHeight.get(c.height) ?? [];
		// a private transfer or swap rode along (a payment that claimed rewards first): the
		// private history tells that one better
		if (same.some((h) => h.kind === 'out')) continue;
		// (a received transfer in the same block is someone else's transaction: it stays)
		const parts = same.filter((h) => h.kind === 'wrap' || h.kind === 'unwrap');
		parts.forEach((h) => hidden.add(h));
		const unwrapped = parts.some((h) => h.kind === 'unwrap');
		const wrapped = (c.kind === 'stake' || c.kind === 'out' || c.kind === 'ibc') && unwrapped ? 'out' : parts.some((h) => h.kind === 'wrap') ? 'in' : unwrapped ? 'out' : undefined;
		ch.push({ type: 'chain', time: c.time * 1000, c, link: logged.find((l) => l.hash === c.hash), wrapped });
	}
	// a private payment's helpers in the same transaction — rewards or public SCRT wrapped
	// to cover it, sSCRT unwrapped to refill gas credits — are part of that payment
	for (const items of atHeight.values()) if (items.some((h) => h.kind === 'out')) items.filter((h) => h.kind === 'wrap' || h.kind === 'unwrap').forEach((h) => hidden.add(h));
	// "Swap to sSCRT" sells several tokens in one transaction: one entry, the sSCRT summed
	for (const items of atHeight.values()) {
		const swept = logged.some((l) => l.kind === 'sweep' && l.height !== undefined && l.height === items[0]?.height);
		const back = items.filter((h) => h.kind === 'in' && (swept || h.counterparty === SHADESWAP_ROUTER));
		back.slice(1).forEach((h) => hidden.add(h));
		if (back.length > 1) folded.set(back[0]!, { ...back[0]!, amount: back.reduce((t, h) => t + h.amount, 0n) });
	}
	// each log entry ties to one history item at most
	const used = new Set<LoggedTx>();
	const hist: Entry[] = history
		.filter((h) => !hidden.has(h))
		.map((h) => folded.get(h) ?? h)
		.map((h) => {
			const link = linkOf(h, logged, used);
			if (link) used.add(link);
			return { type: 'history' as const, time: (h.time ?? 0) * 1000, h, link };
		});
	const shown = new Set([...hist.map((e) => (e.type === 'history' ? e.link?.hash : undefined)), ...chain.map((c) => c.hash)].filter(Boolean));
	// our own log covers what neither shows (a vote the node's index hasn't caught up on, a refill paid from public SCRT)
	const rest: Entry[] = logged.filter((l) => l.status === 'confirmed' && !shown.has(l.hash)).map((l) => ({ type: 'logged', time: l.time, l }));
	// history items without a time keep their place at the end
	return [...hist, ...ch, ...rest].sort((a, b) => b.time - a.time);
}

/** Amount shown for a chain entry. */
export const chainAmount = (c: ChainActivity): string => (c.kind === 'vote' ? '' : formatAmount(c.amount, 4));
