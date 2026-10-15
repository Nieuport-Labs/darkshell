<script lang="ts">
	import { t as tr } from '../../lib/i18n/index.svelte';
	// After Secret_Dashboard PayInvoiceModal: a confirmation, not a form. The
	// link set recipient, asset and amount; only how it is paid is decided here
	// (sSCRT directly, unwrapped, or swapped on ShadeSwap in the same tx).
	import { Eye, Loader2, ReceiptText, ShieldCheck } from '@lucide/svelte';
	import { untrack } from 'svelte';
	import { type TxOutcome } from '../../lib/chain/tx';
	import { formatAmount, shortAddress, splitAmount } from '../../lib/format';
	import { blockReason, failureText, invoiceFacts, payInvoice, sscrtCost, type InvoiceTarget } from '../../lib/pay/invoicePay';
	import { quoteFor, type QuoteState } from '../../lib/pay/plan';
	import { close } from '../../lib/ui.svelte';
	import { prefetchForPayment, spendable } from '../../lib/wallet.svelte';
	import Modal from '../ui/Modal.svelte';
	import SwipeConfirm from '../ui/SwipeConfirm.svelte';
	import { fiatValue } from '../../lib/price.svelte';
	import TxStage from './TxStage.svelte';
	import { haptic } from '../../lib/haptics';

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
			haptic.error();
			failure = failureText(e);
		} finally {
			sending = false;
		}
	}

	prefetchForPayment();
</script>

<Modal full title={tr('Pay invoice')} onclose={close}>
	{#if outcome || sending}
		<TxStage
			{outcome}
			verbs={[tr('Paying'), tr('Paid')]}
			amount={formatAmount(spends, 6)}
			unit="sSCRT"
			sub={fiatValue(spends) ? `≈ ${fiatValue(spends)}` : undefined}
			line={tr('to {0}', { 0: request.label ?? shortAddress(request.address, 10, 6) })}
			summary={swapping ? tr('They received {0} {1}.', { 0: request.amount, 1: asset.symbol }) : undefined}
			ondone={close}
		>
			{#snippet icon()}<ReceiptText size={30} />{/snippet}
		</TxStage>
	{:else}
		<div class="flex flex-col items-center gap-2 pt-6 text-center">
			{#if spends === null}
				<span class="flex h-[3.25rem] items-center gap-2 text-base text-text-muted"><Loader2 size={18} class="animate-spin" /> {tr('Getting the price…')}</span>
			{:else}
				<p class="flex items-baseline justify-center tabular-nums" aria-label="{formatAmount(spends)} sSCRT">
					<span class="{parts.int.length > 6 ? 'text-[2.5rem]' : 'text-[3.25rem]'} font-semibold leading-none tracking-[-0.035em]">{parts.int}</span>
					{#if parts.frac}<span class="text-[1.375rem] font-semibold tracking-[-0.02em] text-text-faint">.{parts.frac}</span>{/if}
					<span class="ml-2 text-title text-text-muted">sSCRT</span>
				</p>
			{/if}
			{#if fiatValue(spends)}<span class="text-base tabular-nums text-text-faint">≈ {fiatValue(spends)}</span>{/if}
			{#if swapping}<span class="text-label text-text-muted">{tr('They receive {0} {1}', { 0: request.amount, 1: asset.symbol })}</span>{/if}
			<span class="inline-flex items-center gap-1.5 rounded-pill bg-surface px-2.5 py-1 text-label text-text-muted">
				{#if asset.private}<ShieldCheck size={12} class="text-accent" /> {tr('Private transfer')}{:else}<Eye size={12} /> {tr('Public transfer')}{/if}
			</span>
			<p class="mt-1 text-base text-text-muted">
				{tr('To')} <span class="font-medium text-text">{request.label ?? shortAddress(request.address, 10, 6)}</span>
			</p>
			<p class="break-address font-mono text-xs text-text-faint">{request.address}</p>
			{#if request.message}<p class="text-base">“{request.message}”</p>{/if}
		</div>

		<div class="flex items-center gap-3 rounded-card border border-border bg-surface px-4 py-3">
			<span class="flex min-w-0 flex-1 flex-col">
				<span class="text-label text-text-muted">{tr('Paid from')}</span>
				<span class="text-base font-medium">{tr('Your balance · {0} sSCRT', { 0: formatAmount(spendable()) })}</span>
				{#if swapping || !asset.private}
					<span class="truncate text-label text-text-faint">
						{swapping ? tr('Swapped on ShadeSwap') : tr('Unwrapped')}{quote.kind === 'ready' ? tr(' · up to {0}% slippage', { 0: Number(quote.quote.slippageBps) / 100 }) : ''}
					</span>
				{/if}
			</span>
			{#if quote.kind === 'loading'}<Loader2 size={16} class="shrink-0 animate-spin text-text-muted" />{/if}
		</div>

		{#if memo}
			<p class="-mt-2 px-1 text-label text-text-faint">{tr('Reference')} <span class="font-mono">{memo}</span> {asset.private ? tr('is attached privately.') : tr('is attached as a public memo.')}</p>
		{/if}
		{#if payError}<p class="text-base text-negative" role="alert">{payError}</p>{/if}
		{#if failure}<p class="break-address text-base text-negative animate-[shake_400ms_var(--ease-standard)]" role="alert">{failure}</p>{/if}

		<div class="mt-auto pt-4">
			<SwipeConfirm label={tr('Swipe to pay')} loading={sending} disabled={!ready && !sending} onconfirm={submit} />
		</div>
	{/if}
</Modal>
