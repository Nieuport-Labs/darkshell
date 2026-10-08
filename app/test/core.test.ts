import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { encryptionSeedFor, isValidMnemonic, newMnemonic, walletFromMnemonic } from '../src/lib/crypto/account';
import { createVault, hasVault, pad, unlockVault, unpad, vaultAddress, WrongPasswordError } from '../src/lib/crypto/vault';
import { planFee, NoGasError } from '../src/lib/gas/feePayer';
import type { FeeGrant } from '../src/lib/gas/feegrant-sdk';
import { parseRichTx } from '../src/lib/chain/sscrt';
import { classify } from '../src/lib/pay/classify';
import { GAS_VAULT_ADDRESS, SSCRT_ADDRESS } from '../src/lib/config';

// LocalSecret's well-known test account "a" (public test mnemonic, never funded on mainnet)
const TEST_MNEMONIC =
	'grant rice replace explain federal release fix clever romance raise often wild taxi quarter soccer fiber love must tape steak together observe swap guitar';
const TEST_ADDRESS = 'secret1ap26qrlp8mcq2pg6r47w43l0y8zkqm8a450s03';

const CHEAP = { t: 1, m: 256, p: 1 };

describe('account', () => {
	it('generates valid 24-word mnemonics', () => {
		const m = newMnemonic();
		expect(m.split(' ')).toHaveLength(24);
		expect(isValidMnemonic(m)).toBe(true);
		expect(isValidMnemonic(m.replace(/\w+$/, 'zoo'))).toBe(false);
	});
	it("derives the standard Secret address (m/44'/529'/0'/0/0)", () => {
		expect(walletFromMnemonic(TEST_MNEMONIC).address).toBe(TEST_ADDRESS);
		expect(walletFromMnemonic(`  ${TEST_MNEMONIC.toUpperCase()} `).address).toBe(TEST_ADDRESS);
	});
	it('derives a stable 32-byte encryption seed', async () => {
		const a = await encryptionSeedFor(TEST_MNEMONIC);
		const b = await encryptionSeedFor(TEST_MNEMONIC);
		expect(a).toHaveLength(32);
		expect(a).toEqual(b);
	});
});

describe('vault', () => {
	it('pads to 512-byte blocks and unpads', () => {
		const data = new TextEncoder().encode('x'.repeat(600));
		const p = pad(data);
		expect((p.length + 16) % 512).toBe(0);
		expect(new TextDecoder().decode(unpad(p))).toBe('x'.repeat(600));
	});
	it('round-trips and rejects a wrong password', async () => {
		expect(await hasVault()).toBe(false);
		await createVault('correct horse', { mnemonic: TEST_MNEMONIC }, TEST_ADDRESS, 'pin', CHEAP);
		expect(await hasVault()).toBe(true);
		expect(await vaultAddress()).toBe(TEST_ADDRESS);
		expect((await unlockVault('correct horse')).mnemonic).toBe(TEST_MNEMONIC);
		await expect(unlockVault('wrong horse')).rejects.toBeInstanceOf(WrongPasswordError);
	});
});

const grant = (granter: string, spend?: string, extra: Partial<FeeGrant> = {}): FeeGrant =>
	({ granter, grantee: TEST_ADDRESS, kind: 'basic', spendLimit: spend, ...extra }) as FeeGrant;

describe('fee payer', () => {
	const MSG = ['/secret.compute.v1beta1.MsgExecuteContract'];
	it('prefers gas credits from the vault', () => {
		const plan = planFee([grant('secret1other', '99999999'), grant(GAS_VAULT_ADDRESS, '5000000')], 150_000, MSG, 0n);
		expect(plan).toMatchObject({ source: 'credits', feeGranter: GAS_VAULT_ADDRESS, fee: 15_000n });
	});
	it('falls back to another grant, then own SCRT', () => {
		expect(planFee([grant(GAS_VAULT_ADDRESS, '10'), grant('secret1other', '99999999')], 150_000, MSG, 0n).source).toBe('grant');
		expect(planFee([], 150_000, MSG, 20_000n).source).toBe('self');
	});
	it('throws when nothing can pay', () => {
		expect(() => planFee([], 150_000, MSG, 0n)).toThrow(NoGasError);
	});
});

describe('history', () => {
	const me = TEST_ADDRESS;
	it('parses SNIP-20 transaction_history entries', () => {
		const t = (action: Record<string, Record<string, string>>) => ({ id: 1, action, coins: { denom: 'SSCRT', amount: '1500000' }, memo: 'INV-1', block_time: 100 });
		expect(parseRichTx(t({ transfer: { from: 'secret1x', sender: 'secret1x', recipient: me } }), me)).toMatchObject({ kind: 'in', counterparty: 'secret1x', amount: 1_500_000n, memo: 'INV-1' });
		expect(parseRichTx(t({ transfer: { from: me, sender: me, recipient: 'secret1y' } }), me)).toMatchObject({ kind: 'out', counterparty: 'secret1y' });
		expect(parseRichTx(t({ deposit: {} }), me).kind).toBe('wrap');
		expect(parseRichTx(t({ redeem: {} }), me).kind).toBe('unwrap');
	});
});

