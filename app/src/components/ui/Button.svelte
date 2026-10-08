<script lang="ts">
	// Port of Secret_Dashboard src/components/ui/Button.tsx; icon and label stay
	// together in the middle even when the button stretches (`block`).
	import type { Snippet } from 'svelte';

	type Variant = 'primary' | 'secondary' | 'soft' | 'text' | 'ghost';
	let {
		children,
		icon,
		trailing,
		variant = 'primary',
		size = 'md',
		shape = 'pill',
		block = false,
		loading = false,
		disabled = false,
		type = 'button',
		class: klass = '',
		onclick,
	}: {
		children: Snippet;
		icon?: Snippet;
		trailing?: Snippet;
		variant?: Variant;
		size?: 'sm' | 'md' | 'lg' | 'xl';
		shape?: 'pill' | 'control';
		block?: boolean;
		loading?: boolean;
		disabled?: boolean;
		type?: 'button' | 'submit';
		class?: string;
		onclick?: (e: MouseEvent) => void;
	} = $props();

	const VARIANTS: Record<Variant, string> = {
		primary: 'bg-accent-strong text-[var(--color-accent-text)]',
		secondary: 'bg-surface border-border text-text',
		soft: 'bg-accent-container text-accent',
		text: 'bg-transparent text-accent',
		ghost: 'bg-transparent text-text-muted hover:text-text',
	};
	const SIZES = { sm: 'text-sm px-3 py-1.5 gap-1.5', md: 'text-base px-4 py-2 gap-2', lg: 'text-base p-2.5 gap-2.5', xl: 'h-14 shrink-0 text-base px-5 gap-2.5' };
</script>

<button
	{type}
	disabled={disabled || loading}
	aria-busy={loading || undefined}
	{onclick}
	class="state-layer inline-flex items-center border border-transparent font-medium transition-[transform,background-color] duration-[var(--duration-short)] ease-[var(--ease-standard)] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100 {shape ===
	'pill'
		? 'rounded-pill'
		: 'rounded-control'} {VARIANTS[variant]} {SIZES[size]} {block ? 'w-full justify-center' : 'justify-center'} {klass}"
>
	{#if loading}<span aria-hidden="true" class="size-4 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent"></span>{:else}{@render icon?.()}{/if}
	<span>{@render children()}</span>
	{@render trailing?.()}
</button>
