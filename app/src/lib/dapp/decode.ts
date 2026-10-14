// What a dApp asks to sign, in words. A direct sign doc is protobuf: its body
// is decoded here, and contract messages the page encrypted with our own
// enigma key (the page gets it through `getEnigmaUtils`) are decrypted, so the
// user sees what the contract will be told rather than "encrypted".

import { toBech32 } from 'secretjs';
import { AuthInfo, TxBody } from 'secretjs/dist/protobuf/cosmos/tx/v1beta1/tx';
import { MsgExecuteContract } from 'secretjs/dist/protobuf/secret/compute/v1beta1/msg';
import { MsgSend, MsgMultiSend } from 'secretjs/dist/protobuf/cosmos/bank/v1beta1/tx';
import { MsgTransfer } from 'secretjs/dist/protobuf/ibc/applications/transfer/v1/tx';
import { MsgBeginRedelegate, MsgDelegate, MsgUndelegate } from 'secretjs/dist/protobuf/cosmos/staking/v1beta1/tx';
import { MsgSetWithdrawAddress, MsgWithdrawDelegatorReward } from 'secretjs/dist/protobuf/cosmos/distribution/v1beta1/tx';
import { MsgVote } from 'secretjs/dist/protobuf/cosmos/gov/v1/tx';
import { MsgVote as MsgVoteV1beta1 } from 'secretjs/dist/protobuf/cosmos/gov/v1beta1/tx';
import { MsgGrantAllowance, MsgRevokeAllowance } from 'secretjs/dist/protobuf/cosmos/feegrant/v1beta1/tx';
import { MsgExec, MsgGrant, MsgRevoke } from 'secretjs/dist/protobuf/cosmos/authz/v1beta1/tx';
import { td } from '../crypto/bytes';
import { formatAmount, shortAddress } from '../format';
import { stepsOf, fromChain, type Step } from '../txSteps';
import { BECH32_PREFIX } from '../config';
import type { Enigma, SignRequest, StdSignDoc } from './provider';

export interface Review {
	/** what the screen is titled */
	title: string;
	steps: Step[];
	fee?: string;
	/** who pays the fee when it is not the account */
	feePayer?: string;
	memo?: string;
	/** a query permit: who may read what */
	permit?: { name: string; tokens: string[]; permissions: string[] };
	/** a message to sign that is not a transaction */
	text?: string;
	/** things to read twice before swiping */
	warnings: string[];
	/** each message as JSON, for "Details" */
	raw: unknown[];
}

interface Decoder {
	decode(bytes: Uint8Array): unknown;
}

const DECODERS: Record<string, Decoder> = {
	'/secret.compute.v1beta1.MsgExecuteContract': MsgExecuteContract,
	'/cosmos.bank.v1beta1.MsgSend': MsgSend,
	'/cosmos.bank.v1beta1.MsgMultiSend': MsgMultiSend,
	'/ibc.applications.transfer.v1.MsgTransfer': MsgTransfer,
	'/cosmos.staking.v1beta1.MsgDelegate': MsgDelegate,
	'/cosmos.staking.v1beta1.MsgUndelegate': MsgUndelegate,
	'/cosmos.staking.v1beta1.MsgBeginRedelegate': MsgBeginRedelegate,
	'/cosmos.distribution.v1beta1.MsgWithdrawDelegatorReward': MsgWithdrawDelegatorReward,
	'/cosmos.distribution.v1beta1.MsgSetWithdrawAddress': MsgSetWithdrawAddress,
	'/cosmos.gov.v1.MsgVote': MsgVote,
	'/cosmos.gov.v1beta1.MsgVote': MsgVoteV1beta1,
	'/cosmos.feegrant.v1beta1.MsgGrantAllowance': MsgGrantAllowance,
	'/cosmos.feegrant.v1beta1.MsgRevokeAllowance': MsgRevokeAllowance,
	'/cosmos.authz.v1beta1.MsgGrant': MsgGrant,
	'/cosmos.authz.v1beta1.MsgExec': MsgExec,
	'/cosmos.authz.v1beta1.MsgRevoke': MsgRevoke,
};

/** Message types that hand control of the account (or where its rewards go) to someone else. */
const DANGER: Record<string, string> = {
	'/cosmos.authz.v1beta1.MsgGrant': 'Gives another address the right to act for this account.',
	'/cosmos.authz.v1beta1.MsgExec': 'Acts for another account through a grant it gave.',
	'/cosmos.distribution.v1beta1.MsgSetWithdrawAddress': 'Sends all future staking rewards to another address.',
	'/cosmos.feegrant.v1beta1.MsgGrantAllowance': 'Lets another address spend this account’s SCRT on its fees.',
	'/cosmos.bank.v1beta1.MsgMultiSend': 'Sends public coins to several addresses.',
};

const coin = (c?: { denom?: string; amount?: string }) =>
	c?.amount ? `${formatAmount(BigInt(c.amount))} ${c.denom === 'uscrt' ? 'SCRT' : c.denom?.startsWith('ibc/') ? 'IBC tokens' : (c.denom ?? '')}` : '';

