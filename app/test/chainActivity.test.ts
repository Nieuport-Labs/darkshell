import { describe, expect, it, vi } from 'vitest';
vi.mock('../src/lib/chain/client', () => ({ lcdUrl: async () => '' }));
const { parseChainTx } = await import('../src/lib/chain/activity');

const me = 'secret1me';
const tx = (messages: Record<string, unknown>[], extra: object = {}) => ({ txhash: 'H', height: '10', timestamp: '2026-10-07T19:27:08Z', code: 0, tx: { body: { messages } }, ...extra });
const coin = (amount: string) => ({ denom: 'uscrt', amount });

describe('parseChainTx', () => {
	it('reads a delegation', () => {
		const a = parseChainTx(tx([{ '@type': '/cosmos.staking.v1beta1.MsgDelegate', validator_address: 'secretvaloper1v', amount: coin('8000000') }]), me);
		expect(a).toMatchObject({ kind: 'stake', amount: 8_000_000n, counterparty: 'secretvaloper1v', failed: false });
	});
	it('reads a vote', () => {
		const a = parseChainTx(tx([{ '@type': '/cosmos.gov.v1.MsgVote', proposal_id: '380', option: 'VOTE_OPTION_YES' }]), me);
		expect(a).toMatchObject({ kind: 'vote', proposal: '380', vote: 'Yes', amount: 0n });
	});
	it('sums claimed rewards from the events', () => {
		const ev = (v: string) => ({ type: 'withdraw_rewards', attributes: [{ key: 'amount', value: v }] });
		const a = parseChainTx(
			tx([{ '@type': '/cosmos.distribution.v1beta1.MsgWithdrawDelegatorReward', validator_address: 'a' }, { '@type': '/cosmos.distribution.v1beta1.MsgWithdrawDelegatorReward', validator_address: 'b' }], {
				events: [ev('100uscrt'), ev('23uscrt,5ibc/X')],
			}),
			me,
		);
		expect(a).toMatchObject({ kind: 'claim', amount: 123n, counterparty: undefined });
	});
	it('tells public SCRT in from out', () => {
		const send = (from: string, to: string) => tx([{ '@type': '/cosmos.bank.v1beta1.MsgSend', from_address: from, to_address: to, amount: [coin('5')] }]);
		expect(parseChainTx(send('secret1x', me), me)).toMatchObject({ kind: 'in', amount: 5n, counterparty: 'secret1x' });
		expect(parseChainTx(send(me, 'secret1y'), me)).toMatchObject({ kind: 'out', counterparty: 'secret1y' });
	});
	it('leaves contract calls alone to the private history', () => {
		expect(parseChainTx(tx([{ '@type': '/secret.compute.v1beta1.MsgExecuteContract' }]), me)).toBeNull();
		const a = parseChainTx(tx([{ '@type': '/secret.compute.v1beta1.MsgExecuteContract' }, { '@type': '/cosmos.staking.v1beta1.MsgDelegate', amount: coin('1') }]), me);
		expect(a).toMatchObject({ kind: 'stake' });
	});
	it('marks failed transactions', () => {
		expect(parseChainTx(tx([{ '@type': '/cosmos.gov.v1.MsgVote', proposal_id: '1', option: 3 }], { code: 5 }), me)).toMatchObject({ vote: 'No', failed: true });
	});
});
