import { describe, expect, it } from 'vitest';
import { MsgDelegate, MsgExecuteContract, MsgTransfer } from 'secretjs';
import { fromChain, fromPlan, overallOf, stepsOf } from '../src/lib/txSteps';
import { GAS_VAULT_ADDRESS, SSCRT_ADDRESS } from '../src/lib/config';
import { SHADESWAP_ROUTER } from '../src/lib/chain/shadeSwap';

const me = 'secret1k0jntykt7e4g3y88ltc60czgjuqdy4c9e8fzek';
const exec = (contract: string, msg: object, funds?: string) =>
	new MsgExecuteContract({ sender: me, contract_address: contract, code_hash: 'x', msg, sent_funds: funds ? [{ denom: 'uscrt', amount: funds }] : [] });
const ATOM = 'secret19e75l25r6sa6nhdf4lggjmgpw0vmpfvsw5cnpe';

describe('transaction steps', () => {
	it('a private transfer stays private even with a gas refill riding along', () => {
		const s = stepsOf(fromPlan([exec(SSCRT_ADDRESS, { transfer: { recipient: me, amount: '1000000' } }), exec(SSCRT_ADDRESS, { redeem: { amount: '2000000' } }), exec(GAS_VAULT_ADDRESS, { grant: {} }, '2000000')]));
		expect(s.map((x) => x.privacy)).toEqual(['private', 'public', 'public']);
		expect(s.map((x) => !!x.upkeep)).toEqual([false, true, true]);
		expect(overallOf(s)).toBe('private');
	});

	it('Lightning: swap is private, unwrap and IBC are public → partly private', () => {
		const s = stepsOf(
			fromPlan([
				exec(SSCRT_ADDRESS, { send: { recipient: SHADESWAP_ROUTER, amount: '5000000', msg: 'e30=' } }),
				exec(ATOM, { redeem: { amount: '700000' } }),
				new MsgTransfer({ sender: me, receiver: 'cosmos1abcdefghijklmnopqrstuvwxyz0123456789ab', source_channel: 'channel-0', source_port: 'transfer', token: { denom: 'ibc/x', amount: '700000' }, timeout_timestamp: '0', memo: 'tag' }),
			]),
		);
		expect(s.map((x) => [x.title.split(' ')[0], x.privacy])).toEqual([
			['Swap', 'private'],
			['Unwrap', 'public'],
			['IBC', 'public'],
		]);
		expect(overallOf(s)).toBe('partial');
	});

	it('staking is public', () => {
		const s = stepsOf(fromPlan([exec(SSCRT_ADDRESS, { redeem: { amount: '1' } }), new MsgDelegate({ delegator_address: me, validator_address: 'secretvaloper1x', amount: { denom: 'uscrt', amount: '1' } })]), { validator: () => 'Saturn' });
		expect(s[1]!.title).toBe('Stake with Saturn');
		expect(overallOf(s)).toBe('public');
	});

	it('reads chain JSON, merges reward claims, ignores a lone refill', () => {
		const s = stepsOf(
			fromChain([
				{ '@type': '/cosmos.distribution.v1beta1.MsgWithdrawDelegatorReward', validator_address: 'a' },
				{ '@type': '/cosmos.distribution.v1beta1.MsgWithdrawDelegatorReward', validator_address: 'b' },
				{ '@type': '/secret.compute.v1beta1.MsgExecuteContract', contract: SSCRT_ADDRESS, msg: { deposit: {} }, sent_funds: [{ denom: 'uscrt', amount: '300' }] },
			]),
		);
		expect(s.map((x) => x.title)).toEqual(['Claim rewards', 'Wrap SCRT → sSCRT']);
		expect(s[0]!.detail).toBe('2 validators');
		expect(overallOf(stepsOf(fromChain([{ '@type': '/secret.compute.v1beta1.MsgExecuteContract', contract: GAS_VAULT_ADDRESS, msg: { grant: {} } }])))).toBe('public');
	});
});

describe('older message versions', () => {
	it('reads a gov v1beta1 vote', () => {
		const steps = stepsOf(fromChain([{ '@type': '/cosmos.gov.v1beta1.MsgVote', proposal_id: '380', option: 'VOTE_OPTION_YES' }]));
		expect(steps).toEqual([{ title: 'Vote Yes on #380', privacy: 'public' }]);
	});
});
