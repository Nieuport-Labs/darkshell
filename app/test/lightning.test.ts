import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/chain/client', () => ({ codeHash: async () => 'ab'.repeat(32), nativeBalance: async () => 0n }));

const { lightningPayment, ATOM_TOKEN, ATOM_IBC_DENOM } = await import('../src/lib/pay/payments');

const ME = 'secret1ap26qrlp8mcq2pg6r47w43l0y8zkqm8a450s03';
const SSCRT = 'secret1k0jntykt7e4g3y88ltc60czgjuqdy4c9e8fzek';

describe('lightningPayment', () => {
	it('swaps, redeems ATOM and sends it to FixedFloat over channel-0 with the memo', async () => {
		const ref = (address: string) => ({ address, codeHash: 'cd'.repeat(32) });
		const pair = { contract: ref('secret1pair'), token0: ref(SSCRT), token1: ref(ATOM_TOKEN), stable: false };
		const quote = { route: [{ pair, from: ref(SSCRT), to: ref(ATOM_TOKEN) }], amountIn: 250_000_000n, amountOut: 1_300_000n, impactBps: 20, slippageBps: 100n };
		const plan = await lightningPayment({} as never, ME, quote, 1_250_000n, 'cosmos1ffdeposit', '123456');

		expect(plan.spends).toBe(250_000_000n);
		const [swap, redeem, transfer] = plan.msgs as unknown as Record<string, unknown>[];
		const ibc = (transfer as { params: Record<string, unknown> }).params;
		const swapMsg = swap!.msg as { send: { recipient: string; amount: string; msg: string } };
		expect(swap!.contractAddress).toBe(SSCRT);
		expect(swapMsg.send.amount).toBe('250000000');
		const inner = JSON.parse(atob(swapMsg.send.msg)) as { swap_tokens_for_exact: { expected_return: { amount: string } } };
		expect(inner.swap_tokens_for_exact.expected_return.amount).toBe('1250000');
		expect(redeem!.contractAddress).toBe(ATOM_TOKEN);
		expect(redeem!.msg).toEqual({ redeem: { amount: '1250000' } });
		expect(ibc).toMatchObject({
			receiver: 'cosmos1ffdeposit',
			source_channel: 'channel-0',
			token: { denom: ATOM_IBC_DENOM, amount: '1250000' },
			memo: '123456',
		});
	});
});
