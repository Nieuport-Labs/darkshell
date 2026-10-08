<script lang="ts">
	// "Payment received" toasts from SNIP-52 notifications (see lib/notify).
	import { ArrowDownLeft } from '@lucide/svelte';
	import { formatAmount } from '../../lib/format';
	import { notices, dismissNotice } from '../../lib/notify/watcher.svelte';
	import { goTab } from '../../lib/ui.svelte';
	import { wallet } from '../../lib/wallet.svelte';

	function accountName(address: string): string | undefined {
		if (address === wallet.address || wallet.accounts.length < 2) return undefined;
		return wallet.accounts.find((a) => a.address === address)?.name;
	}
</script>

<div class="pointer-events-none fixed inset-x-0 top-0 z-50 mx-auto flex max-w-[560px] flex-col gap-2 px-4 pt-safe" aria-live="polite">
	{#each notices.list as n (n.id)}
		{@const other = accountName(n.address)}
		<button
			type="button"
			onclick={() => {
				dismissNotice(n.id);
				if (!other) goTab('activity');
			}}
			class="pointer-events-auto mt-1 flex items-center gap-3 rounded-card border border-border-strong bg-[var(--toast-bg)] px-4 py-3 text-left shadow-[0_16px_48px_-12px_rgba(0,0,0,0.85)] animate-[notice-in_360ms_var(--ease-emphasised)_both]"
		>
			<span class="flex size-9 shrink-0 items-center justify-center rounded-pill bg-[color-mix(in_srgb,var(--color-positive)_15%,transparent)] text-positive"><ArrowDownLeft size={18} /></span>
			<span class="flex min-w-0 flex-1 flex-col">
				<span class="text-base font-medium tabular-nums">{n.amount !== undefined ? `+${formatAmount(n.amount)} sSCRT` : 'Payment received'}</span>
				<span class="truncate text-label text-text-muted">{other ? `Received on ${other}` : 'Received privately'}</span>
			</span>
		</button>
	{/each}
</div>
