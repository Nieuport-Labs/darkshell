<script lang="ts">
	// 6-digit PIN entry: dots + numeric keypad. Keys fire on pointerdown (the
	// moment a finger lands, not when it lifts), so fast typing never drops a
	// digit; the pressed look is a short flash we control instead of :active /
	// :hover, which stick on touch screens. Calls `oncomplete` on the 6th digit;
	// the parent clears the entry (via `reset`) after a wrong PIN.
	import { Delete } from '@lucide/svelte';
	import type { Snippet } from 'svelte';

	let {
		title,
		subtitle = '',
		error = '',
		busy = false,
		oncomplete,
		reset = $bindable(0),
		aux,
	}: { title: string; subtitle?: string; error?: string; busy?: boolean; oncomplete: (pin: string) => void; reset?: number; aux?: Snippet } = $props();

	const LENGTH = 6;
	const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'] as const;
	let pin = $state('');
	let shake = $state(false);
	let pressed = $state<string | null>(null);
	let flashTimer: ReturnType<typeof setTimeout> | undefined;

	// any change of `reset` from outside clears the entry
	$effect(() => {
		void reset;
		pin = '';
	});
	$effect(() => {
		if (!error) return;
		shake = true;
		navigator.vibrate?.([40, 60, 40]);
		const t = setTimeout(() => (shake = false), 400);
		return () => clearTimeout(t);
	});

	function flash(k: string) {
		pressed = k;
		clearTimeout(flashTimer);
		flashTimer = setTimeout(() => (pressed = null), 140);
	}

	function hit(k: string) {
		if (!k || busy) return;
		flash(k);
		navigator.vibrate?.(8);
		if (k === 'del') {
			pin = pin.slice(0, -1);
			return;
		}
		if (pin.length >= LENGTH) return;
		pin += k;
		if (pin.length === LENGTH) {
			const done = pin;
			// let the last dot fill before the (slow) PIN check starts
			requestAnimationFrame(() => requestAnimationFrame(() => oncomplete(done)));
		}
	}

	let lastPointer = 0;

	function down(e: PointerEvent, k: string) {
		if (e.button !== 0) return;
		e.preventDefault(); // no focus ring, no text selection
		lastPointer = Date.now();
		hit(k);
	}

	// Keyboard only (Enter/Space on a focused key). Android WebView follows every
	// touch with a click that can look keyboard-made, so any click shortly after
	// a pointerdown is the same press and is ignored.
	function click(e: MouseEvent, k: string) {
		const pointerType = (e as PointerEvent).pointerType;
		if (Date.now() - lastPointer < 800 || (pointerType && pointerType !== '')) return;
		hit(k);
	}

	function key(e: KeyboardEvent) {
		if (/^[0-9]$/.test(e.key)) hit(e.key);
		else if (e.key === 'Backspace') hit('del');
	}
</script>

<svelte:window onkeydown={key} />

<div class="flex flex-1 flex-col items-center">
	<div class="flex flex-col items-center gap-2 pt-4 text-center">
		<h1 class="text-headline">{title}</h1>
		{#if subtitle}<p class="max-w-[30ch] text-base text-text-muted">{subtitle}</p>{/if}
	</div>

	<div class="mt-8 flex gap-4 {shake ? 'animate-[shake_400ms_var(--ease-standard)]' : ''}" aria-label="{pin.length} of {LENGTH} digits entered" role="status">
		{#each Array(LENGTH) as _, i (i)}
			<span class="size-4 rounded-pill border-2 transition-colors duration-75 {i < pin.length ? 'border-accent bg-accent' : 'border-border-strong bg-transparent'}"></span>
		{/each}
	</div>
	<p class="mt-4 min-h-5 text-base {error ? 'text-negative' : 'text-text-muted'}" role="alert">
		{#if busy}Checking…{:else}{error}{/if}
	</p>

	<div class="mt-auto grid w-full max-w-[340px] grid-cols-3 gap-x-4 gap-y-2 pb-3">
		{#each KEYS as k (k || 'blank')}
			{#if k === ''}
				<span class="flex items-center justify-center">{#if aux}{@render aux()}{/if}</span>
			{:else}
				<button
					type="button"
					aria-label={k === 'del' ? 'Delete' : k}
					onpointerdown={(e) => down(e, k)}
					onclick={(e) => click(e, k)}
					oncontextmenu={(e) => e.preventDefault()}
					class="mx-auto flex size-[4.75rem] touch-none select-none items-center justify-center rounded-pill text-[2.125rem] font-medium tabular-nums outline-none transition-[background-color,transform] duration-75 [-webkit-touch-callout:none] [-webkit-tap-highlight-color:transparent] focus-visible:ring-2 focus-visible:ring-accent
						{k === 'del' ? 'text-text-muted' : 'text-text'}
						{pressed === k ? 'scale-95 bg-surface-3' : 'bg-transparent'}"
				>
					{#if k === 'del'}<Delete size={28} />{:else}{k}{/if}
				</button>
			{/if}
		{/each}
	</div>
</div>
