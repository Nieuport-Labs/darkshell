<script lang="ts">
	// A validator's Keybase picture; its initials on a tint derived from its
	// address while that loads, or when it has none.
	import { validatorImage } from '../../lib/validatorImage';

	let { address, name, identity, size = 40 }: { address: string; name: string; identity?: string; size?: number } = $props();

	let src = $state<string | null>(null);
	let failed = $state(false);
	$effect(() => {
		const id = identity;
		src = null;
		failed = false;
		let live = true;
		void validatorImage(id).then((u) => live && (src = u));
		return () => (live = false);
	});

	const hue = $derived([...address].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7));
	const initials = $derived(
		name
			.replace(/[^\p{L}\p{N} ]/gu, ' ')
			.trim()
			.split(/\s+/)
			.slice(0, 2)
			.map((w) => w[0] ?? '')
			.join('')
			.toUpperCase() || '?',
	);
</script>

<span
	class="relative flex shrink-0 items-center justify-center overflow-hidden rounded-pill font-semibold"
	style="width:{size}px;height:{size}px;font-size:{Math.round(size * 0.36)}px;background:hsl({hue} 45% 22%);color:hsl({hue} 80% 78%)"
	aria-hidden="true"
>
	{initials}
	{#if src && !failed}
		<img {src} alt="" loading="lazy" referrerpolicy="no-referrer" onerror={() => (failed = true)} class="absolute inset-0 size-full object-cover" />
	{/if}
</span>
