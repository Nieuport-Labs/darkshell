// Gas credits: a BasicAllowance fee grant whose granter is the gas-vault
// contract (github.com/jirkacepelka/fee-granter). This module only reads the
// position; refills ride along with the user's own transactions (chain/tx.ts).

import type { SecretNetworkClient } from 'secretjs';
import { codeHash, nativeBalance } from '../chain/client';
import { CREDIT_FLOOR, GAS, GAS_PRICE } from '../config';

export type CreditState =
	/** enough credits */
	| 'warm'
	/** below the floor: the next payment carries a refill */
	| 'low'
	/** nothing pays fees: needs a first top-up from outside */
	| 'cold'
	/** the vault could not read x/feegrant — NOT the same as empty */
	| 'unknown';

export interface CreditStatus {
	state: CreditState;
	remaining: bigint | null;
	native: bigint;
}

/** fee of a typical payment with a refill attached */
const MIN_USEFUL_FEE = BigInt(Math.ceil((GAS.snip20Transfer + GAS.unwrap + GAS.buyGasCredit) * GAS_PRICE));

export async function queryRemaining(client: SecretNetworkClient, vault: string, grantee: string): Promise<bigint | null> {
	const reply = (await client.query.compute.queryContract({
		contract_address: vault,
		code_hash: await codeHash(client, vault),
		query: { remaining: { grantee } },
	})) as { amount?: string | null } | string;
	if (typeof reply === 'string') throw new Error(reply);
	return reply?.amount == null ? null : BigInt(reply.amount);
}

export async function readCreditStatus(client: SecretNetworkClient, vault: string, address: string): Promise<CreditStatus> {
	const [remaining, native] = await Promise.all([queryRemaining(client, vault, address).catch(() => null), nativeBalance(client, address)]);
	if (remaining === null) return { state: 'unknown', remaining, native };
	const state: CreditState =
		remaining >= CREDIT_FLOOR ? 'warm' : remaining >= MIN_USEFUL_FEE || native >= MIN_USEFUL_FEE ? 'low' : 'cold';
	return { state, remaining, native };
}
