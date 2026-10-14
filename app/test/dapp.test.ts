import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { serializeSignDoc } from '@cosmjs/amino';
import { Secp256k1, Secp256k1Signature, sha256 } from '@cosmjs/crypto';
import { makeSignBytes } from '@cosmjs/proto-signing';
import { pubkeyToAddress, toBech32, fromBech32 } from 'secretjs';
import { AuthInfo, TxBody } from 'secretjs/dist/protobuf/cosmos/tx/v1beta1/tx';
import { MsgExecuteContract } from 'secretjs/dist/protobuf/secret/compute/v1beta1/msg';
import { MsgSend } from 'secretjs/dist/protobuf/cosmos/bank/v1beta1/tx';
import { MsgGrant } from 'secretjs/dist/protobuf/cosmos/authz/v1beta1/tx';
import { encryptionFor } from '../src/lib/chain/client';
import { encryptionSeedFor, newMnemonic, walletFromMnemonic } from '../src/lib/crypto/account';
import { fromB64 } from '../src/lib/crypto/bytes';
import { closeLocalStore, openLocalStore } from '../src/lib/crypto/localStore';
import { kv } from '../src/lib/storage';
import { reviewOf } from '../src/lib/dapp/decode';
import { decode, encode } from '../src/lib/dapp/protocol';
import { handleDappRequest, RejectedError, type DappAccount, type DappHost, type DirectDoc, type StdSignDoc } from '../src/lib/dapp/provider';
import { adr36Doc, signRequest } from '../src/lib/dapp/sign';
import { SSCRT_ADDRESS } from '../src/lib/config';

const MNEMONIC = newMnemonic();
const W = walletFromMnemonic(MNEMONIC, 0);
const SITE = 'https://dashboard.nieuportlabs.cz';
const TO = 'secret1kkmu4vydkppkhzmx00glm20vn47t09544adv0g';

async function rawDump(): Promise<string> {
	const db = await new Promise<IDBDatabase>((r) => {
		const q = indexedDB.open('darkshell', 1);
		q.onsuccess = () => r(q.result);
	});
	const all = await new Promise<unknown[]>((r) => {
		const tx = db.transaction('kv', 'readonly');
		const keys = tx.objectStore('kv').getAllKeys();
		const values = tx.objectStore('kv').getAll();
		tx.oncomplete = () => r([keys.result, values.result]);
	});
	db.close();
	return JSON.stringify(all);
}

function verify(pub: string, sig: string, digest: Uint8Array) {
	return Secp256k1.verifySignature(Secp256k1Signature.fromFixedLength(fromB64(sig)), digest, fromB64(pub));
}

function directDoc(messages: { type_url: string; value: Uint8Array }[], granter = ''): DirectDoc {
	const bodyBytes = TxBody.encode(TxBody.fromPartial({ messages, memo: 'hi' })).finish();
	const authInfoBytes = AuthInfo.encode(
		AuthInfo.fromPartial({ signer_infos: [], fee: { amount: [{ denom: 'uscrt', amount: '12500' }], gas_limit: '50000', granter, payer: '' } }),
	).finish();
	return { bodyBytes, authInfoBytes, chainId: 'secret-4', accountNumber: 4242n };
}

const sendMsg = () => ({ type_url: '/cosmos.bank.v1beta1.MsgSend', value: MsgSend.encode(MsgSend.fromPartial({ from_address: W.address, to_address: TO, amount: [{ denom: 'uscrt', amount: '1000000' }] })).finish() });

describe('protocol', () => {
	it('carries bytes, bigints and protobufjs Longs through JSON', () => {
		const v = { a: new Uint8Array([1, 2, 255]), n: 2n ** 60n, l: { low: 5, high: 1, unsigned: false }, s: 'x', list: [new Uint8Array([7])] };
		const back = decode(JSON.parse(JSON.stringify(encode(v)))) as Record<string, unknown>;
		expect(back.a).toEqual(new Uint8Array([1, 2, 255]));
		expect(back.n).toBe(2n ** 60n);
		expect(back.l).toBe((1n << 32n) + 5n);
		expect(back.s).toBe('x');
		expect((back.list as Uint8Array[])[0]).toEqual(new Uint8Array([7]));
	});
});

