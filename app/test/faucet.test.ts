import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { claimFaucet, lastClaim, FaucetError } = await import('../src/lib/gas/faucet');
const { kv } = await import('../src/lib/storage');

const ADDR = 'secret1lr8f2gmfqwldtjehxn8xy8tyff9kemndl949y0';
const reply = (status: number, body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status }));

describe('fee faucet', () => {
	afterEach(async () => {
		vi.unstubAllGlobals();
		await kv.clear();
	});

	it('claims a grant and remembers when', async () => {
		const f = reply(200, { feegrant: { allowance: {} }, address: ADDR });
		vi.stubGlobal('fetch', f);
		await claimFaucet(ADDR);
		expect(f).toHaveBeenCalledWith(`https://faucet.libertarianskastrana.cz/claim/${ADDR}`);
		expect(await lastClaim(ADDR)).toBeGreaterThan(0);
		// once a day
		await expect(claimFaucet(ADDR)).rejects.toBeInstanceOf(FaucetError);
	});

	it('reports the faucet error', async () => {
		vi.stubGlobal('fetch', reply(400, { error: 'Address is invalid' }));
		await expect(claimFaucet(ADDR)).rejects.toThrow(/Address is invalid/);
		expect(await lastClaim(ADDR)).toBe(0);
	});
});
