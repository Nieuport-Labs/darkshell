// Android shell integration (Capacitor). No-ops in a browser.

import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { close, goTab, openPayment, ui } from './ui.svelte';
import { resetEndpoint } from './chain/client';
import { initTor } from './tor.svelte';
import { refresh, wallet } from './wallet.svelte';

export const isNative = Capacitor.isNativePlatform();

let pendingLink: string | null = null;

/** A payment link opened from outside, waiting for the wallet to unlock. */
export function takeNativeLink(): string | null {
	const l = pendingLink;
	pendingLink = null;
	return l;
}

export function initNative(): void {
	if (!isNative) return;

	// Tor (if on) is started natively before the WebView loads; once its first
	// circuit is up, try the network again
	void initTor(() => {
		resetEndpoint();
		if (wallet.phase === 'unlocked') void refresh();
	});

	// payment links (dashboard /pay/ links, `secret:`, `lightning:`) open the payment
	void App.addListener('appUrlOpen', ({ url }) => {
		if (wallet.phase === 'unlocked') openPayment(url);
		else pendingLink = url;
	});
	void App.getLaunchUrl().then((r) => {
		if (r?.url) pendingLink = r.url;
	});

	// hardware back: close the scanner or dialog first, then leave the app
	void App.addListener('backButton', () => {
		if (ui.scanning) ui.scanning = false;
		else if (ui.dialog) close();
		else if (ui.tab !== 'home') goTab('home');
		else void App.minimizeApp();
	});
}
