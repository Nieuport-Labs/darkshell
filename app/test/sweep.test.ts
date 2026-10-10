import { describe, expect, it } from 'vitest';
import { timeline } from '../src/lib/activity';
import type { HistoryItem } from '../src/lib/chain/sscrt';
import { SHADESWAP_ROUTER } from '../src/lib/chain/shadeSwap';
import { isDust, swappable, type OtherToken } from '../src/lib/pay/dust.svelte';
import { price } from '../src/lib/price.svelte';

const tok = (key: string, out: bigint | null, dust = false): OtherToken => ({
	key,
	token: { symbol: key, name: key, address: key, decimals: 6 },
	amount: 1n,
	quote: out === null ? undefined : { route: [], amountIn: 1n, amountOut: out, minOut: out, slippageBps: 100n },
	dust,
});

describe('swap to sSCRT', () => {
	it('calls under a cent dust, by the SCRT price', () => {
		price.usd = 0.008;
		expect(isDust(1_000_000n)).toBe(true); // 1 sSCRT = $0.008
		expect(isDust(2_000_000n)).toBe(false); // $0.016
		price.usd = null;
		expect(isDust(500_000n)).toBe(true); // no price: under 1 sSCRT
		expect(isDust(1_000_000n)).toBe(false);
	});

	it('shows priced tokens, leaving dust out only when asked', () => {
		const list = [tok('A', 5n), tok('B', 1n, true), tok('C', null, true)];
		expect(swappable(list, true).map((t) => t.key)).toEqual(['A']);
		expect(swappable(list, false).map((t) => t.key)).toEqual(['A', 'B']);
	});

	it('shows the sSCRT a multi-token swap brought back as one entry, tied to its log', () => {
		const back = (id: string, amount: bigint): HistoryItem => ({ id, kind: 'in', amount, counterparty: SHADESWAP_ROUTER, height: 500, time: 500 });
		const logged = [{ hash: 'S', kind: 'sweep', time: 500_000, height: 500, spent: '0', status: 'confirmed' }] as never;
		const e = timeline([back('2', 3n), back('1', 4n)], [], logged);
		expect(e).toHaveLength(1);
		expect(e[0]!.type === 'history' && e[0]!.h.amount).toBe(7n);
		expect(e[0]!.type === 'history' && e[0]!.link?.hash).toBe('S');
	});
});