describe('signing', () => {
	it('signs a direct doc the way the chain checks it', async () => {
		const doc = directDoc([sendMsg()]);
		const r = await signRequest(W, { kind: 'direct', signer: W.address, doc });
		expect(r.signed).toBe(doc);
		expect(await verify(r.signature.pub_key.value, r.signature.signature, sha256(makeSignBytes(doc as never)))).toBe(true);
	});

	it('returns a permit exactly as asked (the dashboard compares it)', async () => {
		const doc: StdSignDoc = {
			chain_id: 'secret-4',
			account_number: '0',
			sequence: '0',
			fee: { amount: [{ denom: 'uscrt', amount: '0' }], gas: '1' },
			msgs: [{ type: 'query_permit', value: { permit_name: 'secret-dashboard-1.9', allowed_tokens: [SSCRT_ADDRESS], permissions: ['balance', 'history'] } }],
			memo: '',
		};
		const copy = structuredClone(doc);
		const r = await signRequest(W, { kind: 'amino', signer: W.address, doc });
		expect(r.signed).toEqual(copy);
		expect(await verify(r.signature.pub_key.value, r.signature.signature, sha256(serializeSignDoc(copy)))).toBe(true);
	});

	it('signs ADR-036 so the dashboard profile server accepts it', async () => {
		const data = JSON.stringify({ name: 'me', at: 1 });
		const r = await signRequest(W, { kind: 'arbitrary', signer: W.address, data });
		expect(pubkeyToAddress(fromB64(r.signature.pub_key.value))).toBe(W.address);
		expect(await verify(r.signature.pub_key.value, r.signature.signature, sha256(serializeSignDoc(adr36Doc(W.address, data))))).toBe(true);
	});

	it('refuses to sign for another account', async () => {
		await expect(signRequest(W, { kind: 'arbitrary', signer: TO, data: 'x' })).rejects.toThrow();
	});
});

describe('handleDappRequest', () => {
	const account: DappAccount = { name: 'Account 1', address: W.address, pubkey: W.publicKey };
	let host: DappHost & { signed: number };
	beforeEach(() => {
		host = {
			signed: 0,
			connect: vi.fn(async () => account),
			sign: vi.fn(async (_o, req) => {
				host.signed++;
				return signRequest(W, req);
			}),
			enigma: vi.fn(async () => encryptionFor(new Uint8Array(32))),
			disconnect: vi.fn(async () => {}),
		};
	});
	const call = (method: string, params: unknown[], origin = SITE) => handleDappRequest(host, origin, JSON.parse(JSON.stringify({ id: '1', method, params: encode(params) })));

	it('answers getKey with the address and public key', async () => {
		const r = await call('getKey', ['secret-4']);
		const k = decode((r as { result: unknown }).result) as { bech32Address: string; pubKey: Uint8Array; address: Uint8Array };
		expect(k.bech32Address).toBe(W.address);
		expect(k.pubKey).toEqual(W.publicKey);
		expect(toBech32('secret', k.address)).toBe(W.address);
	});

	it('refuses other chains, other origins, unknown methods and other signers', async () => {
		expect(await call('enable', [['secret-4', 'osmosis-1']])).toMatchObject({ error: expect.stringContaining('osmosis-1') });
		expect(await call('getKey', ['secret-4'], 'http://evil.example')).toMatchObject({ error: expect.stringContaining('https') });
		expect(await call('getKey', ['secret-4'], 'https://a.example/path')).toMatchObject({ error: expect.any(String) });
		expect(await call('exportMnemonic', [])).toMatchObject({ error: expect.stringContaining('Unsupported') });
		expect(await call('constructor', [])).toMatchObject({ error: expect.stringContaining('Unsupported') });
		expect(await call('signArbitrary', ['secret-4', TO, 'x'])).toMatchObject({ error: expect.stringContaining('not the account') });
		expect(host.signed).toBe(0);
	});

	it('passes a rejection back as an error', async () => {
		host.sign = vi.fn(async () => {
			throw new RejectedError();
		});
		expect(await call('signArbitrary', ['secret-4', W.address, 'x'])).toEqual({ id: '1', error: 'Request rejected' });
	});

	it('round-trips a direct signature through the transport encoding', async () => {
		const doc = directDoc([sendMsg()]);
		const r = await call('signDirect', ['secret-4', W.address, doc]);
		const out = decode((r as { result: unknown }).result) as { signed: DirectDoc; signature: { signature: string; pub_key: { value: string } } };
		expect([...out.signed.bodyBytes]).toEqual([...doc.bodyBytes]);
		expect(out.signed.accountNumber).toBe(4242n);
		expect(await verify(out.signature.pub_key.value, out.signature.signature, sha256(makeSignBytes(doc as never)))).toBe(true);
	});

	it('refuses a direct doc for another chain even when the call says secret-4', async () => {
		const doc = { ...directDoc([sendMsg()]), chainId: 'cosmoshub-4' };
		expect(await call('signDirect', ['secret-4', W.address, doc])).toMatchObject({ error: expect.stringContaining('cosmoshub-4') });
	});
});

