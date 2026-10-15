// Fingerprint unlock. The PIN is stored in the Android Keystore under a key
// that only works right after a successful biometric check (BiometricPrompt
// with a CryptoObject) and is invalidated when fingerprints are added or
// removed. The app never sees anything but the PIN coming back; the vault is
// then opened exactly as if it had been typed.
//
// There are two slots. The second one holds the emergency PIN, stored when it
// is set (or when the fingerprint is switched on), so the emergency PIN can
// later take over the fingerprint without the system asking to confirm a new
// credential — a prompt at that moment would show that it was the emergency
// PIN. `bio.slot` says which slot unlocks; the names say nothing about which
// is which.

import { kv } from '../storage';
import { can, platform } from '../platform';
import { t } from '../i18n/index.svelte';

const BASE = 'cash.darkshell.wallet.pin';
type Slot = 0 | 1;
const server = (slot: Slot) => (slot === 0 ? BASE : `${BASE}.b`);

async function activeSlot(): Promise<Slot> {
	return (await kv.get<Slot>('bio.slot')) === 1 ? 1 : 0;
}

async function plugin() {
	return import('@capgo/capacitor-native-biometric');
}

export async function biometricAvailable(): Promise<boolean> {
	if (!can.biometric) return false;
	try {
		const { NativeBiometric } = await plugin();
		return (await NativeBiometric.isAvailable({ useFallback: false })).isAvailable;
	} catch {
		return false;
	}
}

export async function biometricEnabled(): Promise<boolean> {
	return can.biometric && (await kv.get<boolean>('bio.enabled')) === true;
}

async function store(slot: Slot, pin: string): Promise<void> {
	const { NativeBiometric, AccessControl } = await plugin();
	await NativeBiometric.setCredentials({ username: 'pin', password: pin, server: server(slot), accessControl: AccessControl.BIOMETRY_CURRENT_SET });
}

async function drop(slot: Slot): Promise<void> {
	try {
		const { NativeBiometric } = await plugin();
		await NativeBiometric.deleteCredentials({ server: server(slot) });
	} catch {
		/* nothing stored */
	}
}

/** Stores the PIN behind the fingerprint (shows the system prompt). */
export async function enableBiometric(pin: string): Promise<void> {
	await store(await activeSlot(), pin);
	await kv.set('bio.enabled', true);
}

/** Stores the emergency PIN in the other slot, ready for `takeOverBiometric` (shows the system prompt). */
export async function prepareEmergencyBiometric(emergencyPin: string): Promise<void> {
	if (!(await biometricEnabled())) return;
	await store((1 - (await activeSlot())) as Slot, emergencyPin);
	await kv.set('bio.ready', true);
}

/** Whether the other slot holds the emergency PIN. */
export async function emergencyBiometricReady(): Promise<boolean> {
	return (await biometricEnabled()) && (await kv.get<boolean>('bio.ready')) === true;
}

export async function dropEmergencyBiometric(): Promise<void> {
	await kv.del('bio.ready');
	if (can.biometric) await drop((1 - (await activeSlot())) as Slot);
}

/**
 * The emergency PIN was used: the real PIN's slot is deleted and the
 * prepared one unlocks from now on. No system prompt. Call after the app's
 * storage was cleared, with the slot read before (`biometricSlot`).
 */
export async function takeOverBiometric(was: Slot): Promise<void> {
	await drop(was);
	await kv.set('bio.slot', (1 - was) as Slot);
	await kv.set('bio.enabled', true);
}

export const biometricSlot = activeSlot;

/** Asks for the fingerprint and returns the PIN; throws when cancelled or no longer valid. */
export async function biometricPin(): Promise<string> {
	const { NativeBiometric } = await plugin();
	const c = await NativeBiometric.getSecureCredentials({
		server: server(await activeSlot()),
		title: t('Unlock DarkShell'),
		subtitle: platform === 'ios' ? t('Use Face ID') : t('Use your fingerprint'),
		negativeButtonText: t('Use PIN'),
	});
	return c.password;
}

/** The same, worded as the confirmation of a payment (the payment sheet). */
export async function confirmPin(title: string, subtitle: string): Promise<string> {
	const { NativeBiometric } = await plugin();
	const c = await NativeBiometric.getSecureCredentials({ server: server(await activeSlot()), title, subtitle, negativeButtonText: t('Use PIN') });
	return c.password;
}

/** The stored key stopped working (fingerprints added or removed). */
export const biometricInvalidated = (e: unknown) => /no protected credentials|invalidated|KeyPermanentlyInvalidated/i.test(e instanceof Error ? e.message : String(e));

export async function disableBiometric(): Promise<void> {
	await Promise.all([kv.del('bio.enabled'), kv.del('bio.ready'), kv.del('bio.slot')]);
	if (!can.biometric) return;
	await Promise.all([drop(0), drop(1)]);
}
