import 'fake-indexeddb/auto';
import { chacha20poly1305 } from '@noble/ciphers/chacha.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { describe, expect, it } from 'vitest';
import { clearDuress, hasDuress, openDuress, resealDuress, setDuress } from '../src/lib/crypto/duress';
import { createVault, openVault, vaultRecord } from '../src/lib/crypto/vault';
import { decryptRecvd, fromB64, notificationId, scanTx, toB64, type ChainTx, type Watch } from '../src/lib/notify/snip52';

const CHEAP = { t: 1, m: 256, p: 1 };
const SEED_B64 = '8z5yqe1vqTPLuJAhgVCaNqVttsxbQmrP+eYAlbnyQ5Q=';
const HASH = 'A1B2C3D4E5F60718293A4B5C6D7E8F90A1B2C3D4E5F60718293A4B5C6D7E8F90';

const hex = (h: string) => Uint8Array.from(h.match(/../g)!.map((x) => parseInt(x, 16)));

/** What sSCRT emits for a `recvd` notification, built straight from the SNIP-52 text. */
function contractRecvd(seed: Uint8Array, txHash: string, height: number, amount: bigint, sender: Uint8Array): string {
	const amt = new Uint8Array(8);
	new DataView(amt.buffer).setBigUint64(0, amount);
	// [amount: biguint .size 8, sender: bstr .size 20, memo_len: uint]
	const cbor = Uint8Array.from([0x83, 0xc2, 0x48, ...amt, 0x54, ...sender, 0x00]);
	const nonce = sha256(new TextEncoder().encode('recvd')).slice(0, 12).map((b, i) => b ^ hex(txHash)[i]!);
	const aad = new TextEncoder().encode(`${height}:${txHash}`);
	return toB64(chacha20poly1305(seed, nonce, aad).encrypt(cbor));
}

describe('SNIP-52', () => {
	const seed = fromB64(SEED_B64);

	it('notification ids match what the sSCRT contract computed (channel_info answer_id on mainnet)', () => {
		const chainSeed = fromB64('AHQLcr5ncTmbeG4H5iGvTI3vCV7Rh+H2gHsqCJYeW60=');
		expect(toB64(notificationId(chainSeed, 'recvd', HASH))).toBe('L1Cf2sWpcqFPwEhN5jDwvq18gljVlUYNmAC+bWFigos=');
		expect(toB64(notificationId(chainSeed, 'recvd', HASH.toLowerCase()))).toBe('L1Cf2sWpcqFPwEhN5jDwvq18gljVlUYNmAC+bWFigos=');
		expect(toB64(notificationId(chainSeed, 'multirecvd', HASH))).toBe('e439jfL6Qbkh9btNJd0/SFPcNYUG5zL5EXvfnLy+D+E=');
	});

	it('base64 round-trips', () => {
		for (const n of [0, 1, 2, 3, 31, 32, 33]) {
			const b = Uint8Array.from({ length: n }, (_, i) => (i * 37) & 255);
			expect(fromB64(toB64(b))).toEqual(b);
		}
	});

	it('decrypts a recvd payload and finds it among unrelated attributes', () => {
		const sender = Uint8Array.from({ length: 20 }, (_, i) => i + 1);
		const payload = contractRecvd(seed, HASH, 27518826, 12_345_678n, sender);
		expect(decryptRecvd(seed, HASH, 27518826, payload)).toEqual({ amount: 12_345_678n, sender, hasMemo: false });

		const attrs = new Map([
			['snip52:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', 'x'],
			[`snip52:${toB64(notificationId(seed, 'recvd', HASH))}`, payload],
		]);
		const tx: ChainTx = { hash: HASH, height: 27518826, attrs };
		const other: Watch = { seed: toB64(new Uint8Array(32).fill(7)) };
		const hits = scanTx(tx, [other, { seed: SEED_B64 }]);
		expect(hits).toHaveLength(1);
		expect(hits[0]).toMatchObject({ watch: 1, amount: 12_345_678n, hash: HASH });
	});

	it('a wrong height (AAD) still reports the payment, just without the amount', () => {
		const payload = contractRecvd(seed, HASH, 100, 5n, new Uint8Array(20));
		expect(decryptRecvd(seed, HASH, 101, payload)).toEqual({});
	});

	it('finds a multirecvd bloom hit and reads its packet', () => {
		const params = { m: 512, k: 22, packetSize: 16 };
		const id = notificationId(seed, 'multirecvd', HASH);
		// set our k bits exactly as the spec describes (bit 0 = rightmost)
		const filter = new Uint8Array(64);
		const h = sha256(id);
		for (let i = 0; i < params.k; i++) {
			let v = 0;
			for (let b = 0; b < 9; b++) {
				const pos = i * 9 + b;
				v = (v << 1) | ((h[pos >> 3]! >> (7 - (pos & 7))) & 1);
			}
			filter[63 - (v >> 3)]! |= 1 << (v & 7);
		}
		const plain = new Uint8Array(16);
		new DataView(plain.buffer).setBigUint64(0, (777n << 2n) | 1n);
		const packet = Uint8Array.from([...id.slice(0, 8), ...plain.map((x, i) => x ^ id[8 + i]!)]);
		const decoy = new Uint8Array(24).fill(9);
		const attrs = new Map([['snip52:#multirecvd', toB64(Uint8Array.from([...filter, ...decoy, ...packet]))]]);
		const hits = scanTx({ hash: HASH, height: 1, attrs }, [{ seed: SEED_B64, bloom: params }]);
		expect(hits).toEqual([{ watch: 0, hash: HASH, height: 1, amount: 777n }]);
		// an empty filter is no hit
		attrs.set('snip52:#multirecvd', toB64(new Uint8Array(64 + 24)));
		expect(scanTx({ hash: HASH, height: 1, attrs }, [{ seed: SEED_B64, bloom: params }])).toEqual([]);
	});
});

describe('emergency PIN record', () => {
	it('opens only with its own PIN, can be resealed without it, and looks like the vault', async () => {
		await createVault('111111', { mnemonic: 'm' }, 'secret1x', 'pin', CHEAP);
		const key = await setDuress('222222', { action: 'wipe' }, CHEAP);
		expect(await hasDuress()).toBe(true);
		expect(await openDuress('111111')).toBeNull();
		expect(await openDuress('222222')).toEqual({ action: 'wipe' });
		await expect(openVault('222222')).rejects.toThrow();

		await resealDuress(key, { action: 'sweep', mnemonic: 'm', to: 'secret1safe', accounts: [{ index: 0, name: 'A' }] });
		expect(await openDuress('222222')).toMatchObject({ action: 'sweep', to: 'secret1safe' });

		// same padded size as the real vault: the record does not tell which action it holds
		const { kv } = await import('../src/lib/storage');
		const alt = await kv.get<{ ct: string }>('vault.alt');
		expect(alt!.ct.length).toBe((await vaultRecord())!.ct.length);

		await clearDuress();
		expect(await hasDuress()).toBe(false);
	});
});
