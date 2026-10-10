<script lang="ts">
	// Port of Secret_Dashboard src/components/ui/Modal.tsx: a glass sheet,
	// bottom-aligned on a phone, centred on wider screens.
	import { ChevronLeft, X } from '@lucide/svelte';
	import type { Snippet } from 'svelte';
	import { fade, fly } from 'svelte/transition';
	import { cubicIn } from 'svelte/easing';

	let {
		title,
		description,
		onclose,
		onback,
		full = false,
		children,
	}: { title: string; description?: string; onclose?: () => void; onback?: () => void; full?: boolean; children: Snippet } = $props();

	function key(e: KeyboardEvent) {
		if (e.key === 'Escape') onclose?.();
	}
</script>

<svelte:window onkeydown={key} />

{#if full}
	<!-- a page of its own (Send, Receive): back on the left, title centred -->
	<div
		role="dialog"
		aria-modal="true"
		aria-label={title}
		out:fly|global={{ x: 28, duration: 200, easing: cubicIn, opacity: 0 }}
		class="fixed inset-0 z-50 flex flex-col bg-bg pb-safe pt-safe motion-safe:animate-[page-in_480ms_var(--ease-out-expo)]"
	>
		<header class="relative mx-auto flex h-14 w-full max-w-[460px] shrink-0 items-center justify-center px-4">
			{#if onback ?? onclose}
				<button type="button" onclick={onback ?? onclose} aria-label="Back" class="state-layer absolute left-2 rounded-pill p-2.5 text-text">
					<ChevronLeft size={22} aria-hidden="true" />
				</button>
			{/if}
			<h2 class="text-headline">{title}</h2>
		</header>
		<div class="stagger mx-auto flex w-full max-w-[460px] flex-1 flex-col gap-5 overflow-y-auto px-5 pb-4 pt-2 [&>*]:shrink-0" style="--stagger-delay: 60ms">
			{@render children()}
		</div>
	</div>
{:else}
<div class="fixed inset-0 z-50 flex items-end justify-center p-3 pb-safe sm:items-center">
	<button
		type="button"
		aria-label="Close"
		tabindex="-1"
		onclick={onclose}
		disabled={!onclose}
		in:fade|global={{ duration: 260 }}
		out:fade|global={{ duration: 200 }}
		class="absolute inset-0 bg-scrim backdrop-blur-sm"
	></button>
	<div
		role="dialog"
		aria-modal="true"
		aria-label={title}
		out:fly|global={{ y: 40, duration: 200, easing: cubicIn, opacity: 0 }}
		class="glass-panel stagger relative flex max-h-[calc(100dvh-2rem)] w-full max-w-[420px] flex-col gap-5 overflow-y-auto rounded-card p-5 [&>*]:shrink-0 outline-none motion-safe:animate-[modal-in_520ms_var(--ease-out-expo)]"
		style="--stagger-delay: 70ms"
	>
		<div class="flex shrink-0 items-start justify-between gap-4">
			<div class="flex min-w-0 items-center gap-3">
				{#if onback}
					<button type="button" onclick={onback} aria-label="Back" class="state-layer -m-1.5 shrink-0 rounded-pill p-1.5 text-text-muted">
						<ChevronLeft size={18} aria-hidden="true" />
					</button>
				{/if}
				<div class="min-w-0">
					<h2 class="break-words text-headline">{title}</h2>
					{#if description}<p class="mt-1 text-base text-text-muted">{description}</p>{/if}
				</div>
			</div>
			{#if onclose}
				<button type="button" onclick={onclose} aria-label="Close" class="state-layer -m-1.5 shrink-0 rounded-pill p-1.5 text-text-muted">
					<X size={18} aria-hidden="true" />
				</button>
			{/if}
		</div>
		{@render children()}
	</div>
</div>
{/if}
