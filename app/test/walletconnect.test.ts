import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { serializeSignDoc } from '@cosmjs/amino';
import { Secp256k1, Secp256k1Signature, sha256 } from '@cosmjs/crypto';
import { makeSignBytes } from '@cosmjs/proto-signing';
import { AuthInfo, TxBody } from 'secretjs/dist/protobuf/cosmos/tx/v1beta1/tx';
import { MsgSend } from 'secretjs/dist/protobuf/cosmos/bank/v1beta1/tx';
import { newMnemonic, walletFromMnemonic } from '../src/lib/crypto/account';
import { fromB64, toB64 } from '../src/lib/crypto/bytes';
import { encryptionFor } from '../src/lib/chain/enigma';
import { adr36Doc, signRequest } from '../src/lib/dapp/sign';

const W = walletFromMnemonic(newMnemonic(), 0);
const SITE = 'https://dashboard.nieuportlabs.cz';
const asked: { origin: string; warnings: string[] }[] = [];
let connected = false;

// the wallet side: an unlocked account that approves everything (the screens are tested elsewhere)
vi.mock('../src/lib/dapp/host.svelte', () => ({
	askConnect: vi.fn(async (origin: string, warnings: string[]) => {
		asked.push({ origin, warnings });
		connected = true;
		return { name: 'Account 1', address: W.address, pubkey: W.publicKey };
	}),
	walletHost: {
		connect: async () => (connected ? { name: 'Account 1', address: W.address, pubkey: W.publicKey } : null),
		sign: async (_o: string, req: Parameters<typeof signRequest>[1]) => signRequest(W, req),
		enigma: async () => encryptionFor(new Uint8Array(32).fill(3)),
		disconnect: async () => {},
	},
}));
vi.mock('../src/lib/wallet.svelte', () => ({ dappAccount: () => null, onKeystoreChange: () => () => {} }));

const { onProposal, onRequest, isWalletConnectUri } = await import('../src/lib/dapp/walletconnect.svelte');

function fakeClient() {
	const c = {
		approved: [] as unknown[],
		rejected: [] as unknown[],
		responses: [] as { result?: unknown; error?: { message: string } }[],
		session: { getAll: () => [{ topic: 't1', peer: { metadata: { url: SITE, name: 'Secret Dashboard' } } }] },
		approve: vi.fn(async (a: unknown) => void c.approved.push(a)),
		reject: vi.fn(async (r: unknown) => void c.rejected.push(r)),
		respond: vi.fn(async ({ response }: { response: { result?: unknown; error?: { message: string } } }) => void c.responses.push(response)),
	};
	return c;
}

const COSMOS = { cosmos: { chains: ['cosmos:secret-4'], methods: ['cosmos_signDirect', 'cosmos_signAmino'], events: [] } };

const proposal = (validation = 'VALID', ns: Record<string, unknown> = COSMOS) => ({
	id: 7,
	params: { proposer: { metadata: { url: SITE, name: 'Secret Dashboard' } }, requiredNamespaces: ns },
	verifyContext: { verified: { origin: SITE, validation, verifyUrl: '' } },
});

const req = (method: string, params: unknown, chainId = 'cosmos:secret-4') => ({ id: 9, topic: 't1', params: { chainId, request: { method, params } } });

