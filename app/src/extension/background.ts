// The extension's background: every request from a site arrives here (via
// the content script), with the sender's origin as the browser reports it.
// It answers on its own only what the browser session already allows (a
// connected site asking for the key, or for encryption with the account's
// enigma seed). Everything else — connecting, every signature — goes to the
// approval window, where the user unlocks and sees the request in full.
// The background holds no private key, phrase or PIN.

import './swWindow';
import { ripemd160 } from '@noble/hashes/legacy.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { fromB64 } from '../lib/crypto/bytes';
import { encryptionFor } from '../lib/chain/enigma';
import { DAPP_CHAIN_ID, decode, encode, validOrigin, type DappRequest, type DappResponse } from '../lib/dapp/protocol';
import { IDLE_MINUTES, pendingRevokes, readSession, SESSION_KEY, UNLOCK_KEY, setPendingRevokes, writeSession, type DappSession } from './session';

/* ------------------------------ answered here ------------------------------ */

const enigmas = new Map<string, ReturnType<typeof encryptionFor>>();

function enigmaOf(s: DappSession) {
	let e = enigmas.get(s.seed);
	if (!e) {
		enigmas.clear();
		e = encryptionFor(fromB64(s.seed));
		enigmas.set(s.seed, e);
	}
	return e;
}

const chainOk = (c: unknown) => (Array.isArray(c) ? c.length > 0 && c.every((x) => x === DAPP_CHAIN_ID) : c === DAPP_CHAIN_ID);

/** An answer without a window, or undefined when the request needs one. */
async function quick(origin: string, req: DappRequest): Promise<DappResponse | undefined> {
	const s = await readSession();
	const p = decode(req.params) as unknown[];
	if (req.method === 'disable') {
		if (s?.origins.includes(origin)) {
			await writeSession({ ...s, origins: s.origins.filter((o) => o !== origin) });
			await setPendingRevokes([...(await pendingRevokes()), { address: s.account.address, origin }]);
		}
		return { id: req.id, result: null };
	}
	if (!s || !s.origins.includes(origin) || !chainOk(p[0])) return undefined;
	await touch(s);
	const e = enigmaOf(s);
	const result = await (async () => {
		switch (req.method) {
			case 'enable':
				return null;
			case 'getKey':
				return {
					name: s.account.name,
					algo: 'secp256k1',
					pubKey: fromB64(s.account.pubkey),
					address: ripemd160(sha256(fromB64(s.account.pubkey))),
					bech32Address: s.account.address,
					isNanoLedger: false,
					isKeystone: false,
				};
			case 'enigma.getPubkey':
				return e.getPubkey();
			case 'enigma.encrypt':
				return e.encrypt(String(p[1]), p[2] as object);
			case 'enigma.decrypt':
				return e.decrypt(p[1] as Uint8Array, p[2] as Uint8Array);
			case 'enigma.getTxEncryptionKey':
				return e.getTxEncryptionKey(p[1] as Uint8Array);
			default:
				return undefined;
		}
	})().catch((err: unknown) => ({ error: err instanceof Error ? err.message : String(err) }));
	if (result === undefined) return undefined;
	if (result && typeof result === 'object' && 'error' in result) return { id: req.id, error: String(result.error) };
	return { id: req.id, result: encode(result) };
}

/* ---------------------------- the approval window --------------------------- */

interface Job {
	origin: string;
	req: DappRequest;
	resolve: (r: DappResponse) => void;
}

const jobs: Job[] = [];
let port: chrome.runtime.Port | null = null;
let windowId: number | undefined;
let opening: Promise<void> | null = null;
/** the job on screen in the window */
let current: Job | null = null;

async function openWindow(): Promise<void> {
	if (windowId !== undefined) {
		await chrome.windows.update(windowId, { focused: true }).catch(() => (windowId = undefined));
		if (windowId !== undefined) return;
	}
	const last = await chrome.windows.getLastFocused().catch(() => ({}) as { left?: number; top?: number; width?: number });
	const width = 400;
	const left = last.left !== undefined && last.width ? last.left + last.width - width - 16 : undefined;
	const w = await chrome.windows.create({ url: chrome.runtime.getURL('approve.html'), type: 'popup', width, height: 660, focused: true, left, top: last.top !== undefined ? last.top + 64 : undefined });
	windowId = w.id;
}

