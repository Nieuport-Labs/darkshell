// App-wide wallet state. Secrets live only in this module's closure while
// unlocked; locking drops every reference to them. Nothing here ever sends a
// transaction on its own — every transaction is one the user confirmed.

import type { Msg, Permit, SecretNetworkClient, Wallet } from 'secretjs';
import { encryptionSeedFor, newMnemonic, walletFromMnemonic } from './crypto/account';
import { recordFailure, resetFailures, waitMs } from './crypto/lockout';
import {
	changeSecret,
	createVault,
	hasVault,
	openVault,
	saveVault,
	vaultAddress,
	vaultKind,
	WrongPasswordError,
	type AccountEntry,
	type Contact,
	type OpenVault,
	type SecretKind,
} from './crypto/vault';
import { nativeBalance, signingClient } from './chain/client';
import { signPermit, sscrtBalance, sscrtHistory, type HistoryItem } from './chain/sscrt';
import { isSending, refillDue, sendTx, type TxOutcome } from './chain/tx';
import { CREDIT_FLOOR, CREDIT_REFILL, GAS, GAS_PRICE, GAS_VAULT_ADDRESS, MIN_REFILL, SSCRT_ADDRESS } from './config';
import { fetchGrants, forgetGrants, NoGasError } from './gas/feePayer';
import { readCreditStatus, type CreditStatus } from './gas/gasCredits';
import { wrapPayment, type PaymentPlan } from './pay/payments';
import { addrKey, kv, migrateLegacy } from './storage';
import { rePrefix } from './chain/ibc';
import { biometricEnabled, disableBiometric, enableBiometric } from './crypto/biometric';
import { clearDuress, hasDuress, openDuress, resealDuress, setDuress, type DuressPayload } from './crypto/duress';
import { notificationWatch } from './chain/sscrt';
import { backgroundEnabled, clearBackground, notifyNow, setBackground, syncBackground } from './notify/background';
import { pushNotice, startWatcher, stopWatcher, type Target } from './notify/watcher.svelte';
import { newPermit } from 'secretjs';
import { CHAIN_ID } from './config';
import { formatAmount } from './format';
import { MSG_WITHDRAW_REWARD, queryRestaking, queryRewards, queryWithdrawAddress, type Reward } from './chain/staking';
import { MsgWithdrawDelegatorReward } from 'secretjs';
import { snip20Msg } from './chain/sscrt';
import { planTopUp, ShortError } from './pay/topup';
import { queryChainActivity, type ChainActivity } from './chain/activity';
import { fromPlan, overallOf, stepsOf, type Overall, type Step } from './txSteps';
import { queryDelegations } from './chain/staking';
import { MSG_EXECUTE } from './gas/feePayer';
import { startPrice, stopPrice } from './price.svelte';

export type Phase = 'loading' | 'onboarding' | 'locked' | 'unlocked';

interface Session {
	vault: OpenVault;
	wallet: Wallet;
	client: SecretNetworkClient;
	permit: Permit;
	/** opened with the emergency PIN after a sweep: nothing is ever written back */
	decoy?: boolean;
}

let session: Session | null = null;

export interface AccountView extends AccountEntry {
	address: string;
}

export const wallet = $state({
	phase: 'loading' as Phase,
	/** how the lock screen asks: 6-digit PIN, or a password on older vaults */
	kind: 'pin' as SecretKind,
	address: '' as string,
	accounts: [] as AccountView[],
	/** the address book, shared by all accounts */
	contacts: [] as Contact[],
	active: 0,
	balance: null as bigint | null,
	native: null as bigint | null,
	credits: null as CreditStatus | null,
	/** staking rewards a payment can claim (auto-restaked ones and other withdraw addresses excluded) */
	rewards: [] as Reward[],
	/** all pending rewards, estimated forward block by block between reads (for display) */
	rewardsShown: 0n,
	/** SCRT staked (delegated), shown on Home but not spendable */
	staked: 0n,
	history: [] as HistoryItem[],
	/** staking, votes, public SCRT: what the sSCRT history doesn't show (lib/chain/activity.ts) */
	chainActivity: [] as ChainActivity[],
	refreshing: false,
	switching: false,
	/** bumps whenever the local transaction log changes */
	logged: 0,
	error: '' as string,
});

/** Our own sends, so activity can label them (e.g. which redeem was a gas refill). */
export interface LoggedTx {
	hash: string;
	kind: 'send' | 'invoice' | 'ibc' | 'wrap' | 'refill' | 'lightning' | 'external' | 'stake' | 'unstake' | 'claim' | 'vote';
	time: number;
	/** sSCRT the payment itself spent, base units */
	spent?: string;
	refilled?: string;
	/** public SCRT (staking rewards) deposited into sSCRT in the same transaction */
	wrapped?: string;
	/** what the payment was, for the activity detail */
	to?: string;
	amount?: string;
	symbol?: string;
	memo?: string;
	status?: 'pending' | 'confirmed' | 'failed';
	error?: string;
	/** what the transaction did, step by step, and how private each step was */
	steps?: Step[];
	privacy?: Overall;
}

/** Recipient, amount and memo of a payment, kept with its log entry. */
export type PayInfo = Pick<LoggedTx, 'to' | 'amount' | 'symbol' | 'memo' | 'wrapped'>;

