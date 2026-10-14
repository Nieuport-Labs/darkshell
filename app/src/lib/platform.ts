// Where DarkShell is running, and what that place can do. Features ask for a
// capability here instead of asking "is this the Android app?", so each port
// (iOS, the browser extension) only turns on what it really has.

import { Capacitor } from '@capacitor/core';

export type Platform = 'android' | 'ios' | 'extension' | 'web';

function detect(): Platform {
	const p = Capacitor.getPlatform();
	if (p === 'android' || p === 'ios') return p;
	if (typeof location !== 'undefined' && (location.protocol === 'chrome-extension:' || location.protocol === 'moz-extension:')) return 'extension';
	return 'web';
}

export const platform: Platform = detect();

/** Inside Capacitor (Android or iOS). */
export const isNative = platform === 'android' || platform === 'ios';

export const can = {
	/** a key in secure hardware the vault is bound to (Keystore / Secure Enclave) */
	hwKey: isNative,
	/** Tor built in (tor-android and the WebView proxy) */
	tor: platform === 'android',
	/** NFC tags: read and share an invoice */
	nfc: platform === 'android',
	/** the payment sheet over the calling app */
	paySheet: platform === 'android',
	/** payments watched while the app is closed (foreground service) */
	bgNotify: platform === 'android',
	/** fingerprint / Face ID unlock */
	biometric: isNative,
	/** requests without CORS (FixedFloat, the faucet): native HTTP, or an extension's host permissions */
	crossOrigin: isNative || platform === 'extension',
	/** screenshots and recording blocked unless allowed in Settings (FLAG_SECURE, iOS cover) */
	screenShield: isNative,
	/** native HTTP through Capacitor */
	nativeHttp: isNative,
};
