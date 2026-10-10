// Fingerprint unlock. The PIN is stored in the Android Keystore under a key
// that only works right after a successful biometric check (BiometricPrompt
// with a CryptoObject) and is invalidated when fingerprints are added or
// removed. The app never sees anything but the PIN coming back; the vault is
// then opened exactly as if it had been typed.

import { Capacitor } from '@capacitor/core';
import { kv } from '../storage';

const SERVER = 'cash.darkshell.wallet.pin';

async function plugin() {
	return import('@capgo/capacitor-native-biometric');
}

export async function biometricAvailable(): Promise<boolean> {
	if (!Capacitor.isNativePlatform()) return false;
	try {
		const { NativeBiometric } = await plugin();
		return (await NativeBiometric.isAvailable({ useFallback: false })).isAvailable;
	} catch {
		return false;
	}
}

export async function biometricEnabled(): Promise<boolean> {
	return Capacitor.isNativePlatform() && (await kv.get<boolean>('bio.enabled')) === true;
}

/** Stores the PIN behind the fingerprint (shows the system prompt). */
export async function enableBiometric(pin: string): Promise<void> {
	const { NativeBiometric, AccessControl } = await plugin();
	await NativeBiometric.setCredentials({ username: 'pin', password: pin, server: SERVER, accessControl: AccessControl.BIOMETRY_CURRENT_SET });
	await kv.set('bio.enabled', true);
}

/** Asks for the fingerprint and returns the PIN; throws when cancelled or no longer valid. */
export async function biometricPin(): Promise<string> {
	const { NativeBiometric } = await plugin();
	const c = await NativeBiometric.getSecureCredentials({
		server: SERVER,
		title: 'Unlock DarkShell',
		subtitle: 'Use your fingerprint',
		negativeButtonText: 'Use PIN',
	});
	return c.password;
}

/** The same, worded as the confirmation of a payment (the payment sheet). */
export async function confirmPin(title: string, subtitle: string): Promise<string> {
	const { NativeBiometric } = await plugin();
	const c = await NativeBiometric.getSecureCredentials({ server: SERVER, title, subtitle, negativeButtonText: 'Use PIN' });
	return c.password;
}

/** The stored key stopped working (fingerprints added or removed). */
export const biometricInvalidated = (e: unknown) => /no protected credentials|invalidated|KeyPermanentlyInvalidated/i.test(e instanceof Error ? e.message : String(e));

export async function disableBiometric(): Promise<void> {
	await kv.del('bio.enabled');
	if (!Capacitor.isNativePlatform()) return;
	try {
		const { NativeBiometric } = await plugin();
		await NativeBiometric.deleteCredentials({ server: SERVER });
	} catch {
		/* nothing stored */
	}
}
