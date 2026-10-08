// Emergency sweep: everything an account holds (sSCRT and public SCRT) to one
// address, in one transaction per account. Used only by the emergency PIN.

import { MsgSend, type Msg } from 'secretjs';
import { nativeBalance, signingClient } from '../chain/client';
import { signPermit, snip20Msg, sscrtBalance } from '../chain/sscrt';
import { sendTx } from '../chain/tx';
import { DENOM, GAS, SSCRT_ADDRESS } from '../config';
import { encryptionSeedFor, walletFromMnemonic } from '../crypto/account';
import { fetchGrants, MSG_EXECUTE, planFee } from '../gas/feePayer';

const MSG_SEND = '/cosmos.bank.v1beta1.MsgSend';
/** public SCRT below this is not worth a message (fee dust) */
const DUST = 20_000n;

/** Returns the tx hash, or null when the account had nothing to move. */
export async function sweepAccount(mnemonic: string, index: number, to: string, waitMs: number): Promise<string | null> {
	const w = walletFromMnemonic(mnemonic, index);
	if (w.address === to) return null;
	const client = await signingClient(w, await encryptionSeedFor(mnemonic, index));
	const [sscrt, native, grants] = await Promise.all([signPermit(w).then((p) => sscrtBalance(client, p)), nativeBalance(client, w.address), fetchGrants(w.address)]);

	const token = sscrt > 0n ? [await snip20Msg(client, w.address, SSCRT_ADDRESS, { transfer: { recipient: to, amount: sscrt.toString() } })] : [];
	const tokenGas = token.length ? GAS.snip20Transfer : 0;

	// with the public SCRT as well, if whoever pays the fee leaves something to send
	let msgs: Msg[] = token;
	let gas = tokenGas;
	let types = token.length ? [MSG_EXECUTE] : [];
	if (native > DUST) {
		try {
			const plan = planFee(grants, tokenGas + GAS.send, [...types, MSG_SEND], native);
			const amount = plan.source === 'self' ? native - plan.fee : native;
			if (amount > DUST) {
				msgs = [...token, new MsgSend({ from_address: w.address, to_address: to, amount: [{ denom: DENOM, amount: amount.toString() }] })];
				gas = tokenGas + GAS.send;
				types = [...types, MSG_SEND];
			}
		} catch {
			/* nothing can pay for it: leave the public SCRT */
		}
	}
	if (!msgs.length) return null;
	const out = await sendTx(client, w.address, msgs, gas, types, { waitMs });
	return out.hash;
}
