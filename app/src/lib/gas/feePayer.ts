// Decides who pays the fee for a transaction, in this order:
//   1. gas credits (grant from the gas vault)
//   2. any other usable fee grant (best one, per feegrant-sdk ranking)
//   3. the wallet's own native SCRT
// The user never has to think about it; the UI only shows which one was used.

import { lcdUrl } from '../chain/client';
import { GAS_PRICE, GAS_VAULT_ADDRESS } from '../config';
import { estimateFee, fetchFeeGrants, selectFeeGrant, type FeeGrant } from './feegrant-sdk';

export type FeeSource = 'credits' | 'grant' | 'self';

export interface FeePlan {
	source: FeeSource;
	feeGranter?: string;
	fee: bigint;
	gasLimit: number;
}

export class NoGasError extends Error {
	constructor() {
		super('No gas available: gas credits are empty and the wallet holds no SCRT for fees.');
	}
}

const grantCache = new Map<string, { at: number; grants: Promise<FeeGrant[]> }>();

/** Grants change rarely; reuse a read from the last few seconds (prefetched when a payment screen opens). */
export async function fetchGrants(address: string, maxAgeMs = 15_000): Promise<FeeGrant[]> {
	const c = grantCache.get(address);
	if (c && Date.now() - c.at < maxAgeMs) return c.grants;
	const grants = (async () => {
		try {
			return await fetchFeeGrants(await lcdUrl(), address);
		} catch {
			grantCache.delete(address);
			return [];
		}
	})();
	grantCache.set(address, { at: Date.now(), grants });
	return grants;
}

export function forgetGrants(address: string): void {
	grantCache.delete(address);
}

export function planFee(grants: FeeGrant[], gasLimit: number, msgTypeUrls: string[], native: bigint): FeePlan {
	const fee = BigInt(estimateFee(gasLimit, GAS_PRICE));
	const ctx = { fee, msgTypeUrls };

	const vault = selectFeeGrant(grants, { ...ctx, mode: 'select', granter: GAS_VAULT_ADDRESS });
	if (vault.granter) return { source: 'credits', feeGranter: vault.granter, fee, gasLimit };

	const other = selectFeeGrant(grants, ctx);
	if (other.granter) return { source: 'grant', feeGranter: other.granter, fee, gasLimit };

	if (native >= fee) return { source: 'self', fee, gasLimit };
	throw new NoGasError();
}

export const MSG_EXECUTE = '/secret.compute.v1beta1.MsgExecuteContract';
export const MSG_TRANSFER = '/ibc.applications.transfer.v1.MsgTransfer';
