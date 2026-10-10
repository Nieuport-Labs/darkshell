// NFC (android NfcPlugin.java). An open invoice is shared as an NFC tag holding
// its link: a phone with DarkShell closed reads it like a sticker and opens the
// payment sheet; one with DarkShell open reads it here and shows the invoice.

import { App } from '@capacitor/app';
import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';

interface NfcPlugin {
	status(): Promise<{ available: boolean; enabled: boolean; hce: boolean }>;
	share(o: { url: string }): Promise<void>;
	stopShare(): Promise<void>;
	startReading(): Promise<void>;
	stopReading(): Promise<void>;
	addListener(event: 'read', fn: (e: { url: string }) => void): Promise<PluginListenerHandle>;
}

const Nfc = registerPlugin<NfcPlugin>('Nfc');

/** `canShare`: the phone can act as a tag (HCE) */
export const nfc = $state({ available: false, enabled: false, canShare: false, sharing: false });

async function readStatus(): Promise<void> {
	try {
		const s = await Nfc.status();
		nfc.available = s.available;
		nfc.enabled = s.enabled;
		nfc.canShare = s.available && s.hce;
	} catch {
		/* no plugin (browser) */
	}
}

/** Reads tags while the app is open; every link read goes to `onUrl`. */
export async function initNfc(onUrl: (url: string) => void): Promise<void> {
	if (!Capacitor.isNativePlatform()) return;
	await readStatus();
	if (!nfc.available) return;
	await Nfc.addListener('read', ({ url }) => {
		navigator.vibrate?.(30);
		onUrl(url);
	});
	// NFC may have been switched on or off in the meantime
	void App.addListener('resume', () => void readStatus());
	await Nfc.startReading();
}

/** Shares a link as an NFC tag until the returned function is called. */
export function shareOverNfc(url: string): () => void {
	if (!nfc.canShare) return () => {};
	let stopped = false;
	nfc.sharing = true;
	void Nfc.share({ url }).catch(() => (nfc.sharing = false));
	return () => {
		if (stopped) return;
		stopped = true;
		nfc.sharing = false;
		void Nfc.stopShare().catch(() => {});
	};
}