export async function init(): Promise<void> {
	if (await hasVault()) {
		wallet.address = (await vaultAddress()) ?? '';
		wallet.kind = await vaultKind();
		wallet.phase = 'locked';
	} else {
		wallet.phase = 'onboarding';
	}
}

function accountList(v: OpenVault): AccountEntry[] {
	return v.secrets.accounts?.length ? v.secrets.accounts : [{ index: 0, name: 'Account 1' }];
}

/** Brings one account of the open vault online: keys, client, permit. */
async function activate(v: OpenVault, index: number): Promise<void> {
	const { mnemonic } = v.secrets;
	const w = walletFromMnemonic(mnemonic, index);
	const seed = await encryptionSeedFor(mnemonic, index);
	const client = await signingClient(w, seed);
	const permit = await signPermit(w);
	session = { vault: v, wallet: w, client, permit, decoy: session?.vault === v ? session.decoy : decoy };
	wallet.address = w.address;
	wallet.active = index;
	wallet.balance = null;
	wallet.native = null;
	wallet.credits = null;
	wallet.history = [];
	wallet.chainActivity = [];
	wallet.rewards = [];
	wallet.rewardsShown = 0n;
	wallet.staked = 0n;
	rewardBase = null;
}

/** set while opening a decoy session (read by `activate`) */
let decoy = false;

async function open(v: OpenVault, asDecoy = false): Promise<void> {
	decoy = asDecoy;
	session = null;
	const list = accountList(v);
	wallet.accounts = list.map((a) => ({ ...a, address: walletFromMnemonic(v.secrets.mnemonic, a.index).address }));
	wallet.contacts = v.secrets.contacts ?? [];
	await migrateLegacy(wallet.accounts.find((a) => a.index === 0)?.address ?? wallet.accounts[0]!.address);
	const active = list.some((a) => a.index === v.secrets.active) ? v.secrets.active! : list[0]!.index;
	await activate(v, active);
	decoy = false;
	wallet.phase = 'unlocked';
	startAutoLock();
	void refresh();
	void warmUp(session!.client);
	void startNotifications();
	startPrice();
	startRewards();
}

/** Choices made during onboarding, applied right after the wallet opens. */
export interface SetupChoices {
	biometric?: boolean;
	emergency?: { pin: string; to?: string };
	/** a restored phrase: add its other accounts that hold funds */
	discover?: boolean;
}

export async function createWallet(mnemonic: string, pin: string, choices: SetupChoices = {}): Promise<void> {
	const w = walletFromMnemonic(mnemonic, 0);
	const v = await createVault(pin, { mnemonic, accounts: [{ index: 0, name: 'Account 1' }], active: 0 }, w.address, 'pin');
	wallet.kind = 'pin';
	await open(v);
	if (choices.biometric) await enableBiometric(pin).catch(() => {});
	if (choices.emergency) await installDuress(choices.emergency.pin, choices.emergency.to);
	if (choices.discover) void addFundedAccounts();
}

/** Adds every other account of the phrase that holds something (after a restore). */
async function addFundedAccounts(): Promise<void> {
	const s = session;
	if (!s) return;
	try {
		const { scanAccounts } = await import('./accountScan');
		const found = await scanAccounts(s.vault.secrets.mnemonic, wallet.accounts.map((a) => a.index));
		if (session !== s || !found.length) return;
		for (const f of found) wallet.accounts = [...wallet.accounts, { index: f.index, name: `Account ${f.index + 1}`, address: f.address }];
		wallet.accounts = [...wallet.accounts].sort((a, b) => a.index - b.index);
		await persist();
		void startNotifications();
	} catch {
		/* the user can still add them from Accounts */
	}
}

/** Funded accounts of this phrase that are not in the wallet yet. */
export async function findAccounts(onFound?: (a: import('./accountScan').FoundAccount) => void) {
	if (!session) return [];
	const { scanAccounts } = await import('./accountScan');
	return scanAccounts(session.vault.secrets.mnemonic, wallet.accounts.map((a) => a.index), onFound);
}

export class LockedOutError extends Error {
	constructor(public ms: number) {
		super(`Too many wrong attempts. Try again in ${Math.ceil(ms / 1000)} s.`);
	}
}

export async function unlock(secret: string): Promise<void> {
	const wait = await waitMs();
	if (wait > 0) throw new LockedOutError(wait);
	// both PINs are tried together, so the time taken never tells which one it was
	const [real, duress] = await Promise.all([
		openVault(secret).catch((e: unknown) => (e instanceof Error ? e : new Error(String(e)))),
		hasDuress().then((has) => (has ? openDuress(secret) : null)),
	]);
	if (duress) {
		await resetFailures();
		return runDuress(duress, secret);
	}
	if (real instanceof Error) {
		if (real instanceof WrongPasswordError) {
			const delay = await recordFailure();
			if (delay > 0) throw new LockedOutError(delay);
		}
		throw real;
	}
	await resetFailures();
	await open(real);
}

/* ------------------------------- emergency PIN ------------------------------ */

/**
 * The emergency PIN was typed: (1) the real wallet leaves this device, (2) the
 * decoy wallet becomes the wallet, unlocked by this same PIN from now on, and
 * opens like any unlock, (3) the real funds go to the safe address in the
 * background, if one was set — nothing on screen waits for it.
 */
