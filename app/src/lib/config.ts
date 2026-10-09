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
 * Where shared `/pay/…` links point: Secret Dashboard pays them in a browser,
 * and DarkShell opens them when installed. VITE_PAY_ORIGIN overrides it.
 */
export const PAY_LINK_ORIGIN: string = import.meta.env.VITE_PAY_ORIGIN || 'https://dashboard.nieuportlabs.cz';

/**
 * Fee-grant faucet (FeeGrantFaucet2.0) for a wallet's very first refill, so
 * no SCRT is ever needed: its grant pays the fee of buying gas credits with
 * sSCRT. VITE_FAUCET_URL overrides it; an empty value turns it off.
 */
export const FAUCET_URL: string = import.meta.env.VITE_FAUCET_URL ?? 'https://faucet.libertarianskastrana.cz';

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
	delegate: withGasBuffer(250_000),
	undelegate: withGasBuffer(250_000),
	/** per validator */
	claimReward: withGasBuffer(90_000),
	vote: withGasBuffer(120_000),
} as const;

/**
 * Gas credits are kept between 2 and 4 SCRT: below the floor, 2 SCRT are
 * added — riding along with the next transaction (a wrap takes them from the
 * public SCRT it wraps), or on their own when nothing else is being sent.
 */
export const CREDIT_FLOOR = 2_000_000n; // 2 SCRT
export const CREDIT_REFILL = 2_000_000n; // 2 SCRT ≈ hundreds of payments
/** smallest automatic top-up worth a message */
export const MIN_REFILL = 200_000n; // 0.2 SCRT
/** after a refill was sent, don't add another for this long (grant reads lag) */
export const REFILL_COOLDOWN_MS = 3 * 60_000;


export function explorerTx(hash: string): string {
	return EXPLORER_TX.replace('{hash}', hash);
}
