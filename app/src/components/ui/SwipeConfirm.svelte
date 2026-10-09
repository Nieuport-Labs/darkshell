<script lang="ts">
	// Slide to confirm: a square handle that has to be dragged all the way to
	// the right before a payment goes out. Released early, it springs back.
	// Keyboard and screen readers: the handle is a button; Enter/Space confirms.
	import { ChevronsRight, Loader2 } from '@lucide/svelte';

	let {
		label,
		onconfirm,
		disabled = false,
		loading = false,
	}: { label: string; onconfirm: () => void; disabled?: boolean; loading?: boolean } = $props();

	let track = $state<HTMLDivElement>();
	let x = $state(0);
	let dragging = $state(false);
	let done = $state(false);
	let startX = 0;
	let startOffset = 0;

	const HANDLE = 56; // px, size-14
	const PAD = 4;
	const max = () => (track ? Math.max(0, track.clientWidth - HANDLE - PAD * 2) : 0);
	const progress = $derived(max() > 0 ? x / max() : 0);

	// a finished swipe resets when the payment ends without leaving the screen (e.g. an error)
	$effect(() => {
		if (!loading && done) {
			done = false;
			x = 0;
		}
	});

	function down(e: PointerEvent) {
		if (disabled || loading || done) return;
		dragging = true;
		startX = e.clientX;
		startOffset = x;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}

	function move(e: PointerEvent) {
		if (!dragging) return;
		x = Math.max(0, Math.min(max(), startOffset + e.clientX - startX));
	}

	function up() {
		if (!dragging) return;
		dragging = false;
		if (max() > 0 && x >= max() * 0.9) confirm();
		else x = 0;
	}

	function confirm() {
		x = max();
		done = true;
		navigator.vibrate?.(20);
		onconfirm();
	}

	function key(e: KeyboardEvent) {
		if (disabled || loading || done) return;
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			confirm();
		}
	}
</script>

<div
	bind:this={track}
	class="relative h-16 w-full shrink-0 select-none overflow-hidden rounded-[1.25rem] bg-surface {disabled ? 'opacity-50' : ''}"
	style="touch-action: pan-y"
>
	<!-- the swept part fills in behind the handle -->
	<div class="absolute inset-y-0 left-0 rounded-[1.25rem] bg-accent-soft" style="width: {x + HANDLE + PAD * 2}px" aria-hidden="true"></div>
	<span
		class="pointer-events-none absolute inset-0 flex items-center justify-center pl-12 text-base font-medium text-text-muted"
		style="opacity: {Math.max(0, 1 - progress * 1.6)}"
		aria-hidden="true">{label}</span
	>
	<button
		type="button"
		aria-label={label}
		{disabled}
		onpointerdown={down}
		onpointermove={move}
		onpointerup={up}
		onpointercancel={up}
		onkeydown={key}
		class="absolute top-1 flex size-14 cursor-grab touch-none items-center justify-center rounded-2xl bg-accent-strong text-white shadow-lg active:cursor-grabbing disabled:bg-surface-3 disabled:text-text-faint"
		style="left: {PAD + x}px; transition: {dragging ? 'none' : 'left 280ms cubic-bezier(0.32, 0.72, 0, 1)'}"
	>
		{#if loading || done}<Loader2 size={22} class="animate-spin" />{:else}<ChevronsRight size={24} />{/if}
	</button>
</div>
