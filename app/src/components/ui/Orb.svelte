<script lang="ts">
	import { t } from '../../lib/i18n/index.svelte';
	// A transaction in one shape (styles: `.orb` in design/index.css): a ring
	// spinning while it is signed and sent, slower while it waits for a block,
	// then a closed circle that fills, ticks and sends out ripples and sparks.
	// `still` shows the done state without the show (it was done before).
	import type { Snippet } from 'svelte';

	let {
		state,
		size = '9rem',
		still = false,
		label,
		icon,
	}: { state: 'busy' | 'pending' | 'done'; size?: string; still?: boolean; label?: string; icon?: Snippet } = $props();

	// sparks around the circle, alternating colour and reach
	const SPARKS = Array.from({ length: 10 }, (_, i) => ({
		a: `${(360 / 10) * i + (i % 2 ? 6 : -4)}deg`,
		r: `${i % 3 === 0 ? 80 : i % 3 === 1 ? 68 : 58}px`,
		c: i % 4 === 1 ? 'var(--color-accent)' : i % 4 === 3 ? '#ffffff' : 'var(--color-positive)',
		s: i % 3 === 0 ? 1 : 0.7,
	}));
</script>

<div class="orb {still ? 'is-still' : ''}" data-state={state} style="--orb-size: {size}" role="img" aria-label={label ?? (state === 'done' ? t('Done') : t('In progress'))}>
	<span class="orb-glow"></span>
	<span class="orb-ripple"></span>
	<span class="orb-ripple"></span>
	{#each SPARKS as s, i (i)}
		<span class="orb-spark" style="--a: {s.a}; --r: {s.r}; --spark: {s.c}; scale: {s.s}"></span>
	{/each}
	<svg viewBox="0 0 120 120" aria-hidden="true">
		<circle cx="60" cy="60" r="52" class="orb-track" />
		<circle cx="60" cy="60" r="52" class="orb-arc" />
		<circle cx="60" cy="60" r="52" class="orb-ring" />
		<circle cx="60" cy="60" r="44" class="orb-disc" />
		<path d="M41 61l12 12 25-26" class="orb-check" />
	</svg>
	{#if icon}<span class="orb-icon">{@render icon()}</span>{/if}
</div>