async function runDuress(p: DuressPayload, pin: string): Promise<void> {
	const to = p.to && p.mnemonic ? p.to : undefined;
	const real = to ? p.mnemonic : undefined;
	// every real account is swept; the decoy has just one, as a fresh wallet would
	const accounts = p.accounts?.length ? p.accounts.map(({ index, name }) => ({ index, name })) : [{ index: 0, name: 'Account 1' }];
	const decoyAccounts = [{ index: 0, name: 'Account 1' }];
	const bio = await biometricEnabled().catch(() => false);

	// 1. erase (without passing through the onboarding screen)
	await Promise.allSettled([disableBiometric(), clearBackground()]);
	await kv.clear();

	// 2. the decoy, as a real vault behind the same PIN
	const decoySeed = p.decoy ?? newMnemonic();
	const v = await createVault(pin, { mnemonic: decoySeed, accounts: decoyAccounts, active: 0 }, walletFromMnemonic(decoySeed, 0).address, 'pin');
	wallet.kind = 'pin';
	if (bio) await enableBiometric(pin).catch(() => {});

	// 3. the real funds, in the background
	if (real && to) void sweepAll(real, accounts, to);

	await open(v);
}

async function sweepAll(mnemonic: string, accounts: AccountEntry[], to: string): Promise<void> {
	const { sweepAccount } = await import('./pay/sweep');
	for (const a of accounts) {
		// one at a time: each waits until the previous one is in a block (same signer lock)
		for (let attempt = 0; attempt < 3; attempt++) {
			try {
				await sweepAccount(mnemonic, a.index, to, 15_000);
				break;
			} catch {
				await new Promise((r) => setTimeout(r, 3000));
			}
		}
	}
}

export function emergencyPin(): { to?: string } | null {
	const d = session?.vault.secrets.duress;
	return d ? { to: d.to } : null;
}

function duressPayload(decoy: string, to?: string): DuressPayload {
	const v = session!.vault.secrets;
	return {
		decoy,
		...(to ? { to, mnemonic: v.mnemonic } : {}),
		accounts: wallet.accounts.map(({ index, name }) => ({ index, name })),
		active: wallet.active,
	};
}

/**
 * Sets (or replaces) the emergency PIN. `current` is the normal PIN, asked
 * again. `to` (optional) is where the funds go when it is used.
 */
export async function setEmergencyPin(current: string, pin: string, to?: string): Promise<void> {
	if (!session) throw new Error('Wallet is locked');
	if (session.decoy) return;
	if (!/^[0-9]{6}$/.test(pin)) throw new Error('The emergency PIN must be exactly 6 digits.');
	if (pin === current) throw new Error('The emergency PIN must differ from your normal PIN.');
	await openVault(current);
	await installDuress(pin, to);
}

/** Writes the emergency record (and a decoy seed, made once) for the open wallet. */
async function installDuress(pin: string, to?: string): Promise<void> {
	if (!session) return;
	const decoy = session.vault.secrets.duress?.decoy ?? newMnemonic();
	const key = await setDuress(pin, duressPayload(decoy, to));
	session.vault.secrets.duress = { key, decoy, ...(to ? { to } : {}) };
	await persist();
}

export async function removeEmergencyPin(): Promise<void> {
	if (!session || session.decoy) return;
	await clearDuress();
	delete session.vault.secrets.duress;
	await persist();
}

/** Removes everything from this device: vault, emergency PIN, fingerprint key, notification seeds. */
export async function eraseDevice(): Promise<void> {
	await forgetDevice();
}

/* ------------------------------- fingerprint -------------------------------- */

export async function setBiometric(on: boolean, pin?: string): Promise<void> {
	if (session?.decoy) return;
	if (!on) return disableBiometric();
	if (!pin) throw new Error('PIN required');
	await openVault(pin);
	await enableBiometric(pin);
}

/* ------------------------------ notifications ------------------------------- */

let watchList: (Target & { label: string })[] = [];
let bgOn = false;

function labelled(): (import('./notify/snip52').Watch & { label?: string })[] {
	return watchList.map((t) => ({ ...t.watch, label: wallet.accounts.length > 1 ? t.label : undefined }));
}

async function startNotifications(): Promise<void> {
	const s = session;
	if (!s) return;
	try {
		const list = await Promise.all(
			wallet.accounts.map(async (a) => {
				const own = a.index === wallet.active;
				const w = own ? s.wallet : walletFromMnemonic(s.vault.secrets.mnemonic, a.index);
				const permit = own ? s.permit : await newPermit(w, w.address, CHAIN_ID, 'darkshell', [SSCRT_ADDRESS], ['balance', 'history'], false);
				return { address: a.address, label: a.name, watch: await notificationWatch(s.client, permit) };
			}),
		);
		if (session !== s) return;
		watchList = list;
		startWatcher(list, (hit) => {
			const name = wallet.accounts.find((a) => a.address === hit.address)?.name;
			pushNotice({ address: hit.address, amount: hit.amount, hash: hit.hash });
			// with the background service on, it posts the phone notification itself
			if (document.hidden && !bgOn) {
				void notifyNow(
					hit.hash,
					hit.amount !== undefined ? `+${formatAmount(hit.amount)} sSCRT` : 'Payment received',
					`Received privately${name && wallet.accounts.length > 1 ? ` on ${name}` : ''}.`,
				);
			}
			if (hit.address === wallet.address) setTimeout(() => void refresh(), 1500);
		});
		bgOn = await backgroundEnabled();
		if (!s.decoy && bgOn) await syncBackground(labelled());
	} catch {
		/* notifications are a nicety; the balance still refreshes on its own */
	}
}

