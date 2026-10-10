import { describe, expect, it } from 'vitest';
import { classify } from '../src/lib/pay/classify';
import { blockReason, invoiceFacts, sscrtCost, type InvoiceTarget } from '../src/lib/pay/invoicePay';
import { fitsSheet } from '../src/lib/pay/sheet';

const PAYEE = 'secret16dyfc744j0lrhae0xpfjxl5cnx2hu80h0p0rad';
const ME = 'secret1k0jntykt7e4g3y88ltc60czgjuqdy4c9e8fzek';
const target = (q: string) => classify(`secret:${PAYEE}?${q}`) as InvoiceTarget;

describe('payment sheet', () => {
	it('shows Secret requests with an amount; everything else opens the full app', () => {
		expect(fitsSheet(classify(`secret:${PAYEE}?asset=sscrt&amount=2`))).toBe(true);
		expect(fitsSheet(classify(`secret://${PAYEE}?asset=sscrt&amount=2`))).toBe(true);
		expect(fitsSheet(classify(`secret:${PAYEE}?asset=sscrt`))).toBe(false);
		expect(fitsSheet(classify(`secret:${PAYEE}`))).toBe(false);
		expect(fitsSheet(classify('lightning:lnbc1'))).toBe(false);
		expect(fitsSheet(classify('hello'))).toBe(false);
	});

	it('costs the amount itself in sSCRT, and a swap only once quoted', () => {
		const t = target('asset=sscrt&amount=12.5&id=INV-A&return=https%3A%2F%2Fshop.example%2Fdone');
		const f = invoiceFacts(t);
		expect(f).toMatchObject({ amount: 12_500_000n, swapping: false, memo: 'INV-A', returnHost: 'shop.example' });
		expect(sscrtCost(f, { kind: 'none' })).toBe(12_500_000n);

		const s = target('asset=silk&amount=5');
		const fs = invoiceFacts(s);
		expect(fs.swapping).toBe(true);
		expect(sscrtCost(fs, { kind: 'loading' })).toBeNull();
	});

	it('refuses what cannot be paid', () => {
		const t = target('asset=sscrt&amount=3');
		const f = invoiceFacts(t);
		expect(blockReason(t, f, { kind: 'none' }, null, ME)).toBe('');
		expect(blockReason(t, f, { kind: 'none' }, 2_000_000n, ME)).toBe('Not enough sSCRT.');
		expect(blockReason(t, f, { kind: 'none' }, 3_000_000n, ME)).toBe('');
		expect(blockReason(t, f, { kind: 'none' }, null, PAYEE)).toBe('This is your own request.');
		const old = target('asset=sscrt&amount=3&exp=1000');
		expect(blockReason(old, invoiceFacts(old), { kind: 'none' }, null, ME)).toBe('This request has expired.');
	});

	it('rejects a return URL that is not https', () => {
		expect(classify(`secret:${PAYEE}?asset=sscrt&amount=1&return=javascript%3Aalert(1)`).kind).toBe('error');
	});
});