/** Bytes fields as text where they are addresses, base64 elsewhere (for Details). */
function plain(v: unknown): unknown {
	if (v instanceof Uint8Array) return v.length === 20 ? toBech32(BECH32_PREFIX, v) : `0x${[...v].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
	if (Array.isArray(v)) return v.map(plain);
	if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plain(x)]));
	return v;
}

/**
 * A contract message is nonce(32) ‖ pubkey(32) ‖ AES-SIV ciphertext of
 * codeHash(64 hex) ‖ JSON. Only messages encrypted with our own key open.
 */
async function openContractMsg(msg: Uint8Array, enigma: Enigma | null): Promise<unknown> {
	if (!enigma || msg.length < 64) return undefined;
	try {
		const ours = await enigma.getPubkey();
		const pub = msg.slice(32, 64);
		if (!pub.every((b, i) => b === ours[i])) return undefined;
		const plainBytes = await enigma.decrypt(msg.slice(64), msg.slice(0, 32));
		return JSON.parse(td.decode(plainBytes).slice(64));
	} catch {
		return undefined;
	}
}

async function flatOf(typeUrl: string, value: Uint8Array, enigma: Enigma | null): Promise<Record<string, unknown>> {
	const dec = DECODERS[typeUrl];
	if (!dec) return { '@type': typeUrl };
	const m = dec.decode(value) as Record<string, unknown>;
	if (typeUrl === '/secret.compute.v1beta1.MsgExecuteContract') {
		const e = m as unknown as { contract: Uint8Array; msg: Uint8Array; sent_funds: unknown };
		const opened = await openContractMsg(e.msg, enigma);
		return { '@type': typeUrl, contract: toBech32(BECH32_PREFIX, e.contract), msg: opened ?? 'encrypted', sent_funds: e.sent_funds };
	}
	if (typeUrl === '/cosmos.authz.v1beta1.MsgExec') {
		const x = m as { grantee: string; msgs: { type_url: string; value: Uint8Array }[] };
		return { '@type': typeUrl, grantee: x.grantee, msgs: await Promise.all(x.msgs.map((i) => flatOf(i.type_url, i.value, enigma))) };
	}
	return { '@type': typeUrl, ...(plain(m) as Record<string, unknown>) };
}

function stepFor(m: Record<string, unknown>): Step | null {
	const t = String(m['@type']);
	switch (t) {
		case '/cosmos.staking.v1beta1.MsgBeginRedelegate':
			return { title: 'Move stake to another validator', detail: coin(m.amount as never), privacy: 'public' };
		case '/cosmos.distribution.v1beta1.MsgSetWithdrawAddress':
			return { title: 'Send staking rewards elsewhere', detail: `to ${shortAddress(String(m.withdraw_address), 10, 4)}`, privacy: 'public' };
		case '/cosmos.feegrant.v1beta1.MsgGrantAllowance':
			return { title: 'Pay fees for another address', detail: `for ${shortAddress(String(m.grantee), 10, 4)}`, privacy: 'public' };
		case '/cosmos.feegrant.v1beta1.MsgRevokeAllowance':
			return { title: 'Stop paying fees for an address', detail: shortAddress(String(m.grantee), 10, 4), privacy: 'public' };
		case '/cosmos.authz.v1beta1.MsgGrant':
			return { title: 'Grant permission', detail: `to ${shortAddress(String(m.grantee), 10, 4)}`, privacy: 'public' };
		case '/cosmos.authz.v1beta1.MsgRevoke':
			return { title: 'Revoke permission', detail: shortAddress(String(m.grantee), 10, 4), privacy: 'public' };
		case '/cosmos.authz.v1beta1.MsgExec':
			return { title: 'Act for another account', detail: `${(m.msgs as unknown[]).length} message(s)`, privacy: 'public' };
		case '/cosmos.bank.v1beta1.MsgMultiSend':
			return { title: 'Public transfer to several addresses', privacy: 'public' };
		default:
			return null;
	}
}

function stepsFor(flat: Record<string, unknown>[]): Step[] {
	return flat.flatMap((m) => stepFor(m) ?? stepsOf(fromChain([m])));
}

function warningsFor(flat: Record<string, unknown>[], unknown: string[]): string[] {
	const w = [...new Set(flat.map((m) => DANGER[String(m['@type'])]).filter((x): x is string => !!x))];
	if (unknown.length) w.push(`DarkShell can't read ${unknown.length === 1 ? 'one message' : `${unknown.length} messages`} (${unknown.join(', ')}). Sign only if you trust this site.`);
	return w;
}