function next(): void {
	if (!port || current) return;
	current = jobs.shift() ?? null;
	if (current) port.postMessage({ type: 'request', origin: current.origin, req: current.req });
	else port.postMessage({ type: 'idle' });
}

function needsWindow(job: Job): void {
	jobs.push(job);
	if (port) next();
	else opening ??= openWindow().finally(() => (opening = null));
}

function rejectAll(message: string): void {
	const all = [...(current ? [current] : []), ...jobs.splice(0)];
	current = null;
	for (const j of all) j.resolve({ id: j.req.id, error: message });
}

chrome.runtime.onConnect.addListener((p) => {
	if (p.name !== 'approve' || p.sender?.url !== chrome.runtime.getURL('approve.html')) return p.disconnect();
	port?.disconnect();
	port = p;
	p.onMessage.addListener((msg: { type: string; res?: DappResponse }) => {
		if (msg.type === 'response' && current && msg.res?.id === current.req.id) {
			current.resolve(msg.res);
			current = null;
			next();
		} else if (msg.type === 'ready') next();
	});
	p.onDisconnect.addListener(() => {
		if (port === p) port = null;
		rejectAll('Request rejected');
	});
});

chrome.windows.onRemoved.addListener((id) => {
	if (id === windowId) {
		windowId = undefined;
		if (!port) rejectAll('Request rejected');
	}
});

/* --------------------------------- requests -------------------------------- */

function senderOrigin(sender: chrome.runtime.MessageSender): string | null {
	if (sender.id !== chrome.runtime.id || !sender.tab || sender.frameId !== 0) return null;
	try {
		return sender.origin && sender.origin !== 'null' ? sender.origin : new URL(sender.url ?? '').origin;
	} catch {
		return null;
	}
}

chrome.runtime.onMessage.addListener((msg: { type?: string; req?: DappRequest }, sender, sendResponse) => {
	if (msg?.type !== 'darkshell:dapp' || !msg.req) return;
	const origin = senderOrigin(sender);
	const req = msg.req;
	const id = typeof req.id === 'string' ? req.id : '';
	if (!origin || !validOrigin(origin)) {
		sendResponse({ id, error: 'Only https sites can connect to DarkShell.' });
		return;
	}
	void quick(origin, req)
		.then((r) => r ?? new Promise<DappResponse>((resolve) => needsWindow({ origin, req, resolve })))
		.then(sendResponse, (e: unknown) => sendResponse({ id, error: e instanceof Error ? e.message : String(e) }));
	return true;
});

/* ---------------------------- idle lock and events --------------------------- */

async function touch(s: DappSession): Promise<void> {
	if (Date.now() - s.at > 30_000) await writeSession({ ...s, at: Date.now() });
	await chrome.alarms.create('lock', { delayInMinutes: IDLE_MINUTES });
}

chrome.alarms.onAlarm.addListener((a) => {
	if (a.name === 'lock') void Promise.all([writeSession(null), chrome.storage.session.remove(UNLOCK_KEY)]);
});

/** Pages that asked for the account are told when it changes, or locks. */
chrome.storage.onChanged.addListener((changes, area) => {
	if (area !== 'session' || !changes[SESSION_KEY]) return;
	const before = changes[SESSION_KEY].oldValue as DappSession | undefined;
	const after = changes[SESSION_KEY].newValue as DappSession | undefined;
	if (before?.account.address === after?.account.address && before?.origins.length === after?.origins.length) return;
	if (after) void chrome.alarms.create('lock', { delayInMinutes: IDLE_MINUTES });
	void chrome.tabs.query({}).then((tabs) => {
		for (const t of tabs) if (t.id !== undefined) void chrome.tabs.sendMessage(t.id, { type: 'darkshell:keystorechange' }).catch(() => {});
	});
});

// only the extension's own pages read the session (Chrome; Firefox has no other level)
void chrome.storage.session.setAccessLevel?.({ accessLevel: 'TRUSTED_CONTEXTS' }).catch(() => {});
