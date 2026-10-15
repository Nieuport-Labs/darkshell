<script lang="ts">
	import { t } from '../../lib/i18n/index.svelte';
	// After Secret_Dashboard InvoiceModal, with an id (sent as the private memo)
	// and an expiry so DarkShell can tell when it has been paid.
	import { Check, Nfc, Share2, Trash2 } from '@lucide/svelte';
	import { untrack } from 'svelte';
	import { encodePaymentLink, encodePaymentUri, newInvoiceId, normalizeAmount, toBaseUnits, type PaymentRequest } from 'secret-pay';
	import { CHAIN_ID, PAY_LINK_ORIGIN, SSCRT_ADDRESS } from '../../lib/config';
	import { shareTarget } from '../../lib/pay/share';
	import { nfc, shareOverNfc } from '../../lib/nfc.svelte';
	import { addInvoice, invoices, loadInvoices, reconcile, removeInvoice, type IssuedInvoice } from '../../lib/pay/invoices.svelte';
	import { close, open } from '../../lib/ui.svelte';
	import { wallet } from '../../lib/wallet.svelte';
	import { haptic } from '../../lib/haptics';
	import Orb from '../ui/Orb.svelte';
	import AmountHero from '../ui/AmountHero.svelte';
	import Button from '../ui/Button.svelte';
	import Modal from '../ui/Modal.svelte';
	import { fiatValue } from '../../lib/price.svelte';
	import Qr from '../ui/Qr.svelte';

	let { fromReceive = false, id }: { fromReceive?: boolean; id?: string } = $props();

	let amount = $state('');
	let message = $state('');
	let expiry = $state(0);
	let shownId = $state<string | null>(untrack(() => id ?? null));
	// the link by default: a phone camera opens it (in DarkShell, through the dashboard's assetlinks); the URI is for a wallet's scanner
	let target = $state<'uri' | 'link'>(PAY_LINK_ORIGIN ? 'link' : 'uri');
	let copied = $state(false);

	$effect(() => {
		const history = wallet.history;
		const me = wallet.address;
		void loadInvoices().then(() => reconcile(history, me));
	});

	const valid = $derived.by(() => {
		const n = normalizeAmount(amount.replace(',', '.'));
		if (!n) return null;
		try {
			toBaseUnits(n, 6);
			return n;
		} catch {
			return null;
		}
	});

	const shown = $derived(shownId ? invoices.list.find((i) => i.request.id === shownId) : undefined);

	// while an unpaid invoice is open, a phone held to this one gets its link over NFC
	$effect(() => {
		const inv = shown;
		if (!inv || inv.status === 'paid' || inv.status === 'expired' || !nfc.enabled) return;
		return shareOverNfc(shareTarget(inv.request));
	});

	// paid while it is on screen: celebrate once
	let celebrate = $state(false);
	let seen: string | undefined;
	$effect(() => {
		const st = shown?.status;
		if (seen && seen !== 'paid' && st === 'paid') {
			celebrate = true;
			setTimeout(() => haptic.success(), 480);
		}
		seen = st;
	});

	async function create() {
		if (!valid) return;
		const req: PaymentRequest = {
			chain: CHAIN_ID,
			address: wallet.address,
			asset: SSCRT_ADDRESS,
			amount: valid,
			id: newInvoiceId(),
			...(expiry ? { exp: Math.floor(Date.now() / 1000) + expiry } : {}),
			...(message.trim() ? { message: message.trim() } : {}),
		};
		const inv = await addInvoice(req);
		shownId = inv.request.id!;
	}

	async function share(inv: IssuedInvoice) {
		const url = shareTarget(inv.request);
		try {
			if (navigator.share) return await navigator.share(url.startsWith('http') ? { title: t('Invoice {0}', { 0: inv.request.id }), url } : { title: t('Invoice {0}', { 0: inv.request.id }), text: url });
		} catch {
			return;
		}
		await navigator.clipboard.writeText(url).catch(() => {});
		copied = true;
		setTimeout(() => (copied = false), 1600);
	}

	const STATUS: Record<IssuedInvoice['status'], [string, string]> = {
		open: ['Waiting for payment', 'text-text-muted'],
		no_match: ['Waiting for payment', 'text-text-muted'],
		paid: ['Paid', 'text-positive'],
		underpaid: ['Partly paid', 'text-[#f5b544]'],
		late: ['Paid after it expired', 'text-[#f5b544]'],
		expired: ['Expired', 'text-negative'],
	};
	const EXPIRY: [number, string][] = [
		[3600, t('1 hour')],
		[86400, t('1 day')],
		[604800, t('1 week')],
		[0, t('Never')],
	];
</script>

