// Sending a transaction, safely:
//
// - One at a time. A second send while one is in flight is refused.
// - Signed once. The tx hash is known before anything goes out, and if the
//   broadcast has to be retried it is the *same signed bytes* — the chain
//   accepts a given account sequence once, so a retry can never pay twice.
// - "Not confirmed yet" is not "failed". A slow block gives a pending result
//   with the hash, never an error that invites the user to press Send again.
// - Gas credits ride along. When credits are low, a refill (redeem sSCRT → buy
//   credits) is appended to the user's own transaction instead of being sent
//   as a separate one, and is left off whenever it would change who pays.

import { BroadcastMode, MsgExecuteContract, type Msg, type SecretNetworkClient, type TxResponse } from 'secretjs';
import { CREDIT_FLOOR, CREDIT_REFILL, DENOM, GAS, GAS_PRICE, GAS_VAULT_ADDRESS, REFILL_COOLDOWN_MS, SSCRT_ADDRESS } from '../config';
import { MSG_EXECUTE, fetchGrants, planFee, type FeePlan } from '../gas/feePayer';
import { availableFee, type FeeGrant } from '../gas/feegrant-sdk';
import { addrKey, kv } from '../storage';
import { codeHash, nativeBalance } from './client';

export class TxFailedError extends Error {
	constructor(
		message: string,
		public hash?: string,
	) {
		super(message);
	}
}

export class BusyError extends Error {
	constructor() {
		super('A payment is already being sent. Wait for it to finish.');
	}
}

/** Turns chain errors into something a person can read. */
export function humanizeTxError(raw: string): string {
	if (/insufficient funds/i.test(raw)) return 'Not enough balance for this payment.';
	if (/fee-grant not found|fee allowance|basic allowance/i.test(raw)) return 'The fee grant could not pay this fee.';
	if (/out of gas/i.test(raw)) return 'The network needed more gas than expected.';
	if (/account sequence mismatch/i.test(raw)) return 'Another transaction was still pending. Try again in a few seconds.';
	if (/swap|expected_return|slippage|minimum/i.test(raw)) return 'The swap price moved. Try again for a new quote.';
	return raw.length > 240 ? `${raw.slice(0, 240)}…` : raw;
}

export interface SendOptions {
	memo?: string;
	/** sSCRT this tx does NOT spend, i.e. what a refill may use */
	sscrtSpare?: bigint;
	/** used by "Refill now": include the refill even above the floor */
	forceRefill?: boolean;
	/** how long to wait for the block before returning `pending` (0 = don't wait) */
	waitMs?: number;
	/** called the moment the network accepted the tx (before it is in a block) */
	onBroadcast?: (pending: Extract<TxOutcome, { status: 'pending' }>) => void;
}

export type TxOutcome =
	| { status: 'confirmed'; hash: string; plan: FeePlan; refilled: bigint; tx: TxResponse }
	| { status: 'pending'; hash: string; plan: FeePlan; refilled: bigint };

let inFlight = false;

export function isSending(): boolean {
	return inFlight;
}

async function refillMessages(client: SecretNetworkClient, sender: string, amount: bigint): Promise<Msg[]> {
	const [sscrtHash, vaultHash] = await Promise.all([codeHash(client, SSCRT_ADDRESS), codeHash(client, GAS_VAULT_ADDRESS)]);
	return [
		new MsgExecuteContract({ sender, contract_address: SSCRT_ADDRESS, code_hash: sscrtHash, msg: { redeem: { amount: amount.toString(), denom: DENOM } }, sent_funds: [] }),
		new MsgExecuteContract({
			sender,
			contract_address: GAS_VAULT_ADDRESS,
			code_hash: vaultHash,
			msg: { grant: { grantee: sender } },
			sent_funds: [{ denom: DENOM, amount: amount.toString() }],
		}),
	];
}

const REFILL_GAS = GAS.unwrap + GAS.buyGasCredit;

async function cooldownUntil(address: string): Promise<number> {
	return (await kv.get<number>(addrKey('refill.until', address))) ?? 0;
}

function vaultCredit(grants: FeeGrant[]): bigint {
	const g = grants.find((x) => x.granter === GAS_VAULT_ADDRESS);
	return g ? (availableFee(g) ?? 0n) : 0n;
}

