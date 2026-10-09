// SCRT staking, from the private balance. The wallet holds sSCRT, so every
// staking transaction starts and ends there, in one transaction each:
//
//   stake    → redeem sSCRT + delegate
//   unstake  → undelegate (the SCRT comes back as public SCRT after unbonding;
//              the wallet then offers to make it private)
//   claim    → withdraw rewards + deposit them into sSCRT
//
// Delegating to or undelegating from a validator also pays out its pending
// rewards (x/distribution does that on every delegation change), so stake and
// unstake wrap those too — no public SCRT is ever left lying around.
// Queries and message shapes after Secret_Dashboard `src/lib/staking.ts`.

import { MsgDelegate, MsgUndelegate, MsgWithdrawDelegatorReward, type Msg, type SecretNetworkClient } from 'secretjs';
import { DENOM, GAS, SSCRT_ADDRESS } from '../config';
import { MSG_EXECUTE } from '../gas/feePayer';
import { parseTimestamp } from '../gas/feegrant-sdk';
import type { PaymentPlan } from '../pay/payments';
import { lcdUrl } from './client';
import { snip20Msg } from './sscrt';

export const MSG_DELEGATE = '/cosmos.staking.v1beta1.MsgDelegate';
export const MSG_UNDELEGATE = '/cosmos.staking.v1beta1.MsgUndelegate';
export const MSG_WITHDRAW_REWARD = '/cosmos.distribution.v1beta1.MsgWithdrawDelegatorReward';

/** rewards smaller than this stay public rather than cost a deposit message */
export const MIN_WRAP_REWARD = 10_000n; // 0.01 SCRT

export interface Validator {
	address: string;
	moniker: string;
	/** fraction, 0.05 = 5 % */
	commission: number;
	/** voting power, base units */
	tokens: bigint;
	jailed: boolean;
	bonded: boolean;
	website?: string;
	details?: string;
}

export interface Delegation {
	validator: string;
	amount: bigint;
}

export interface Reward {
	validator: string;
	/** base units, truncated (rounding up would promise more than can be claimed) */
	amount: bigint;
}

export interface Unbonding {
	validator: string;
	amount: bigint;
	completesAt: Date;
}

type RawValidator = {
	operator_address?: string;
	description?: { moniker?: string; website?: string; details?: string };
	commission?: { commission_rates?: { rate?: string } };
	tokens?: string;
	jailed?: boolean;
	status?: string;
};

function toValidator(v: RawValidator): Validator {
	return {
		address: v.operator_address ?? '',
		moniker: v.description?.moniker?.trim() || 'Unnamed validator',
		commission: Number(v.commission?.commission_rates?.rate ?? '0'),
		tokens: BigInt(v.tokens?.split('.')[0] || '0'),
		jailed: !!v.jailed,
		bonded: v.status === 'BOND_STATUS_BONDED',
		website: v.description?.website || undefined,
		details: v.description?.details || undefined,
	};
}

/** The active set, most voting power first. */
export async function queryValidators(client: SecretNetworkClient): Promise<Validator[]> {
	const r = await client.query.staking.validators({ status: 'BOND_STATUS_BONDED', pagination: { limit: '300' } });
	return (r.validators ?? [])
		.map(toValidator)
		.filter((v) => v.address)
		.sort((a, b) => (b.tokens > a.tokens ? 1 : b.tokens < a.tokens ? -1 : 0));
}

/** One validator whatever its status (a stake outlives its place in the active set). */
export async function queryValidator(client: SecretNetworkClient, address: string): Promise<Validator | undefined> {
	try {
		const r = await client.query.staking.validator({ validator_addr: address });
		return r.validator ? toValidator(r.validator) : undefined;
	} catch {
		return undefined;
	}
}

export async function queryDelegations(client: SecretNetworkClient, delegator: string): Promise<Delegation[]> {
	const r = await client.query.staking.delegatorDelegations({ delegator_addr: delegator, pagination: { limit: '300' } });
	return (r.delegation_responses ?? [])
		.map((d) => ({ validator: d.delegation?.validator_address ?? '', amount: BigInt(d.balance?.amount ?? '0') }))
		.filter((d) => d.validator && d.amount > 0n);
}

export async function queryRewards(client: SecretNetworkClient, delegator: string): Promise<Reward[]> {
	const r = await client.query.distribution.delegationTotalRewards({ delegator_address: delegator });
	return (r.rewards ?? [])
		.map((e) => ({
			validator: e.validator_address ?? '',
			amount: BigInt(e.reward?.find((c) => c.denom === DENOM)?.amount?.split('.')[0] || '0'),
		}))
		.filter((x) => x.validator && x.amount > 0n);
}

export async function queryUnbondings(client: SecretNetworkClient, delegator: string): Promise<Unbonding[]> {
	const r = await client.query.staking.delegatorUnbondingDelegations({ delegator_addr: delegator, pagination: { limit: '100' } });
	const rows: Unbonding[] = [];
	for (const u of r.unbonding_responses ?? []) {
		for (const e of u.entries ?? []) {
			rows.push({ validator: u.validator_address ?? '', amount: BigInt(e.balance ?? '0'), completesAt: parseTimestamp(e.completion_time) ?? new Date() });
		}
	}
	return rows.sort((a, b) => a.completesAt.getTime() - b.completesAt.getTime());
}

/**
 * Validators this account has Secret's auto-restake on for. The chain compounds
 * those rewards on its own schedule, so they may be gone by the time a
 * transaction runs: never count on them for a deposit.
 */
