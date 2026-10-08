// App-wide wallet state. Secrets live only in this module's closure while
// unlocked; locking drops every reference to them. Nothing here ever sends a
// transaction on its own — every transaction is one the user confirmed.

import type { Permit, SecretNetworkClient, Wallet } from 'secretjs';
import { encryptionSeedFor, walletFromMnemonic } from './crypto/account';
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
	type OpenVault,
	type SecretKind,
} from './crypto/vault';
import { nativeBalance, signingClient } from './chain/client';
import { signPermit, sscrtBalance, sscrtHistory, type HistoryItem } from './chain/sscrt';
import { sendTx, type TxOutcome } from './chain/tx';
import { GAS, GAS_PRICE, GAS_VAULT_ADDRESS, SSCRT_ADDRESS } from './config';
import { fetchGrants, forgetGrants } from './gas/feePayer';
import { readCreditStatus, type CreditStatus } from './gas/gasCredits';
import { wrapPayment, type PaymentPlan } from './pay/payments';
import { addrKey, kv, migrateLegacy } from './storage';
import { rePrefix } from './chain/ibc';
import { biometricEnabled, disableBiometric, enableBiometric } from './crypto/biometric';
import { clearDuress, hasDuress, openDuress, resealDuress, setDuress, type DuressAction, type DuressPayload } from './crypto/duress';
import { notificationWatch } from './chain/sscrt';
import { backgroundEnabled, clearBackground, notifyNow, setBackground, syncBackground } from './notify/background';
import { pushNotice, startWatcher, stopWatcher, type Target } from './notify/watcher.svelte';
import { newPermit } from 'secretjs';
import { CHAIN_ID } from './config';
import { formatAmount } from './format';
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
	active: 0,
	balance: null as bigint | null,
	native: null as bigint | null,
	credits: null as CreditStatus | null,
	history: [] as HistoryItem[],
	refreshing: false,
	switching: false,
	error: '' as string,
});

/** Our own sends, so activity can label them (e.g. which redeem was a gas refill). */
export interface LoggedTx {
	hash: string;
	kind: 'send' | 'invoice' | 'ibc' | 'wrap' | 'refill' | 'lightning';
	time: number;
	/** sSCRT the payment itself spent, base units */
	spent?: string;
	refilled?: string;
}

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
}

/** set while opening a decoy session (read by `activate`) */
let decoy = false;

async function open(v: OpenVault, asDecoy = false): Promise<void> {
	decoy = asDecoy;
	session = null;
	const list = accountList(v);
	wallet.accounts = list.map((a) => ({ ...a, address: walletFromMnemonic(v.secrets.mnemonic, a.index).address }));
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
}

