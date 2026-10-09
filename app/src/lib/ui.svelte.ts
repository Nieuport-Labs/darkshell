// Which dialog is open. Only `/pay/<address>?…` is a real URL (so shared
// invoice links open the wallet on the payment); everything else is state.

import type { HistoryItem } from './chain/sscrt';
import type { ChainActivity } from './chain/activity';
import { classify, type Target } from './pay/classify';

export type Dialog =
	| { name: 'send'; target?: Target; raw?: string }
	| { name: 'pay'; target: Extract<Target, { kind: 'secret' }>; raw: string }
	| { name: 'receive' }
	| { name: 'invoice'; fromReceive?: boolean; id?: string }
	| { name: 'settings' }
	| { name: 'accounts' }
	| { name: 'contacts' }
	| { name: 'stake'; validator?: string; mode?: 'stake' | 'unstake' }
	| { name: 'proposal'; id: string }
	/** a one-tap transaction (collect rewards, make private, refill gas credits): recap, then swipe */
	| { name: 'action'; action: 'claim' | 'wrap' | 'refill' }
	| { name: 'tx'; item?: HistoryItem; hash?: string; chain?: ChainActivity }
	| { name: 'lightning'; target?: Extract<Target, { kind: 'lightning' }>; orderId?: string };

/** `activity` has no tab of its own: Home's "See all" opens it */
export type Tab = 'home' | 'activity' | 'invoices' | 'staking' | 'settings';

export const ui = $state({ dialog: null as Dialog | null, scanning: false, tab: 'home' as Tab, hideBalance: false });

/** Switches the bottom tab: closes any dialog and starts the page at the top. */
export function goTab(t: Tab): void {
	ui.dialog = null;
	ui.scanning = false;
	ui.tab = t;
	if (typeof window !== 'undefined') window.scrollTo({ top: 0 });
}

export function open(d: Dialog): void {
	ui.dialog = d;
}

export function close(): void {
	ui.dialog = null;
}

/** Routes anything scanned or pasted: an invoice with an amount goes to Pay, the rest to Send. */
export function openPayment(raw: string): void {
	const target = classify(raw);
	if (target.kind === 'secret' && target.request.amount !== undefined) open({ name: 'pay', target, raw });
	else if (target.kind === 'lightning') open({ name: 'lightning', target });
	else open({ name: 'send', target, raw });
}

/** A `/pay/…` link the app was opened with, consumed once after unlock. */
export function takePendingPayLink(): string | null {
	if (typeof location === 'undefined' || !location.pathname.startsWith('/pay/')) return null;
	const link = location.href;
	history.replaceState(null, '', '/');
	return link;
}
