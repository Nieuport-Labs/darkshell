// What the Staking tab shows and does, for the active account. Every action
// goes through `pay` (fee from gas credits, refill riding along, logged), and
// every one starts or ends in sSCRT: see chain/staking.ts.

import type { TxOutcome } from './chain/tx';
import {
	claimPlan,
	queryApr,
	queryDelegations,
	queryRestaking,
	queryRewards,
	queryUnbondings,
	queryUnbondingSeconds,
	queryValidator,
	queryValidators,
	queryWithdrawAddress,
	stakePlan,
	unstakePlan,
	type Delegation,
	type Reward,
	type Unbonding,
	type Validator,
} from './chain/staking';
import { queryMyVote, queryProposals, VOTE_LABELS, votePlan, type Proposal, type VoteOption } from './chain/governance';
import { client, pay, wallet } from './wallet.svelte';

export const staking = $state({
	/** whose figures these are (they reset when the account changes) */
	address: '',
	validators: [] as Validator[],
	delegations: [] as Delegation[],
	rewards: [] as Reward[],
	unbondings: [] as Unbonding[],
	/** validators with Secret's auto-restake on */
	restaking: [] as string[],
	/** rewards are paid to this account (not to another withdraw address) */
	ownWithdraw: true,
	unbondingSeconds: 21 * 86_400,
	apr: undefined as number | undefined,
	loading: false,
	loaded: false,
	error: '',
	proposals: [] as Proposal[],
	/** this account's votes on open proposals */
	votes: {} as Record<string, VoteOption>,
	govLoading: false,
	govError: '',
});

export const totalStaked = () => staking.delegations.reduce((s, d) => s + d.amount, 0n);
export const totalRewards = () => staking.rewards.reduce((s, r) => s + r.amount, 0n);
export const totalUnbonding = () => staking.unbondings.reduce((s, u) => s + u.amount, 0n);
export const validatorOf = (address: string) => staking.validators.find((v) => v.address === address);
export const delegationTo = (address: string) => staking.delegations.find((d) => d.validator === address)?.amount ?? 0n;
export const rewardOf = (address: string) => staking.rewards.find((r) => r.validator === address)?.amount ?? 0n;
export const validatorName = (address: string) => validatorOf(address)?.moniker ?? `${address.slice(0, 14)}…`;

function reset(address: string) {
	staking.address = address;
	staking.delegations = [];
	staking.rewards = [];
	staking.unbondings = [];
	staking.restaking = [];
	staking.votes = {};
	staking.loaded = false;
}

export async function loadStaking(): Promise<void> {
	const me = wallet.address;
	if (!me) return;
	if (staking.address !== me) reset(me);
	staking.loading = true;
	staking.error = '';
	try {
		const c = client();
		const [vals, dels, rews, unbs, restaking, withdraw, secs] = await Promise.all([
			staking.validators.length ? Promise.resolve(staking.validators) : queryValidators(c),
			queryDelegations(c, me),
			queryRewards(c, me).catch(() => []),
			queryUnbondings(c, me).catch(() => []),
			queryRestaking(c, me).catch(() => []),
			queryWithdrawAddress(c, me).catch(() => me),
			queryUnbondingSeconds(c).catch(() => staking.unbondingSeconds),
		]);
		// a stake with a validator that left the active set stays visible (and movable)
		const known = new Set(vals.map((v) => v.address));
		const extra = (await Promise.all(dels.filter((d) => !known.has(d.validator)).map((d) => queryValidator(c, d.validator)))).filter((v) => !!v);
		if (wallet.address !== me) return;
		staking.validators = [...vals.filter((v) => !extra.some((x) => x.address === v.address)), ...extra];
		staking.delegations = dels.sort((a, b) => (b.amount > a.amount ? 1 : -1));
		staking.rewards = rews;
		staking.unbondings = unbs;
		staking.restaking = restaking;
		staking.ownWithdraw = withdraw === me;
		staking.unbondingSeconds = secs || staking.unbondingSeconds;
		staking.loaded = true;
		if (staking.apr === undefined) void queryApr().then((a) => (staking.apr = a)).catch(() => {});
	} catch (e) {
		staking.error = e instanceof Error ? e.message : String(e);
	} finally {
		staking.loading = false;
	}
}

/** Rewards of `validator` that a stake/unstake may deposit (they are paid out by it). */
function wrappable(validator: string): bigint {
	if (!staking.ownWithdraw || staking.restaking.includes(validator)) return 0n;
	return rewardOf(validator);
}

type OnBroadcast = Parameters<typeof pay>[2];

export async function stake(validator: string, amount: bigint, onBroadcast?: OnBroadcast): Promise<TxOutcome> {
	const plan = await stakePlan(client(), wallet.address, validator, amount, wrappable(validator));
	const out = await pay(plan, 'stake', onBroadcast, { to: validator, amount: amount.toString(), symbol: 'SCRT', wrapped: plan.wrapped ? plan.wrapped.toString() : undefined });
	setTimeout(() => void loadStaking(), out.status === 'confirmed' ? 0 : 8000);
	return out;
}

export async function unstake(validator: string, amount: bigint, onBroadcast?: OnBroadcast): Promise<TxOutcome> {
	const plan = await unstakePlan(client(), wallet.address, validator, amount, wrappable(validator));
	const out = await pay(plan, 'unstake', onBroadcast, { to: validator, amount: amount.toString(), symbol: 'SCRT', wrapped: plan.wrapped ? plan.wrapped.toString() : undefined });
	setTimeout(() => void loadStaking(), out.status === 'confirmed' ? 0 : 8000);
	return out;
}

/** Claims all rewards straight into the private balance (one transaction). */
export async function claimAll(onBroadcast?: OnBroadcast): Promise<TxOutcome> {
	// auto-restaked rewards can vanish before the transaction runs: leave those to the chain
	const claimable = staking.rewards.filter((r) => !staking.restaking.includes(r.validator));
	if (!claimable.length) throw new Error('No rewards to claim yet.');
	const plan = await claimPlan(client(), wallet.address, claimable, staking.ownWithdraw);
	const out = await pay(plan, 'claim', onBroadcast, { amount: plan.wrapped.toString(), symbol: 'SCRT', wrapped: plan.wrapped ? plan.wrapped.toString() : undefined });
	setTimeout(() => void loadStaking(), out.status === 'confirmed' ? 0 : 8000);
	return out;
}

/* -------------------------------- governance -------------------------------- */

export async function loadGovernance(): Promise<void> {
	const me = wallet.address;
	if (staking.address !== me) reset(me);
	staking.govLoading = true;
	staking.govError = '';
	try {
		const c = client();
		const list = await queryProposals(c, 40);
		staking.proposals = list;
		const open = list.filter((p) => p.status === 'PROPOSAL_STATUS_VOTING_PERIOD');
		const votes = await Promise.all(open.map(async (p) => [p.id, await queryMyVote(c, p.id, me)] as const));
		if (wallet.address !== me) return;
		staking.votes = Object.fromEntries(votes.filter(([, v]) => v)) as Record<string, VoteOption>;
	} catch (e) {
		staking.govError = e instanceof Error ? e.message : String(e);
	} finally {
		staking.govLoading = false;
	}
}

export async function vote(id: string, option: VoteOption, onBroadcast?: OnBroadcast): Promise<TxOutcome> {
	const out = await pay(votePlan(id, wallet.address, option), 'vote', onBroadcast, { memo: `Voted ${VOTE_LABELS[option]} on proposal #${id}` });
	staking.votes = { ...staking.votes, [id]: option };
	return out;
}