export async function notificationsInBackground(): Promise<boolean> {
	return backgroundEnabled();
}

export async function setNotificationsInBackground(on: boolean): Promise<boolean> {
	if (session?.decoy) return on;
	bgOn = await setBackground(on, labelled());
	return bgOn;
}

/** Only for the backup screen; requires the PIN again. */
export async function revealMnemonic(secret: string): Promise<string> {
	const wait = await waitMs();
	if (wait > 0) throw new LockedOutError(wait);
	try {
		if (session?.decoy) {
			// the emergency PIN shows the (already emptied) phrase rather than a telling "wrong PIN"
			const d = await openDuress(secret);
			if (d?.mnemonic) return d.mnemonic;
		}
		const v = await openVault(secret);
		await resetFailures();
		return v.secrets.mnemonic;
	} catch (e) {
		if (e instanceof WrongPasswordError) await recordFailure();
		throw e;
	}
}

/** Sets a new 6-digit PIN (also how an old password vault switches to a PIN). */
export async function changePin(current: string, pin: string): Promise<void> {
	if (session?.decoy) return;
	if (await openDuress(pin)) throw new Error('That is your emergency PIN. Choose another one.');
	const v = await changeSecret(current, pin, 'pin');
	wallet.kind = 'pin';
	if (session) session.vault = v;
	// the fingerprint key holds the PIN: store the new one (or switch it off)
	if (await biometricEnabled()) await enableBiometric(pin).catch(() => disableBiometric());
}

/* --------------------------------- accounts --------------------------------- */

async function persist(): Promise<void> {
	if (!session || session.decoy) return;
	session.vault.secrets.accounts = wallet.accounts.map(({ index, name }) => ({ index, name }));
	session.vault.secrets.contacts = wallet.contacts.map(({ name, address }) => ({ name, address }));
	session.vault.secrets.active = wallet.active;
	const dr = session.vault.secrets.duress;
	if (dr && !dr.decoy) dr.decoy = newMnemonic();
	await saveVault(session.vault, wallet.address);
	// keep the emergency record's account list current (every account is swept)
	const d = session.vault.secrets.duress;
	if (d?.decoy) await resealDuress(d.key, duressPayload(d.decoy, d.to));
}

export async function switchAccount(index: number): Promise<void> {
	if (!session || index === wallet.active || wallet.switching) return;
	wallet.switching = true;
	try {
		await activate(session.vault, index);
		await persist();
		void refresh();
	} finally {
		wallet.switching = false;
	}
}

/** Adds the account at `index` (default: the next unused one) and switches to it. */
export async function addAccount(name: string, index?: number): Promise<void> {
	if (!session) return;
	if (index === undefined) {
		index = 0;
		while (wallet.accounts.some((a) => a.index === index)) index++;
	}
	if (wallet.accounts.some((a) => a.index === index)) return switchAccount(index);
	const address = walletFromMnemonic(session.vault.secrets.mnemonic, index).address;
	wallet.accounts = [...wallet.accounts, { index, name: name.trim().slice(0, 32) || `Account ${index + 1}`, address }].sort((a, b) => a.index - b.index);
	await persist();
	await switchAccount(index);
	void startNotifications();
}

/**
 * Removes an account from this wallet. Its funds stay at its address and the
 * phrase still controls it: adding it again (Accounts → Add) brings it back.
 */
export async function removeAccount(index: number): Promise<void> {
	if (!session || wallet.accounts.length < 2 || !wallet.accounts.some((a) => a.index === index)) return;
	if (index === wallet.active) {
		const next = wallet.accounts.find((a) => a.index !== index)!;
		await switchAccount(next.index);
	}
	wallet.accounts = wallet.accounts.filter((a) => a.index !== index);
	await persist();
	void startNotifications();
}

/* -------------------------------- address book -------------------------------- */

export async function saveContact(c: Contact, replacing?: string): Promise<void> {
	const entry = { name: c.name.trim().slice(0, 40), address: c.address.trim() };
	if (!entry.name || !entry.address) return;
	const rest = wallet.contacts.filter((x) => x.address !== entry.address && x.address !== replacing);
	wallet.contacts = [...rest, entry].sort((a, b) => a.name.localeCompare(b.name));
	await persist();
}

export async function removeContact(address: string): Promise<void> {
	wallet.contacts = wallet.contacts.filter((c) => c.address !== address);
	await persist();
}

export async function renameAccount(index: number, name: string): Promise<void> {
	const clean = name.trim().slice(0, 32);
	if (!clean) return;
	wallet.accounts = wallet.accounts.map((a) => (a.index === index ? { ...a, name: clean } : a));
	await persist();
}

export function activeName(): string {
	return wallet.accounts.find((a) => a.index === wallet.active)?.name ?? 'Account 1';
}

