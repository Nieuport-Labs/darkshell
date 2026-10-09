// On-chain governance over x/gov v1: proposals, the live tally, this account's
// vote, and voting. After Secret_Dashboard `src/lib/governance.ts`, trimmed to
// what a phone needs (no proposal submission).

import { MsgVote, VoteOption as Options, type SecretNetworkClient } from 'secretjs';
import { GAS } from '../config';
import { parseTimestamp } from '../gas/feegrant-sdk';
import type { PaymentPlan } from '../pay/payments';

export const MSG_VOTE = '/cosmos.gov.v1.MsgVote';

export type ProposalStatus =
	| 'PROPOSAL_STATUS_UNSPECIFIED'
	| 'PROPOSAL_STATUS_DEPOSIT_PERIOD'
	| 'PROPOSAL_STATUS_VOTING_PERIOD'
	| 'PROPOSAL_STATUS_PASSED'
	| 'PROPOSAL_STATUS_REJECTED'
	| 'PROPOSAL_STATUS_FAILED';

export type VoteOption = 'YES' | 'ABSTAIN' | 'NO' | 'NO_WITH_VETO';

export interface Tally {
	yes: bigint;
	abstain: bigint;
	no: bigint;
	veto: bigint;
}

export interface Proposal {
	id: string;
	title: string;
	/** the proposer's own text: untrusted, shown as plain text only */
	summary: string;
	status: ProposalStatus;
	messageTypes: string[];
	votingEndTime?: Date;
	depositEndTime?: Date;
	submitTime?: Date;
	expedited: boolean;
	finalTally: Tally;
}

export interface GovParams {
	quorum: number;
	threshold: number;
	vetoThreshold: number;
	expeditedThreshold: number;
}

function toTally(raw: Record<string, string | undefined> | undefined): Tally {
	const at = (k: string) => BigInt(raw?.[k]?.split('.')[0] || '0');
	return { yes: at('yes_count'), abstain: at('abstain_count'), no: at('no_count'), veto: at('no_with_veto_count') };
}

type RawProposal = {
	id?: string;
	title?: string;
	summary?: string;
	status?: string;
	messages?: Array<Record<string, unknown>>;
	final_tally_result?: Record<string, string | undefined>;
	submit_time?: unknown;
	deposit_end_time?: unknown;
	voting_end_time?: unknown;
	expedited?: boolean;
};

function toProposal(raw: RawProposal): Proposal {
	return {
		id: raw.id ?? '',
		title: raw.title?.trim() || `Proposal ${raw.id ?? '?'}`,
		summary: raw.summary?.trim() ?? '',
		status: (raw.status as ProposalStatus) ?? 'PROPOSAL_STATUS_UNSPECIFIED',
		messageTypes: (raw.messages ?? []).map((m) => String(m['@type'] ?? '')).filter(Boolean),
		submitTime: parseTimestamp(raw.submit_time),
		depositEndTime: parseTimestamp(raw.deposit_end_time),
		votingEndTime: parseTimestamp(raw.voting_end_time),
		expedited: !!raw.expedited,
		finalTally: toTally(raw.final_tally_result),
	};
}

/** The newest proposals, newest first (the open ones are always among them). */
export async function queryProposals(client: SecretNetworkClient, limit = 40): Promise<Proposal[]> {
	const r = await client.query.gov.proposals({ pagination: { limit: String(limit), reverse: true } } as never);
	return ((r.proposals ?? []) as RawProposal[]).map(toProposal).filter((p) => p.id);
}

export async function queryProposal(client: SecretNetworkClient, id: string): Promise<Proposal | undefined> {
	const r = await client.query.gov.proposal({ proposal_id: id });
	return r.proposal ? toProposal(r.proposal as RawProposal) : undefined;
}

/** The running count; while voting is open the stored tally stays at zero. */
export async function queryTally(client: SecretNetworkClient, id: string): Promise<Tally> {
	const r = await client.query.gov.tallyResult({ proposal_id: id });
	return toTally(r.tally as Record<string, string | undefined>);
}

/** How this account voted, if it has (the chain answers "no vote" with an error). */
export async function queryMyVote(client: SecretNetworkClient, id: string, voter: string): Promise<VoteOption | undefined> {
	try {
		const r = await client.query.gov.vote({ proposal_id: id, voter });
		const o = r.vote?.options?.[0]?.option;
		return o ? (String(o).replace('VOTE_OPTION_', '') as VoteOption) : undefined;
	} catch {
		return undefined;
	}
}

