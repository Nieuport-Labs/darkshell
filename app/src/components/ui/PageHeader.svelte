<script lang="ts">
	import { ChevronLeft } from '@lucide/svelte';
	import type { Snippet } from 'svelte';

	let { title, action, onback }: { title: string; action?: Snippet; onback?: () => void } = $props();
</script>

<!-- Same height as Home's account header, so titles never sit against the status bar. -->
<header class="flex min-h-14 items-center justify-between gap-3 pb-4 pt-3">
	<div class="flex min-w-0 items-center gap-1">
		{#if onback}
			<button type="button" onclick={onback} aria-label="Back" class="state-layer -ml-2 rounded-pill p-1.5 text-text"><ChevronLeft size={26} /></button>
		{/if}
		<h1 class="truncate text-display">{title}</h1>
	</div>
	{@render action?.()}
</header>
