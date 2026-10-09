import { describe, expect, it } from 'vitest';
import { fromBase, isBtcAddress, isEthAddress, isXmrAddress, parseExternal, sciToBigInt, toBase } from '../src/lib/pay/external';

const XMR = '44AFFq5kSiGBoZ4NMDwYtN18obc8AemS33DBLWs3H7otXft3XjrpDtQGv7SqSsaBYBb98uNbr2VBBEt7f2wfn3RVGQBEP3A';

describe('addresses', () => {
	it('checks EIP-55', () => {
		expect(isEthAddress('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed')).toBe(true);
		expect(isEthAddress('0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed')).toBe(true);
		expect(isEthAddress('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAeD')).toBe(false);
		expect(isEthAddress('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAe')).toBe(false);
	});
	it('checks Bitcoin addresses', () => {
		expect(isBtcAddress('bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq')).toBe(true);
		expect(isBtcAddress('bc1p5d7rjq7g6rdk2yhzks9smlaqtedr4dekq08ge8ztwac72sfr9rusxg3297')).toBe(true);
		expect(isBtcAddress('1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2')).toBe(true);
		expect(isBtcAddress('3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy')).toBe(true);
		expect(isBtcAddress('bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdx')).toBe(false);
		expect(isBtcAddress('1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN3')).toBe(false);
	});
	it('checks Monero addresses', () => {
		expect(isXmrAddress(XMR)).toBe(true);
		expect(isXmrAddress(XMR.slice(0, -1) + 'B')).toBe(false);
	});
});

describe('amounts', () => {
	it('reads EIP-681 values', () => {
		expect(sciToBigInt('2.014e18')).toBe(2_014_000_000_000_000_000n);
		expect(sciToBigInt('1000')).toBe(1000n);
		expect(() => sciToBigInt('1.5e0')).toThrow();
	});
	it('converts both ways', () => {
		expect(fromBase(1_500_000_000_000_000n, 18)).toBe('0.0015');
		expect(fromBase(100_000_000n, 8)).toBe('1');
		expect(toBase('0.0015', 18)).toBe(1_500_000_000_000_000n);
		expect(toBase('0.000000001', 8)).toBeNull();
		expect(toBase('0', 8)).toBeNull();
	});
});

describe('parseExternal', () => {
	it('reads an EIP-681 request with a network', () => {
		expect(parseExternal('ethereum:0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed@42161?value=1.5e16')).toEqual({
			kind: 'external', coin: 'ETH', address: '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed', network: 'arbitrum', amount: '0.015',
		});
	});
	it('takes a bare 0x address without a network', () => {
		expect(parseExternal('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed')).toMatchObject({ coin: 'ETH', network: undefined, amount: undefined });
	});
	it('refuses token requests, unknown networks and bad checksums', () => {
		expect(() => parseExternal('ethereum:0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed/transfer?address=0x1&uint256=1')).toThrow(/token/);
		expect(() => parseExternal('ethereum:0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed@56')).toThrow(/56/);
		expect(() => parseExternal('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAeD')).toThrow(/checksum/);
	});
	it('reads BIP-21, and prefers its Lightning invoice', () => {
		expect(parseExternal('bitcoin:bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq?amount=0.001&message=Coffee')).toEqual({
			kind: 'external', coin: 'BTC', address: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq', amount: '0.001', note: 'Coffee',
		});
		expect(parseExternal('bitcoin:bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq?amount=0.001&lightning=lnbc10u1xyz')).toEqual({ lightning: 'lnbc10u1xyz' });
	});
	it('reads a Monero request', () => {
		expect(parseExternal(`monero:${XMR}?tx_amount=0.25&tx_description=Rent`)).toEqual({ kind: 'external', coin: 'XMR', address: XMR, amount: '0.25', note: 'Rent' });
		expect(parseExternal(XMR)).toMatchObject({ coin: 'XMR' });
	});
	it('leaves other things alone', () => {
		expect(parseExternal('secret1qpr7pk7m0m47eamjp7euwq48vnsel462d600ms')).toBeNull();
		expect(parseExternal('hello')).toBeNull();
	});
});
