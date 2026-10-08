// sSCRT: balance and history through a SNIP-24 query permit (signed locally,
// no transaction, no viewing key to leak), transfers with a private memo.

import { MsgExecuteContract, type Permit, type SecretNetworkClient, type Wallet } from 'secretjs';
import { newPermit } from 'secretjs';
import { CHAIN_ID, DENOM, SSCRT_ADDRESS } from '../config';
import { codeHash } from './client';

export async function signPermit(wallet: Wallet): Promise<Permit> {
	return newPermit(wallet, wallet.address, CHAIN_ID, 'darkshell', [SSCRT_ADDRESS], ['balance', 'history'], false);
}

async function permitQuery<T>(client: SecretNetworkClient, permit: Permit, query: object): Promise<T> {
	const reply = await client.query.compute.queryContract({
		contract_address: SSCRT_ADDRESS,
		code_hash: await codeHash(client, SSCRT_ADDRESS),
		query: { with_permit: { permit, query } },
	});
	if (typeof reply === 'string') throw new Error(reply);
	const err = (reply as { generic_err?: { msg: string }; query_error?: { msg: string } }).generic_err ?? (reply as { query_error?: { msg: string } }).query_error;
	if (err) throw new Error(err.msg);
	return reply as T;
}

export async function sscrtBalance(client: SecretNetworkClient, permit: Permit): Promise<bigint> {
	const r = await permitQuery<{ balance?: { amount: string } }>(client, permit, { balance: {} });
	return BigInt(r.balance?.amount ?? '0');
}

export type HistoryKind = 'in' | 'out' | 'wrap' | 'unwrap' | 'other';

export interface HistoryItem {
	id: string;
	kind: HistoryKind;
	/** base units, always positive */
	amount: bigint;
	counterparty?: string;
	memo?: string;
	/** unix seconds */
	time?: number;
	height?: number;
}

interface RichTx {
	id: number | string;
	action: Record<string, { from?: string; sender?: string; recipient?: string; minter?: string; burner?: string; owner?: string }>;
	coins: { denom: string; amount: string };
	memo?: string | null;
	block_time?: number;
	block_height?: number;
}

interface LegacyTx {
	id: number | string;
	from: string;
	sender?: string;
	receiver: string;
	coins: { denom: string; amount: string };
	memo?: string | null;
	block_time?: number;
	block_height?: number;
}

export function parseRichTx(t: RichTx, me: string): HistoryItem {
	const [type, data = {}] = Object.entries(t.action)[0] ?? ['other', {}];
	let kind: HistoryKind = 'other';
	let counterparty: string | undefined;
	if (type === 'transfer') {
		const out = data.from === me;
		kind = out ? 'out' : 'in';
		counterparty = out ? data.recipient : data.from;
	} else if (type === 'deposit') kind = 'wrap';
	else if (type === 'redeem') kind = 'unwrap';
	else if (type === 'mint') {
		kind = 'in';
		counterparty = data.minter;
	} else if (type === 'burn') {
		kind = 'out';
		counterparty = data.burner;
	}
	return {
		id: String(t.id),
		kind,
		amount: BigInt(t.coins.amount),
		counterparty,
		memo: t.memo ?? undefined,
		time: t.block_time,
		height: t.block_height,
	};
}

/** Newest first. Uses `transaction_history`, falling back to the older `transfer_history`. */
export async function sscrtHistory(client: SecretNetworkClient, permit: Permit, me: string, pageSize = 30, page = 0): Promise<HistoryItem[]> {
	try {
		const r = await permitQuery<{ transaction_history?: { txs: RichTx[] } }>(client, permit, { transaction_history: { page_size: pageSize, page } });
		return (r.transaction_history?.txs ?? []).map((t) => parseRichTx(t, me));
	} catch {
		const r = await permitQuery<{ transfer_history?: { txs: LegacyTx[] } }>(client, permit, { transfer_history: { page_size: pageSize, page } });
		return (r.transfer_history?.txs ?? []).map((t) => ({
			id: String(t.id),
			kind: t.from === me ? 'out' : 'in',
			amount: BigInt(t.coins.amount),
			counterparty: t.from === me ? t.receiver : t.from,
			memo: t.memo ?? undefined,
			time: t.block_time,
			height: t.block_height,
		}));
	}
}

/** A MsgExecuteContract on any SNIP-20, with its code hash read live. */
export async function snip20Msg(
	client: SecretNetworkClient,
	sender: string,
	contract: string,
	msg: object,
	funds?: bigint,
): Promise<MsgExecuteContract<object>> {
	return new MsgExecuteContract({
		sender,
		contract_address: contract,
		code_hash: await codeHash(client, contract),
		msg,
		sent_funds: funds ? [{ denom: DENOM, amount: funds.toString() }] : [],
	});
}

/** SNIP-52 notification seed (and bloom parameters) for the permit's account. */
export async function notificationWatch(client: SecretNetworkClient, permit: Permit): Promise<import('../notify/snip52').Watch> {
	interface Channel {
		channel: string;
		mode: string;
		parameters?: { m: number; k: number } | null;
		data?: { packet_size?: number } | null;
	}
	const r = await permitQuery<{ channel_info?: { seed: string; channels: Channel[] } }>(client, permit, { channel_info: { channels: ['recvd', 'multirecvd'] } });
	const info = r.channel_info;
	if (!info?.seed) throw new Error('sSCRT has no notification channels');
	const multi = info.channels.find((c) => c.channel === 'multirecvd' && c.mode === 'bloom');
	return {
		seed: info.seed,
		...(multi?.parameters && multi.data?.packet_size ? { bloom: { m: multi.parameters.m, k: multi.parameters.k, packetSize: multi.data.packet_size } } : {}),
	};
}