{#if shown}
	<Modal full title={t('Invoice')} onclose={id ? close : () => (shownId = null)}>
		<div class="flex flex-col items-center gap-1 pt-2 text-center">
			<div class="flex items-baseline gap-2">
				<span class="text-[2.75rem] font-semibold leading-tight tracking-[-0.03em] tabular-nums">{shown.request.amount}</span>
				<span class="text-title text-text-muted">sSCRT</span>
			</div>
			{#if fiatValue(toBaseUnits(shown.request.amount ?? '0', 6))}<span class="-mt-1 text-base tabular-nums text-text-faint">≈ {fiatValue(toBaseUnits(shown.request.amount ?? '0', 6))}</span>{/if}
			<span class="inline-flex items-center gap-1.5 text-label {STATUS[shown.status][1]}">
				{#if shown.status === 'open' || shown.status === 'no_match'}<span class="live-dot" aria-hidden="true"></span>{/if}
				{t(STATUS[shown.status][0])}
			</span>
			{#if shown.request.message}<p class="mt-1 text-base text-text-muted">{shown.request.message}</p>{/if}
		</div>

		{#if shown.status === 'paid'}
			<div class="mx-auto my-3"><Orb state="done" still={!celebrate} label={t('Paid')} /></div>
			{#if celebrate}<p class="paid-note text-center text-base text-text-muted">{t('Payment received.')}</p>{/if}
		{:else}
			{#if PAY_LINK_ORIGIN}
			<div class="mx-auto flex rounded-pill bg-surface p-1 text-label" role="tablist">
				{#each [['uri', 'URI'], ['link', t('Link')]] as [k, l] (k)}
					<button role="tab" aria-selected={target === k} onclick={() => (target = k as 'uri' | 'link')} class="rounded-pill px-3 py-1 {target === k ? 'bg-accent-strong text-white' : 'text-text-muted'}"
						>{l}</button
					>
				{/each}
			</div>
			{/if}
			<div class="receive-qr mx-auto w-full max-w-[340px] [animation:none]"><Qr fill value={target === 'uri' ? encodePaymentUri(shown.request) : encodePaymentLink(PAY_LINK_ORIGIN, shown.request)} label={t('Invoice QR code')} /></div>
			{#if nfc.sharing}
				<p class="flex items-center justify-center gap-2 text-base text-text-muted">
					<span class="nfc-wave relative flex size-7 items-center justify-center text-accent"><Nfc size={18} aria-hidden="true" /></span>
					{t('Or hold their phone to the back of this one')}
				</p>
			{:else if nfc.canShare && !nfc.enabled}
				<p class="flex items-center justify-center gap-1.5 text-label text-text-faint"><Nfc size={15} /> {t('Turn on NFC to let a phone tap to pay')}</p>
			{/if}
		{/if}

		<p class="text-center text-label text-text-faint">
			<span class="font-mono">{shown.request.id}</span>{shown.request.exp ? t(' · valid until {0}', { 0: new Date(shown.request.exp * 1000).toLocaleString() }) : ''}
		</p>

		<div class="mt-auto flex items-center gap-3 pt-4">
			<Button block size="xl" class="flex-1" onclick={() => share(shown!)}>
				{#snippet icon()}{#if copied}<Check size={18} />{:else}<Share2 size={18} />{/if}{/snippet}
				{copied ? t('Copied') : t('Share invoice')}
			</Button>
			<button
				type="button"
				aria-label={t('Remove invoice')}
				onclick={() => removeInvoice(shown!.request.id!).then(() => (id ? close() : (shownId = null)))}
				class="state-layer flex size-14 shrink-0 items-center justify-center rounded-pill bg-surface-3 text-text-muted"
			>
				<Trash2 size={19} />
			</button>
		</div>
	</Modal>
{:else}
	<Modal full title={t('New invoice')} onclose={fromReceive ? () => open({ name: 'receive' }) : close}>
		<div class="flex flex-1 flex-col items-center justify-center">
			<AmountHero bind:amount symbol="sSCRT" fiat />
		</div>

		<input bind:value={message} maxlength="140" placeholder={t('What is it for? (optional)')} aria-label={t('Description')} class="rounded-pill bg-surface px-5 py-3.5 text-base outline-none placeholder:text-text-faint" />

		<div class="flex flex-col gap-1.5">
			<span class="px-5 text-label text-text-faint">{t('Valid for')}</span>
			<div class="grid grid-cols-4 gap-1 rounded-pill bg-surface p-1">
				{#each EXPIRY as [v, l] (v)}
					<button
						type="button"
						onclick={() => (expiry = v)}
						aria-pressed={expiry === v}
						class="state-layer rounded-pill py-2.5 text-label {expiry === v ? 'bg-text text-bg' : 'text-text-muted'}">{l}</button
					>
				{/each}
			</div>
		</div>

		<Button block size="xl" disabled={!valid} onclick={create}>{valid ? t('Ask for {0} sSCRT', { 0: valid }) : t('Enter an amount')}</Button>

	</Modal>
{/if}