export async function queryGovParams(client: SecretNetworkClient): Promise<GovParams> {
	const r = await client.query.gov.params({ params_type: 'tallying' });
	const p = r.params as Record<string, string | undefined> | undefined;
	const frac = (v: string | undefined, d: number) => (Number(v) > 0 ? Number(v) : d);
	return {
		quorum: frac(p?.quorum, 0.334),
		threshold: frac(p?.threshold, 0.5),
		vetoThreshold: frac(p?.veto_threshold, 0.334),
		expeditedThreshold: frac(p?.expedited_threshold, frac(p?.threshold, 0.5)),
	};
}

export async function queryBondedTokens(client: SecretNetworkClient): Promise<bigint> {
	const r = await client.query.staking.pool({});
	return BigInt(r.pool?.bonded_tokens ?? '0');
}

export interface Outcome {
	turnout: number;
	quorum: number;
	quorumMet: boolean;
	yesRatio: number;
	vetoed: boolean;
	threshold: number;
	passing: boolean;
}

/** The chain's three tests: quorum, veto, then yes among yes/no/veto. */
export function evaluate(t: Tally, bonded: bigint, params: GovParams, expedited: boolean): Outcome | undefined {
	if (bonded <= 0n) return undefined;
	const voted = t.yes + t.abstain + t.no + t.veto;
	const decisive = t.yes + t.no + t.veto;
	const ratio = (a: bigint, b: bigint) => (b <= 0n ? 0 : Number((a * 1_000_000n) / b) / 1_000_000);
	const turnout = ratio(voted, bonded);
	const yesRatio = ratio(t.yes, decisive);
	const vetoed = ratio(t.veto, voted) >= params.vetoThreshold;
	const threshold = expedited ? params.expeditedThreshold : params.threshold;
	const quorumMet = turnout >= params.quorum;
	return { turnout, quorum: params.quorum, quorumMet, yesRatio, vetoed, threshold, passing: quorumMet && !vetoed && decisive > 0n && yesRatio > threshold };
}

export const VOTE_LABELS: Record<VoteOption, string> = { YES: 'Yes', NO: 'No', NO_WITH_VETO: 'No with veto', ABSTAIN: 'Abstain' };

export const STATUS_LABELS: Record<ProposalStatus, string> = {
	PROPOSAL_STATUS_UNSPECIFIED: 'Unknown',
	PROPOSAL_STATUS_DEPOSIT_PERIOD: 'Deposit',
	PROPOSAL_STATUS_VOTING_PERIOD: 'Voting',
	PROPOSAL_STATUS_PASSED: 'Passed',
	PROPOSAL_STATUS_REJECTED: 'Rejected',
	PROPOSAL_STATUS_FAILED: 'Failed',
};

/** "Ends in 3d 4h" while voting (or deposit) is open. */
export function timeLeft(p: Proposal): string | undefined {
	const end = p.status === 'PROPOSAL_STATUS_VOTING_PERIOD' ? p.votingEndTime : p.status === 'PROPOSAL_STATUS_DEPOSIT_PERIOD' ? p.depositEndTime : undefined;
	if (!end) return undefined;
	const min = Math.floor((end.getTime() - Date.now()) / 60_000);
	if (min <= 0) return 'Closing';
	if (min < 60) return `Ends in ${min}m`;
	const h = Math.floor(min / 60);
	return h < 48 ? `Ends in ${h}h` : `Ends in ${Math.floor(h / 24)}d ${h % 24}h`;
}

/** `/cosmos.upgrade.v1beta1.MsgSoftwareUpgrade` → `Software upgrade`. */
export function messageTypeLabel(typeUrl: string): string {
	const words = (typeUrl.split('.').pop() ?? typeUrl)
		.replace(/^Msg/, '')
		.replace(/Proposal$/, '')
		.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
		.trim();
	return words ? words.charAt(0).toUpperCase() + words.slice(1).toLowerCase() : 'Text';
}

/** A vote. The message takes the numeric protobuf enum, not the query's string. */
export function votePlan(proposalId: string, voter: string, option: VoteOption): PaymentPlan {
	const numeric: Record<VoteOption, number> = {
		YES: Options.VOTE_OPTION_YES,
		ABSTAIN: Options.VOTE_OPTION_ABSTAIN,
		NO: Options.VOTE_OPTION_NO,
		NO_WITH_VETO: Options.VOTE_OPTION_NO_WITH_VETO,
	};
	return {
		msgs: [new MsgVote({ proposal_id: proposalId, voter, option: numeric[option], metadata: '' })],
		gas: GAS.vote,
		types: [MSG_VOTE],
		spends: 0n,
	};
}