/** User's own FixedFloat credentials, kept in the vault. */
export function ffCredentials(): { key: string; secret: string } | undefined {
	return session?.vault.secrets.ff;
}

export async function setFfCredentials(c: { key: string; secret: string } | undefined): Promise<void> {
	if (!session) return;
	session.vault.secrets.ff = c;
	await persist();
}

/** The account's own Cosmos Hub address (same key, `cosmos` prefix): refund target for FixedFloat. */
export function cosmosAddress(): string {
	if (!session) return '';
	return rePrefix(session.wallet.address, 'cosmos');
}

export function lock(): void {
	session = null;
	stopWatcher();
	stopPrice();
	stopRewards();
	wallet.accounts = [];
	wallet.contacts = [];
	wallet.balance = null;
	wallet.native = null;
	wallet.credits = null;
	wallet.history = [];
	wallet.chainActivity = [];
	wallet.phase = wallet.address ? 'locked' : 'onboarding';
	stopAutoLock();
}

export function client(): SecretNetworkClient {
	if (!session) throw new Error('Wallet is locked');
	return session.client;
}

export async function refresh(): Promise<void> {
	const s = session;
	if (!s) return;
	wallet.refreshing = true;
	wallet.error = '';
	try {
		const [bal, native, history, credits] = await Promise.all([
			sscrtBalance(s.client, s.permit),
			nativeBalance(s.client, s.wallet.address),
			sscrtHistory(s.client, s.permit, s.wallet.address).catch(() => wallet.history),
			readCreditStatus(s.client, GAS_VAULT_ADDRESS, s.wallet.address).catch(() => null),
		]);
		if (session !== s) return;
		wallet.balance = bal;
		wallet.native = native;
		wallet.history = history;
		wallet.credits = credits;
		void readRewards(s);
		void readChainActivity(s);
		void settlePending(s);
		void autoRefill(s);
	} catch (e) {
		wallet.error = e instanceof Error ? e.message : String(e);
	} finally {
		wallet.refreshing = false;
	}
}

async function readChainActivity(s: Session): Promise<void> {
	try {
		const a = await queryChainActivity(s.wallet.address);
		if (session === s) wallet.chainActivity = a;
	} catch {
		// the node's transaction index is optional: keep what we had
	}
}

/* ------------------------------ staking rewards ------------------------------ */
//
// Unclaimed staking rewards and public SCRT count as balance: a payment that
// needs them claims the rewards and wraps both into sSCRT in the same
// transaction, before it pays (see `pay`). Between reads, the rewards shown
// grow at the rate the last two reads measured, so the balance moves every block.

/** public SCRT kept back so a fee can still be paid from it if no grant covers one */
export const NATIVE_RESERVE = 150_000n; // 0.15 SCRT, the fee of the largest payment
/** a claim covers at most this many validators (the largest rewards) */
const MAX_CLAIMS = 12;
const BLOCK_MS = 6_000;

let rewardBase: { total: bigint; at: number; rate: number } | null = null;
let rewardPoll: ReturnType<typeof setInterval> | undefined;
let rewardTick: ReturnType<typeof setInterval> | undefined;

async function readRewards(s: Session): Promise<void> {
	if (s.decoy) return;
	const me = s.wallet.address;
	try {
		const [all, restaking, withdraw, dels] = await Promise.all([
			queryRewards(s.client, me),
			queryRestaking(s.client, me).catch(() => [] as string[]),
			queryWithdrawAddress(s.client, me).catch(() => me),
			queryDelegations(s.client, me).catch(() => null),
		]);
		if (session !== s) return;
		if (dels) wallet.staked = dels.reduce((t, d) => t + d.amount, 0n);
		const total = all.reduce((t, r) => t + r.amount, 0n);
		const now = Date.now();
		// the rate only from two reads in a row that grew (a claim resets the total)
		const prev = rewardBase;
		const rate = prev && total >= prev.total && now > prev.at ? Number(total - prev.total) / (now - prev.at) : (prev?.rate ?? 0);
		rewardBase = { total, at: now, rate };
		wallet.rewards = withdraw === me ? all.filter((r) => !restaking.includes(r.validator)).sort((a, b) => (b.amount > a.amount ? 1 : -1)).slice(0, MAX_CLAIMS) : [];
		wallet.rewardsShown = total;
	} catch {
		/* no staking, or the node hiccuped: keep what we had */
	}
}

function startRewards() {
	stopRewards();
	rewardPoll = setInterval(() => {
		if (session && !document.hidden) void readRewards(session);
	}, 30_000);
	rewardTick = setInterval(() => {
		const b = rewardBase;
		if (!b || b.rate <= 0 || document.hidden) return;
		// never run ahead more than a few minutes of an old read
		const ms = Math.min(Date.now() - b.at, 5 * 60_000);
		wallet.rewardsShown = b.total + BigInt(Math.floor(b.rate * ms));
	}, BLOCK_MS);
}

function stopRewards() {
	clearInterval(rewardPoll);
	clearInterval(rewardTick);
	rewardBase = null;
}

const claimable = () => wallet.rewards.reduce((t, r) => t + r.amount, 0n);
const nativeUsable = () => (wallet.native !== null && wallet.native > NATIVE_RESERVE ? wallet.native - NATIVE_RESERVE : 0n);

