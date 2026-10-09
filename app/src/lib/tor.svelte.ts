// "Connect through Tor": Tor runs inside the Android app and carries all of
// its traffic (native side: TorManager.java). Not available in a browser.

import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';

type Status = 'OFF' | 'STARTING' | 'ON' | 'STOPPING';

interface TorState {
	enabled: boolean;
	status: Status;
	port: number;
}

interface TorPlugin {
	start(): Promise<TorState>;
	stop(): Promise<TorState>;
	status(): Promise<TorState>;
	check(): Promise<{ isTor: boolean; ip: string }>;
	addListener(event: 'status', fn: (e: { status: Status; port: number }) => void): Promise<PluginListenerHandle>;
}

const Tor = registerPlugin<TorPlugin>('Tor');

export const torAvailable = Capacitor.isNativePlatform();

export const tor = $state({ enabled: false, status: 'OFF' as Status });

let listening = false;
/** called whenever Tor finishes connecting, so the wallet can refresh */
let onReady: (() => void) | undefined;

export async function initTor(ready?: () => void): Promise<void> {
	onReady = ready;
	if (!torAvailable) return;
	if (!listening) {
		listening = true;
		await Tor.addListener('status', (e) => {
			const was = tor.status;
			tor.status = e.status;
			if (e.status === 'ON' && was !== 'ON') onReady?.();
		});
	}
	const s = await Tor.status();
	tor.enabled = s.enabled;
	tor.status = s.status;
}

export async function setTor(on: boolean): Promise<void> {
	if (!torAvailable) return;
	const s = on ? await Tor.start() : await Tor.stop();
	tor.enabled = s.enabled;
	tor.status = s.status;
	if (!on) onReady?.();
}

export function torLabel(): string {
	if (!tor.enabled) return 'Off';
	return tor.status === 'ON' ? 'Connected' : tor.status === 'STOPPING' || tor.status === 'OFF' ? 'Not running' : 'Connecting…';
}

/** Whether check.torproject.org sees this app's traffic coming from Tor. */
export async function checkTor(): Promise<{ isTor: boolean; ip: string }> {
	return Tor.check();
}
