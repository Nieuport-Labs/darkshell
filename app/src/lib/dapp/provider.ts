// The dApp provider: one request from one page (by its origin), checked and
// answered. Whatever carries the request (extension, in-app browser,
// WalletConnect) supplies a `DappHost`, which owns the keys and the screens:
// this module never signs anything the host has not shown and the user has
// not confirmed. Only Secret Network (secret-4) is offered.

import { fromBech32 } from 'secretjs';
import { DAPP_CHAIN_ID, type DappKey, type DappMethod, type DappRequest, type DappResponse, decode, encode, validOrigin } from './protocol';

/** A direct sign doc as cosmjs/secretjs hand it to a signer. */
export interface DirectDoc {
	bodyBytes: Uint8Array;
	authInfoBytes: Uint8Array;
	chainId: string;
	accountNumber: bigint;
}

export interface StdSignDoc {
	chain_id: string;
	account_number: string;
	sequence: string;
	fee: { amount: { denom: string; amount: string }[]; gas: string; granter?: string; payer?: string };
	msgs: { type: string; value: unknown }[];
	memo: string;
	timeout_height?: string;
}

export type SignRequest =
	| { kind: 'direct'; signer: string; doc: DirectDoc }
	| { kind: 'amino'; signer: string; doc: StdSignDoc }
	| { kind: 'arbitrary'; signer: string; data: string | Uint8Array };

export interface StdSignature {
	pub_key: { type: string; value: string };
	signature: string;
}

export type SignResult = { signed?: DirectDoc | StdSignDoc; signature: StdSignature };

export interface DappAccount {
	name: string;
	address: string;
	/** compressed secp256k1 */
	pubkey: Uint8Array;
}

/** The parts of secretjs's EncryptionUtils a page may use. */
export interface Enigma {
	getPubkey(): Promise<Uint8Array>;
	encrypt(codeHash: string, msg: object): Promise<Uint8Array>;
	decrypt(ciphertext: Uint8Array, nonce: Uint8Array): Promise<Uint8Array>;
	getTxEncryptionKey(nonce: Uint8Array): Promise<Uint8Array>;
}

export interface DappHost {
	/**
	 * The account this origin is connected to. With `ask`, a page that is not
	 * connected yet (or a wallet that is locked) gets the connect screen;
	 * without it, the answer is null instead.
	 */
	connect(origin: string, ask: boolean): Promise<DappAccount | null>;
	/** Shows the request and signs it once the user confirms. Throws `RejectedError` otherwise. */
	sign(origin: string, req: SignRequest): Promise<SignResult>;
	/** The connected account's transaction encryption (same seed as the wallet's own). */
	enigma(origin: string): Promise<Enigma>;
	/** Forgets this origin. */
	disconnect(origin: string): Promise<void>;
}

export class RejectedError extends Error {
	constructor(message = 'Request rejected') {
		super(message);
		this.name = 'RejectedError';
	}
}

function chainOf(chainIds: unknown): void {
	const list = Array.isArray(chainIds) ? chainIds : [chainIds];
	if (!list.length || list.some((c) => c !== DAPP_CHAIN_ID)) {
		throw new Error(`DarkShell holds Secret Network (${DAPP_CHAIN_ID}) only; ${list.filter((c) => c !== DAPP_CHAIN_ID).join(', ') || 'no chain'} is not supported.`);
	}
}

function keyOf(a: DappAccount): DappKey {
	return {
		name: a.name,
		algo: 'secp256k1',
		pubKey: a.pubkey,
		address: fromBech32(a.address).data,
		bech32Address: a.address,
		isNanoLedger: false,
		isKeystone: false,
	};
}

async function connected(host: DappHost, origin: string): Promise<DappAccount> {
	const a = await host.connect(origin, true);
	if (!a) throw new RejectedError('Not connected');
	return a;
}

function signerOf(a: DappAccount, signer: unknown): string {
	if (signer !== a.address) throw new Error(`${String(signer)} is not the account connected to this site.`);
	return signer;
}

function asDirect(v: unknown): DirectDoc {
	const d = v as Partial<DirectDoc> & { accountNumber?: unknown };
	if (!(d?.bodyBytes instanceof Uint8Array) || !(d.authInfoBytes instanceof Uint8Array)) throw new Error('Malformed sign doc');
	const n = d.accountNumber;
	const accountNumber = typeof n === 'bigint' ? n : typeof n === 'number' || typeof n === 'string' ? BigInt(n) : 0n;
	return { bodyBytes: d.bodyBytes, authInfoBytes: d.authInfoBytes, chainId: String(d.chainId), accountNumber };
}

