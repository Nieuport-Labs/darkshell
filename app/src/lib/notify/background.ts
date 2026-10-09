// Phone notifications for incoming payments while DarkShell is closed.
//
// A small native service (android/.../PaymentWatchService.java) keeps one
// WebSocket to a public RPC node subscribed to sSCRT executions and checks each
// one against the accounts' notification seeds, so a payment shows up seconds
// after its block. For that the seeds are kept in plain app storage. A seed
// only lets someone recognise incoming sSCRT payments — it cannot spend, and
// it is never sent anywhere — so this is opt-in.

import { Capacitor, registerPlugin } from '@capacitor/core';
import { kv } from '../storage';
import { RPC_URLS, type Watch } from './snip52';

export const canNotify = Capacitor.isNativePlatform();
const CHANNEL = 'payments';

/** WebSocket endpoints that keep a subscription open (checked October 2026). */
export const RPC_WS = ['wss://rpc.lavenderfive.com:443/secretnetwork/websocket', 'wss://rpc-secret.keplr.app/websocket'];

export type LabelledWatch = Watch & { label?: string };

interface PaymentWatchPlugin {
	start(config: { watches: LabelledWatch[]; ws: string[]; rpc: string[] }): Promise<void>;
	stop(): Promise<void>;
	status(): Promise<{ enabled: boolean; unrestricted: boolean }>;
	allowBackground(): Promise<void>;
}

const PaymentWatch = registerPlugin<PaymentWatchPlugin>('PaymentWatch');

/** Same numeric id the native service uses for a tx, so a payment never shows twice. */
export function notificationNumber(hash: string): number {
	return parseInt(hash.slice(0, 7), 16);
}

// Returns the module, never the plugin itself: an async function returning a
// Capacitor plugin proxy makes the promise call `.then()` on it, which the
// plugin rejects natively — and the await never finishes.
async function notifications() {
	return import('@capacitor/local-notifications');
}

export async function backgroundEnabled(): Promise<boolean> {
	return canNotify && (await kv.get<boolean>('notify.background')) === true;
}

/** Asks for the Android 13+ notification permission. */
async function permission(): Promise<boolean> {
	const ln = (await notifications()).LocalNotifications;
	let p = await ln.checkPermissions();
	if (p.display !== 'granted') p = await ln.requestPermissions();
	return p.display === 'granted';
}

export async function setBackground(on: boolean, watches: LabelledWatch[]): Promise<boolean> {
	if (!canNotify) return false;
	if (on && !(await permission())) return false;
	await kv.set('notify.background', on);
	await syncBackground(on ? watches : []);
	return on;
}

/** Hands the current accounts' seeds to the service (or stops it). */
export async function syncBackground(watches: LabelledWatch[]): Promise<void> {
	if (!canNotify) return;
	if (watches.length) await PaymentWatch.start({ watches, ws: RPC_WS, rpc: RPC_URLS });
	else await PaymentWatch.stop().catch(() => {});
}

/** Whether Android lets the service run without battery restrictions. */
export async function backgroundUnrestricted(): Promise<boolean> {
	if (!canNotify) return true;
	return (await PaymentWatch.status().catch(() => ({ unrestricted: true }))).unrestricted;
}

export async function allowBackground(): Promise<void> {
	if (canNotify) await PaymentWatch.allowBackground();
}

/** A notification right now, from the app itself (used while it is in the background). */
export async function notifyNow(hash: string, title: string, body: string): Promise<void> {
	if (!canNotify) return;
	try {
		const ln = (await notifications()).LocalNotifications;
		if ((await ln.checkPermissions()).display !== 'granted') return;
		await ln.createChannel({ id: CHANNEL, name: 'Payments received', importance: 4, visibility: 0 });
		await ln.schedule({ notifications: [{ id: notificationNumber(hash), title, body, channelId: CHANNEL, smallIcon: 'ic_stat_notify', autoCancel: true }] });
	} catch {
		/* best effort */
	}
}

/** Called when the wallet is erased from the device. */
export async function clearBackground(): Promise<void> {
	if (!canNotify) return;
	await PaymentWatch.stop().catch(() => {});
	try {
		const ln = (await notifications()).LocalNotifications;
		if ((await ln.getDeliveredNotifications()).notifications.length) await ln.removeAllDeliveredNotifications();
	} catch {
		/* nothing to clear */
	}
}
