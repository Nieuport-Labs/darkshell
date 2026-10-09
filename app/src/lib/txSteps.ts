// A transaction, step by step, and which steps are private. On Secret, what a
// SNIP-20 transfer or a ShadeSwap swap says is encrypted (amount, recipient,
// memo); everything that moves public coins is not: unwrapping (the SCRT that
// comes out is visible), wrapping, bank sends, IBC transfers, staking, votes.
// Works on the messages as the chain returns them (`@type`, decrypted where
// this wallet sent them) and on the ones a payment is about to send.

import { MsgDelegate, MsgExecuteContract, MsgSend, MsgTransfer, MsgUndelegate, MsgVote, MsgWithdrawDelegatorReward, type Msg } from 'secretjs';
import { SHADESWAP_ROUTER } from './chain/shadeSwap';
import { ibcDestinationFor } from './chain/ibc';
import { GAS_VAULT_ADDRESS, SSCRT_ADDRESS } from './config';
import { formatAmount, shortAddress } from './format';
import { privateSymbol, tokenByAddress } from './tokens';

export type Privacy = 'private' | 'public';
/** a whole transaction: every step private, none, or some */
export type Overall = Privacy | 'partial';

export interface Step {
	title: string;
	detail?: string;
	privacy: Privacy;
	/** a gas-credit refill riding along: not part of what the user did */
	upkeep?: boolean;
}

/** One message, flattened the same way whichever side it came from. */
interface Flat {
	type: string;
	contract?: string;
	msg?: unknown;
	funds?: { denom?: string; amount?: string }[];
	[k: string]: unknown;
}

const T = {
	exec: '/secret.compute.v1beta1.MsgExecuteContract',
	send: '/cosmos.bank.v1beta1.MsgSend',
	ibc: '/ibc.applications.transfer.v1.MsgTransfer',
	delegate: '/cosmos.staking.v1beta1.MsgDelegate',
	undelegate: '/cosmos.staking.v1beta1.MsgUndelegate',
	withdraw: '/cosmos.distribution.v1beta1.MsgWithdrawDelegatorReward',
	vote: '/cosmos.gov.v1.MsgVote',
};

/** From the chain (`getTx`): `@type` plus the message fields. */
export function fromChain(messages: unknown[]): Flat[] {
	return messages.map((m) => {
		const o = (m ?? {}) as Record<string, unknown>;
		return { ...o, type: String(o['@type'] ?? ''), contract: o.contract as string | undefined, funds: o.sent_funds as Flat['funds'] };
	});
}

/** From a payment about to be sent (secretjs messages keep their fields in `params`). */
export function fromPlan(msgs: Msg[]): Flat[] {
	return msgs.map((m) => {
		const p = ((m as { params?: Record<string, unknown> }).params ?? {}) as Record<string, unknown>;
		const type =
			m instanceof MsgExecuteContract
				? T.exec
				: m instanceof MsgSend
					? T.send
					: m instanceof MsgTransfer
						? T.ibc
						: m instanceof MsgDelegate
							? T.delegate
							: m instanceof MsgUndelegate
								? T.undelegate
								: m instanceof MsgWithdrawDelegatorReward
									? T.withdraw
									: m instanceof MsgVote
										? T.vote
										: 'other';
		// MsgExecuteContract keeps its fields on itself (camelCase); the others in `params`
		if (m instanceof MsgExecuteContract) return { type, contract: m.contractAddress, msg: m.msg, funds: m.sentFunds };
		return { ...p, type };
	});
}

type Coin = { denom?: string; amount?: string };

export interface Names {
	validator?: (address: string) => string;
}

const coin = (c: Coin | undefined) =>
	c?.amount ? `${formatAmount(BigInt(c.amount))} ${c.denom === 'uscrt' ? 'SCRT' : c.denom?.startsWith('ibc/') ? 'tokens' : (c.denom ?? '')}` : '';

