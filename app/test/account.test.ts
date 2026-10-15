import { describe, expect, it } from 'vitest';
import { Wallet } from 'secretjs';
import { encryptionSeedFor, forgetSeeds, newMnemonic, walletFromMnemonic, warmSeed } from '../src/lib/crypto/account';

describe('account keys', () => {
	it('match what secretjs derives itself, for several accounts', async () => {
		const m = newMnemonic();
		await warmSeed(m);
		for (const index of [0, 1, 7]) {
			const fast = walletFromMnemonic(m, index);
			const ref = new Wallet(m, { coinType: 529, bech32Prefix: 'secret', hdAccountIndex: index });
			expect(fast.address).toBe(ref.address);
			expect([...fast.publicKey]).toEqual([...ref.publicKey]);
			expect([...fast.privateKey]).toEqual([...ref.privateKey]);
			expect(fast).toBeInstanceOf(Wallet);
		}
	});

	it('is the same with or without the native seed', async () => {
		const m = newMnemonic();
		forgetSeeds();
		const cold = walletFromMnemonic(m, 2).address;
		const seedA = await encryptionSeedFor(m, 0);
		forgetSeeds();
		await warmSeed(m);
		expect(walletFromMnemonic(m, 2).address).toBe(cold);
		expect([...(await encryptionSeedFor(m, 0))]).toEqual([...seedA]);
	});
});
