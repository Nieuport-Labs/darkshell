// The sheet word: a word the user picks, shown at the top of the payment sheet
// and the lock screen. Another app can draw a look-alike sheet to catch the PIN,
// but it cannot know this word (app storage is private, and FLAG_SECURE keeps
// it out of screenshots), so a sheet without it is not DarkShell.
//
// Not a secret like the PIN: stored as is, outside the vault, because it has
// to be shown before anything is unlocked.

import { kv } from './storage';

export const SHEET_WORD_KEY = 'settings.sheetWord';
export const SHEET_WORD_MAX = 24;

export async function sheetWord(): Promise<string> {
	return (await kv.get<string>(SHEET_WORD_KEY).catch(() => undefined)) ?? '';
}

export async function setSheetWord(word: string): Promise<string> {
	const clean = word.trim().slice(0, SHEET_WORD_MAX);
	if (clean) await kv.set(SHEET_WORD_KEY, clean);
	else await kv.del(SHEET_WORD_KEY);
	return clean;
}