describe('WalletConnect', () => {
	it('recognises wc: links', () => {
		expect(isWalletConnectUri(`wc:${'a'.repeat(64)}@2?relay-protocol=irn&symKey=${'b'.repeat(64)}`)).toBe(true);
		expect(isWalletConnectUri('secret:secret1abc')).toBe(false);
	});

	it('connects a verified site for secret-4 with this account', async () => {
		const c = fakeClient();
		await onProposal(c as never, proposal());
		expect(asked.at(-1)).toEqual({ origin: SITE, warnings: [] });
		const ns = (c.approved[0] as { namespaces: { cosmos: { accounts: string[]; methods: string[] } } }).namespaces.cosmos;
		expect(ns.accounts).toEqual([`cosmos:secret-4:${W.address}`]);
		expect(ns.methods).toContain('secret_enigmaEncrypt');
	});

	it('warns when the site could not be verified, refuses scams and other chains', async () => {
		const c = fakeClient();
		await onProposal(c as never, proposal('UNKNOWN'));
		expect(asked.at(-1)!.warnings[0]).toContain('could not confirm');
		const n = asked.length;
		await onProposal(c as never, proposal('INVALID'));
		await onProposal(c as never, proposal('VALID', { eip155: { chains: ['eip155:1'], methods: ['eth_sign'] } }));
		await onProposal(c as never, proposal('VALID', { cosmos: { chains: ['cosmos:cosmoshub-4'], methods: ['cosmos_signDirect'] } }));
		await onProposal(c as never, proposal('VALID', { cosmos: { chains: ['cosmos:secret-4'], methods: ['cosmos_sendTx'] } }));
		expect(asked.length).toBe(n);
		expect(c.rejected).toHaveLength(4);
	});

	it('signs direct, amino and arbitrary requests in the WalletConnect format', async () => {
		connected = true;
		const c = fakeClient();
		const send = MsgSend.encode(MsgSend.fromPartial({ from_address: W.address, to_address: W.address, amount: [{ denom: 'uscrt', amount: '1' }] })).finish();
		const bodyBytes = new Uint8Array(TxBody.encode(TxBody.fromPartial({ messages: [{ type_url: '/cosmos.bank.v1beta1.MsgSend', value: send }] })).finish());
		const authInfoBytes = new Uint8Array(AuthInfo.encode(AuthInfo.fromPartial({ signer_infos: [], fee: { amount: [], gas_limit: '1', payer: '', granter: '' } })).finish());
		await onRequest(c as never, req('cosmos_signDirect', { signerAddress: W.address, signDoc: { chainId: 'secret-4', accountNumber: '12', bodyBytes: toB64(bodyBytes), authInfoBytes: toB64(authInfoBytes) } }));
		const d = c.responses[0]!.result as { signed: { accountNumber: string; bodyBytes: string }; signature: { signature: string } };
		expect(d.signed.accountNumber).toBe('12');
		expect(d.signed.bodyBytes).toBe(toB64(bodyBytes));
		const digest = sha256(makeSignBytes({ bodyBytes, authInfoBytes, chainId: 'secret-4', accountNumber: 12n } as never));
		expect(await Secp256k1.verifySignature(Secp256k1Signature.fromFixedLength(fromB64(d.signature.signature)), digest, W.publicKey)).toBe(true);

		const permit = { chain_id: 'secret-4', account_number: '0', sequence: '0', fee: { amount: [], gas: '1' }, msgs: [{ type: 'query_permit', value: { permit_name: 'p', allowed_tokens: [], permissions: ['balance'] } }], memo: '' };
		await onRequest(c as never, req('cosmos_signAmino', { signerAddress: W.address, signDoc: permit }));
		expect((c.responses[1]!.result as { signed: unknown }).signed).toEqual(permit);

		await onRequest(c as never, req('cosmos_signArbitrary', { signerAddress: W.address, data: 'hello' }));
		const a = c.responses[2]!.result as { signature: string };
		expect(await Secp256k1.verifySignature(Secp256k1Signature.fromFixedLength(fromB64(a.signature)), sha256(serializeSignDoc(adr36Doc(W.address, 'hello'))), W.publicKey)).toBe(true);

		await onRequest(c as never, req('secret_getEnigmaPubKey', {}));
		expect(fromB64(c.responses[3]!.result as string)).toEqual(await encryptionFor(new Uint8Array(32).fill(3)).getPubkey());

		await onRequest(c as never, req('cosmos_sendTx', {}));
		expect(c.responses[4]!.error?.message).toContain('Unsupported');
		await onRequest(c as never, req('cosmos_getAccounts', {}, 'cosmos:cosmoshub-4'));
		expect(c.responses[5]!.error?.message).toContain('Secret Network only');
	});
});
