<script lang="ts">
	import { Fuel } from '@lucide/svelte';
	import { formatAmount } from '../../lib/format';
	import { wallet } from '../../lib/wallet.svelte';

	let { onclick }: { onclick?: () => void } = $props();

	const c = $derived(wallet.credits);
	const dot = $derived(
		!c ? 'bg-text-faint' : c.state === 'warm' ? 'bg-positive' : c.state === 'low' ? 'bg-[#f5b544]' : 'bg-negative',
	);
	const label = $derived(
		!c ? '…' : c.state === 'unknown' ? '?' : c.remaining !== null && c.remaining > 0n ? formatAmount(c.remaining, 2) : c.native > 0n ? 'own SCRT' : 'empty',
	);
</script>

<button {onclick} class="state-layer flex items-center gap-1.5 rounded-pill border border-border bg-surface py-1.5 pl-2.5 pr-3 text-label text-text-muted" aria-label="Gas credits: {label}">
	<span class="size-1.5 rounded-pill {dot}"></span>
	<Fuel size={13} aria-hidden="true" />
	<span class="tabular-nums">{label}</span>
</button>
