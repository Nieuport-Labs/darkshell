<script lang="ts">
	import { ChevronRight, Zap } from '@lucide/svelte';
	import PageHeader from '../components/ui/PageHeader.svelte';
	import ActivityList from '../components/wallet/ActivityList.svelte';
	import { isFinal, loadLnOrders, lnOrders, STATUS_TEXT } from '../lib/ff/orders.svelte';
	import { goTab, open } from '../lib/ui.svelte';
	import { wallet } from '../lib/wallet.svelte';

	$effect(() => {
		void wallet.address; // reload when the account changes
		void loadLnOrders();
	});
</script>

<div class="flex flex-col gap-2">
	<PageHeader title="Activity" onback={() => goTab('home')} />

	{#if lnOrders.list.length}
		<section class="flex flex-col pb-4">
			<h2 class="pb-2 text-title">Lightning payments</h2>
			<ul class="flex flex-col">
				{#each lnOrders.list as o (o.id)}
					<li>
						<button type="button" onclick={() => open({ name: 'lightning', orderId: o.id })} class="state-layer -mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-card px-2 py-3 text-left">
							<span class="flex size-10 shrink-0 items-center justify-center rounded-pill bg-surface text-accent"><Zap size={17} /></span>
							<span class="min-w-0 flex-1">
								<span class="block truncate text-base font-medium">{o.description || 'Lightning invoice'}</span>
								<span class="block truncate text-label {o.status === 'DONE' ? 'text-positive' : isFinal(o.status) ? 'text-negative' : 'text-text-faint'}">{STATUS_TEXT[o.status]}</span>
							</span>
							<span class="flex shrink-0 flex-col items-end">
								<span class="text-base font-medium tabular-nums">−{Number(o.sats).toLocaleString()} sats</span>
								<span class="text-label text-text-faint">{new Date(o.created).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span>
							</span>
							<ChevronRight size={16} class="shrink-0 text-text-faint" />
						</button>
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	<ActivityList title="All payments" />
</div>
