// The extension stays unlocked for IDLE_MINUTES after the last use, though its
// popup closes whenever the user clicks away: the open vault's AES key is kept
// in `chrome.storage.session` (memory only, gone when the browser closes,
// readable by the extension's own pages and background, never by sites), and
// the next window opens with it instead of the PIN (wallet.resumeWallet).
// The background's alarm drops it after the idle time; any open window then
// locks. Never the PIN or the phrase itself.

import { fromB64, toB64 } from '../lib/crypto/bytes';
import { lock, resumeWallet, wallet } from '../lib/wallet.svelte';
import { IDLE_MINUTES, UNLOCK_KEY } from './session';

export { UNLOCK_KEY };

export async function rememberUnlock(raw: Uint8Array | null): Promise<void> {
	if (raw) await chrome.storage.session.set({ [UNLOCK_KEY]: toB64(raw) });
	else await chrome.storage.session.remove(UNLOCK_KEY);
}

/** Opens the wallet with the kept key, if there is one. */
export async function resume(): Promise<boolean> {
	const b64 = (await chrome.storage.session.get(UNLOCK_KEY))[UNLOCK_KEY] as string | undefined;
	if (!b64) return false;
	try {
		await resumeWallet(fromB64(b64));
		bump(true);
		return true;
	} catch {
		// sealed under another key since (a new PIN): ask for the PIN
		await rememberUnlock(null);
		return false;
	}
}

let bumped = 0;

/** Use of a window: the idle time starts again (at most every 30 s). */
function bump(force = false): void {
	if (wallet.phase !== 'unlocked' || (!force && Date.now() - bumped < 30_000)) return;
	bumped = Date.now();
	void chrome.alarms.create('lock', { delayInMinutes: IDLE_MINUTES });
}

/** In every extension window: activity keeps the session alive, the background's lock closes it. */
export function watchIdle(): void {
	for (const e of ['pointerdown', 'keydown'] as const) addEventListener(e, () => bump(), { passive: true });
	chrome.storage.onChanged.addListener((changes, area) => {
		if (area === 'session' && changes[UNLOCK_KEY] && !changes[UNLOCK_KEY].newValue && wallet.phase === 'unlocked') lock();
	});
}
