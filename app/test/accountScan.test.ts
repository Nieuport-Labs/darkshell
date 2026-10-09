import { describe, expect, it, vi } from 'vitest';

// funded indexes of the fake phrase: 0 (sSCRT), 3 (SCRT only) and 7 (both)
const funded: Record<number, { s: bigint; n: bigint }> = { 0: { s: 5n, n: 0n }, 3: { s: 0n, n: 2n }, 7: { s: 1n, n: 1n } };
const asked: number[] = [];

vi.mock('../src/lib/crypto/account', () => ({
	walletFromMnemonic: (_m: string, index: number) => ({ address: `addr${index}`, index }),
}));
vi.mock('../src/lib/chain/client', () => ({
	readClient: async () => ({}),
	nativeBalance: async (_c: unknown, address: string) => funded[Number(address.slice(4))]?.n ?? 0n,
}));
vi.mock('../src/lib/chain/sscrt', () => ({
	signPermit: async (w: { index: number }) => {
		asked.push(w.index);
		return w.index;
	},
	sscrtBalance: async (_c: unknown, index: number) => funded[index]?.s ?? 0n,
}));

const { scanAccounts } = await import('../src/lib/accountScan');

describe('scanAccounts', () => {
	it('finds funded accounts past gaps and stops after 5 empty ones', async () => {
		asked.length = 0;
		const found = await scanAccounts('seed', [0]);
		expect(found.map((f) => f.index)).toEqual([3, 7]);
		expect(found[1]).toMatchObject({ address: 'addr7', sscrt: 1n, native: 1n });
		// batches 0-4, 5-9 and 10-14 (7 was funded); 15+ is past the gap
		expect(Math.max(...asked)).toBe(14);
	});
});
