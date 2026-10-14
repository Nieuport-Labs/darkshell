// WalletConnect: a site open on another device (say, Secret Dashboard on a
// computer) shows a QR code; scanning it here pairs the two through Reown's
// relay. Everything on the relay is end-to-end encrypted with the key in that
// QR code; the relay sees only that two endpoints talk (and their IPs, unless
// Tor is on). Requests then come here and go through the same provider and
// the same screens as everywhere else (lib/dapp/provider.ts): connect once,
// and every signature is shown and confirmed.
//
// Only while the wallet is unlocked and open: on lock the connection to the
// relay closes, nothing runs in the background. Sessions (their keys) are kept
// in the encrypted store, so the device doesn't list them either.
//
// Methods: the cosmos_* ones every Cosmos wallet answers, cosmos_signArbitrary
// (ADR-036), and secret_* for the account's contract encryption: a site that
// lets DarkShell encrypt its transaction's contract message gets it shown here
// in full rather than as "encrypted".

import type SignClientType from '@walletconnect/sign-client';
import { toB64, fromB64 } from '../crypto/bytes';
import { accountKv } from '../crypto/localStore';
import { WC_PROJECT_ID } from '../config';
import { isNative } from '../platform';
import { dappAccount, onKeystoreChange } from '../wallet.svelte';
import { askConnect, walletHost } from './host.svelte';
import { revoke, siteName } from './permissions';
import { DAPP_CHAIN_ID, decode, encode, validOrigin, type DappMethod } from './protocol';
import { handleDappRequest, RejectedError } from './provider';

type Client = InstanceType<typeof SignClientType>;

const CHAIN = `cosmos:${DAPP_CHAIN_ID}`;
const METHODS = [
	'cosmos_getAccounts',
	'cosmos_signDirect',
	'cosmos_signAmino',
	'cosmos_signArbitrary',
	'secret_getEnigmaPubKey',
	'secret_enigmaEncrypt',
	'secret_enigmaDecrypt',
	'secret_getTxEncryptionKey',
];
const EVENTS = ['accountsChanged'];

/** the phone apps only: the extension is the browser's own wallet */
export const wcAvailable = WC_PROJECT_ID !== '' && isNative;

export interface WcSession {
	topic: string;
	origin: string;
	name: string;
}

export const wc = $state({ sessions: [] as WcSession[], pairing: false, error: '' });

let client: Promise<Client> | null = null;

/* --------------------------- storage (encrypted) --------------------------- */

const STORE = 'walletconnect';
const STORE_ID = 'sessions';
let cache: Record<string, unknown> | null = null;
let writing: Promise<void> = Promise.resolve();

async function all(): Promise<Record<string, unknown>> {
	return (cache ??= (await accountKv.get<Record<string, unknown>>(STORE, STORE_ID)) ?? {});
}

function save(): Promise<void> {
	writing = writing.then(() => accountKv.set(STORE, STORE_ID, cache ?? {})).catch(() => {});
	return writing;
}

const storage = {
	async getKeys() {
		return Object.keys(await all());
	},
	async getEntries<T>() {
		return Object.entries(await all()) as [string, T][];
	},
	async getItem<T>(key: string) {
		return (await all())[key] as T | undefined;
	},
	async setItem<T>(key: string, value: T) {
		(await all())[key] = JSON.parse(JSON.stringify(value));
		await save();
	},
	async removeItem(key: string) {
		delete (await all())[key];
		await save();
	},
};

/* --------------------------------- client --------------------------------- */

function originOf(url: string | undefined): string | null {
	try {
		const o = new URL(url ?? '').origin;
		return validOrigin(o) ? o : null;
	} catch {
		return null;
	}
}

function refreshSessions(c: Client): void {
	wc.sessions = c.session.getAll().map((s) => {
		const origin = originOf(s.peer.metadata.url) ?? s.peer.metadata.url;
		return { topic: s.topic, origin, name: s.peer.metadata.name || siteName(origin) };
	});
}

function start(): Promise<Client> {
	return (client ??= (async () => {
		const { default: SignClient } = await import('@walletconnect/sign-client');
		const c = await SignClient.init({
			projectId: WC_PROJECT_ID,
			storage: storage as never,
			metadata: { name: 'DarkShell', description: 'A private sSCRT account on Secret Network.', url: 'https://darkshell.cash', icons: [] },
		});
		c.on('session_proposal', (e) => void onProposal(c, e));
		c.on('session_request', (e) => void onRequest(c, e));
		c.on('session_delete', () => refreshSessions(c));
		c.on('session_expire', () => refreshSessions(c));
		refreshSessions(c);
		return c;
	})().catch((e) => {
		client = null;
		throw e;
	}));
}