function execStep(m: Flat): Step {
	const token = m.contract ? tokenByAddress(m.contract) : undefined;
	const sym = token ? privateSymbol(token) : 'token';
	const body = m.msg;
	if (m.contract === GAS_VAULT_ADDRESS) return { title: 'Gas credits refill', detail: coin(m.funds?.[0]), privacy: 'public', upkeep: true };
	if (typeof body !== 'object' || body === null) {
		// someone else's message: encrypted to them
		return { title: 'Contract call', detail: 'encrypted', privacy: 'private' };
	}
	const [action, args] = Object.entries(body as Record<string, Record<string, unknown>>)[0] ?? ['', {}];
	const amount = typeof args?.amount === 'string' ? formatAmount(BigInt(args.amount)) : '';
	switch (action) {
		case 'transfer':
			return { title: `Private ${sym} transfer`, detail: [amount && `${amount} ${sym}`, args?.recipient ? `to ${shortAddress(String(args.recipient), 8, 4)}` : ''].filter(Boolean).join(' '), privacy: 'private' };
		case 'send':
			if (args?.recipient === SHADESWAP_ROUTER) return { title: 'Swap on ShadeSwap', detail: amount ? `${amount} ${sym} in` : undefined, privacy: 'private' };
			return { title: `Private ${sym} transfer`, detail: amount ? `${amount} ${sym}` : undefined, privacy: 'private' };
		case 'redeem':
			return { title: `Unwrap ${sym} → public ${token?.symbol ?? ''}`.trim(), detail: amount ? `${amount} ${token?.symbol ?? ''}, visible on chain` : 'visible on chain', privacy: 'public' };
		case 'deposit':
			return { title: `Wrap ${m.contract === SSCRT_ADDRESS ? 'SCRT → sSCRT' : `→ ${sym}`}`, detail: m.funds?.[0] ? `${coin(m.funds[0])}, visible on chain` : undefined, privacy: 'public' };
		default:
			return { title: `${sym === 'token' ? 'Contract' : sym} · ${action.replace(/_/g, ' ')}`, privacy: 'private' };
	}
}

const VOTE: Record<string, string> = { '1': 'Yes', '2': 'Abstain', '3': 'No', '4': 'No with veto', VOTE_OPTION_YES: 'Yes', VOTE_OPTION_ABSTAIN: 'Abstain', VOTE_OPTION_NO: 'No', VOTE_OPTION_NO_WITH_VETO: 'No with veto' };

export function stepsOf(flat: Flat[], names: Names = {}): Step[] {
	const steps: Step[] = [];
	const val = (a: unknown) => (typeof a === 'string' ? (names.validator?.(a) ?? shortAddress(a, 14, 4)) : 'validator');
	for (const m of flat) {
		// gov v1beta1 votes (other wallets still send them) read like v1
		switch (m.type === '/cosmos.gov.v1beta1.MsgVote' ? T.vote : m.type) {
			case T.exec:
				steps.push(execStep(m));
				break;
			case T.send: {
				const amt = (m.amount as Coin[] | undefined)?.[0];
				steps.push({ title: 'Public transfer', detail: [coin(amt), m.to_address ? `to ${shortAddress(String(m.to_address), 8, 4)}` : ''].filter(Boolean).join(' '), privacy: 'public' });
				break;
			}
			case T.ibc: {
				const to = String(m.receiver ?? '');
				steps.push({ title: `IBC transfer to ${ibcDestinationFor(to)?.name ?? 'another chain'}`, detail: [coin(m.token as Coin), to ? `to ${shortAddress(to, 10, 4)}` : ''].filter(Boolean).join(' '), privacy: 'public' });
				break;
			}
			case T.delegate:
				steps.push({ title: `Stake with ${val(m.validator_address)}`, detail: coin(m.amount as Coin), privacy: 'public' });
				break;
			case T.undelegate:
				steps.push({ title: `Unstake from ${val(m.validator_address)}`, detail: coin(m.amount as Coin), privacy: 'public' });
				break;
			case T.withdraw: {
				const prev = steps.at(-1);
				if (prev?.title.startsWith('Claim rewards')) {
					const n = Number(prev.detail?.match(/^(\d+)/)?.[1] ?? '1') + 1;
					prev.title = 'Claim rewards';
					prev.detail = `${n} validators`;
				} else steps.push({ title: 'Claim rewards', detail: `from ${val(m.validator_address)}`, privacy: 'public' });
				break;
			}
			case T.vote:
				steps.push({ title: `Vote ${VOTE[String(m.option)] ?? ''} on #${String(m.proposal_id ?? '?')}`.replace('  ', ' '), privacy: 'public' });
				break;
			default:
				steps.push({ title: m.type.split('.').pop()?.replace(/^Msg/, '') || 'Message', privacy: 'public' });
		}
	}
	// a refill paid in sSCRT is an unwrap followed by the vault grant: both upkeep
	steps.forEach((st, i) => {
		const prev = steps[i - 1];
		if (st.upkeep && prev?.title.startsWith('Unwrap sSCRT')) {
			prev.upkeep = true;
			prev.title = 'Unwrap sSCRT for gas credits';
		}
	});
	return steps;
}

/** The transaction as a whole; a gas refill riding along does not count. */
export function overallOf(steps: Step[]): Overall {
	const own = steps.filter((s) => !s.upkeep);
	const list = own.length ? own : steps;
	if (!list.length) return 'private';
	const priv = list.filter((s) => s.privacy === 'private').length;
	return priv === list.length ? 'private' : priv === 0 ? 'public' : 'partial';
}

export const OVERALL_LABEL: Record<Overall, string> = { private: 'Private', public: 'Public', partial: 'Partly private' };
