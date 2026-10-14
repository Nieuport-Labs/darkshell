// Settings → Screenshots. The phone apps block screenshots and screen
// recording by default (WindowShield.java, ScreenShieldPlugin.swift); the
// user can allow them. The choice lives on the native side, so it applies
// from the first frame of the next start, before the wallet is unlocked.

import { registerPlugin } from '@capacitor/core';
import { can } from './platform';

interface ScreenShieldPlugin {
	get(): Promise<{ allow: boolean }>;
	set(o: { allow: boolean }): Promise<{ allow: boolean }>;
}

const ScreenShield = registerPlugin<ScreenShieldPlugin>('ScreenShield');

export const screenShieldAvailable = can.screenShield;

export async function screenshotsAllowed(): Promise<boolean> {
	if (!can.screenShield) return true;
	return (await ScreenShield.get()).allow;
}

export async function allowScreenshots(allow: boolean): Promise<boolean> {
	if (!can.screenShield) return true;
	return (await ScreenShield.set({ allow })).allow;
}
