// What the extension remembers between windows while the browser runs:
// the unlocked account's public side and its enigma seed, and which sites
// it is connected to. Kept in `chrome.storage.session` (memory only, gone
// when the browser closes, readable by the extension's own pages and
// background, not by content scripts). Never the phrase, the private key or
// the PIN. (The vault key, while unlocked, is kept by unlock.ts.)

export interface DappSession {
	account: { name: string; address: string; pubkey: string };
	/** base64 enigma seed: lets the background answer a site's encrypt/decrypt */
	seed: string;
	origins: string[];
	/** last use, for the idle lock */
	at: number;
}

const KEY = 'dapp';

/** Lock after this long without a request or a window. */
export const IDLE_MINUTES = 15;

export async function readSession(): Promise<DappSession | null> {
	const r = await chrome.storage.session.get(KEY);
	return (r[KEY] as DappSession | undefined) ?? null;
}

export async function writeSession(s: DappSession | null): Promise<void> {
	if (s) await chrome.storage.session.set({ [KEY]: s });
	else await chrome.storage.session.remove(KEY);
}

export const SESSION_KEY = KEY;

/** the open vault's key while the wallet is unlocked (unlock.ts) */
export const UNLOCK_KEY = 'unlock';

/** A site the user disconnected while the wallet was locked: dropped from the vault's list at the next unlock. */
export interface PendingRevoke {
	address: string;
	origin: string;
}

const REVOKES = 'revokes';

export async function pendingRevokes(): Promise<PendingRevoke[]> {
	return ((await chrome.storage.local.get(REVOKES))[REVOKES] as PendingRevoke[] | undefined) ?? [];
}

export async function setPendingRevokes(list: PendingRevoke[]): Promise<void> {
	if (list.length) await chrome.storage.local.set({ [REVOKES]: list });
	else await chrome.storage.local.remove(REVOKES);
}
