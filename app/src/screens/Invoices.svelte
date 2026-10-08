<script lang="ts">
	import PageHeader from '../components/ui/PageHeader.svelte';
	import { ChevronRight, Plus, ReceiptText } from '@lucide/svelte';
	import Button from '../components/ui/Button.svelte';
	import { invoices, loadInvoices, reconcile, type IssuedInvoice } from '../lib/pay/invoices.svelte';
	import { open } from '../lib/ui.svelte';
	import { usdValue } from '../lib/price.svelte';
	import { toBaseUnits } from 'secret-pay';
	import { wallet } from '../lib/wallet.svelte';

	$effect(() => {
		const history = wallet.history;
		const me = wallet.address;
		void loadInvoices().then(() => reconcile(history, me));
	});

	const STATUS: Record<IssuedInvoice['status'], [string, string]> = {
		open: ['Waiting', 'text-text-muted'],
		no_match: ['Waiting', 'text-text-muted'],
		paid: ['Paid', 'text-positive'],
		underpaid: ['Partly paid', 'text-[#f5b544]'],
		late: ['Paid late', 'text-[#f5b544]'],
		expired: ['Expired', 'text-negative'],
	};
</script>

<div class="flex flex-col gap-4">
	<PageHeader title="Invoices" />
	<Button size="lg" class="w-full" onclick={() => open({ name: 'invoice' })}>
		{#snippet icon()}<Plus size={17} />{/snippet}
		New invoice
	</Button>

	{#if invoices.list.length}
		<ul class="flex flex-col">
			{#each invoices.list as inv (inv.request.id)}
				<li>
					<button type="button" onclick={() => open({ name: 'invoice', id: inv.request.id })} class="state-layer -mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-card px-2 py-3 text-left">
						<span class="flex size-10 shrink-0 items-center justify-center rounded-pill bg-surface text-text-muted"><ReceiptText size={17} /></span>
						<span class="min-w-0 flex-1">
							<span class="block truncate text-base font-medium">{inv.request.message ?? inv.request.id}</span>
							<span class="block text-label text-text-faint">{new Date(inv.created).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span>
						</span>
						<span class="flex shrink-0 flex-col items-end">
							<span class="text-base font-medium tabular-nums">{inv.request.amount} sSCRT</span>
							<span class="text-label"
								><span class={STATUS[inv.status][1]}>{STATUS[inv.status][0]}</span
								>{#if usdValue(toBaseUnits(inv.request.amount ?? '0', 6))}<span class="tabular-nums text-text-faint"> · {usdValue(toBaseUnits(inv.request.amount ?? '0', 6))}</span>{/if}</span
							>
						</span>
						<ChevronRight size={16} class="shrink-0 text-text-faint" />
					</button>
				</li>
			{/each}
		</ul>
	{:else}
		<div class="flex flex-col items-center py-12 text-center">
			<span class="flex size-11 items-center justify-center rounded-pill bg-accent-container text-accent"><ReceiptText size={20} /></span>
			<h2 class="mt-4 text-title">No invoices yet</h2>
			<p class="mt-1.5 text-base text-text-muted">Ask for a set amount with a QR code or link. You’ll see here when it gets paid.</p>
		</div>
	{/if}
</div>