/** After unlock: reconnects existing sessions (if any). */
export async function resumeWalletConnect(): Promise<void> {
	if (!wcAvailable) return;
	if (!Object.keys(await all()).some((k) => k.includes('session'))) return;
	try {
		const c = await start();
		await c.core.relayer.transportOpen().catch(() => {});
		refreshSessions(c);
	} catch {
		/* the relay is unreachable; sites can pair again later */
	}
}

/** On lock: off the relay, and the decrypted copy of the store dropped. */
export async function suspendWalletConnect(): Promise<void> {
	const c = client && (await client.catch(() => null));
	await c?.core.relayer.transportClose().catch(() => {});
	await writing;
	cache = null;
}

/** A `wc:` link, scanned or opened. */
export async function pairWalletConnect(uri: string): Promise<void> {
	if (!wcAvailable) throw new Error('WalletConnect is not set up in this build.');
	wc.error = '';
	wc.pairing = true;
	try {
		const c = await start();
		await c.core.relayer.transportOpen().catch(() => {});
		await c.pair({ uri });
	} catch (e) {
		wc.error = e instanceof Error ? e.message : String(e);
		throw e;
	} finally {
		wc.pairing = false;
	}
}

export function isWalletConnectUri(raw: string): boolean {
	return /^wc:[0-9a-f]{64}@2\?/i.test(raw.trim());
}

/* -------------------------------- proposals -------------------------------- */

type ProposalEvent = Parameters<Parameters<Client['on']>[1]>[0] & {
	id: number;
	params: { proposer: { metadata: { url: string; name: string } }; requiredNamespaces: Record<string, { chains?: string[]; methods: string[] }>; optionalNamespaces?: Record<string, { chains?: string[] }> };
	verifyContext: { verified: { origin: string; validation: 'UNKNOWN' | 'VALID' | 'INVALID'; isScam?: boolean } };
};

export async function onProposal(c: Client, e: unknown): Promise<void> {
	const p = e as ProposalEvent;
	const reject = (message: string) => c.reject({ id: p.id, reason: { code: 5000, message } }).catch(() => {});
	const v = p.verifyContext?.verified;
	const claimed = originOf(p.params.proposer.metadata.url);
	const origin = (v?.validation === 'VALID' && originOf(v.origin)) || claimed;
	if (!origin) return void reject('Only https sites can connect to DarkShell.');
	if (v?.isScam || v?.validation === 'INVALID') return void reject('This site is not what it claims to be.');

	// only Secret Network: a site that needs another chain is refused
	const required = Object.entries(p.params.requiredNamespaces ?? {});
	for (const [ns, r] of required) {
		if (ns !== 'cosmos' && !ns.startsWith('cosmos:')) return void reject(`DarkShell holds Secret Network only (asked for ${ns}).`);
		const chains = r.chains ?? (ns.includes(':') ? [ns] : []);
		if (chains.some((ch) => ch !== CHAIN)) return void reject('DarkShell holds Secret Network only.');
		const missing = r.methods.filter((m) => !METHODS.includes(m));
		if (missing.length) return void reject(`Not supported: ${missing.join(', ')}`);
	}

	const warnings = v?.validation === 'VALID' ? [] : ['DarkShell could not confirm which site this is. Connect only if you just scanned its QR code yourself.'];
	try {
		const a = await askConnect(origin, warnings);
		await c.approve({
			id: p.id,
			namespaces: { cosmos: { chains: [CHAIN], accounts: [`${CHAIN}:${a.address}`], methods: METHODS, events: EVENTS } },
		});
		refreshSessions(c);
	} catch (err) {
		await reject(err instanceof Error ? err.message : 'Rejected');
	}
}

/* --------------------------------- requests -------------------------------- */

interface RequestEvent {
	id: number;
	topic: string;
	params: { request: { method: string; params: Record<string, unknown> }; chainId: string };
}

const b = (s: unknown) => fromB64(String(s ?? ''));