/** Everything the account holds: sSCRT, public SCRT and pending rewards (shown on Home). */
export function totalBalance(): bigint | null {
	return wallet.balance === null ? null : wallet.balance + (wallet.native ?? 0n) + wallet.rewardsShown;
}

/** What a payment can spend right now: sSCRT, plus public SCRT and claimable rewards wrapped on the way. */
export function spendable(): bigint | null {
	return wallet.balance === null ? null : wallet.balance + nativeUsable() + claimable();
}

interface TopUp {
	msgs: Msg[];
	gas: number;
	types: string[];
	/** sSCRT the deposit adds */
	deposit: bigint;
	fromNative: bigint;
	claimed: boolean;
}

/**
 * Messages that go in front of a payment: claim the rewards and wrap them (and,
 * when the sSCRT is short, public SCRT) into sSCRT. Only amounts the
 * transaction can certainly deposit: rewards read earlier only grow until it runs.
 */
async function topUp(s: Session, spends: bigint): Promise<TopUp | null> {
	let t;
	try {
		t = planTopUp(spends, wallet.balance ?? 0n, claimable(), nativeUsable());
	} catch (e) {
		if (e instanceof ShortError) throw new Error(`Not enough funds: this needs ${formatAmount(spends)} and the account can spend ${formatAmount(spendable())}.`);
		throw e;
	}
	if (t.deposit === 0n) return null;
	const me = s.wallet.address;
	const withdraws = t.claim ? wallet.rewards : [];
	return {
		msgs: [
			...withdraws.map((r) => new MsgWithdrawDelegatorReward({ delegator_address: me, validator_address: r.validator })),
			await snip20Msg(s.client, me, SSCRT_ADDRESS, { deposit: {} }, t.deposit),
		],
		gas: GAS.claimReward * withdraws.length + GAS.wrap,
		types: [...(withdraws.length ? [MSG_WITHDRAW_REWARD] : []), MSG_EXECUTE],
		deposit: t.deposit,
		fromNative: t.fromNative,
		claimed: t.claim,
	};
}

/** Adds or updates (by hash) an entry of the local transaction log. */
export async function log(entry: LoggedTx) {
	if (session?.decoy) return;
	const key = addrKey('txlog', wallet.address);
	const list = (await kv.get<LoggedTx[]>(key)) ?? [];
	const old = list.find((l) => l.hash === entry.hash);
	const next = old ? { ...old, ...Object.fromEntries(Object.entries(entry).filter(([, v]) => v !== undefined)) } : entry;
	await kv.set(key, [next, ...list.filter((l) => l !== old)].slice(0, 200));
	wallet.logged++;
}

/** Sent transactions still waiting for a block: ask the chain once more. */
async function settlePending(s: Session): Promise<void> {
	const list = await txLog();
	for (const l of list.filter((x) => x.status === 'pending')) {
		try {
			const tx = await s.client.query.getTx(l.hash);
			if (tx) await log({ ...l, status: tx.code === 0 ? 'confirmed' : 'failed', error: tx.code === 0 ? undefined : tx.rawLog });
			else if (Date.now() - l.time > 30 * 60_000) await log({ ...l, status: 'failed', error: 'Never made it into a block.' });
		} catch {
			/* try again next refresh */
		}
	}
}

export async function txLog(): Promise<LoggedTx[]> {
	return (await kv.get<LoggedTx[]>(addrKey('txlog', wallet.address))) ?? [];
}

/** Sends a built payment. A gas-credit refill rides along when one is due. */
export async function pay(
	plan: PaymentPlan,
	kind: LoggedTx['kind'],
	onBroadcast?: (pending: Extract<TxOutcome, { status: 'pending' }>) => void,
	info: PayInfo = {},
	/** public SCRT the payment leaves untouched (a refill may use it) */
	nativeSpare = 0n,
): Promise<TxOutcome> {
	const s = session;
	if (!s) throw new Error('Wallet is locked');
	// rewards and public SCRT the payment needs (or rewards worth taking along) go in first
	const top = plan.spends > 0n && !s.decoy ? await topUp(s, plan.spends) : null;
	const full: PaymentPlan = top ? { ...plan, msgs: [...top.msgs, ...plan.msgs], gas: plan.gas + top.gas, types: [...new Set([...top.types, ...plan.types])] } : plan;
	const sscrtAfter = (wallet.balance ?? 0n) + (top?.deposit ?? 0n);
	const spare = sscrtAfter > plan.spends ? sscrtAfter - plan.spends : 0n;
	const nativeLeft = top ? nativeUsable() - top.fromNative : nativeSpare;
	const wrapped = top ? top.deposit.toString() : info.wrapped;
	const steps = stepsOf(fromPlan(full.msgs));
	const privacy = overallOf(steps);
	const send = () =>
		sendTx(s.client, s.wallet.address, full.msgs, full.gas, full.types, {
			memo: plan.txMemo,
			sscrtSpare: spare,
			nativeSpare: nativeSpare < nativeLeft ? nativeSpare : nativeLeft,
			onBroadcast: (p) => {
				// show it as sent right away; the balances move optimistically until the block confirms
				if (wallet.balance !== null && sscrtAfter >= plan.spends) wallet.balance = sscrtAfter - plan.spends;
				if (top && wallet.native !== null) wallet.native -= top.fromNative;
				if (top?.claimed) {
					wallet.rewards = [];
					wallet.rewardsShown = 0n;
					rewardBase = null;
				}
				void log({ hash: p.hash, kind, time: Date.now(), spent: plan.spends.toString(), status: 'pending', ...info, wrapped, steps, privacy });
				onBroadcast?.(p);
			},
		});
	// first payment with nothing to pay the fee: ask the faucet once, then try again
	const out = await send().catch(async (e) => {
		if (!(e instanceof NoGasError) || !(await faucetGrant(s.wallet.address))) throw e;
		return send();
	});
	forgetGrants(s.wallet.address);
	await log({
		hash: out.hash,
		kind,
		time: Date.now(),
		spent: plan.spends.toString(),
		refilled: out.refilled ? out.refilled.toString() : undefined,
		status: out.status === 'confirmed' ? 'confirmed' : 'pending',
		...info,
		wrapped,
		steps,
		privacy,
	});
	setTimeout(() => void refresh(), out.status === 'confirmed' ? 0 : 8000);
	return out;
}

