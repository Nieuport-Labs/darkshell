// Turns anything scanned or pasted into a payment target.

import { decode as decodeBolt11 } from 'light-bolt11-decoder';
import { parsePayment, type ParseErrorCode, type PaymentRequest } from 'secret-pay';
import { ibcDestinationFor, type IbcDestination } from '../chain/ibc';
import { invoiceAsset, type InvoiceAsset } from '../tokens';
import { ExternalError, parseExternal, type ExternalTarget } from './external';

export type Target =
	| { kind: 'secret'; request: PaymentRequest; asset: InvoiceAsset }
	| { kind: 'ibc'; address: string; dest: IbcDestination }
	| { kind: 'lightning'; invoice: string; sats?: bigint; msat?: bigint; description?: string; expiresAt?: number; network: 'mainnet' | 'testnet' }
	| ExternalTarget
	| { kind: 'error'; message: string };

const MESSAGES: Record<ParseErrorCode, string> = {
	empty: 'Nothing to read.',
	unrecognized: 'This is not an address or payment request.',
	bad_address: 'The address is not valid (checksum failed).',
	bad_asset: 'The requested asset is not valid.',
	unknown_asset: 'The requested asset is unknown.',
	bad_amount: 'The requested amount is not valid.',
	too_many_decimals: 'The requested amount has too many decimals.',
	bad_exp: 'The expiry of this request is not valid.',
	bad_return: 'The page this request returns to is not a safe (https) address.',
	memo_too_long: 'The memo of this request is too long.',
	duplicate_param: 'This payment request is malformed.',
	unsupported_required_param: 'This payment request needs a feature this wallet does not have yet.',
	wrong_chain: 'This address belongs to a network that is not supported yet.',
};

function lightning(raw: string): Target | null {
	const inv = raw.trim().replace(/^lightning:/i, '').toLowerCase();
	if (!/^ln(bc|tb|bcrt)[0-9a-z]+$/.test(inv)) return null;
	try {
		const d = decodeBolt11(inv);
		let sats: bigint | undefined;
		let msat: bigint | undefined;
		let description: string | undefined;
		let ts: number | undefined;
		for (const s of d.sections) {
			if (s.name === 'amount') {
				msat = BigInt(s.value);
				sats = msat / 1000n;
			}
			if (s.name === 'description') description = String(s.value);
			if (s.name === 'timestamp') ts = s.value;
		}
		return {
			kind: 'lightning',
			invoice: inv,
			sats,
			msat,
			description,
			expiresAt: ts !== undefined ? ts + d.expiry : undefined,
			network: inv.startsWith('lnbc') && !inv.startsWith('lnbcrt') ? 'mainnet' : 'testnet',
		};
	} catch {
		return { kind: 'error', message: 'This Lightning invoice could not be read.' };
	}
}

export function classify(input: string): Target {
	const ln = lightning(input);
	if (ln) return ln;

	// Ethereum / Bitcoin / Monero (a BIP-21 request with a Lightning invoice pays that)
	try {
		const x = parseExternal(input);
		if (x && 'lightning' in x) return lightning(x.lightning) ?? { kind: 'error', message: 'The Lightning invoice in this request could not be read.' };
		if (x) return x;
	} catch (e) {
		if (e instanceof ExternalError) return { kind: 'error', message: e.message };
		throw e;
	}

	const r = parsePayment(input);
	if (r.ok) {
		const asset = invoiceAsset(r.request.asset);
		if (!asset) return { kind: 'error', message: 'This request asks for a token DarkShell does not know.' };
		return { kind: 'secret', request: r.request, asset };
	}
	if (r.error === 'wrong_chain' || r.error === 'unrecognized') {
		const raw = input.trim().replace(/^[a-z+]+:/i, '').split('?')[0]!;
		const dest = ibcDestinationFor(raw);
		if (dest) return { kind: 'ibc', address: raw.toLowerCase(), dest };
	}
	return { kind: 'error', message: MESSAGES[r.error] };
}
