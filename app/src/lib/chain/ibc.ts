// Destinations on other Cosmos chains. sSCRT cannot cross IBC, so a payment
// there is one transaction: redeem sSCRT → SCRT, then an ICS-20 transfer.

import { fromBech32, toBech32 } from 'secretjs';
import { isBech32Address } from 'secret-pay';

export interface IbcDestination {
	prefix: string;
	chainId: string;
	name: string;
	/** transfer channel on secret-4 */
	channel: string;
}

/** Verified against the cosmos chain-registry `_IBC` files (secret-4 side). */
export const IBC_DESTINATIONS: IbcDestination[] = [
	{ prefix: 'osmo', chainId: 'osmosis-1', name: 'Osmosis', channel: 'channel-1' },
	{ prefix: 'cosmos', chainId: 'cosmoshub-4', name: 'Cosmos Hub', channel: 'channel-0' },
];

export function ibcDestinationFor(address: string): IbcDestination | undefined {
	const lower = address.trim().toLowerCase();
	return IBC_DESTINATIONS.find((d) => lower.startsWith(`${d.prefix}1`) && isBech32Address(lower, d.prefix));
}

export const IBC_TIMEOUT_SECONDS = 15 * 60;

/** The same account bytes under another chain's prefix (same key controls it). */
export function rePrefix(address: string, prefix: string): string {
	return toBech32(prefix, fromBech32(address).data);
}
