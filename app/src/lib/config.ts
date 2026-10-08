// Network configuration. Mainnet only for now; addresses come from the
// fee-granter repo (gas vault) and the chain (sSCRT). Code hashes are never
// written down — they change on migration and are read live.

export const CHAIN_ID = 'secret-4';
export const DENOM = 'uscrt';
export const DECIMALS = 6;
export const BECH32_PREFIX = 'secret';
export const COIN_TYPE = 529;

/** Gas price in uscrt per gas unit. */
export const GAS_PRICE = 0.1;

export const SSCRT_ADDRESS = 'secret1k0jntykt7e4g3y88ltc60czgjuqdy4c9e8fzek';
export const SSCRT_SYMBOL = 'sSCRT';

/** gas-vault contract from github.com/jirkacepelka/fee-granter (code id 2611). */
export const GAS_VAULT_ADDRESS = 'secret1kkmu4vydkppkhzmx00glm20vn47t09544adv0g';

export const LCD_URLS = [
	'https://lcd-secret.keplr.app',
	'https://lcd.mainnet.secretsaturn.net',
	'https://lcd.secret.express',
	'https://secret-api.lavenderfive.com',
];

export const EXPLORER_TX = 'https://www.mintscan.io/secret/tx/{hash}';

/**
 * Public origin for shareable `/pay/…` web links (VITE_PAY_ORIGIN at build
 * time). Without one — e.g. inside the Android app, whose origin is
 * https://localhost — sharing falls back to the `secret:` URI, which DarkShell
 * and other wallets open directly.
 */
export const PAY_LINK_ORIGIN: string =
	import.meta.env.VITE_PAY_ORIGIN ||
	(typeof location !== 'undefined' && !/^https?:\/\/localhost(:\d+)?$/.test(location.origin) && location.protocol === 'https:' ? location.origin : '');

export const GAS_BUFFER = 1.2;
export function withGasBuffer(gas: number): number {
	return Math.ceil(gas * GAS_BUFFER);
}

/**
 * Fixed gas limits per message, padded (the same figures Secret_Dashboard
 * uses). Simulation is not used: for encrypted contract calls it is slow and
 * not more accurate.
 */
export const GAS = {
	send: withGasBuffer(25_000),
	snip20Transfer: withGasBuffer(110_000),
	wrap: withGasBuffer(110_000),
	unwrap: withGasBuffer(110_000),
	ibcTransfer: withGasBuffer(150_000),
	buyGasCredit: withGasBuffer(400_000),
} as const;

/**
 * Gas credits: refill when below the floor, by a fixed amount, as part of the
 * user's next transaction (never as a transaction of its own).
 */
export const CREDIT_FLOOR = 1_000_000n; // 1 SCRT
export const CREDIT_REFILL = 2_000_000n; // 2 SCRT ≈ hundreds of payments
/** after a refill was sent, don't add another for this long (grant reads lag) */
export const REFILL_COOLDOWN_MS = 3 * 60_000;


export function explorerTx(hash: string): string {
	return EXPLORER_TX.replace('{hash}', hash);
}