function asAmino(v: unknown): StdSignDoc {
	const d = v as StdSignDoc;
	if (!d || typeof d !== 'object' || !Array.isArray(d.msgs) || typeof d.chain_id !== 'string' || !d.fee) throw new Error('Malformed sign doc');
	return d;
}

const METHODS: Record<DappMethod, (host: DappHost, origin: string, p: unknown[]) => Promise<unknown>> = {
	async enable(host, origin, [chainIds]) {
		chainOf(chainIds);
		await connected(host, origin);
		return null;
	},
	async getKey(host, origin, [chainId]) {
		chainOf(chainId);
		return keyOf(await connected(host, origin));
	},
	async signDirect(host, origin, [chainId, signer, doc]) {
		chainOf(chainId);
		const a = await connected(host, origin);
		const d = asDirect(doc);
		chainOf(d.chainId);
		return host.sign(origin, { kind: 'direct', signer: signerOf(a, signer), doc: d });
	},
	async signAmino(host, origin, [chainId, signer, doc]) {
		chainOf(chainId);
		const a = await connected(host, origin);
		const d = asAmino(doc);
		// SNIP-24 permits and ADR-036 carry the chain id inside; anything else must be secret-4
		if (d.chain_id !== '' && d.chain_id !== DAPP_CHAIN_ID) chainOf(d.chain_id);
		return host.sign(origin, { kind: 'amino', signer: signerOf(a, signer), doc: d });
	},
	async signArbitrary(host, origin, [chainId, signer, data]) {
		chainOf(chainId);
		const a = await connected(host, origin);
		if (typeof data !== 'string' && !(data instanceof Uint8Array)) throw new Error('Data must be a string or bytes');
		const r = await host.sign(origin, { kind: 'arbitrary', signer: signerOf(a, signer), data });
		return r.signature;
	},
	async 'enigma.getPubkey'(host, origin, [chainId]) {
		chainOf(chainId);
		return (await host.enigma(origin)).getPubkey();
	},
	async 'enigma.encrypt'(host, origin, [chainId, codeHash, msg]) {
		chainOf(chainId);
		if (typeof codeHash !== 'string' || !msg || typeof msg !== 'object') throw new Error('encrypt(codeHash, msg)');
		return (await host.enigma(origin)).encrypt(codeHash, msg);
	},
	async 'enigma.decrypt'(host, origin, [chainId, ciphertext, nonce]) {
		chainOf(chainId);
		if (!(ciphertext instanceof Uint8Array) || !(nonce instanceof Uint8Array)) throw new Error('decrypt(ciphertext, nonce)');
		return (await host.enigma(origin)).decrypt(ciphertext, nonce);
	},
	async 'enigma.getTxEncryptionKey'(host, origin, [chainId, nonce]) {
		chainOf(chainId);
		if (!(nonce instanceof Uint8Array)) throw new Error('getTxEncryptionKey(nonce)');
		return (await host.enigma(origin)).getTxEncryptionKey(nonce);
	},
	async disable(host, origin) {
		await host.disconnect(origin);
		return null;
	},
};

/**
 * Answers one request. `raw` is the JSON a transport received (encoded with
 * `protocol.encode`); the response is encoded the same way. `origin` must come
 * from the transport (the browser's own idea of the sender), never from the page.
 */
export async function handleDappRequest(host: DappHost, origin: string, raw: unknown): Promise<DappResponse> {
	const r = raw as Partial<DappRequest>;
	const id = typeof r?.id === 'string' ? r.id : '';
	try {
		if (!validOrigin(origin)) throw new Error('Only https sites can connect to DarkShell.');
		const fn = typeof r?.method === 'string' && Object.hasOwn(METHODS, r.method) ? METHODS[r.method as DappMethod] : undefined;
		if (!fn) throw new Error(`Unsupported method: ${String(r?.method)}`);
		const params = Array.isArray(r.params) ? (decode(r.params) as unknown[]) : [];
		return { id, result: encode(await fn(host, origin, params)) };
	} catch (e) {
		return { id, error: e instanceof Error ? e.message : String(e) };
	}
}
