<script lang="ts">
	import type { Snippet } from 'svelte';

	let { title, action }: { title: string; action?: Snippet } = $props();
</script>

<!-- Same height as Home's account header, so titles never sit against the status bar. -->
<header class="flex min-h-14 items-center justify-between gap-3 pb-4 pt-3">
	<h1 class="text-display">{title}</h1>
	{@render action?.()}
</header>
