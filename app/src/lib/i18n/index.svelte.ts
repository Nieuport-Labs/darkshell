// The app's language. Texts are written in English in the code and wrapped in
// t(); a language is a dictionary from the English text to its translation
// (lib/i18n/cs.ts, de.ts). A text missing from a dictionary shows in English.
//
// Kept in plain storage (settings.lang), not in the vault: the lock screen and
// onboarding speak it before anything is unlocked.

import { kv } from '../storage';
import cs from './cs';
import de from './de';

export type Lang = 'en' | 'cs' | 'de';

export const LANGS: { code: Lang; name: string; flag: string }[] = [
	{ code: 'en', name: 'English', flag: '🇬🇧' },
	{ code: 'cs', name: 'Čeština', flag: '🇨🇿' },
	{ code: 'de', name: 'Deutsch', flag: '🇩🇪' },
];

const DICTS: Record<Lang, Record<string, string> | null> = { en: null, cs, de };

/** The browser's or phone's language, when DarkShell speaks it. */
export function systemLang(): Lang {
	const list = typeof navigator === 'undefined' ? [] : (navigator.languages ?? [navigator.language]);
	for (const l of list) {
		const code = l.slice(0, 2).toLowerCase();
		if (code === 'cs' || code === 'sk') return 'cs';
		if (code === 'de') return 'de';
		if (code === 'en') return 'en';
	}
	return 'en';
}

export const i18n = $state({ lang: systemLang() as Lang });

/** BCP 47 tag for number and date formatting. */
export function locale(): string {
	return { en: 'en-US', cs: 'cs-CZ', de: 'de-DE' }[i18n.lang];
}

export async function loadLang(): Promise<void> {
	const saved = await kv.get<Lang>('settings.lang');
	if (saved && saved in DICTS) i18n.lang = saved;
	setDocumentLang();
}

export async function setLang(lang: Lang): Promise<void> {
	i18n.lang = lang;
	setDocumentLang();
	await kv.set('settings.lang', lang);
}

function setDocumentLang() {
	if (typeof document !== 'undefined') document.documentElement.lang = i18n.lang;
}

/** The text in the current language; `{name}` is filled from `vars`. */
export function t(text: string, vars?: Record<string, string | number | null | undefined>): string {
	const out = DICTS[i18n.lang]?.[text] ?? text;
	return vars ? out.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k] ?? "") : m)) : out;
}

// English singulars of the texts used with tn()
const EN_PLURALS: Record<string, string> = {
	'{n} accounts#one': '{n} account',
	'{n} contacts#one': '{n} contact',
	'{n} other tokens#one': '{n} other token',
	'{n} small amounts left out as dust.#one': '{n} small amount left out as dust.',
	'{n} transactions#one': '{n} transaction',
	'{n} validators#one': '{n} validator',
};

/**
 * A text with a count: `tn('{n} accounts', n)`. A dictionary gives the other
 * forms as `'{n} accounts#one'`, `#few`, `#many` (Intl.PluralRules categories);
 * the English singulars are in EN_PLURALS.
 */
export function tn(text: string, n: number, vars?: Record<string, string | number | null | undefined>): string {
	const cat = new Intl.PluralRules(locale()).select(n);
	const d = DICTS[i18n.lang];
	const out = cat === 'other' ? null : d ? d[`${text}#${cat}`] : EN_PLURALS[`${text}#${cat}`];
	return t(out ?? text, { n, ...vars });
}


/** An account's name as shown: the default names ("Account 2", "Účet 2"…) in the current language. */
export function accountName(name: string): string {
	const m = /^(?:Account|Účet|Konto) (\d+)$/.exec(name);
	return m ? t('Account {0}', { 0: m[1] }) : name;
}
