import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';

// as the browser extension: no hardware key, but a browser-profile one
vi.mock('../src/lib/platform', () => ({
	platform: 'extension',
	isNative: false,
	can: { hwKey: false, tor: false, nfc: false, paySheet: false, bgNotify: false, biometric: false, crossOrigin: true, nativeHttp: false },
}));

const { bindToDevice, deviceKeyAvailable, mixRoot } = await import('../src/lib/crypto/hwkey');
const { createVault, openVault, vaultRecord } = await import('../src/lib/crypto/vault');

describe('browser-profile device key', () => {
	it('binds the root the same way every time, and differently from the root', async () => {
		expect(await deviceKeyAvailable()).toBe(true);
		const a = await bindToDevice(new Uint8Array(32).fill(7));
		const b = await bindToDevice(new Uint8Array(32).fill(7));
		expect(a).toEqual(b);
		expect(a).not.toEqual(new Uint8Array(32).fill(7));
		expect(await bindToDevice(new Uint8Array(32).fill(8))).not.toEqual(a);
		const root = new Uint8Array(32).fill(1);
		await mixRoot(root, true);
		expect(root.every((x) => x === 0)).toBe(true);
	});

	it('is kept apart from the wallet store and cannot be read out', async () => {
		const key = await new Promise<CryptoKey>((resolve) => {
			const open = indexedDB.open('darkshell-device', 1);
			open.onsuccess = () => {
				const r = open.result.transaction('keys').objectStore('keys').get('vault');
				r.onsuccess = () => resolve(r.result as CryptoKey);
			};
		});
		expect(key.extractable).toBe(false);
		await expect(crypto.subtle.exportKey('raw', key)).rejects.toThrow();
	});

	it('seals new vaults to it', async () => {
		await createVault('123456', { mnemonic: 'abandon '.repeat(11) + 'about' }, 'secret1x', 'pin', { t: 1, m: 256, p: 1 });
		expect((await vaultRecord())?.hw).toBe(true);
		expect((await openVault('123456')).secrets.mnemonic).toContain('abandon');
	});
});
