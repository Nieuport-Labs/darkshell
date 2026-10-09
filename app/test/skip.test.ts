import { describe, expect, it } from 'vitest';
import { paysTo } from '../src/lib/pay/skip';
import fixture from './fixtures/skip-axelar-memo.json';

describe('paysTo', () => {
	// a real Skip memo: secret → Osmosis swap → Axelar → Ethereum, paying 0x…dEaD
	it('finds the recipient ABI-encoded in an Axelar payload', () => {
		expect(paysTo(fixture.memo, '0x000000000000000000000000000000000000dEaD')).toBe(true);
		expect(paysTo(fixture.memo, '0x000000000000000000000000000000000000bEEF')).toBe(false);
	});
	it('finds a recipient named in the memo', () => {
		expect(paysTo('{"forward":{"receiver":"osmo1abc"}}', 'osmo1abc')).toBe(true);
	});
});