async function waitFor(client: SecretNetworkClient, hash: string, timeoutMs: number): Promise<TxResponse | null> {
	const start = Date.now();
	await new Promise((r) => setTimeout(r, 1200));
	while (Date.now() - start < timeoutMs) {
		try {
			const tx = await client.query.getTx(hash);
			if (tx) return tx;
		} catch {
			/* node hiccup: keep polling */
		}
		await new Promise((r) => setTimeout(r, 1000));
	}
	return null;
}

/** Sends `msgs` as one transaction. See the file header for the guarantees. */
export async function sendTx(
	client: SecretNetworkClient,
	address: string,
	msgs: Msg[],
	gasLimit: number,
	msgTypes: string[],
	opts: SendOptions = {},
): Promise<TxOutcome> {
	if (inFlight) throw new BusyError();
	inFlight = true;
	try {
		const [grants, native] = await Promise.all([fetchGrants(address), nativeBalance(client, address)]);
		let plan = planFee(grants, gasLimit, msgTypes, native);
		let all = msgs;
		let refilled = 0n;

		// append a gas-credit refill when it is due and affordable
		const spare = opts.sscrtSpare ?? 0n;
		const due = opts.forceRefill || (vaultCredit(grants) < CREDIT_FLOOR && Date.now() > (await cooldownUntil(address)));
		// Automatic refills only ever take a full refill from sSCRT the payment
		// leaves untouched, so they never drain a small balance; "Refill now"
		// may use whatever is there.
		const amount = opts.forceRefill ? (spare < CREDIT_REFILL ? spare : CREDIT_REFILL) : spare >= CREDIT_REFILL ? CREDIT_REFILL : 0n;
		if (due && amount >= 100_000n) {
			try {
				const withRefill = planFee(grants, gasLimit + REFILL_GAS, [...msgTypes, MSG_EXECUTE], native);
				// never let the refill change who pays (that could make the user's own payment fail)
				if (msgs.length === 0 || withRefill.source === plan.source) {
					all = [...msgs, ...(await refillMessages(client, address, amount))];
					plan = withRefill;
					refilled = amount;
				}
			} catch {
				/* refill not affordable: send without it */
			}
		}
		if (all.length === 0) throw new TxFailedError('Nothing to send.');

		const options = {
			gasLimit: plan.gasLimit,
			gasPriceInFeeDenom: GAS_PRICE,
			feeDenom: DENOM,
			feeGranter: plan.feeGranter,
			memo: opts.memo ?? '',
		};
		const bytes = await client.tx.signTx(all, options);
		const sent = await broadcastOnce(client, bytes);
		opts.onBroadcast?.({ status: 'pending', hash: sent, plan, refilled });
		if (refilled > 0n) await kv.set(addrKey('refill.until', address), Date.now() + REFILL_COOLDOWN_MS);

		const wait = opts.waitMs ?? 120_000;
		const tx = wait > 0 ? await waitFor(client, sent, wait) : null;
		if (!tx) return { status: 'pending', hash: sent, plan, refilled };
		if (tx.code !== 0) {
			if (refilled > 0n) await kv.del(addrKey('refill.until', address));
			throw new TxFailedError(humanizeTxError(tx.rawLog || `error code ${tx.code}`), sent);
		}
		return { status: 'confirmed', hash: sent, plan, refilled, tx };
	} finally {
		inFlight = false;
	}
}

/**
 * Broadcasts signed bytes and returns the hash. A network error is retried with
 * the same bytes (idempotent); a rejection by the node (CheckTx) is final.
 */
async function broadcastOnce(client: SecretNetworkClient, bytes: Uint8Array): Promise<string> {
	let lastError: unknown;
	for (let attempt = 0; attempt < 3; attempt++) {
		try {
			const r = await client.tx.broadcastSignedTx(bytes, { waitForCommit: false, broadcastMode: BroadcastMode.Sync });
			return r.transactionHash;
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			if (/tx already in mempool|already exists in cache/i.test(msg)) return hashOf(bytes);
			if (/failed with code/i.test(msg)) throw new TxFailedError(humanizeTxError(msg.replace(/^.*Log: /, '')));
			lastError = e;
			await new Promise((r) => setTimeout(r, 1500));
		}
	}
	throw new TxFailedError(`Could not reach the network: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

async function hashOf(bytes: Uint8Array): Promise<string> {
	const d = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>));
	return [...d].map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}
