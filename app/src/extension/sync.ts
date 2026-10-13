// Extension pages (popup, approval window) mirror the open wallet into the
// browser session: the account's public key, its enigma seed and its
// connected sites, so the background can answer a site without a window.
// Locking clears it.

import { toB64 } from '../lib/crypto/bytes';
import { connections, onConnectionsChange, revoke } from '../lib/dapp/permissions';
import { dappAccount, dappEnigmaSeed, onKeystoreChange } from '../lib/wallet.svelte';
import { pendingRevokes, setPendingRevokes, writeSession } from './session';

let running: Promise<void> = Promise.resolve();

async function sync(): Promise<void> {
	const a = dappAccount();
	const seed = dappEnigmaSeed();
	if (!a || !seed) return writeSession(null);
	// sites disconnected from the page while the wallet was locked
	const revokes = await pendingRevokes();
	const mine = revokes.filter((r) => r.address === a.address);
	for (const r of mine) await revoke(a.address, r.origin);
	if (mine.length) await setPendingRevokes(revokes.filter((r) => r.address !== a.address));
	const origins = (await connections(a.address)).map((c) => c.origin);
	await writeSession({ account: { name: a.name, address: a.address, pubkey: toB64(a.pubkey) }, seed: toB64(seed), origins, at: Date.now() });
}

/** Writes the current state now (one write at a time, in order). */
export function syncSession(): Promise<void> {
	running = running.then(sync, sync);
	return running;
}

export function startSync(): void {
	onKeystoreChange(() => void syncSession());
	onConnectionsChange(() => void syncSession());
}
