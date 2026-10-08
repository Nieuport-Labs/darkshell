// Live incoming-payment notifications while the app is open (SNIP-52).
//
// Every few seconds the newest sSCRT executions are read from a public RPC
// node and checked locally against each account's notification seed. The node
// only ever sees "someone is reading sSCRT transactions" — never which
// account, and never whether anything matched.

import { SSCRT_ADDRESS } from '../config';
import { firstRpc, latestHeight, scanTx, txsSince, type Received, type Watch } from './snip52';

export interface Notice {
	id: number;
	/** account the payment arrived to */
	address: string;
	amount?: bigint;
	hash: string;
	time: number;
}

/** In-app toasts, newest last. */
export const notices = $state({ list: [] as Notice[] });

export interface Target {
	address: string;
	watch: Watch;
}

const POLL_MS = 4000;

let targets: Target[] = [];
let after = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
let running = false;
let onHit: ((r: Received & { address: string }) => void) | undefined;
let seq = 0;

async function tick(): Promise<void> {
	if (!running) return;
	try {
		if (targets.length) {
			if (!after) after = (await firstRpc(latestHeight)) - 1;
			const txs = await firstRpc((rpc) => txsSince(rpc, SSCRT_ADDRESS, after, 2));
			const watches = targets.map((t) => t.watch);
			for (const tx of txs) {
				after = Math.max(after, tx.height);
				for (const hit of scanTx(tx, watches)) {
					const address = targets[hit.watch]!.address;
					onHit?.({ ...hit, address });
				}
			}
		}
	} catch {
		/* node hiccup: try again next tick */
	}
	if (running) timer = setTimeout(tick, POLL_MS);
}

export function startWatcher(list: Target[], hit: (r: Received & { address: string }) => void): void {
	stopWatcher();
	targets = list;
	onHit = hit;
	running = true;
	after = 0;
	void tick();
}

export function stopWatcher(): void {
	running = false;
	clearTimeout(timer);
	targets = [];
	onHit = undefined;
}

export function pushNotice(n: Omit<Notice, 'id' | 'time'>): void {
	const notice = { ...n, id: ++seq, time: Date.now() };
	notices.list = [...notices.list, notice].slice(-3);
	setTimeout(() => dismissNotice(notice.id), 6000);
}

export function dismissNotice(id: number): void {
	notices.list = notices.list.filter((n) => n.id !== id);
}
