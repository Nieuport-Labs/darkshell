// The dApp host backed by the open wallet: used by the in-app browser and by
// the extension's approval window (after its own unlock). Requests that need
// the user wait in a queue; `DappRequestSheet` shows the first one and calls
// `answer`. One request is on screen at a time.

import { dappAccount, dappEnigma, dappSign } from '../wallet.svelte';
import { reviewOf, type Review } from './decode';
import { allow, isConnected, revoke, touch } from './permissions';
import { RejectedError, type DappAccount, type DappHost, type Enigma, type SignRequest, type SignResult } from './provider';

export type Pending =
	| { id: number; kind: 'connect'; origin: string; account: DappAccount; warnings?: string[] }
	| { id: number; kind: 'sign'; origin: string; account: DappAccount; review: Review; request: SignRequest };

type Unnumbered = Pending extends infer P ? (P extends Pending ? Omit<P, 'id'> : never) : never;

interface Waiting {
	item: Pending;
	resolve: (ok: boolean) => void;
}

export const dappUi = $state({ pending: null as Pending | null, busy: false, error: '' });

const queue: Waiting[] = [];
let seq = 0;

function show(): void {
	dappUi.pending = queue[0]?.item ?? null;
	dappUi.error = '';
}

/** Puts a request on screen and waits for the user's answer. */
function ask(item: Unnumbered): Promise<boolean> {
	return new Promise((resolve) => {
		queue.push({ item: { ...item, id: ++seq } as Pending, resolve });
		if (queue.length === 1) show();
	});
}

/** The user's answer to the request on screen. */
export function answer(ok: boolean): void {
	const w = queue.shift();
	w?.resolve(ok);
	show();
}

/** Every request waiting is refused (the wallet locked, the browser closed). */
export function rejectAll(): void {
	for (const w of queue.splice(0)) w.resolve(false);
	show();
}

function locked(): never {
	throw new RejectedError('DarkShell is locked. Unlock it and try again.');
}

/**
 * A site asks to connect from elsewhere (WalletConnect): always on screen, with
 * what is known about where it really comes from. Resolves with the account.
 */
export async function askConnect(origin: string, warnings: string[] = []): Promise<DappAccount> {
	const a = dappAccount();
	if (!a) locked();
	if (!(await ask({ kind: 'connect', origin, account: a, warnings }))) throw new RejectedError();
	const now = dappAccount();
	if (!now || now.address !== a.address) throw new RejectedError('The account changed. Try again.');
	await allow(a.address, origin);
	return a;
}

export const walletHost: DappHost = {
	async connect(origin, prompt) {
		const a = dappAccount();
		if (!a) return prompt ? locked() : null;
		if (await isConnected(a.address, origin)) {
			void touch(a.address, origin);
			return a;
		}
		if (!prompt) return null;
		if (!(await ask({ kind: 'connect', origin, account: a }))) throw new RejectedError();
		// the account may have changed while the question was on screen
		const now = dappAccount();
		if (!now || now.address !== a.address) throw new RejectedError('The account changed. Try again.');
		await allow(a.address, origin);
		return a;
	},

	async sign(origin, request): Promise<SignResult> {
		const a = dappAccount();
		if (!a) locked();
		const review = await reviewOf(request, dappEnigma());
		if (!(await ask({ kind: 'sign', origin, account: a, review, request }))) throw new RejectedError();
		void touch(a.address, origin);
		return dappSign(request);
	},

	async enigma(origin): Promise<Enigma> {
		const a = dappAccount();
		const e = dappEnigma();
		if (!a || !e) locked();
		if (!(await isConnected(a.address, origin))) throw new RejectedError('Not connected');
		return e;
	},

	async disconnect(origin) {
		const a = dappAccount();
		if (a) await revoke(a.address, origin);
	},
};
