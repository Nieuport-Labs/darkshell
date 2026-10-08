import { fromBaseUnits, normalizeAmount, toBaseUnits } from 'secret-pay';
import { DECIMALS } from './config';

/** 12345678 → "12.345678"; grouped integer part, trimmed decimals. */
export function formatAmount(base: bigint | null | undefined, maxDecimals = 6): string {
	if (base === null || base === undefined) return '—';
	const s = fromBaseUnits(base, DECIMALS);
	const [int, frac = ''] = s.split('.');
	const grouped = int!.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
	const f = frac.slice(0, maxDecimals);
	return f ? `${grouped}.${f}` : grouped;
}

/** Splits for display: big integer part, small decimals. Always shows 2 decimals. */
export function splitAmount(base: bigint | null): { int: string; frac: string } {
	if (base === null) return { int: '—', frac: '' };
	const s = fromBaseUnits(base, DECIMALS);
	const [int, frac = ''] = s.split('.');
	return { int: int!.replace(/\B(?=(\d{3})+(?!\d))/g, ' '), frac: frac.padEnd(2, '0') };
}

/** User input → base units, or null. Accepts comma as decimal separator. */
export function parseAmountInput(input: string): bigint | null {
	const norm = normalizeAmount(input.replace(',', '.').replace(/\s/g, ''));
	if (!norm) return null;
	try {
		return toBaseUnits(norm, DECIMALS);
	} catch {
		return null;
	}
}

export function shortAddress(a: string, head = 10, tail = 6): string {
	return a.length <= head + tail + 1 ? a : `${a.slice(0, head)}…${a.slice(-tail)}`;
}

export function relativeTime(unix?: number): string {
	if (!unix) return '';
	const diff = Date.now() / 1000 - unix;
	if (diff < 60) return 'just now';
	if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
	if (diff < 86400) return `${Math.floor(diff / 3600)} h ago`;
	return new Date(unix * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}
