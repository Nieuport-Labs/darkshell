// Builds the messages for every kind of payment DarkShell makes. The wallet
// only holds sSCRT, so everything starts from it; the recipient always gets
// exactly what they asked for, in one transaction (all or nothing).
//
//   sSCRT          → SNIP-20 transfer (private, memo encrypted)
//   public SCRT    → redeem sSCRT + bank send (tx memo is public)
//   other private  → swap sSCRT on ShadeSwap (min return = amount) + transfer
//   other public   → swap + redeem that token + bank send
//   Cosmos address → redeem sSCRT + IBC transfer
// Mirrors Secret_Dashboard `src/lib/invoicePayment.ts`.

import { MsgSend, MsgTransfer, type Msg, type SecretNetworkClient } from 'secretjs';
import { paymentMemo, type PaymentRequest } from 'secret-pay';
import { IBC_TIMEOUT_SECONDS, type IbcDestination } from '../chain/ibc';
import { swapGas, swapMessage } from '../chain/shadeSwap';
import { snip20Msg } from '../chain/sscrt';
import { DENOM, GAS, SSCRT_ADDRESS } from '../config';
import { MSG_EXECUTE, MSG_TRANSFER } from '../gas/feePayer';
import type { InvoiceAsset } from '../tokens';
import type { PaddedQuote } from './quote';

const MSG_SEND = '/cosmos.bank.v1beta1.MsgSend';

export interface PaymentPlan {
	msgs: Msg[];
	gas: number;
	types: string[];
	/** transaction memo (public) */
	txMemo?: string;
	/** sSCRT this payment spends, in base units */
	spends: bigint;
}

export async function sscrtTransfer(client: SecretNetworkClient, sender: string, to: string, amount: bigint, memo?: string): Promise<PaymentPlan> {
	const msg = await snip20Msg(client, sender, SSCRT_ADDRESS, { transfer: { recipient: to, amount: amount.toString(), ...(memo ? { memo } : {}) } });
	return { msgs: [msg], gas: GAS.snip20Transfer, types: [MSG_EXECUTE], spends: amount };
}

/** Whether paying this asset needs a ShadeSwap quote first. */
export function needsSwap(asset: InvoiceAsset): boolean {
	return asset.token.address !== SSCRT_ADDRESS;
}

/**
 * Pays a request for `amount` (base units) of `asset`. `quote` is required when
 * `needsSwap(asset)`: sSCRT in, at least `amount` of the asset's token out.
 */
export async function requestPayment(
	client: SecretNetworkClient,
	sender: string,
	req: PaymentRequest,
	asset: InvoiceAsset,
	amount: bigint,
	quote?: PaddedQuote,
	memoOverride?: string,
): Promise<PaymentPlan> {
	const memo = paymentMemo(req) ?? memoOverride;
	const to = req.address;
	const msgs: Msg[] = [];
	const types: string[] = [];
	let gas = 0;
	let spends = amount;

	if (needsSwap(asset)) {
		if (!quote) throw new Error('No price for this swap yet.');
		msgs.push(await swapMessage(client, sender, quote.route, quote.amountIn, amount));
		types.push(MSG_EXECUTE);
		gas += swapGas(quote.route);
		spends = quote.amountIn;
	}

	if (asset.private) {
		msgs.push(await snip20Msg(client, sender, asset.token.address, { transfer: { recipient: to, amount: amount.toString(), ...(memo ? { memo } : {}) } }));
		types.push(MSG_EXECUTE);
		gas += GAS.snip20Transfer;
		return { msgs, gas, types, spends };
	}

	const redeem = asset.token.address === SSCRT_ADDRESS ? { redeem: { amount: amount.toString(), denom: DENOM } } : { redeem: { amount: amount.toString() } };
	msgs.push(
		await snip20Msg(client, sender, asset.token.address, redeem),
		new MsgSend({ from_address: sender, to_address: to, amount: [{ denom: asset.id, amount: amount.toString() }] }),
	);
	types.push(MSG_EXECUTE, MSG_SEND);
	gas += GAS.unwrap + GAS.send;
	return { msgs, gas, types, txMemo: memo, spends };
}

export async function ibcPayment(
	client: SecretNetworkClient,
	sender: string,
	receiver: string,
	dest: IbcDestination,
	amount: bigint,
	memo = '',
): Promise<PaymentPlan> {
	const redeem = await snip20Msg(client, sender, SSCRT_ADDRESS, { redeem: { amount: amount.toString(), denom: DENOM } });
	const transfer = new MsgTransfer({
		sender,
		receiver: receiver.trim().toLowerCase(),
		source_port: 'transfer',
		source_channel: dest.channel,
		token: { denom: DENOM, amount: amount.toString() },
		timeout_timestamp: String(Math.floor(Date.now() / 1000) + IBC_TIMEOUT_SECONDS),
		memo,
	});
	return { msgs: [redeem, transfer], gas: GAS.unwrap + GAS.ibcTransfer, types: [MSG_EXECUTE, MSG_TRANSFER], spends: amount };
}

/** Wraps public SCRT the wallet received into sSCRT (user-initiated). */
export async function wrapPayment(client: SecretNetworkClient, sender: string, amount: bigint): Promise<PaymentPlan> {
	const msg = await snip20Msg(client, sender, SSCRT_ADDRESS, { deposit: {} }, amount);
	return { msgs: [msg], gas: GAS.wrap, types: [MSG_EXECUTE], spends: 0n };
}

/** ATOM on Secret: SNIP-20 and the IBC voucher it redeems into (`transfer/channel-0/uatom`). */
export const ATOM_TOKEN = 'secret19e75l25r6sa6nhdf4lggjmgpw0vmpfvsw5cnpe';
export const ATOM_IBC_DENOM = 'ibc/27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2';
/** secret-4 → cosmoshub-4; the channel ATOM arrived through, so it unwinds to native uatom. */
export const HUB_CHANNEL = 'channel-0';

/**
 * Pays a FixedFloat order in ATOM from sSCRT, in one transaction:
 * swap sSCRT→ATOM (min. return = order amount), redeem the ATOM SNIP-20,
 * IBC-transfer the ATOM to FixedFloat's deposit address on the Cosmos Hub with
 * the order's memo in the ICS-20 packet.
 */
export async function lightningPayment(
	client: SecretNetworkClient,
	sender: string,
	quote: PaddedQuote,
	atom: bigint,
	depositAddress: string,
	memo: string,
): Promise<PaymentPlan> {
	const swap = await swapMessage(client, sender, quote.route, quote.amountIn, atom);
	const redeem = await snip20Msg(client, sender, ATOM_TOKEN, { redeem: { amount: atom.toString() } });
	const transfer = new MsgTransfer({
		sender,
		receiver: depositAddress,
		source_port: 'transfer',
		source_channel: HUB_CHANNEL,
		token: { denom: ATOM_IBC_DENOM, amount: atom.toString() },
		timeout_timestamp: String(Math.floor(Date.now() / 1000) + IBC_TIMEOUT_SECONDS),
		memo,
	});
	return {
		msgs: [swap, redeem, transfer],
		gas: swapGas(quote.route) + GAS.unwrap + GAS.ibcTransfer,
		types: [MSG_EXECUTE, MSG_EXECUTE, MSG_TRANSFER],
		spends: quote.amountIn,
	};
}
