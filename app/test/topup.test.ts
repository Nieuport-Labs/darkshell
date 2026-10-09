import { describe, expect, it } from 'vitest';
import { planTopUp, ShortError } from '../src/lib/pay/topup';

describe('planTopUp', () => {
	it('nothing extra when sSCRT covers it and rewards are small', () => {
		expect(planTopUp(1_000_000n, 5_000_000n, 50_000n, 0n).deposit).toBe(0n);
	});
	it('takes rewards along when they are worth it', () => {
		expect(planTopUp(1_000_000n, 5_000_000n, 200_000n, 0n)).toEqual({ claim: true, fromRewards: 200_000n, fromNative: 0n, deposit: 200_000n });
	});
	it('covers a shortfall with rewards first, then public SCRT', () => {
		expect(planTopUp(3_000_000n, 1_000_000n, 500_000n, 9_000_000n)).toEqual({ claim: true, fromRewards: 500_000n, fromNative: 1_500_000n, deposit: 2_000_000n });
	});
	it('covers a shortfall from public SCRT alone when rewards are dust', () => {
		expect(planTopUp(2_000_000n, 1_000_000n, 5_000n, 3_000_000n)).toMatchObject({ claim: false, fromNative: 1_000_000n, deposit: 1_000_000n });
	});
	it('refuses what the account cannot cover', () => {
		expect(() => planTopUp(10_000_000n, 1_000_000n, 500_000n, 1_000_000n)).toThrow(ShortError);
	});
});