/** WalletConnect's JSON → the provider's call, and the answer back into WalletConnect's JSON. */
function translate(method: string, p: Record<string, unknown>): { call: DappMethod; params: unknown[]; out: (r: unknown) => unknown } {
	const signer = p.signerAddress;
	switch (method) {
		case 'cosmos_getAccounts':
			return { call: 'getKey', params: [DAPP_CHAIN_ID], out: (k) => [{ address: (k as { bech32Address: string }).bech32Address, algo: 'secp256k1', pubkey: toB64((k as { pubKey: Uint8Array }).pubKey) }] };
		case 'cosmos_signDirect': {
			const d = (p.signDoc ?? {}) as Record<string, unknown>;
			return {
				call: 'signDirect',
				params: [d.chainId, signer, { chainId: d.chainId, accountNumber: BigInt(String(d.accountNumber ?? '0')), bodyBytes: b(d.bodyBytes), authInfoBytes: b(d.authInfoBytes) }],
				out: (r) => {
					const x = r as { signed: { chainId: string; accountNumber: bigint; bodyBytes: Uint8Array; authInfoBytes: Uint8Array }; signature: unknown };
					return { signature: x.signature, signed: { chainId: x.signed.chainId, accountNumber: x.signed.accountNumber.toString(), bodyBytes: toB64(x.signed.bodyBytes), authInfoBytes: toB64(x.signed.authInfoBytes) } };
				},
			};
		}
		case 'cosmos_signAmino': {
			const d = p.signDoc as { chain_id?: string };
			return { call: 'signAmino', params: [d?.chain_id || DAPP_CHAIN_ID, signer, d], out: (r) => r };
		}
		case 'cosmos_signArbitrary':
			return { call: 'signArbitrary', params: [DAPP_CHAIN_ID, signer, String(p.data ?? '')], out: (r) => r };
		case 'secret_getEnigmaPubKey':
			return { call: 'enigma.getPubkey', params: [DAPP_CHAIN_ID], out: (r) => toB64(r as Uint8Array) };
		case 'secret_enigmaEncrypt':
			return { call: 'enigma.encrypt', params: [DAPP_CHAIN_ID, p.codeHash, p.msg], out: (r) => toB64(r as Uint8Array) };
		case 'secret_enigmaDecrypt':
			return { call: 'enigma.decrypt', params: [DAPP_CHAIN_ID, b(p.ciphertext), b(p.nonce)], out: (r) => toB64(r as Uint8Array) };
		case 'secret_getTxEncryptionKey':
			return { call: 'enigma.getTxEncryptionKey', params: [DAPP_CHAIN_ID, b(p.nonce)], out: (r) => toB64(r as Uint8Array) };
		default:
			throw new Error(`Unsupported method: ${method}`);
	}
}

export async function onRequest(c: Client, e: unknown): Promise<void> {
	const r = e as RequestEvent;
	const fail = (message: string) => c.respond({ topic: r.topic, response: { id: r.id, jsonrpc: '2.0', error: { code: 5000, message } } }).catch(() => {});
	const session = c.session.getAll().find((s) => s.topic === r.topic);
	const origin = originOf(session?.peer.metadata.url);
	if (!session || !origin) return void fail('Unknown session');
	if (r.params.chainId !== CHAIN) return void fail('DarkShell holds Secret Network only.');
	try {
		const t = translate(r.params.request.method, r.params.request.params ?? {});
		const res = await handleDappRequest(walletHost, origin, { id: String(r.id), method: t.call, params: encode(t.params) });
		if ('error' in res) return void fail(res.error);
		await c.respond({ topic: r.topic, response: { id: r.id, jsonrpc: '2.0', result: t.out(decode(res.result)) } });
	} catch (err) {
		await fail(err instanceof RejectedError ? err.message : err instanceof Error ? err.message : String(err));
	}
}

/* ----------------------------- account changes ----------------------------- */

onKeystoreChange(() => {
	const a = dappAccount();
	if (!a) return;
	// sessions follow the active account; the site asks (getKey) and is connected again for it if need be
	void client?.then(async (c) => {
		for (const s of c.session.getAll()) {
			const accounts = [`${CHAIN}:${a.address}`];
			await c.update({ topic: s.topic, namespaces: { cosmos: { chains: [CHAIN], accounts, methods: METHODS, events: EVENTS } } }).catch(() => {});
			await c.emit({ topic: s.topic, chainId: CHAIN, event: { name: 'accountsChanged', data: accounts } }).catch(() => {});
		}
	});
});

/** Ends a site's sessions and forgets the site. */
export async function disconnectSite(origin: string): Promise<void> {
	const a = dappAccount();
	if (a) await revoke(a.address, origin);
	const c = client && (await client.catch(() => null));
	if (!c) return;
	for (const s of c.session.getAll().filter((x) => originOf(x.peer.metadata.url) === origin)) {
		await c.disconnect({ topic: s.topic, reason: { code: 6000, message: 'Disconnected in DarkShell' } }).catch(() => {});
	}
	refreshSessions(c);
}
