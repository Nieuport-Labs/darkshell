import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { walletFromMnemonic, encryptionSeedFor } from '../src/lib/crypto/account';
import { delayFor, recordFailure, resetFailures, waitMs } from '../src/lib/crypto/lockout';
import { createVault, openVault, saveVault, vaultKind, WrongPasswordError } from '../src/lib/crypto/vault';
import { rePrefix } from '../src/lib/chain/ibc';
import { ffCall, FfError, hmacHex, satsToBtc } from '../src/lib/ff/fixedfloat';

const TEST_MNEMONIC =
	'grant rice replace explain federal release fix clever romance raise often wild taxi quarter soccer fiber love must tape steak together observe swap guitar';
const ADDR0 = 'secret1ap26qrlp8mcq2pg6r47w43l0y8zkqm8a450s03';
const CHEAP = { t: 1, m: 256, p: 1 };

describe('accounts on one seed', () => {
	it('index 0 is the classic address, others differ deterministically', async () => {
		expect(walletFromMnemonic(TEST_MNEMONIC, 0).address).toBe(ADDR0);
		const a1 = walletFromMnemonic(TEST_MNEMONIC, 1).address;
		expect(a1).not.toBe(ADDR0);
		expect(walletFromMnemonic(TEST_MNEMONIC, 1).address).toBe(a1);
		expect(await encryptionSeedFor(TEST_MNEMONIC, 1)).not.toEqual(await encryptionSeedFor(TEST_MNEMONIC, 0));
	});
	it('cosmos address is the same account bytes', () => {
		const c = rePrefix(ADDR0, 'cosmos');
		expect(c.startsWith('cosmos1')).toBe(true);
		expect(rePrefix(c, 'secret')).toBe(ADDR0);
	});
});

describe('PIN vault', () => {
	it('stores the kind, saves changes without the PIN, rejects a wrong PIN', async () => {
		const v = await createVault('123456', { mnemonic: TEST_MNEMONIC, accounts: [{ index: 0, name: 'Account 1' }] }, ADDR0, 'pin', CHEAP);
		expect(await vaultKind()).toBe('pin');
		v.secrets.accounts!.push({ index: 1, name: 'Savings' });
		await saveVault(v);
		const back = await openVault('123456');
		expect(back.secrets.accounts!.map((a) => a.name)).toEqual(['Account 1', 'Savings']);
		await expect(openVault('654321')).rejects.toBeInstanceOf(WrongPasswordError);
	});

	it('locks out progressively after 5 wrong PINs', async () => {
		await resetFailures();
		expect(delayFor(4)).toBe(0);
		expect(delayFor(5)).toBe(30_000);
		expect(delayFor(6)).toBe(60_000);
		expect(delayFor(50)).toBe(60 * 60_000);
		const t = 1_000_000;
		for (let i = 0; i < 4; i++) expect(await recordFailure(t)).toBe(0);
		expect(await recordFailure(t)).toBe(30_000);
		expect(await waitMs(t + 10_000)).toBe(20_000);
		await resetFailures();
		expect(await waitMs(t)).toBe(0);
	});
});

describe('FixedFloat client', () => {
	it('signs the exact body with HMAC-SHA256 (RFC 4231 test case 2)', async () => {
		expect(await hmacHex('Jefe', 'what do ya want for nothing?')).toBe('5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843');
	});

	it('sends key + signature headers and unwraps data', async () => {
		let seen: { url: string; headers: Record<string, string>; body: string } | undefined;
		const data = await ffCall<{ ok: number }>('price', { a: 1 }, { key: 'K', secret: 'S' }, async (url, headers, body) => {
			seen = { url, headers, body };
			return { code: 0, msg: 'OK', data: { ok: 1 } };
		});
		expect(data).toEqual({ ok: 1 });
		expect(seen!.url).toBe('https://ff.io/api/v2/price');
		expect(seen!.body).toBe('{"a":1}');
		expect(seen!.headers['X-API-KEY']).toBe('K');
		expect(seen!.headers['X-API-SIGN']).toBe(await hmacHex('S', '{"a":1}'));
	});

	it('turns API errors into FfError', async () => {
		await expect(ffCall('create', {}, { key: 'K', secret: 'S' }, async () => ({ code: 301, msg: 'Invalid address' }))).rejects.toBeInstanceOf(FfError);
		await expect(ffCall('create', {}, undefined)).rejects.toBeInstanceOf(FfError);
	});

	it('converts sats to BTC exactly', () => {
		expect(satsToBtc(1n)).toBe('0.00000001');
		expect(satsToBtc(21_000n)).toBe('0.00021000');
		expect(satsToBtc(150_000_000n)).toBe('1.50000000');
	});
});
