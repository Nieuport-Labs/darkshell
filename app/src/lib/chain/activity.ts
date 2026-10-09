// Activity the sSCRT history can't show: staking, rewards, votes and public
// SCRT moving in or out — whether done in this app or anywhere else. Read
// from a public node's transaction index (`message.sender` and
// `transfer.recipient`), newest first.
//
// Contract calls alone (sSCRT, ShadeSwap, the gas vault) are left out: the
// private history describes those. A transaction that also stakes, votes or
// claims is read here too; `timeline` (lib/activity.ts) drops the parts the
// private history already shows.

import { lcdUrl } from './client';

export type ChainKind = 'stake' | 'unstake' | 'restake' | 'claim' | 'vote' | 'in' | 'out' | 'ibc';

export interface ChainActivity {
	hash: string;
	/** unix seconds */
	time: number;
	height: number;
	kind: ChainKind;
	/** uscrt; 0 for a vote */
	amount: bigint;
	/** validator, sender or recipient */
	counterparty?: string;
	proposal?: string;
	/** Yes / No / Abstain / No with veto */
	vote?: string;
	failed: boolean;
}

interface TxResponse {
	txhash: string;
	height: string;
	timestamp: string;
	code: number;
	tx?: { body?: { messages?: Record<string, unknown>[] } };
	events?: { type: string; attributes?: { key: string; value: string }[] }[];
}

const T = 'cosmos.';
const VOTES: Record<string, string> = { '1': 'Yes', '2': 'Abstain', '3': 'No', '4': 'No with veto', VOTE_OPTION_YES: 'Yes', VOTE_OPTION_ABSTAIN: 'Abstain', VOTE_OPTION_NO: 'No', VOTE_OPTION_NO_WITH_VETO: 'No with veto' };

const uscrt = (coins: unknown): bigint => {
	const list = Array.isArray(coins) ? coins : coins ? [coins] : [];
	return list.reduce((s: bigint, c: { denom?: string; amount?: string }) => (c?.denom === 'uscrt' && c.amount ? s + BigInt(c.amount) : s), 0n);
};

/** "123uscrt,4ibc/…" → 123 */
const uscrtOf = (s: string | undefined): bigint =>
	(s ?? '').split(',').reduce((t, part) => {
		const m = part.trim().match(/^(\d+)uscrt$/);
		return m ? t + BigInt(m[1]) : t;
	}, 0n);

/** What one transaction did for `me`, or null when it is not for this list. */
export function parseChainTx(r: TxResponse, me: string): ChainActivity | null {
	const msgs = r.tx?.body?.messages ?? [];
	const types = msgs.map((m) => String(m['@type'] ?? ''));
	if (!msgs.length) return null;
	const base = { hash: r.txhash, time: Math.floor(new Date(r.timestamp).getTime() / 1000), height: Number(r.height), failed: r.code !== 0 };
	const has = (name: string) => types.some((t) => t.endsWith(name));
	const first = (name: string) => msgs.find((m) => String(m['@type']).endsWith(name)) ?? {};

	if (has('.MsgDelegate')) {
		const ds = msgs.filter((m) => String(m['@type']).endsWith('.MsgDelegate'));
		return { ...base, kind: 'stake', amount: ds.reduce((s, m) => s + uscrt(m.amount), 0n), counterparty: String(ds[0]!.validator_address ?? '') };
	}
	if (has('.MsgUndelegate')) {
		const m = first('.MsgUndelegate');
		return { ...base, kind: 'unstake', amount: uscrt(m.amount), counterparty: String(m.validator_address ?? '') };
	}
	if (has('.MsgBeginRedelegate')) {
		const m = first('.MsgBeginRedelegate');
		return { ...base, kind: 'restake', amount: uscrt(m.amount), counterparty: String(m.validator_dst_address ?? '') };
	}
	if (has('.MsgVote') || has('.MsgVoteWeighted')) {
		const m = first('.MsgVote');
		return { ...base, kind: 'vote', amount: 0n, proposal: String(m.proposal_id ?? ''), vote: VOTES[String(m.option)] };
	}
	if (has('.MsgWithdrawDelegatorReward')) {
		const paid = (r.events ?? []).filter((e) => e.type === 'withdraw_rewards').reduce((s, e) => s + uscrtOf(e.attributes?.find((a) => a.key === 'amount')?.value), 0n);
		const n = types.filter((t) => t.endsWith('.MsgWithdrawDelegatorReward')).length;
		return { ...base, kind: 'claim', amount: paid, counterparty: n === 1 ? String(first('.MsgWithdrawDelegatorReward').validator_address ?? '') : undefined };
	}
	if (has('.MsgTransfer')) {
		const m = first('.MsgTransfer');
		if (m.sender !== me) return null;
		return { ...base, kind: 'ibc', amount: uscrt(m.token), counterparty: String(m.receiver ?? '') };
	}
	if (has('.MsgSend') || has('.MsgMultiSend')) {
		const m = first('.MsgSend');
		if (m.to_address === me && m.from_address !== me) return { ...base, kind: 'in', amount: uscrt(m.amount), counterparty: String(m.from_address ?? '') };
		if (m.from_address === me) return { ...base, kind: 'out', amount: uscrt(m.amount), counterparty: String(m.to_address ?? '') };
	}
	return null;
}

async function search(base: string, query: string, limit: number): Promise<TxResponse[]> {
	const url = `${base}/cosmos/tx/v1beta1/txs?query=${encodeURIComponent(query)}&order_by=ORDER_BY_DESC&limit=${limit}`;
	const r = await fetch(url, { headers: { Accept: 'application/json' } });
	if (!r.ok) throw new Error(`HTTP ${r.status}`);
	return ((await r.json()) as { tx_responses?: TxResponse[] }).tx_responses ?? [];
}

/** The newest staking, governance and public-SCRT transactions of `me`. */
export async function queryChainActivity(me: string, limit = 30): Promise<ChainActivity[]> {
	const base = await lcdUrl();
	const [sent, received] = await Promise.all([search(base, `message.sender='${me}'`, limit), search(base, `transfer.recipient='${me}'`, 15).catch(() => [])]);
	const seen = new Set<string>();
	const out: ChainActivity[] = [];
	for (const r of [...sent, ...received]) {
		if (seen.has(r.txhash)) continue;
		seen.add(r.txhash);
		const a = parseChainTx(r, me);
		// an empty claim (auto-withdraw of nothing) or a 0-value send is noise
		if (a && (a.amount > 0n || a.kind === 'vote' || a.failed)) out.push(a);
	}
	return out.sort((a, b) => b.time - a.time);
}
