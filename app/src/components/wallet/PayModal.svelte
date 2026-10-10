<script lang="ts">
	// After Secret_Dashboard PayInvoiceModal: a confirmation, not a form. The
	// link set recipient, asset and amount; only how it is paid is decided here
	// (sSCRT directly, unwrapped, or swapped on ShadeSwap in the same tx).
	import { Eye, Loader2, ShieldCheck } from '@lucide/svelte';
	import { untrack } from 'svelte';
	import { type TxOutcome } from '../../lib/chain/tx';
	import { formatAmount, shortAddress, splitAmount } from '../../lib/format';
	import { blockReason, failureText, invoiceFacts, payInvoice, sscrtCost, type InvoiceTarget } from '../../lib/pay/invoicePay';
	import { quoteFor, type QuoteState } from '../../lib/pay/plan';
	import { close } from '../../lib/ui.svelte';
	import { prefetchForPayment, spendable } from '../../lib/wallet.svelte';
	import Modal from '../ui/Modal.svelte';
	import SwipeConfirm from '../ui/SwipeConfirm.svelte';
	import { usdValue } from '../../lib/price.svelte';
	import TxResult from './TxResult.svelte';

	let { target: t }: { target: InvoiceTarget } = $props();
	const target = untrack(() => t);
	const { request, asset } = target;
	const facts = invoiceFacts(target);
	const { amount, swapping, memo } = facts;

	let quote = $state<QuoteState>(swapping ? { kind: 'loading' } : { kind: 'none' });
	let sending = $state(false);
	let failure = $state('');
	let outcome = $state<TxOutcome | null>(null);

	if (swapping) void quoteFor(asset, amount).then((q) => (quote = q));

	// the figure that matters is what the payment spends, in sSCRT
	const spends = $derived(sscrtCost(facts, quote));
	const parts = $derived(splitAmount(spends));
	const payError = $derived(blockReason(target, facts, quote, spendable()));
	const ready = $derived(!payError && spends !== null && !sending);

	async function submit() {
		if (!ready) return;
		sending = true;
		failure = '';
		try {
			outcome = await payInvoice(target, facts, quote, (p) => (outcome = p));
		} catch (e) {
			failure = failureText(e);
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
			{#if spends === null}
				<span class="flex h-[3.25rem] items-center gap-2 text-base text-text-muted"><Loader2 size={18} class="animate-spin" /> Getting the price…</span>
			{:else}
				<p class="flex items-baseline justify-center tabular-nums" aria-label="{formatAmount(spends)} sSCRT">
					<span class="{parts.int.length > 6 ? 'text-[2.5rem]' : 'text-[3.25rem]'} font-semibold leading-none tracking-[-0.035em]">{parts.int}</span>
					{#if parts.frac}<span class="text-[1.375rem] font-semibold tracking-[-0.02em] text-text-faint">.{parts.frac}</span>{/if}
					<span class="ml-2 text-title text-text-muted">sSCRT</span>
				</p>
			{/if}
			{#if usdValue(spends)}<span class="text-base tabular-nums text-text-faint">≈ {usdValue(spends)}</span>{/if}
			{#if swapping}<span class="text-label text-text-muted">They receive {request.amount} {asset.symbol}</span>{/if}
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
				<span class="text-label text-text-muted">Paid from</span>
				<span class="text-base font-medium">Your balance · {formatAmount(spendable())} sSCRT</span>
				{#if swapping || !asset.private}
					<span class="truncate text-label text-text-faint">
						{swapping ? 'Swapped on ShadeSwap' : 'Unwrapped'}{quote.kind === 'ready' ? ` · up to ${Number(quote.quote.slippageBps) / 100}% slippage` : ''}
					</span>
				{/if}
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
