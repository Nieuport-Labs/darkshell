// The payment sheet (android PayActivity): a payment link or another app opens
// DarkShell as a sheet over itself. This module talks to the native side
// (PaySheetPlugin.java). In a dev browser, `?sheet=<payment link>` previews it.

import { Capacitor, registerPlugin } from '@capacitor/core';
import { returnUrlFor, type ReturnStatus } from 'secret-pay';
import type { Target } from './classify';

interface PaySheetPlugin {
	info(): Promise<{ url: string | null; forResult: boolean; caller?: string | null }>;
	finish(o: { status: ReturnStatus; tx?: string; id?: string }): Promise<void>;
	openUrl(o: { url: string }): Promise<void>;
	openInApp(o: { url?: string }): Promise<void>;
}

const PaySheet = registerPlugin<PaySheetPlugin>('PaySheet');

export interface SheetRequest {
	url: string;
	/** another app started it for a result */
	forResult: boolean;
}

const devUrl = () => (import.meta.env.DEV ? new URLSearchParams(location.search).get('sheet') : null);

/** The request this WebView was opened for as a payment sheet; null in the full app. */
export async function sheetRequest(): Promise<SheetRequest | null> {
	const dev = devUrl();
	if (dev) return { url: dev, forResult: false };
	if (!Capacitor.isNativePlatform()) return null;
	try {
		const i = await PaySheet.info();
		return i.url ? { url: i.url, forResult: i.forResult } : null;
	} catch {
		return null;
	}
}

/** What the sheet shows itself: a Secret request with an amount. Everything else opens the full app. */
export function fitsSheet(t: Target): t is Extract<Target, { kind: 'secret' }> {
	return t.kind === 'secret' && !!t.request.amount;
}

/**
 * Leaves the sheet. After paying, a web page that gave a `return` URL is opened
 * with the outcome; an app that asked for a result gets it; otherwise the
 * caller (the browser tab) is simply back on top.
 */
export async function leaveSheet(req: SheetRequest, t: Extract<Target, { kind: 'secret' }> | null, status: ReturnStatus, tx?: string): Promise<void> {
	const back = t && status === 'paid' && !req.forResult ? returnUrlFor(t.request, { status, tx }) : null;
	if (devUrl()) {
		console.info('[sheet] leave', { status, tx, back });
		document.body.dataset.sheetLeft = back ?? status;
		return;
	}
	if (back) return PaySheet.openUrl({ url: back });
	return PaySheet.finish({ status, tx, id: t?.request.id });
}

/** Hands the link to the full app (requests without an amount, Lightning, other chains…). */
export async function openInApp(url: string): Promise<void> {
	if (devUrl()) {
		console.info('[sheet] open in app', url);
		document.body.dataset.sheetLeft = 'app';
		return;
	}
	return PaySheet.openInApp({ url });
}