export async function queryRestaking(client: SecretNetworkClient, delegator: string): Promise<string[]> {
	const r = await client.query.distribution.restakingEntries({ delegator });
	return r.validators ?? [];
}

/** Where this account's rewards are paid (normally itself). */
export async function queryWithdrawAddress(client: SecretNetworkClient, delegator: string): Promise<string> {
	const r = await client.query.distribution.delegatorWithdrawAddress({ delegator_address: delegator });
	return r.withdraw_address || delegator;
}

/** Seconds an undelegation takes (21 days on secret-4). */
export async function queryUnbondingSeconds(client: SecretNetworkClient): Promise<number> {
	const r = await client.query.staking.params({});
	return Number(String(r.params?.unbonding_time ?? '0s').replace(/s$/, '')) || 0;
}

/**
 * Yearly staking return: inflation, less what is withheld before it reaches
 * stakers (community tax + Secret's foundation tax), over the bonded share of
 * supply. Read over REST, where the decimals arrive as strings.
 */
export async function queryApr(): Promise<number | undefined> {
	const base = (await lcdUrl()).replace(/\/+$/, '');
	const get = async <T>(path: string): Promise<T> => {
		const r = await fetch(base + path, { headers: { Accept: 'application/json' } });
		if (!r.ok) throw new Error(`HTTP ${r.status}`);
		return r.json() as Promise<T>;
	};
	const [inflation, pool, supply, dist] = await Promise.all([
		get<{ inflation?: string }>('/cosmos/mint/v1beta1/inflation'),
		get<{ pool?: { bonded_tokens?: string } }>('/cosmos/staking/v1beta1/pool'),
		get<{ amount?: { amount?: string } }>(`/cosmos/bank/v1beta1/supply/by_denom?denom=${DENOM}`),
		get<{ params?: { community_tax?: string; secret_foundation_tax?: string } }>('/cosmos/distribution/v1beta1/params'),
	]);
	const rate = Number(inflation.inflation);
	const bonded = BigInt(pool.pool?.bonded_tokens ?? '0');
	const total = BigInt(supply.amount?.amount ?? '0');
	if (!Number.isFinite(rate) || bonded === 0n || total === 0n) return undefined;
	const ratio = Number((bonded * 10_000n) / total) / 10_000;
	const withheld = Number(dist.params?.community_tax ?? '0') + Number(dist.params?.secret_foundation_tax ?? '0');
	return (rate * (1 - withheld)) / ratio;
}

/* --------------------------------- messages --------------------------------- */

const coin = (amount: bigint) => ({ denom: DENOM, amount: amount.toString() });

async function wrapMsg(client: SecretNetworkClient, sender: string, amount: bigint): Promise<Msg> {
	return snip20Msg(client, sender, SSCRT_ADDRESS, { deposit: {} }, amount);
}

/** Stake: unwrap `amount` of sSCRT and delegate it; the validator's pending rewards go private. */
export async function stakePlan(client: SecretNetworkClient, delegator: string, validator: string, amount: bigint, reward: bigint): Promise<PaymentPlan & { wrapped: bigint }> {
	const redeem = await snip20Msg(client, delegator, SSCRT_ADDRESS, { redeem: { amount: amount.toString(), denom: DENOM } });
	const msgs: Msg[] = [redeem, new MsgDelegate({ delegator_address: delegator, validator_address: validator, amount: coin(amount) })];
	const wrapped = reward >= MIN_WRAP_REWARD ? reward : 0n;
	if (wrapped) msgs.push(await wrapMsg(client, delegator, wrapped));
	return {
		msgs,
		gas: GAS.unwrap + GAS.delegate + (wrapped ? GAS.wrap : 0),
		types: [MSG_EXECUTE, MSG_DELEGATE],
		spends: amount,
		wrapped,
	};
}

/** Unstake: start unbonding; the validator's pending rewards go private now. */
export async function unstakePlan(client: SecretNetworkClient, delegator: string, validator: string, amount: bigint, reward: bigint): Promise<PaymentPlan & { wrapped: bigint }> {
	const msgs: Msg[] = [new MsgUndelegate({ delegator_address: delegator, validator_address: validator, amount: coin(amount) })];
	const wrapped = reward >= MIN_WRAP_REWARD ? reward : 0n;
	if (wrapped) msgs.push(await wrapMsg(client, delegator, wrapped));
	return { msgs, gas: GAS.undelegate + (wrapped ? GAS.wrap : 0), types: [MSG_UNDELEGATE, ...(wrapped ? [MSG_EXECUTE] : [])], spends: 0n, wrapped };
}

/** Claim: withdraw every validator's rewards and deposit the total into sSCRT. */
export async function claimPlan(client: SecretNetworkClient, delegator: string, rewards: Reward[], wrap = true): Promise<PaymentPlan & { wrapped: bigint }> {
	// the largest first; a transaction with dozens of withdrawals would only cost more gas
	const take = [...rewards].sort((a, b) => (b.amount > a.amount ? 1 : -1)).slice(0, 12);
	// rewards paid to another withdraw address can't be deposited from here
	const wrapped = wrap ? take.reduce((s, r) => s + r.amount, 0n) : 0n;
	const msgs: Msg[] = take.map((r) => new MsgWithdrawDelegatorReward({ delegator_address: delegator, validator_address: r.validator }));
	if (wrapped > 0n) msgs.push(await wrapMsg(client, delegator, wrapped));
	return { msgs, gas: GAS.claimReward * take.length + (wrapped > 0n ? GAS.wrap : 0), types: [MSG_WITHDRAW_REWARD, ...(wrapped > 0n ? [MSG_EXECUTE] : [])], spends: 0n, wrapped };
}
