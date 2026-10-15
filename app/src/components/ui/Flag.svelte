<script lang="ts">
	// Small drawn flags: emoji flags don't show on Windows.
	import type { Lang } from '../../lib/i18n/index.svelte';
	let { lang, size = 28 }: { lang: Lang; size?: number } = $props();
</script>

<svg width={size} height={size * 0.7} viewBox="0 0 30 21" class="shrink-0 overflow-hidden rounded-[3px] shadow-[0_0_0_1px_rgb(255_255_255/0.12)]" aria-hidden="true">
	{#if lang === 'cs'}
		<rect width="30" height="10.5" fill="#fff" />
		<rect y="10.5" width="30" height="10.5" fill="#d7141a" />
		<path d="M0 0 L15 10.5 L0 21 Z" fill="#11457e" />
	{:else if lang === 'de'}
		<rect width="30" height="7" fill="#000" />
		<rect y="7" width="30" height="7" fill="#dd0000" />
		<rect y="14" width="30" height="7" fill="#ffce00" />
	{:else}
		<rect width="30" height="21" fill="#012169" />
		<path d="M0 0 L30 21 M30 0 L0 21" stroke="#fff" stroke-width="4.2" />
		<path d="M0 0 L30 21 M30 0 L0 21" stroke="#c8102e" stroke-width="1.6" />
		<path d="M15 0 V21 M0 10.5 H30" stroke="#fff" stroke-width="7" />
		<path d="M15 0 V21 M0 10.5 H30" stroke="#c8102e" stroke-width="4.2" />
	{/if}
</svg>
