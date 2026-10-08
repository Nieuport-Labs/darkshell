import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GAS_VAULT_ADDRESS } from '../src/lib/config';

let grants: object[] = [];
vi.mock('../src/lib/gas/feePayer', async (orig) => ({
	...(await orig<typeof import('../src/lib/gas/feePayer')>()),
	fetchGrants: async () => grants,
}));
vi.mock('../src/lib/chain/client', () => ({
	nativeBalance: async () => 0n,
	codeHash: async () => 'ab'.repeat(32),
}));

const { sendTx, BusyError, TxFailedError } = await import('../src/lib/chain/tx');
const { kv } = await import('../src/lib/storage');

const MSG = {} as import('secretjs').Msg;
const ME = 'secret1ap26qrlp8mcq2pg6r47w43l0y8zkqm8a450s03';

function fakeClient(opts: { landed?: 'ok' | 'fail' | 'never'; netErrors?: number } = {}) {
	let netErrors = opts.netErrors ?? 0;
	const signed: unknown[][] = [];
	const broadcasts: Uint8Array[] = [];
	const client = {
		tx: {
			signTx: vi.fn(async (msgs: unknown[]) => {
				signed.push(msgs);
				return new Uint8Array([signed.length]);
			}),
			broadcastSignedTx: vi.fn(async (bytes: Uint8Array) => {
				broadcasts.push(bytes);
				if (netErrors-- > 0) throw new Error('Failed to fetch');
				return { transactionHash: `HASH${bytes[0]}` };
			}),
		},
		query: {
			getTx: vi.fn(async () => (opts.landed === 'never' ? null : { code: opts.landed === 'fail' ? 5 : 0, rawLog: 'insufficient funds' })),
		},
	};
	return { client: client as never, signed, broadcasts };
}

const vaultGrant = (spend: string) => ({ granter: GAS_VAULT_ADDRESS, grantee: ME, kind: 'basic', spendLimit: spend });

describe('sendTx', () => {
	beforeEach(async () => {
		grants = [vaultGrant('50000000')];
		await kv.clear();
		vi.useRealTimers();
	});

	it('signs once and retries network errors with the same bytes', async () => {
		const { client, signed, broadcasts } = fakeClient({ netErrors: 2 });
		const out = await sendTx(client, ME, [MSG], 100_000, ['/x']);
		expect(out.status).toBe('confirmed');
		expect(signed).toHaveLength(1);
		expect(broadcasts).toHaveLength(3);
		expect(new Set(broadcasts.map((b) => b[0])).size).toBe(1);
	}, 20_000);

	it('refuses a second send while one is in flight', async () => {
		const { client } = fakeClient();
		const first = sendTx(client, ME, [MSG], 100_000, ['/x']);
		await expect(sendTx(client, ME, [MSG], 100_000, ['/x'])).rejects.toBeInstanceOf(BusyError);
		await first;
	}, 20_000);

	it('reports a slow tx as pending, not failed', async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true, advanceTimeDelta: 50 });
		const { client } = fakeClient({ landed: 'never' });
		const p = sendTx(client, ME, [MSG], 100_000, ['/x']);
		await vi.advanceTimersByTimeAsync(130_000);
		await expect(p).resolves.toMatchObject({ status: 'pending', hash: 'HASH1' });
	});

	it('throws on a tx the chain rejected', async () => {
		const { client } = fakeClient({ landed: 'fail' });
		await expect(sendTx(client, ME, [MSG], 100_000, ['/x'])).rejects.toBeInstanceOf(TxFailedError);
	}, 20_000);

	it('appends a refill when credits are low, then not again during the cooldown', async () => {
		grants = [vaultGrant('900000')]; // 0.9 SCRT < floor
		const a = fakeClient();
		const first = await sendTx(a.client, ME, [MSG], 100_000, ['/x'], { sscrtSpare: 10_000_000n });
		expect(first.refilled).toBe(2_000_000n);
		expect(a.signed[0]).toHaveLength(3); // payment + redeem + vault grant

		const b = fakeClient();
		const second = await sendTx(b.client, ME, [MSG], 100_000, ['/x'], { sscrtSpare: 10_000_000n });
		expect(second.refilled).toBe(0n);
		expect(b.signed[0]).toHaveLength(1);
	}, 20_000);

	it('never drains a small balance into gas credits', async () => {
		grants = [vaultGrant('900000')];
		const { client, signed } = fakeClient();
		const out = await sendTx(client, ME, [MSG], 100_000, ['/x'], { sscrtSpare: 100_000n });
		expect(out.refilled).toBe(0n);
		expect(signed[0]).toHaveLength(1);
	}, 20_000);

	it('never refills when credits are healthy', async () => {
		const { client, signed } = fakeClient();
		const out = await sendTx(client, ME, [MSG], 100_000, ['/x'], { sscrtSpare: 10_000_000n });
		expect(out.refilled).toBe(0n);
		expect(signed[0]).toHaveLength(1);
	}, 20_000);
});
