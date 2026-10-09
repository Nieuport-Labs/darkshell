// How much of a payment comes from outside the sSCRT balance: claimable staking
// rewards first, then public SCRT. Both are wrapped into sSCRT in front of the
// payment, in the same transaction (wallet.svelte.ts `pay`).

/** rewards below this are not worth a withdraw message */
export const MIN_CLAIM = 10_000n; // 0.01 SCRT
/** rewards worth claiming along with any payment, even one sSCRT alone covers */
export const CLAIM_ALONG = 100_000n; // 0.1 SCRT

export interface TopUpPlan {
	claim: boolean;
	fromRewards: bigint;
	fromNative: bigint;
	/** sSCRT the deposit adds */
	deposit: bigint;
}

export class ShortError extends Error {}

/**
 * `rewards` is what the claim pays at least (read before the transaction; it
 * only grows until it runs); `native` is public SCRT the payment may use.
 */
export function planTopUp(spends: bigint, sscrt: bigint, rewards: bigint, native: bigint): TopUpPlan {
	const shortfall = spends > sscrt ? spends - sscrt : 0n;
	const claim = rewards >= MIN_CLAIM && (shortfall > 0n || rewards >= CLAIM_ALONG);
	const fromRewards = claim ? rewards : 0n;
	const fromNative = shortfall > fromRewards ? shortfall - fromRewards : 0n;
	if (fromNative > native) throw new ShortError('Not enough funds for this payment.');
	return { claim, fromRewards, fromNative, deposit: fromRewards + fromNative };
}
