<script lang="ts">
	// The glyph of an activity entry: the same in the list and on its detail page.
	import { ArrowDownLeft, ArrowLeftRight, Fuel, Landmark, Send, ShieldCheck, Vote, Zap } from '@lucide/svelte';
	import type { Icon } from '../../lib/activity';

	let { icon, size = 40 }: { icon: Icon; size?: number } = $props();
	const g = $derived(Math.round(size * 0.42));
</script>

<span
	class="flex shrink-0 items-center justify-center rounded-pill bg-surface {icon === 'in' ? 'text-positive' : icon === 'bolt' || icon === 'stake' || icon === 'vote' ? 'text-accent' : 'text-text-muted'}"
	style="width:{size}px;height:{size}px"
>
	{#if icon === 'in'}<ArrowDownLeft size={g} />{:else if icon === 'swap'}<ArrowLeftRight size={g} />{:else if icon === 'gas'}<Fuel size={g} />{:else if icon === 'shield'}<ShieldCheck size={g} />{:else if icon === 'bolt'}<Zap
			size={g}
		/>{:else if icon === 'stake'}<Landmark size={g} />{:else if icon === 'vote'}<Vote size={g} />{:else}<Send size={g} />{/if}
</span>