async function reviewDirect(doc: { bodyBytes: Uint8Array; authInfoBytes: Uint8Array }, enigma: Enigma | null): Promise<Review> {
	const body = TxBody.decode(doc.bodyBytes) as unknown as { messages: { type_url: string; value: Uint8Array }[]; memo: string };
	const auth = AuthInfo.decode(doc.authInfoBytes) as unknown as { fee?: { amount: { denom: string; amount: string }[]; granter: string; payer: string } };
	const flat = await Promise.all(body.messages.map((m) => flatOf(m.type_url, m.value, enigma)));
	const unknown = body.messages.filter((m) => !DECODERS[m.type_url]).map((m) => m.type_url.split('.').pop() ?? m.type_url);
	return {
		title: 'Approve transaction',
		steps: stepsFor(flat),
		fee: auth.fee?.amount?.length ? auth.fee.amount.map(coin).join(' + ') : 'No fee',
		feePayer: auth.fee?.granter || auth.fee?.payer || undefined,
		memo: body.memo || undefined,
		warnings: warningsFor(flat, unknown),
		raw: flat,
	};
}

/** Amino message types, by the `type` they carry, mapped to the protobuf names `stepsOf` reads. */
const AMINO: Record<string, string> = {
	'wasm/MsgExecuteContract': '/secret.compute.v1beta1.MsgExecuteContract',
	'cosmos-sdk/MsgSend': '/cosmos.bank.v1beta1.MsgSend',
	'cosmos-sdk/MsgMultiSend': '/cosmos.bank.v1beta1.MsgMultiSend',
	'cosmos-sdk/MsgTransfer': '/ibc.applications.transfer.v1.MsgTransfer',
	'cosmos-sdk/MsgDelegate': '/cosmos.staking.v1beta1.MsgDelegate',
	'cosmos-sdk/MsgUndelegate': '/cosmos.staking.v1beta1.MsgUndelegate',
	'cosmos-sdk/MsgBeginRedelegate': '/cosmos.staking.v1beta1.MsgBeginRedelegate',
	'cosmos-sdk/MsgWithdrawDelegationReward': '/cosmos.distribution.v1beta1.MsgWithdrawDelegatorReward',
	'cosmos-sdk/MsgModifyWithdrawAddress': '/cosmos.distribution.v1beta1.MsgSetWithdrawAddress',
	'cosmos-sdk/MsgVote': '/cosmos.gov.v1beta1.MsgVote',
	'cosmos-sdk/v1/MsgVote': '/cosmos.gov.v1.MsgVote',
	'cosmos-sdk/MsgGrantAllowance': '/cosmos.feegrant.v1beta1.MsgGrantAllowance',
	'cosmos-sdk/MsgRevokeAllowance': '/cosmos.feegrant.v1beta1.MsgRevokeAllowance',
	'cosmos-sdk/MsgGrant': '/cosmos.authz.v1beta1.MsgGrant',
	'cosmos-sdk/MsgExec': '/cosmos.authz.v1beta1.MsgExec',
};

function reviewPermit(doc: StdSignDoc): Review | null {
	const m = doc.msgs[0];
	if (doc.msgs.length !== 1 || m?.type !== 'query_permit') return null;
	const v = m.value as { permit_name?: string; allowed_tokens?: string[]; permissions?: string[] };
	return {
		title: 'Allow reading',
		steps: [],
		permit: { name: String(v.permit_name ?? ''), tokens: v.allowed_tokens ?? [], permissions: v.permissions ?? [] },
		warnings: [],
		raw: [m],
	};
}

function reviewAmino(doc: StdSignDoc): Review {
	const permit = reviewPermit(doc);
	if (permit) return permit;
	const flat = doc.msgs.map((m) => {
		const type = AMINO[m.type];
		const value = (m.value ?? {}) as Record<string, unknown>;
		// amino's MsgExecuteContract carries the encrypted msg as base64
		return type ? { '@type': type, ...value, contract: value.contract, sent_funds: value.sent_funds, msg: type.endsWith('MsgExecuteContract') ? 'encrypted' : value.msg } : { '@type': m.type };
	});
	const unknown = doc.msgs.filter((m) => !AMINO[m.type]).map((m) => m.type);
	const warnings = warningsFor(flat, unknown);
	if (doc.chain_id === '') warnings.push('This is signed without a chain: make sure you know what it is for.');
	return {
		title: 'Approve transaction',
		steps: stepsFor(flat),
		fee: doc.fee.amount.length ? doc.fee.amount.map(coin).join(' + ') : 'No fee',
		feePayer: doc.fee.granter || doc.fee.payer || undefined,
		memo: doc.memo || undefined,
		warnings,
		raw: doc.msgs,
	};
}

function reviewArbitrary(data: string | Uint8Array): Review {
	let text = typeof data === 'string' ? data : td.decode(data);
	// a JSON payload (a profile, say) reads better indented
	try {
		text = JSON.stringify(JSON.parse(text), null, 2);
	} catch {
		/* plain text */
	}
	return { title: 'Sign a message', steps: [], text, warnings: [], raw: [] };
}

export async function reviewOf(req: SignRequest, enigma: Enigma | null): Promise<Review> {
	if (req.kind === 'direct') return reviewDirect(req.doc, enigma);
	if (req.kind === 'amino') return reviewAmino(req.doc);
	return reviewArbitrary(req.data);
}
