<script lang="ts">
	// After Secret_Dashboard PayInvoiceModal: a confirmation, not a form. The
	// link set recipient, asset and amount; only how it is paid is decided here
	// (sSCRT directly, unwrapped, or swapped on ShadeSwap in the same tx).
	import { Eye, Loader2, ShieldCheck } from '@lucide/svelte';
	import { isExpired, paymentMemo, toBaseUnits } from 'secret-pay';
	import { untrack } from 'svelte';
	import { BusyError, type TxOutcome } from '../../lib/chain/tx';
	import { SSCRT_ADDRESS } from '../../lib/config';
	import { formatAmount, shortAddress } from '../../lib/format';
	import { NoGasError } from '../../lib/gas/feePayer';
	import type { Target } from '../../lib/pay/classify';
	import { buildPlan, quoteFor, type QuoteState } from '../../lib/pay/plan';
	import { close } from '../../lib/ui.svelte';
	import { pay, prefetchForPayment, wallet } from '../../lib/wallet.svelte';
	import Button from '../ui/Button.svelte';
	import Modal from '../ui/Modal.svelte';
	import SwipeConfirm from '../ui/SwipeConfirm.svelte';
	import { usdValue } from '../../lib/price.svelte';
	import TxResult from './TxResult.svelte';

	let { target: t }: { target: Extract<Target, { kind: 'secret' }> } = $props();
	const target = untrack(() => t);
	const { request, asset } = target;

	const amount = toBaseUnits(request.amount!, asset.decimals);
	const swapping = asset.token.address !== SSCRT_ADDRESS;
	const expired = isExpired(request);
	const own = request.address === wallet.address;
	const memo = paymentMemo(request);

	let quote = $state<QuoteState>(swapping ? { kind: 'loading' } : { kind: 'none' });
	let sending = $state(false);
	let failure = $state('');
	let outcome = $state<TxOutcome | null>(null);

	if (swapping) void quoteFor(asset, amount).then((q) => (quote = q));

	const spends = $derived(quote.kind === 'ready' ? quote.quote.amountIn : swapping ? null : amount);
	const payError = $derived(
		expired
			? 'This invoice has expired.'
			: own
				? 'This is your own invoice.'
				: quote.kind === 'unavailable'
					? `There is no ShadeSwap route from sSCRT to ${asset.symbol} right now.`
					: spends !== null && wallet.balance !== null && spends > wallet.balance
						? 'Not enough sSCRT.'
						: '',
	);
	const ready = $derived(!payError && spends !== null && !sending);
	const size = request.amount!.length > 8 ? 'text-[2rem]' : 'text-[2.75rem]';

	async function submit() {
		if (!ready) return;
		sending = true;
		failure = '';
		try {
			const plan = await buildPlan(target, amount, undefined, quote.kind === 'ready' ? quote.quote : undefined);
			outcome = await pay(plan, 'invoice', (p) => (outcome = p), {
				to: request.address,
				amount: amount.toString(),
				symbol: asset.symbol,
				memo: request.id ?? request.memo,
			});
		} catch (e) {
			failure =
				e instanceof NoGasError
					? 'Nothing can pay the network fee: gas credits are empty. See Settings → Gas credits.'
					: e instanceof BusyError || e instanceof Error
						? e.message
						: String(e);
		} finally {
			sending = false;
		}
	}

	prefetchForPayment();
</script>

<Modal full title="Pay invoice" onclose={close}>
	{#if outcome}
		<TxResult {outcome} summary="Paid {request.amount} {asset.symbol} to {request.label ?? shortAddress(request.address)}." ondone={close} />
	{:else}
		<div class="flex flex-col items-center gap-2 pt-6 text-center">
			<div class="flex items-baseline gap-2">
				<span class="{size} font-semibold leading-tight tracking-[-0.03em] tabular-nums">{request.amount}</span>
				<span class="text-title text-text-muted">{asset.symbol}</span>
			</div>
			{#if usdValue(spends)}<span class="-mt-1 text-base tabular-nums text-text-faint">≈ {usdValue(spends)}</span>{/if}
			<span class="inline-flex items-center gap-1.5 rounded-pill bg-surface px-2.5 py-1 text-label text-text-muted">
				{#if asset.private}<ShieldCheck size={12} class="text-accent" /> Private transfer{:else}<Eye size={12} /> Public transfer{/if}
			</span>
			<p class="mt-1 text-base text-text-muted">
				To <span class="font-medium text-text">{request.label ?? shortAddress(request.address, 10, 6)}</span>
			</p>
			<p class="break-address font-mono text-xs text-text-faint">{request.address}</p>
			{#if request.message}<p class="text-base">“{request.message}”</p>{/if}
		</div>

		<div class="flex items-center gap-3 rounded-card border border-border bg-surface px-4 py-3">
			<span class="flex min-w-0 flex-1 flex-col">
				<span class="text-label text-text-muted">Pay with</span>
				<span class="text-base font-medium">
					{#if quote.kind === 'loading'}
						Finding a price…
					{:else if quote.kind === 'ready'}
						{formatAmount(quote.quote.amountIn)} sSCRT
					{:else}
						{formatAmount(amount)} sSCRT
					{/if}
				</span>
				<span class="truncate text-label text-text-faint">
					Balance {formatAmount(wallet.balance)} sSCRT{swapping ? ' · swapped on ShadeSwap' : !asset.private ? ' · unwrapped' : ''}{quote.kind === 'ready'
						? ` · up to ${Number(quote.quote.slippageBps) / 100}% slippage`
						: ''}
				</span>
			</span>
			{#if quote.kind === 'loading'}<Loader2 size={16} class="shrink-0 animate-spin text-text-muted" />{/if}
		</div>

		{#if memo}
			<p class="-mt-2 px-1 text-label text-text-faint">Reference <span class="font-mono">{memo}</span> is attached{asset.private ? ' privately' : ' as a public memo'}.</p>
		{/if}
		{#if payError}<p class="text-base text-negative" role="alert">{payError}</p>{/if}
		{#if failure}<p class="break-address text-base text-negative" role="alert">{failure}</p>{/if}

		<div class="mt-auto pt-4">
			<SwipeConfirm label="Swipe to pay" loading={sending} disabled={!ready && !sending} onconfirm={submit} />
		</div>
	{/if}
</Modal>
