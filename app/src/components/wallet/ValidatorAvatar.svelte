<script lang="ts">
	// A validator's initials on a tint derived from its address: stable, and no
	// lookup to a third-party profile service.
	let { address, name, size = 40 }: { address: string; name: string; size?: number } = $props();

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
	class="flex shrink-0 items-center justify-center rounded-pill font-semibold"
	style="width:{size}px;height:{size}px;font-size:{Math.round(size * 0.36)}px;background:hsl({hue} 45% 22%);color:hsl({hue} 80% 78%)"
	aria-hidden="true">{initials}</span
>