/** Things a payment needs, loaded before the user taps Pay (call when a pay screen opens). */
export function prefetchForPayment(): void {
	if (!session) return;
	void fetchGrants(session.wallet.address).catch(() => {});
}

/** Warm caches after unlock so the first quote and payment don't pay for cold starts. */
async function warmUp(client: SecretNetworkClient): Promise<void> {
	const { listPairs, SHADESWAP_ROUTER } = await import('./chain/shadeSwap');
	const { codeHash } = await import('./chain/client');
	await Promise.allSettled([
		listPairs(client),
		codeHash(client, SHADESWAP_ROUTER),
		codeHash(client, 'secret15mkmad8ac036v4nrpcc7nk8wyr578egt077syt'),
		codeHash(client, SSCRT_ADDRESS),
		codeHash(client, GAS_VAULT_ADDRESS),
	]);
}

/** "Refill now" in settings: a refill transaction on its own, explicitly asked for. */
export async function refillNow(): Promise<TxOutcome> {
	const s = session;
	if (!s) throw new Error('Wallet is locked');
	const out = await sendTx(s.client, s.wallet.address, [], 0, [], { sscrtSpare: wallet.balance ?? 0n, forceRefill: true });
	await log({ hash: out.hash, kind: 'refill', time: Date.now(), refilled: out.refilled.toString(), status: out.status === 'confirmed' ? 'confirmed' : 'pending' });
	void refresh();
	return out;
}

/** What `wrapPublic` would move into sSCRT, and how much of it would top up gas credits. */
export async function wrapPreview(): Promise<{ amount: bigint; refill: bigint }> {
	const s = session;
	if (!s || wallet.native === null) throw new Error('Wallet is locked');
	// keep enough to pay this fee ourselves in case no grant covers it
	const fee = BigInt(Math.ceil((GAS.wrap + GAS.buyGasCredit) * GAS_PRICE)) * 2n;
	const available = wallet.native - fee;
	if (available <= 0n) throw new Error('Not enough public SCRT to move.');
	const due = await refillDue(s.wallet.address).catch(() => false);
	const refill = due && available >= MIN_REFILL ? (available < CREDIT_REFILL ? available : CREDIT_REFILL) : 0n;
	return { amount: available - refill, refill };
}

/**
 * Moves public SCRT that arrived on this address into the private balance.
 * When gas credits are low, up to CREDIT_REFILL of it tops them up first, in
 * the same transaction.
 */
export async function wrapPublic(): Promise<TxOutcome> {
	const s = session;
	if (!s || wallet.native === null) throw new Error('Wallet is locked');
	const { amount, refill } = await wrapPreview();
	if (amount < 10_000n) {
		// all of it goes to gas credits
		const out = await sendTx(s.client, s.wallet.address, [], 0, [], { nativeSpare: refill, forceRefill: true });
		await log({ hash: out.hash, kind: 'refill', time: Date.now(), refilled: out.refilled.toString(), status: out.status === 'confirmed' ? 'confirmed' : 'pending' });
		void refresh();
		return out;
	}
	const plan = await wrapPayment(s.client, s.wallet.address, amount);
	return pay(plan, 'wrap', undefined, { amount: amount.toString(), symbol: 'SCRT' }, refill);
}

/**
 * Keeps gas credits topped up when no payment is going out to carry the
 * refill: below the floor, one refill transaction from public SCRT or sSCRT.
 */
let autoTried = 0;
async function autoRefill(s: Session): Promise<void> {
	const c = wallet.credits;
	if (s.decoy || !c || c.remaining === null || c.remaining >= CREDIT_FLOOR) return;
	if (isSending() || Date.now() - autoTried < 5 * 60_000) return;
	const fee = BigInt(Math.ceil((GAS.unwrap + GAS.buyGasCredit) * GAS_PRICE)) * 2n;
	const native = c.native > fee ? c.native - fee : 0n;
	const sscrt = wallet.balance ?? 0n;
	if (native < MIN_REFILL && sscrt < MIN_REFILL) return;
	if ((await txLog()).some((l) => l.status === 'pending')) return;
	if (!(await refillDue(s.wallet.address).catch(() => false))) return;
	autoTried = Date.now();
	try {
		const send = () => sendTx(s.client, s.wallet.address, [], 0, [], { nativeSpare: native, sscrtSpare: sscrt, forceRefill: true, waitMs: 0 });
		// nothing pays the fee yet (first use, no SCRT): the faucet's grant pays it
		const out = await send().catch(async (e) => {
			if (!(e instanceof NoGasError) || !(await faucetGrant(s.wallet.address))) throw e;
			return send();
		});
		if (session !== s) return;
		await log({ hash: out.hash, kind: 'refill', time: Date.now(), refilled: out.refilled.toString(), status: 'pending' });
		setTimeout(() => void refresh(), 8000);
	} catch {
		/* nothing can pay the fee, or busy: try again later */
	}
}

