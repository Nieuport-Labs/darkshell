<script lang="ts">
	// Full-screen receive page (Vizor/Zashi style): one QR asking for private
	// sSCRT, the account, share. While it is open, a phone held to this one gets
	// the address over NFC (an amount-less link: the payer's wallet asks how much).
	import { Check, Copy, Nfc, ReceiptText, Share2 } from '@lucide/svelte';
	import { encodePaymentUri, formatShort, type PaymentRequest } from 'secret-pay';
	import { CHAIN_ID, SSCRT_ADDRESS } from '../../lib/config';
	import { shortAddress } from '../../lib/format';
	import { nfc, shareOverNfc } from '../../lib/nfc.svelte';
	import { shareTarget } from '../../lib/pay/share';
	import { close, open } from '../../lib/ui.svelte';
	import { activeName, wallet } from '../../lib/wallet.svelte';
	import Modal from '../ui/Modal.svelte';
	import Qr from '../ui/Qr.svelte';

	let copied = $state(false);

	const req: PaymentRequest = $derived({ chain: CHAIN_ID, address: wallet.address, asset: SSCRT_ADDRESS });

	$effect(() => {
		if (!nfc.enabled || !wallet.address) return;
		return shareOverNfc(shareTarget(req));
	});

	async function copy() {
		try {
			await navigator.clipboard.writeText(wallet.address);
			copied = true;
			setTimeout(() => (copied = false), 1600);
		} catch {
			/* clipboard blocked */
		}
	}

	async function share() {
		const text = shareTarget(req);
		try {
			if (navigator.share) {
				return await navigator.share(text.startsWith('http') ? { title: 'My sSCRT address', text: formatShort(req), url: text } : { title: 'My address', text });
			}
		} catch {
			return;
		}
		await copy();
	}
</script>

<Modal full title="Receive sSCRT" onclose={close}>
	<div class="mx-auto mt-4 w-full max-w-[340px] [animation:none]">
		<Qr fill value={encodePaymentUri(req)} label="QR code asking for sSCRT" />
	</div>

	<div class="flex flex-col items-center gap-1.5 text-center">
		<p class="text-title font-medium">{activeName()}</p>
		<button type="button" onclick={copy} class="font-mono text-base text-text-muted">{shortAddress(wallet.address, 12, 10)}</button>
	</div>

	{#if nfc.sharing}
		<p class="nfc-hint flex items-center justify-center gap-2 text-base text-text-muted">
			<span class="nfc-wave relative flex size-7 items-center justify-center text-accent"><Nfc size={18} aria-hidden="true" /></span>
			Or hold their phone to the back of this one
		</p>
	{:else if nfc.canShare && !nfc.enabled}
		<p class="flex items-center justify-center gap-1.5 text-label text-text-faint"><Nfc size={15} aria-hidden="true" /> Turn on NFC to share it by tapping phones</p>
	{/if}

	<div class="mt-auto flex flex-col items-center gap-3 pt-4">
		<div class="flex w-full items-center gap-3">
			<button type="button" onclick={share} class="state-layer flex h-14 flex-1 items-center justify-center gap-2.5 rounded-pill bg-text text-base font-medium text-bg">
				<Share2 size={19} aria-hidden="true" />
				Share address
			</button>
			<button
				type="button"
				onclick={() => open({ name: 'invoice', fromReceive: true })}
				aria-label="Create invoice"
				class="state-layer flex size-14 shrink-0 items-center justify-center rounded-pill bg-surface-3 text-text"
			>
				<ReceiptText size={20} aria-hidden="true" />
			</button>
		</div>
		<button type="button" onclick={copy} class="state-layer flex items-center gap-2 rounded-pill px-4 py-2.5 text-base font-medium">
			{#if copied}<Check size={18} class="text-positive" aria-hidden="true" /> Copied{:else}<Copy size={18} aria-hidden="true" /> Copy address{/if}
		</button>
	</div>
</Modal>
