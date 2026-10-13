import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { signingClient } from '../src/lib/chain/client';
import { CONSENSUS_IO_PUBKEY } from '../src/lib/config';
import { newMnemonic, walletFromMnemonic } from '../src/lib/crypto/account';
import { fromB64 } from '../src/lib/crypto/bytes';
import { mixRoot } from '../src/lib/crypto/hwkey';
import { accountKv, closeLocalStore, encryptPlainRecords, openLocalStore } from '../src/lib/crypto/localStore';
import { createVault, openVault, saveVault, vaultRecord } from '../src/lib/crypto/vault';
import { setSheetWord, sheetWord } from '../src/lib/sheetWord';
import { kv } from '../src/lib/storage';

const CHEAP = { t: 1, m: 256, p: 1 };
const ADDR = 'secret1k0jntykt7e4g3y88ltc60czgjuqdy4c9e8fzek';
const TO = 'secret1kkmu4vydkppkhzmx00glm20vn47t09544adv0g';

async function rawDump(): Promise<string> {
	const db = await new Promise<IDBDatabase>((r) => {
		const q = indexedDB.open('darkshell', 1);
		q.onsuccess = () => r(q.result);
	});
	const all = await new Promise<[IDBValidKey[], unknown[]]>((r) => {
		const tx = db.transaction('kv', 'readonly');
		const keys = tx.objectStore('kv').getAllKeys();
		const values = tx.objectStore('kv').getAll();
		tx.oncomplete = () => r([keys.result, values.result]);
	});
	db.close();
	return JSON.stringify(all);
}

describe('local store', () => {
	afterEach(async () => {
		closeLocalStore();
		await kv.clear();
	});

	it('keeps per-account records encrypted, under names that do not show the address', async () => {
		await openLocalStore(newMnemonic());
		await accountKv.set('txlog', ADDR, [{ hash: 'H', kind: 'send', time: 1, to: TO, amount: '12345' }]);
		expect(await accountKv.get('txlog', ADDR)).toEqual([{ hash: 'H', kind: 'send', time: 1, to: TO, amount: '12345' }]);
		const dump = await rawDump();
		expect(dump).not.toContain(ADDR);
		expect(dump).not.toContain(TO);
		expect(dump).not.toContain('12345');
	});

	it('reads the same records after a re-open with the same phrase, nothing with another', async () => {
		const phrase = newMnemonic();
		await openLocalStore(phrase);
		await accountKv.set('invoices', ADDR, [1, 2]);
		closeLocalStore();
		await openLocalStore(phrase);
		expect(await accountKv.get('invoices', ADDR)).toEqual([1, 2]);
		await openLocalStore(newMnemonic());
		expect(await accountKv.get('invoices', ADDR)).toBeUndefined();
	});

	it('moves records kept in the clear into the store', async () => {
		await kv.set(`txlog:${ADDR}`, [{ hash: 'OLD', to: TO }]);
		await openLocalStore(newMnemonic());
		await encryptPlainRecords([ADDR]);
		expect(await kv.get(`txlog:${ADDR}`)).toBeUndefined();
		expect(await accountKv.get('txlog', ADDR)).toEqual([{ hash: 'OLD', to: TO }]);
		expect(await rawDump()).not.toContain(TO);
	});

	it('keeps records in memory only while locked', async () => {
		await accountKv.set('refill.until', ADDR, 99);
		expect(await accountKv.get('refill.until', ADDR)).toBe(99);
		expect(await rawDump()).not.toContain('99');
		closeLocalStore();
		expect(await accountKv.get('refill.until', ADDR)).toBeUndefined();
	});
});

describe('vault', () => {
	afterEach(async () => {
		await kv.clear();
	});

	it('refuses to save a session that dropped its phrase (payment sheet)', async () => {
		const phrase = newMnemonic();
		const open = await createVault('135791', { mnemonic: phrase }, walletFromMnemonic(phrase).address, 'pin', CHEAP);
		await expect(saveVault({ key: open.key, secrets: { mnemonic: '' } })).rejects.toThrow(/recovery phrase/);
		expect((await openVault('135791')).secrets.mnemonic).toBe(phrase);
	});

	it('is not bound to a device key outside the Android app', async () => {
		const phrase = newMnemonic();
		await createVault('135791', { mnemonic: phrase }, walletFromMnemonic(phrase).address, 'pin', CHEAP);
		expect((await vaultRecord())!.hw).toBeUndefined();
	});

	it('a device-bound record cannot be opened where there is no device key', async () => {
		await expect(mixRoot(new Uint8Array(32), true)).rejects.toThrow(/phone it was made on/);
		const root = new Uint8Array([1, 2, 3]);
		expect(await mixRoot(root, false)).toBe(root);
	});
});

describe('chain client', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("encrypts to the pinned consensus key, never one a node hands out", async () => {
		vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('offline'))));
		const w = walletFromMnemonic(newMnemonic());
		const client = await signingClient(w, new Uint8Array(32));
		const utils = (client as unknown as { encryptionUtils: { getConsensusIoPubKey(): Promise<Uint8Array> } }).encryptionUtils;
		expect(await utils.getConsensusIoPubKey()).toEqual(fromB64(CONSENSUS_IO_PUBKEY));
		expect(fromB64(CONSENSUS_IO_PUBKEY)).toHaveLength(32);
	});
});

describe('sheet word', () => {
	it('is trimmed, capped and removable', async () => {
		expect(await setSheetWord('  Lighthouse  ')).toBe('Lighthouse');
		expect(await sheetWord()).toBe('Lighthouse');
		expect((await setSheetWord('x'.repeat(100))).length).toBe(24);
		await setSheetWord('');
		expect(await sheetWord()).toBe('');
	});
});