describe('classify', () => {
	it('reads Secret requests, Cosmos addresses and Lightning invoices', () => {
		const s = classify(`${TEST_ADDRESS}:sSCRT`);
		expect(s.kind === 'secret' && s.request.asset).toBe(SSCRT_ADDRESS);
		const ln = classify(
			'lightning:lnbc20u1p3y0x3hpp5743k2g0fsqqxj7n8qzuhns5gmkk4djeejk3wkp64ppevgekvc0jsdqcve5kzar2v9nr5gpqd4hkuetesp5ez2g297jduwc20t6lmqlsg3man0vf2jfd8ar9fh8fhn2g8yttfkqxqy9gcqcqzys9qrsgqrzjqtx3k77yrrav9hye7zar2rtqlfkytl094dsp0ms5majzth6gt7ca6uhdkxl983uywgqqqqlgqqqvx5qqjqrzjqd98kxkpyw0l9tyy8r8q57k7zpy9zjmh6sez752wj6gcumqnj3yxzhdsmg6qq56utgqqqqqqqqqqqeqqjq7jd56882gtxhrjm03c93aacyfy306m4fq0tskf83c0nmet8zc2lxyyg3saz8x6vwcp26xnrlagf9semau3qm2glysp7sv95693fphvsp54l567', // light-bolt11-decoder test vector (2000 sats)
		);
		expect(ln.kind).toBe('lightning');
		expect(ln.kind === 'lightning' && ln.sats).toBe(2000n);
		expect(ln.kind === 'lightning' && ln.network).toBe('mainnet');
		expect(ln.kind === 'lightning' && ln.msat).toBe(2_000_000n);
		expect(classify('hello').kind).toBe('error');
	});
});

import { invoiceAsset, tokenForBankDenom } from '../src/lib/tokens';
import { swapIn, swapOut } from '../src/lib/chain/shadeSwap';
import { slippageFor } from '../src/lib/pay/quote';

describe('invoices in other assets', () => {
	const ATOM = 'secret19e75l25r6sa6nhdf4lggjmgpw0vmpfvsw5cnpe';
	it('resolves private tokens, public denoms and the default', () => {
		expect(invoiceAsset(undefined)).toMatchObject({ symbol: 'sSCRT', private: true });
		expect(invoiceAsset('uscrt')).toMatchObject({ symbol: 'SCRT', private: false });
		expect(invoiceAsset('uscrt')!.token.address).toBe(SSCRT_ADDRESS);
		expect(invoiceAsset(ATOM)).toMatchObject({ symbol: 'ATOM', private: true, decimals: 6 });
		const pub = tokenForBankDenom('ibc/27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2');
		expect(pub?.address).toBe(ATOM);
		expect(invoiceAsset('secret1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq')).toBeUndefined();
	});
	it('classifies an invoice in ATOM, also by ticker', () => {
		const t = classify(`secret:${TEST_ADDRESS}?asset=atom&amount=1.5`);
		expect(t.kind === 'secret' && t.asset.symbol).toBe('ATOM');
		expect(t.kind === 'secret' && t.request.asset).toBe(ATOM);
		const pub = classify(`secret:${TEST_ADDRESS}?asset=ibc/27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2&amount=2`);
		expect(pub.kind === 'secret' && pub.asset.private).toBe(false);
	});
	it('rejects unknown tokens', () => {
		expect(classify(`secret:${TEST_ADDRESS}?asset=doge&amount=1`).kind).toBe('error');
	});
});

describe('ShadeSwap math (ported)', () => {
	it('swapIn is the inverse of swapOut, rounded in the pool’s favour', () => {
		const [rIn, rOut, fn, fd] = [1_000_000_000n, 500_000_000n, 3n, 1000n];
		const want = 1_000_000n;
		const need = swapIn(rIn, rOut, want, fn, fd)!;
		expect(swapOut(rIn, rOut, need, fn, fd) >= want).toBe(true);
		expect(swapOut(rIn, rOut, need - 10n, fn, fd) < want).toBe(true);
	});
	it('clamps slippage to 1–5 %', () => {
		expect(slippageFor(0)).toBe(100n);
		expect(slippageFor(250)).toBe(250n);
		expect(slippageFor(9000)).toBe(500n);
	});
});
