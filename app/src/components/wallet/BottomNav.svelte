<script lang="ts">
	import { House, ReceiptText, Sprout } from '@lucide/svelte';
	import { goTab, ui, type Tab } from '../../lib/ui.svelte';

	const TABS: { tab: Tab; label: string; icon: typeof House }[] = [
		{ tab: 'home', label: 'Home', icon: House },
		{ tab: 'invoices', label: 'Invoices', icon: ReceiptText },
		{ tab: 'staking', label: 'Earn', icon: Sprout },
	];
</script>

<nav
	class="bar fixed inset-x-0 bottom-0 z-40 border-t border-glass-edge pb-[max(0.5rem,env(safe-area-inset-bottom),var(--safe-area-inset-bottom,0px))] pt-2"
	aria-label="Main"
>
	<div class="mx-auto grid max-w-[560px] grid-cols-3 gap-1 px-3">
		{#each TABS as t (t.tab)}
			{@const active = ui.tab === t.tab}
			<button
				type="button"
				onclick={() => goTab(t.tab)}
				aria-current={active ? 'page' : undefined}
				class="state-layer flex min-h-12 touch-manipulation select-none flex-col items-center justify-center gap-1 rounded-card py-2 text-label {active ? 'bg-accent-soft text-accent' : 'text-text-muted'}"
			>
				<t.icon size={20} />
				{t.label}
			</button>
		{/each}
	</div>
</nav>