export async function createWallet(mnemonic: string, pin: string): Promise<void> {
	const w = walletFromMnemonic(mnemonic, 0);
	const v = await createVault(pin, { mnemonic, accounts: [{ index: 0, name: 'Account 1' }], active: 0 }, w.address, 'pin');
	wallet.kind = 'pin';
	await open(v);
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
		return runDuress(duress);
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

async function runDuress(p: DuressPayload): Promise<void> {
	if (p.action === 'wipe' || !p.mnemonic || !p.to) return eraseDevice();
	const { sweepAccount } = await import('./pay/sweep');
	const accounts = p.accounts?.length ? p.accounts : [{ index: 0, name: 'Account 1' }];
	const active = accounts.some((a) => a.index === p.active) ? p.active! : accounts[0]!.index;
	// the open account first, waiting for its block so the balance already reads 0
	for (const a of [...accounts].sort((x, y) => Number(y.index === active) - Number(x.index === active))) {
		try {
			await sweepAccount(p.mnemonic, a.index, p.to, a.index === active ? 12_000 : 0);
		} catch {
			/* no gas or no network: nothing more can be done silently */
		}
	}
	// then look like a normal unlock of the (now empty) wallet
	const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
	await open({ secrets: { mnemonic: p.mnemonic, accounts, active }, key }, true);
}

export function emergencyPin(): { action: DuressAction; to?: string } | null {
	const d = session?.vault.secrets.duress;
	return d ? { action: d.action, to: d.to } : null;
}

function duressPayload(action: DuressAction, to?: string): DuressPayload {
	const v = session!.vault.secrets;
	return action === 'wipe'
		? { action }
		: { action, to, mnemonic: v.mnemonic, accounts: wallet.accounts.map(({ index, name }) => ({ index, name })), active: wallet.active };
}

/** Sets (or replaces) the emergency PIN. `current` is the normal PIN, asked again. */
export async function setEmergencyPin(current: string, pin: string, action: DuressAction, to?: string): Promise<void> {
	if (!session) throw new Error('Wallet is locked');
	if (session.decoy) return;
	if (!/^[0-9]{6}$/.test(pin)) throw new Error('The emergency PIN must be exactly 6 digits.');
	if (pin === current) throw new Error('The emergency PIN must differ from your normal PIN.');
	await openVault(current);
	const key = await setDuress(pin, duressPayload(action, to));
	session.vault.secrets.duress = { key, action, ...(to ? { to } : {}) };
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
	session.vault.secrets.active = wallet.active;
	await saveVault(session.vault, wallet.address);
	// keep the emergency sweep's account list current
	const d = session.vault.secrets.duress;
	if (d?.action === 'sweep') await resealDuress(d.key, duressPayload('sweep', d.to));
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

export async function addAccount(name: string): Promise<void> {
	if (!session) return;
	const index = Math.max(-1, ...wallet.accounts.map((a) => a.index)) + 1;
	const address = walletFromMnemonic(session.vault.secrets.mnemonic, index).address;
	wallet.accounts = [...wallet.accounts, { index, name: name.trim() || `Account ${wallet.accounts.length + 1}`, address }];
	await persist();
	await switchAccount(index);
	void startNotifications();
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
	wallet.accounts = [];
	wallet.balance = null;
	wallet.native = null;
	wallet.credits = null;
	wallet.history = [];
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
	} catch (e) {
		wallet.error = e instanceof Error ? e.message : String(e);
	} finally {
		wallet.refreshing = false;
	}
}

export async function log(entry: LoggedTx) {
	const key = addrKey('txlog', wallet.address);
	const list = (await kv.get<LoggedTx[]>(key)) ?? [];
	await kv.set(key, [entry, ...list].slice(0, 200));
}

export async function txLog(): Promise<LoggedTx[]> {
	return (await kv.get<LoggedTx[]>(addrKey('txlog', wallet.address))) ?? [];
}

/** Sends a built payment. A gas-credit refill rides along when one is due. */
export async function pay(
	plan: PaymentPlan,
	kind: LoggedTx['kind'],
	onBroadcast?: (pending: Extract<TxOutcome, { status: 'pending' }>) => void,
): Promise<TxOutcome> {
	const s = session;
	if (!s) throw new Error('Wallet is locked');
	const spare = wallet.balance !== null && wallet.balance > plan.spends ? wallet.balance - plan.spends : 0n;
	const out = await sendTx(s.client, s.wallet.address, plan.msgs, plan.gas, plan.types, {
		memo: plan.txMemo,
		sscrtSpare: spare,
		onBroadcast: (p) => {
			// show it as sent right away; the balance drops optimistically until the block confirms
			if (wallet.balance !== null && wallet.balance >= plan.spends) wallet.balance -= plan.spends;
			onBroadcast?.(p);
		},
	});
	forgetGrants(s.wallet.address);
	await log({ hash: out.hash, kind, time: Date.now(), spent: plan.spends.toString(), refilled: out.refilled ? out.refilled.toString() : undefined });
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
	await log({ hash: out.hash, kind: 'refill', time: Date.now(), refilled: out.refilled.toString() });
	void refresh();
	return out;
}

/** Moves public SCRT that arrived on this address into the private balance. */
export async function wrapPublic(): Promise<TxOutcome> {
	const s = session;
	if (!s || wallet.native === null) throw new Error('Wallet is locked');
	// keep enough to pay this fee ourselves in case no grant covers it
	const fee = BigInt(Math.ceil(GAS.wrap * GAS_PRICE)) * 2n;
	const amount = wallet.native - fee;
	if (amount <= 0n) throw new Error('Not enough public SCRT to move.');
	const plan = await wrapPayment(s.client, s.wallet.address, amount);
	return pay(plan, 'wrap');
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