describe('review', () => {
	it('decrypts a contract message the page encrypted with our key', async () => {
		const enigma = encryptionFor(await encryptionSeedFor(MNEMONIC, 0));
		const codeHash = 'af74387e276be8874f07bec3a87023ee49b0e7ebe08178c49d0a49c3c98ed60e';
		const msg = await enigma.encrypt(codeHash, { transfer: { recipient: TO, amount: '2500000' } });
		const exec = MsgExecuteContract.encode(
			MsgExecuteContract.fromPartial({ sender: fromBech32(W.address).data, contract: fromBech32(SSCRT_ADDRESS).data, msg, sent_funds: [] }),
		).finish();
		const rv = await reviewOf({ kind: 'direct', signer: W.address, doc: directDoc([{ type_url: '/secret.compute.v1beta1.MsgExecuteContract', value: exec }], TO) }, enigma);
		expect(rv.steps[0]).toMatchObject({ title: 'Private sSCRT transfer', privacy: 'private' });
		expect(rv.steps[0]!.detail).toContain('2.5');
		expect(rv.fee).toContain('0.0125');
		expect(rv.feePayer).toBe(TO);
		expect(rv.memo).toBe('hi');
		expect(rv.warnings).toEqual([]);
		// someone else's key: shown as encrypted, never guessed
		const other = await reviewOf({ kind: 'direct', signer: W.address, doc: directDoc([{ type_url: '/secret.compute.v1beta1.MsgExecuteContract', value: exec }]) }, encryptionFor(new Uint8Array(32).fill(1)));
		expect(other.steps[0]).toMatchObject({ title: 'Contract call', detail: 'encrypted' });
	});

	it('warns about grants and messages it cannot read', async () => {
		const grant = { type_url: '/cosmos.authz.v1beta1.MsgGrant', value: MsgGrant.encode(MsgGrant.fromPartial({ granter: W.address, grantee: TO })).finish() };
		const odd = { type_url: '/secret.registration.v1beta1.RaAuthenticate', value: new Uint8Array([1]) };
		const rv = await reviewOf({ kind: 'direct', signer: W.address, doc: directDoc([grant, odd]) }, null);
		expect(rv.warnings.join(' ')).toContain('right to act for this account');
		expect(rv.warnings.join(' ')).toContain('RaAuthenticate');
	});

	it('describes a permit and a message', async () => {
		const permit = await reviewOf(
			{
				kind: 'amino',
				signer: W.address,
				doc: { chain_id: 'secret-4', account_number: '0', sequence: '0', fee: { amount: [], gas: '1' }, msgs: [{ type: 'query_permit', value: { permit_name: 'p', allowed_tokens: [SSCRT_ADDRESS], permissions: ['balance'] } }], memo: '' },
			},
			null,
		);
		expect(permit.permit).toEqual({ name: 'p', tokens: [SSCRT_ADDRESS], permissions: ['balance'] });
		const text = await reviewOf({ kind: 'arbitrary', signer: W.address, data: '{"a":1}' }, null);
		expect(text.text).toBe('{\n  "a": 1\n}');
	});
});

describe('permissions', () => {
	it('are kept per account and encrypted', async () => {
		await kv.clear();
		await openLocalStore(MNEMONIC);
		const { allow, connections, isConnected, revoke } = await import('../src/lib/dapp/permissions');
		await allow(W.address, SITE);
		expect(await isConnected(W.address, SITE)).toBe(true);
		expect(await isConnected(TO, SITE)).toBe(false);
		expect(await rawDump()).not.toContain('nieuport');
		await revoke(W.address, SITE);
		expect(await connections(W.address)).toEqual([]);
		closeLocalStore();
	});
});

