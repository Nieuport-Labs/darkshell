// Sites the user connected, per account. Kept in the encrypted account store,
// so this device's storage doesn't list which sites the wallet talks to.

import { accountKv } from '../crypto/localStore';

export interface Connection {
	origin: string;
	/** when the user approved it */
	since: number;
	/** last request from it */
	used?: number;
}

export async function connections(address: string): Promise<Connection[]> {
	return (await accountKv.get<Connection[]>('dapps', address)) ?? [];
}

export async function isConnected(address: string, origin: string): Promise<boolean> {
	return (await connections(address)).some((c) => c.origin === origin);
}

export async function allow(address: string, origin: string): Promise<void> {
	const list = await connections(address);
	if (list.some((c) => c.origin === origin)) return;
	await accountKv.set('dapps', address, [{ origin, since: Date.now() }, ...list]);
}

export async function touch(address: string, origin: string): Promise<void> {
	const list = await connections(address);
	const c = list.find((x) => x.origin === origin);
	if (!c) return;
	c.used = Date.now();
	await accountKv.set('dapps', address, list);
}

export async function revoke(address: string, origin: string): Promise<void> {
	const list = await connections(address);
	await accountKv.set('dapps', address, list.filter((c) => c.origin !== origin));
}

/** "https://dashboard.nieuportlabs.cz" → "dashboard.nieuportlabs.cz" */
export function siteName(origin: string): string {
	try {
		const u = new URL(origin);
		return u.port ? u.host : u.hostname;
	} catch {
		return origin;
	}
}
