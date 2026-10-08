<script lang="ts">
	import { X } from '@lucide/svelte';
	import { onDestroy, onMount } from 'svelte';
	// served from the app itself, so scanning works offline and calls no CDN
	import readerWasm from 'zxing-wasm/reader/zxing_reader.wasm?url';

	let { onresult, onclose }: { onresult: (text: string) => void; onclose: () => void } = $props();

	let video: HTMLVideoElement;
	let stream: MediaStream | null = null;
	let error = $state('');
	let stopped = false;
	let raf = 0;

	onMount(async () => {
		try {
			const { BarcodeDetector, prepareZXingModule } = await import('barcode-detector/ponyfill');
			prepareZXingModule({ overrides: { locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? readerWasm : prefix + path) } });
			const detector = new BarcodeDetector({ formats: ['qr_code'] });
			stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
			if (stopped) return stop();
			video.srcObject = stream;
			await video.play();
			let last = 0;
			const tick = async (t: number) => {
				if (stopped) return;
				if (t - last > 180 && video.readyState >= 2) {
					last = t;
					try {
						const text = (await detector.detect(video))[0]?.rawValue;
						if (text) {
							navigator.vibrate?.(30);
							stop();
							onresult(text);
							return;
						}
					} catch {
						/* keep scanning */
					}
				}
				raf = requestAnimationFrame(tick);
			};
			raf = requestAnimationFrame(tick);
		} catch (e) {
			error =
				(e as DOMException)?.name === 'NotAllowedError'
					? 'Camera access was blocked. Allow it in settings, or paste the code instead.'
					: 'The camera is not available. Paste the code instead.';
		}
	});

	function stop() {
		stopped = true;
		cancelAnimationFrame(raf);
		stream?.getTracks().forEach((t) => t.stop());
		stream = null;
	}

	onDestroy(stop);
</script>

<div class="fixed inset-0 z-[60] grid place-items-center bg-black" role="dialog" aria-modal="true" aria-label="Scan a QR code">
	<!-- svelte-ignore a11y_media_has_caption -->
	<video bind:this={video} playsinline muted class="absolute inset-0 h-full w-full object-cover"></video>
	<div class="relative aspect-square w-[min(70vw,280px)] rounded-card border-2 border-white/80 shadow-[0_0_0_100vmax_rgb(0_0_0/0.55)]"></div>
	<button
		class="glass absolute right-4 top-[max(1rem,env(safe-area-inset-top))] rounded-pill border border-glass-edge p-2.5 text-text"
		onclick={() => (stop(), onclose())}
		aria-label="Close scanner"><X size={20} /></button
	>
	<p class="absolute inset-x-6 bottom-[max(2.5rem,env(safe-area-inset-bottom))] text-center text-base text-white">
		{error || 'Scan a Secret address, an invoice or a Cosmos address'}
	</p>
</div>
