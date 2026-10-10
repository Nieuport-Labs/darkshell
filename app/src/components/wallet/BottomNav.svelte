<script lang="ts">
	import { House, ReceiptText, Sprout } from '@lucide/svelte';
	import { goTab, ui, type Tab } from '../../lib/ui.svelte';
	import { haptic } from '../../lib/haptics';

	const TABS: { tab: Tab; label: string; icon: typeof House }[] = [
		{ tab: 'home', label: 'Home', icon: House },
		{ tab: 'invoices', label: 'Invoices', icon: ReceiptText },
		{ tab: 'staking', label: 'Earn', icon: Sprout },
	];
	const index = $derived(Math.max(0, TABS.findIndex((t) => t.tab === ui.tab)));
</script>

<nav
	class="bar fixed inset-x-0 bottom-0 z-40 border-t border-glass-edge pb-[max(0.5rem,env(safe-area-inset-bottom),var(--safe-area-inset-bottom,0px))] pt-2"
	aria-label="Main"
>
	<div class="relative mx-auto grid max-w-[560px] grid-cols-3 gap-1 px-3">
		<!-- the active tab's pill slides (with a little give) to the tab tapped -->
		<span
			aria-hidden="true"
			class="pointer-events-none absolute inset-y-0 left-3 rounded-card bg-accent-soft transition-transform duration-500 ease-[var(--ease-spring)]"
			style="width: calc((100% - 2rem) / 3); transform: translateX(calc({index} * (100% + 0.25rem)))"
		></span>
		{#each TABS as t (t.tab)}
			{@const active = ui.tab === t.tab}
			<button
				type="button"
				onclick={() => {
					if (!active) haptic.tap();
					goTab(t.tab);
				}}
				aria-current={active ? 'page' : undefined}
				class="state-layer relative flex min-h-12 touch-manipulation select-none flex-col items-center justify-center gap-1 rounded-card py-2 text-label transition-colors duration-300 {active ? 'text-accent' : 'text-text-muted'}"
			>
				<span class={active ? 'nav-pop' : ''}><t.icon size={20} /></span>
				{t.label}
			</button>
		{/each}
	</div>
</nav>