/**
 * Asks the fee-grant faucet for this address and waits until the grant can be
 * read on chain. True when a fee can now be paid from it.
 */
async function faucetGrant(address: string): Promise<boolean> {
	const { claimFaucet, faucetConfigured } = await import('./gas/faucet');
	if (!faucetConfigured() || session?.decoy) return false;
	try {
		await claimFaucet(address);
	} catch {
		return false;
	}
	// the grant lands in the faucet's next block
	for (let i = 0; i < 10; i++) {
		await new Promise((r) => setTimeout(r, 2500));
		forgetGrants(address);
		if ((await fetchGrants(address, 0)).length) return true;
	}
	return false;
}

/* ---------------------------------- auto-lock --------------------------------- */

const IDLE_MS = 5 * 60_000;
const HIDDEN_MS = 60_000;
let idleTimer: ReturnType<typeof setTimeout> | undefined;
let hiddenAt = 0;

function bump() {
	clearTimeout(idleTimer);
	idleTimer = setTimeout(lock, IDLE_MS);
}

function onVisibility() {
	if (document.hidden) hiddenAt = Date.now();
	else if (hiddenAt && Date.now() - hiddenAt > HIDDEN_MS) lock();
	else if (session) void refresh();
}

const EVENTS = ['pointerdown', 'keydown', 'scroll'] as const;

function startAutoLock() {
	if (typeof document === 'undefined') return;
	bump();
	for (const e of EVENTS) addEventListener(e, bump, { passive: true });
	document.addEventListener('visibilitychange', onVisibility);
}

function stopAutoLock() {
	if (typeof document === 'undefined') return;
	clearTimeout(idleTimer);
	for (const e of EVENTS) removeEventListener(e, bump);
	document.removeEventListener('visibilitychange', onVisibility);
}

export async function forgetDevice(): Promise<void> {
	lock();
	await Promise.allSettled([disableBiometric(), clearBackground()]);
	await kv.clear();
	wallet.address = '';
	wallet.phase = 'onboarding';
}

/* ----------------------------- transaction detail ----------------------------- */

const hashCache = new Map<string, string | null>();

/**
 * The hash of the transaction that paid us `item`. sSCRT history has no
 * hashes; the SNIP-52 notification in each block names the ones meant for us.
 */
export async function receivedHash(item: HistoryItem): Promise<string | null> {
	const key = `${wallet.address}:${item.id}`;
	if (hashCache.has(key)) return hashCache.get(key)!;
	const own = watchList.find((w) => w.address === wallet.address);
	if (!own || !item.height) return null;
	const { firstRpc, scanTx, txsSince } = await import('./notify/snip52');
	const txs = await firstRpc((rpc) => txsSince(rpc, SSCRT_ADDRESS, item.height! - 1, 1));
	const hits = txs.filter((t) => t.height === item.height).flatMap((t) => scanTx(t, [own.watch]));
	const hit = hits.find((h) => h.amount === item.amount) ?? (hits.length === 1 ? hits[0] : undefined);
	const hash = hit?.hash ?? null;
	hashCache.set(key, hash);
	return hash;
}

export interface ChainTxDetail {
	code: number;
	error?: string;
	height: number;
	time?: string;
	gasUsed: number;
	gasWanted: number;
	fee?: string;
	feePayer?: string;
	txMemo?: string;
	/** messages as the chain has them, decrypted where this wallet can */
	messages: unknown[];
}

/** A transaction from the chain; our own contract calls come back decrypted. */
export async function chainTx(hash: string): Promise<ChainTxDetail | null> {
	const s = session;
	if (!s) throw new Error('Wallet is locked');
	const tx = await s.client.query.getTx(hash);
	if (!tx) return null;
	const body = tx.tx?.body as { messages?: unknown[]; memo?: string } | undefined;
	const auth = tx.tx?.auth_info as { fee?: { amount?: { amount: string; denom: string }[]; granter?: string } } | undefined;
	const fee = auth?.fee?.amount?.[0];
	return {
		code: tx.code,
		error: tx.code ? tx.rawLog : undefined,
		height: tx.height,
		time: tx.timestamp,
		gasUsed: Number(tx.gasUsed),
		gasWanted: Number(tx.gasWanted),
		fee: fee ? `${formatAmount(BigInt(fee.amount))} ${fee.denom === 'uscrt' ? 'SCRT' : fee.denom}` : undefined,
		feePayer: auth?.fee?.granter || undefined,
		txMemo: body?.memo || undefined,
		messages: body?.messages ?? [],
	};
}
