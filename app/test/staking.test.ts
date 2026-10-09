import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/chain/sscrt', () => ({
	snip20Msg: async (_c: unknown, sender: string, contract: string, msg: object, funds?: bigint) => ({ kind: 'exec', sender, contract, msg, funds }),
}));
vi.mock('../src/lib/chain/client', () => ({ lcdUrl: async () => '' }));

const { claimPlan, stakePlan, suggestValidator, unstakePlan, MIN_WRAP_REWARD } = await import('../src/lib/chain/staking');
const { votePlan } = await import('../src/lib/chain/governance');

const me = 'secret1me';
const val = 'secretvaloper1v';
const c = {} as never;

describe('staking plans', () => {
	it('stake: redeem, delegate, then deposit the paid-out rewards', async () => {
		const p = await stakePlan(c, me, val, 5_000_000n, 300_000n);
		expect(p.msgs).toHaveLength(3);
		expect((p.msgs[0] as unknown as { msg: object }).msg).toEqual({ redeem: { amount: '5000000', denom: 'uscrt' } });
		expect(p.msgs[1]!.constructor.name).toBe('MsgDelegate');
		expect(p.msgs[2]).toMatchObject({ msg: { deposit: {} }, funds: 300_000n });
		expect(p.spends).toBe(5_000_000n);
		expect(p.wrapped).toBe(300_000n);
	});

	it('stake: tiny rewards stay public (no deposit)', async () => {
		const p = await stakePlan(c, me, val, 1_000_000n, MIN_WRAP_REWARD - 1n);
		expect(p.msgs).toHaveLength(2);
		expect(p.wrapped).toBe(0n);
	});

	it('unstake spends no sSCRT', async () => {
		const p = await unstakePlan(c, me, val, 2_000_000n, 0n);
		expect(p.msgs.map((m) => m.constructor.name)).toEqual(['MsgUndelegate']);
		expect(p.spends).toBe(0n);
	});

	it('claim: one withdraw per validator, then one deposit of the total', async () => {
		const p = await claimPlan(c, me, [
			{ validator: 'a', amount: 100n },
			{ validator: 'b', amount: 250n },
		]);
		expect(p.msgs.slice(0, 2).map((m) => m.constructor.name)).toEqual(['MsgWithdrawDelegatorReward', 'MsgWithdrawDelegatorReward']);
		expect(p.msgs[2]).toMatchObject({ msg: { deposit: {} }, funds: 350n });
		expect(p.wrapped).toBe(350n);
	});

	it('claim to another withdraw address deposits nothing', async () => {
		const p = await claimPlan(c, me, [{ validator: 'a', amount: 100n }], false);
		expect(p.msgs).toHaveLength(1);
		expect(p.types).toEqual(['/cosmos.distribution.v1beta1.MsgWithdrawDelegatorReward']);
	});

	it('vote uses the numeric option', () => {
		const p = votePlan('380', me, 'NO_WITH_VETO');
		expect((p.msgs[0] as unknown as { params: { option: number } }).params.option).toBe(4);
	});
});

describe('suggestValidator', () => {
	const v = (address: string, tokens: number, commission = 0.05, extra: object = {}) => ({ address, moniker: address, commission, tokens: BigInt(tokens), jailed: false, bonded: true, ...extra });
	const set = [v('big1', 900), v('big2', 800), v('big3', 700), v('mid1', 300), v('mid2', 200, 0.2), v('zero', 150, 0), v('jail', 100, 0.05, { jailed: true }), v('low', 100)];

	it('keeps the user on a validator they already use', () => {
		expect(suggestValidator(set, ['big1'], 'a')?.address).toBe('big1');
	});
	it('otherwise picks outside the biggest third, fair commission, not jailed', () => {
		for (const seed of ['a', 'b', 'secret1xyz', 'secret1abc']) {
			expect(['mid1', 'low']).toContain(suggestValidator(set, [], seed)?.address);
		}
	});
	it('is stable for one account', () => {
		expect(suggestValidator(set, [], 'secret1q')?.address).toBe(suggestValidator(set, [], 'secret1q')?.address);
	});
	it('handles no validators', () => {
		expect(suggestValidator([], [], 'a')).toBeUndefined();
	});
});
