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

/** The node the wallet uses unless Settings name another (all platforms). */
export const DEFAULT_LCD = 'https://lcd.secret.mainnet.secret3.dev';

/**
 * Public LCD nodes, asked all at once when the default does not answer; the
 * first to answer for secret-4 wins. Checked October 2026: Secret Saturn,
 * secret.express and secret-api.lavenderfive no longer resolve, and Keplr's
 * answers in ~10 s (often 503).
 */
export const LCD_FALLBACKS = [
	'https://rest.lavenderfive.com:443/secretnetwork',
	'https://secretnetwork-api.lavenderfive.com',
	'https://lcd-secret.keplr.app',
];

export const LCD_URLS = [DEFAULT_LCD, ...LCD_FALLBACKS];

/**
 * secret-4's consensus IO public key (registration/v1beta1/tx-key). Pinned so
 * a node cannot hand out its own (lib/chain/client.ts). Checked October 2026:
 * Lavender Five and Keplr's nodes answer the same. It only changes if the
 * network re-keys; then every contract call fails until this is updated.
 */
export const CONSENSUS_IO_PUBKEY = 'OXDCbUQIpNSfknDX6FvjK7ewuDBe67PleZyT38f5SEs=';

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

/**
 * WalletConnect (Reown Cloud) project id: how a site on another device (a
 * computer's browser) reaches this phone, through Reown's relay. Public, not a
 * secret. Without it, WalletConnect is off. VITE_WC_PROJECT_ID sets it.
 */
export const WC_PROJECT_ID: string = import.meta.env.VITE_WC_PROJECT_ID ?? '';

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
/**
 * Below the floor but above this, credits still pay dozens of fees: a refill
 * only takes what the account clearly won't miss (see `refillSource`). Below
 * it, a refill may take whatever the payment leaves untouched.
 */
export const CREDIT_URGENT = 300_000n; // 0.3 SCRT ≈ 20 payments
/** above the urgent level, a refill is at most this share of a balance (1 in N) */
export const REFILL_SHARE = 10n;
/** smallest automatic top-up worth a message */
export const MIN_REFILL = 200_000n; // 0.2 SCRT
/** after a refill was sent, don't add another for this long (grant reads lag) */
export const REFILL_COOLDOWN_MS = 3 * 60_000;


export function explorerTx(hash: string): string {
	return EXPLORER_TX.replace('{hash}', hash);
}
