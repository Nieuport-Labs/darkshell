// Signs a request the user confirmed, with the account's secretjs Wallet.
// Amino docs are signed exactly as given: the result's `signed` must equal
// the request (permits and multisig check it), so no fee or memo is filled in.

import type { Wallet } from 'secretjs';
import { toB64, te } from '../crypto/bytes';
import type { SignRequest, SignResult, StdSignDoc } from './provider';

/** ADR-036: arbitrary data wrapped in a zero-fee, chainless amino doc (what Keplr signs). */
export function adr36Doc(signer: string, data: string | Uint8Array): StdSignDoc {
	return {
		chain_id: '',
		account_number: '0',
		sequence: '0',
		fee: { gas: '0', amount: [] },
		msgs: [{ type: 'sign/MsgSignData', value: { signer, data: toB64(typeof data === 'string' ? te.encode(data) : data) } }],
		memo: '',
	};
}

export async function signRequest(w: Wallet, req: SignRequest): Promise<SignResult> {
	if (req.signer !== w.address) throw new Error('This request is for another account.');
	switch (req.kind) {
		case 'direct': {
			const r = await w.signDirect(req.signer, req.doc as never);
			return { signed: req.doc, signature: r.signature };
		}
		case 'amino': {
			const r = await w.signAmino(req.signer, req.doc as never);
			return { signed: req.doc, signature: r.signature };
		}
		case 'arbitrary': {
			const r = await w.signAmino(req.signer, adr36Doc(req.signer, req.data) as never);
			return { signature: r.signature };
		}
	}
}
