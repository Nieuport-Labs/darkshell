<script lang="ts">
	import qrcode from 'qrcode-generator';

	let { value, label = 'QR code', fill = false }: { value: string; label?: string; fill?: boolean } = $props();

	// level M, black on white — the same as Secret_Dashboard's invoice QR
	const svg = $derived.by(() => {
		const qr = qrcode(0, 'M');
		qr.addData(value, 'Byte');
		qr.make();
		return qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
	});
</script>

<div class="mx-auto w-full {fill ? 'rounded-[1.25rem] p-3.5' : 'max-w-[220px] rounded-card p-3'} bg-white [&_svg]:block [&_svg]:h-auto [&_svg]:w-full" role="img" aria-label={label}>
	{@html svg}
</div>
