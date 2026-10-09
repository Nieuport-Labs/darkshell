// "Connect through Tor": Tor runs inside the Android app and carries all of
// its traffic (native side: TorManager.java). Not available in a browser.
//
// While Tor is on but not connected yet, the app does not touch the network
// at all: every fetch / XHR waits (gateNetwork) until the first circuit is up.
// The native proxy fails closed anyway; this keeps requests from failing and
// the app from showing errors while Tor connects.

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

/** `stuck`: still not connected after STUCK_MS (shown as "can't connect") */
export const tor = $state({ enabled: false, status: 'OFF' as Status, stuck: false });

const STUCK_MS = 120_000;
let stuckTimer: ReturnType<typeof setTimeout> | undefined;

/** set once the native side has said whether Tor is on */
let known = !torAvailable;
const waiters: (() => void)[] = [];

/** whether the app may use the network now */
export function torReady(): boolean {
	return known && (!tor.enabled || tor.status === 'ON');
}

/** resolves once the app may use the network */
export function whenOnline(): Promise<void> {
	return torReady() ? Promise.resolve() : new Promise((r) => waiters.push(r));
}

function update(s: Partial<TorState>) {
	if (s.enabled !== undefined) tor.enabled = s.enabled;
	if (s.status !== undefined) tor.status = s.status;
	clearTimeout(stuckTimer);
	tor.stuck = tor.enabled && tor.status === 'OFF';
	if (tor.enabled && tor.status === 'STARTING') stuckTimer = setTimeout(() => (tor.stuck = tor.status !== 'ON'), STUCK_MS);
	if (torReady()) waiters.splice(0).forEach((w) => w());
}

let gated = false;

/** Holds back every fetch and XHR until `torReady()`. Call before anything goes out. */
export function gateNetwork(): void {
	if (!torAvailable || gated) return;
	gated = true;
	const fetch0 = window.fetch.bind(window);
	window.fetch = async (...a: Parameters<typeof fetch>) => {
		await whenOnline();
		return fetch0(...a);
	};
	const send0 = XMLHttpRequest.prototype.send;
	XMLHttpRequest.prototype.send = function (this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
		if (torReady()) return send0.call(this, body);
		void whenOnline().then(() => {
			// aborted while waiting
			if (this.readyState === XMLHttpRequest.OPENED) send0.call(this, body);
		});
	};
}

let listening = false;
/** called whenever Tor finishes connecting, so the wallet can refresh */
let onReady: (() => void) | undefined;

export async function initTor(ready?: () => void): Promise<void> {
	onReady = ready;
	if (!torAvailable) return;
	gateNetwork();
	try {
		if (!listening) {
			listening = true;
			await Tor.addListener('status', (e) => {
				const was = tor.status;
				update({ status: e.status });
				if (e.status === 'ON' && was !== 'ON') onReady?.();
			});
		}
		const s = await Tor.status();
		known = true;
		update(s);
	} catch {
		// no Tor plugin answer: don't hold the network back forever
		known = true;
		update({});
	}
}

export async function setTor(on: boolean): Promise<void> {
	if (!torAvailable) return;
	const s = on ? await Tor.start() : await Tor.stop();
	update(s);
	if (!on) onReady?.();
}

export function torLabel(): string {
	if (!tor.enabled) return 'Off';
	if (tor.status === 'ON') return 'Connected';
	if (tor.stuck || tor.status === 'STOPPING' || tor.status === 'OFF') return "Can't connect";
	return 'Connecting…';
}

/** Whether check.torproject.org sees this app's traffic coming from Tor. */
export async function checkTor(): Promise<{ isTor: boolean; ip: string }> {
	return Tor.check();
}
