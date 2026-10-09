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

/** The logged send `h` belongs to, matched by amount and time. */
export function linkOf(h: HistoryItem, logged: LoggedTx[]): LoggedTx | undefined {
	if (!h.time || h.kind === 'in') return undefined;
	const near = (l: LoggedTx) => Math.abs(l.time - h.time! * 1000) < WINDOW_MS;
	const amount = h.amount.toString();
	if (h.kind === 'unwrap') {
		const refill = logged.find((l) => l.refilled === amount && near(l));
		if (refill) return refill;
	}
	if (h.kind === 'wrap') return logged.find((l) => l.wrapped === amount && near(l)) ?? logged.find((l) => l.kind === 'wrap' && near(l));
	return logged.find((l) => l.spent === amount && near(l));
}

export function describe(h: HistoryItem, link?: LoggedTx): Described {
	const out = (title: string, detail: string, icon: Icon = 'out'): Described => ({ title, detail, sign: '−', icon, link });
	if (h.kind === 'in') return { title: 'Received', detail: h.counterparty ? `from ${shortAddress(h.counterparty, 6, 4)}` : '', sign: '+', icon: 'in' };
	if (h.kind === 'wrap' && link?.wrapped === h.amount.toString()) {
		if (link.kind === 'stake' || link.kind === 'unstake' || link.kind === 'claim') return { title: 'Staking rewards', detail: 'claimed privately', sign: '+', icon: 'stake', link };
		return { title: 'Made private', detail: 'rewards and public SCRT, for a payment', sign: '+', icon: 'shield', link };
	}
	if (h.kind === 'wrap') return { title: 'Made private', detail: 'from public SCRT', sign: '+', icon: 'shield', link };
	if (link?.kind === 'stake') return out('Staked', 'SCRT with a validator', 'stake');
	if (link?.kind === 'lightning') return out('Lightning payment', 'via FixedFloat', 'bolt');
	if (link?.kind === 'refill' || (h.kind === 'unwrap' && link?.refilled === h.amount.toString())) return out('Gas credits', 'refill', 'gas');
	if (link?.kind === 'invoice') return out('Paid invoice', link.to ? `to ${shortAddress(link.to, 6, 4)}` : '', h.counterparty === SHADESWAP_ROUTER ? 'swap' : 'out');
	if (link?.kind === 'ibc') return out('Sent', 'to another chain');
	if (h.kind === 'out' && h.counterparty === SHADESWAP_ROUTER) return out('Swapped', 'on ShadeSwap', 'swap');
	if (h.kind === 'out') return out('Sent', h.counterparty ? `to ${shortAddress(h.counterparty, 6, 4)}` : '');
	if (h.kind === 'unwrap') return link ? out('Sent', 'as public SCRT') : out('Unwrapped', 'to public SCRT');
	return { title: 'Other', detail: '', sign: '', icon: 'out' };
}

/** A logged send the chain history does not show yet (still in flight, or failed). */
export function unsettled(logged: LoggedTx[], history: HistoryItem[]): LoggedTx[] {
	return logged.filter((l) => {
		if (l.status !== 'pending' && l.status !== 'failed') return false;
		if (l.status === 'failed' && Date.now() - l.time > 24 * 3600_000) return false;
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
		stake: ['Staking', 'stake'],
		unstake: ['Unstaking', 'stake'],
		claim: ['Claiming rewards', 'stake'],
		vote: ['Voting', 'vote'],
	};
	const done: Record<LoggedTx['kind'], string> = {
		send: 'Sent',
		invoice: 'Paid invoice',
		ibc: 'Sent to another chain',
		wrap: 'Made private',
		refill: 'Gas credits',
		lightning: 'Lightning payment',
		stake: 'Staked',
		unstake: 'Unstaked',
		claim: 'Staking rewards',
		vote: l.memo?.replace(/ on proposal #\d+$/, '') || 'Voted',
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
export function describeChain(c: ChainActivity, validator: (a: string) => string = (a) => shortAddress(a, 10, 4)): Described {
	const val = c.counterparty ? validator(c.counterparty) : '';
	const r = (title: string, detail: string, sign: Described['sign'], icon: Icon): Described => ({ title: c.failed ? `${title} failed` : title, detail, sign, icon });
	switch (c.kind) {
		case 'stake':
			return r('Staked', val ? `with ${val}` : '', '', 'stake');
		case 'unstake':
			return r('Unstaked', val ? `from ${val} · back in 21 days` : 'back in 21 days', '', 'stake');
		case 'restake':
			return r('Moved stake', val ? `to ${val}` : '', '', 'stake');
		case 'claim':
			return r('Staking rewards', 'collected as public SCRT', '+', 'stake');
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
	| { type: 'chain'; time: number; c: ChainActivity; link?: LoggedTx }
	| { type: 'logged'; time: number; l: LoggedTx };

/**
 * Everything the account did, newest first: the private sSCRT history, the
 * chain's staking/governance/public-SCRT transactions, and our own log for
 * what neither shows (a vote or unstake the node's index hasn't caught up on,
 * a refill paid from public SCRT). Unsettled sends are listed separately.
 */
export function timeline(history: HistoryItem[], chain: ChainActivity[], logged: LoggedTx[]): Entry[] {
	const hist: Entry[] = history.map((h) => ({ type: 'history', time: (h.time ?? 0) * 1000, h, link: linkOf(h, logged) }));
	const linked = new Set(hist.map((e) => (e.type === 'history' ? e.link?.hash : undefined)).filter(Boolean));
	const hashes = new Set(chain.map((c) => c.hash));
	// a transaction the private history already shows (a stake made here shows as its unwrap,
	// claimed rewards as their wrap) is not listed twice; unstaking and votes it can't show
	const ch: Entry[] = chain
		.filter((c) => !linked.has(c.hash) || c.kind === 'unstake' || c.kind === 'restake' || c.kind === 'vote')
		.map((c) => ({ type: 'chain', time: c.time * 1000, c, link: logged.find((l) => l.hash === c.hash) }));
	const rest: Entry[] = logged
		.filter((l) => l.status === 'confirmed' && !linked.has(l.hash) && !hashes.has(l.hash))
		.map((l) => ({ type: 'logged', time: l.time, l }));
	// history items without a time keep their place at the end
	return [...hist, ...ch, ...rest].sort((a, b) => b.time - a.time);
}

/** Amount shown for a chain entry. */
export const chainAmount = (c: ChainActivity): string => (c.kind === 'vote' ? '' : formatAmount(c.amount, 4));
