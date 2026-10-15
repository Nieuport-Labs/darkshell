import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import cs from '../src/lib/i18n/cs';
import de from '../src/lib/i18n/de';
import { i18n, t, tn } from '../src/lib/i18n/index.svelte';

// every literal text the app passes to t()/tr()/tn()
function texts(dir: string, out = new Set<string>()): Set<string> {
	for (const name of readdirSync(dir)) {
		const p = join(dir, name);
		if (statSync(p).isDirectory()) {
			if (name !== 'i18n') texts(p, out);
		} else if (/\.(svelte|ts)$/.test(name)) {
			const src = readFileSync(p, 'utf8');
			for (const m of src.matchAll(/(?<![\w.])(?:tr?|tn)\(\s*'((?:[^'\\]|\\.)*)'/g)) out.add(m[1]!.replace(/\\'/g, "'"));
		}
	}
	return out;
}

describe('translations', () => {
	const all = texts(join(__dirname, '../src'));

	it.each([
		['cs', cs],
		['de', de],
	])('%s has every text', (_, dict) => {
		expect([...all].filter((k) => !(k in dict))).toEqual([]);
	});

	it('keeps the placeholders of every text', () => {
		for (const dict of [cs, de])
			for (const [k, v] of Object.entries(dict)) {
				const want = (k.replace(/#\w+$/, '').match(/\{\w+\}/g) ?? []).sort();
				expect((v.match(/\{\w+\}/g) ?? []).sort(), `${k} → ${v}`).toEqual(want);
			}
	});

	it('fills values and counts', () => {
		i18n.lang = 'cs';
		expect(t('Account {0}', { 0: 2 })).toBe('Účet 2');
		expect(tn('{n} accounts', 1)).toBe('1 účet');
		expect(tn('{n} accounts', 3)).toBe('3 účty');
		expect(tn('{n} accounts', 7)).toBe('7 účtů');
		i18n.lang = 'en';
		expect(tn('{n} accounts', 1)).toBe('1 account');
		expect(t('Not in any dictionary {0}', { 0: 'x' })).toBe('Not in any dictionary x');
	});
});
