<script lang="ts">
	// After Secret_Dashboard InvoiceModal, with an id (sent as the private memo)
	// and an expiry so DarkShell can tell when it has been paid.
	import { Check, Share2, Trash2 } from '@lucide/svelte';
	import { untrack } from 'svelte';
	import { encodePaymentLink, encodePaymentUri, newInvoiceId, normalizeAmount, toBaseUnits, type PaymentRequest } from 'secret-pay';
	import { CHAIN_ID, PAY_LINK_ORIGIN, SSCRT_ADDRESS } from '../../lib/config';
	import { shareTarget } from '../../lib/pay/share';
	import { addInvoice, invoices, loadInvoices, reconcile, removeInvoice, type IssuedInvoice } from '../../lib/pay/invoices.svelte';
	import { close, open } from '../../lib/ui.svelte';
	import { wallet } from '../../lib/wallet.svelte';
	import AmountHero from '../ui/AmountHero.svelte';
	import Button from '../ui/Button.svelte';
	import Modal from '../ui/Modal.svelte';
	import { usdValue } from '../../lib/price.svelte';
	import Qr from '../ui/Qr.svelte';

	let { fromReceive = false, id }: { fromReceive?: boolean; id?: string } = $props();

	let amount = $state('');
	let message = $state('');
	let expiry = $state(0);
	let shownId = $state<string | null>(untrack(() => id ?? null));
	let target = $state<'uri' | 'link'>('uri');
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

	// paid while it is on screen: celebrate once
	let celebrate = $state(false);
	let seen: string | undefined;
	$effect(() => {
		const st = shown?.status;
		if (seen && seen !== 'paid' && st === 'paid') {
			celebrate = true;
			navigator.vibrate?.([30, 60, 30]);
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
			if (navigator.share) return await navigator.share(url.startsWith('http') ? { title: `Invoice ${inv.request.id}`, url } : { title: `Invoice ${inv.request.id}`, text: url });
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
		[3600, '1 hour'],
		[86400, '1 day'],
		[604800, '1 week'],
		[0, 'Never'],
	];
</script>

{#if shown}
	<Modal full title="Invoice" onclose={id ? close : () => (shownId = null)}>
		<div class="flex flex-col items-center gap-1 pt-2 text-center">
			<div class="flex items-baseline gap-2">
				<span class="text-[2.75rem] font-semibold leading-tight tracking-[-0.03em] tabular-nums">{shown.request.amount}</span>
				<span class="text-title text-text-muted">sSCRT</span>
			</div>
			{#if usdValue(toBaseUnits(shown.request.amount ?? '0', 6))}<span class="-mt-1 text-base tabular-nums text-text-faint">≈ {usdValue(toBaseUnits(shown.request.amount ?? '0', 6))}</span>{/if}
			<span class="inline-flex items-center gap-1.5 text-label {STATUS[shown.status][1]}">
				{#if shown.status === 'open' || shown.status === 'no_match'}<span class="live-dot" aria-hidden="true"></span>{/if}
				{STATUS[shown.status][0]}
			</span>
			{#if shown.request.message}<p class="mt-1 text-base text-text-muted">{shown.request.message}</p>{/if}
		</div>

		{#if shown.status === 'paid'}
			<div class="paid-mark {celebrate ? 'is-new' : ''}" role="img" aria-label="Paid">
				<span class="paid-ring"></span>
				<svg viewBox="0 0 52 52" class="size-full" aria-hidden="true">
					<circle cx="26" cy="26" r="24" class="paid-disc" />
					<path d="M15 27l7 7 15-16" class="paid-check" />
				</svg>
			</div>
			{#if celebrate}<p class="paid-note text-center text-base text-text-muted">Payment received.</p>{/if}
		{:else}
			{#if PAY_LINK_ORIGIN}
			<div class="mx-auto flex rounded-pill bg-surface p-1 text-label" role="tablist">
				{#each [['uri', 'URI'], ['link', 'Link']] as [k, l] (k)}
					<button role="tab" aria-selected={target === k} onclick={() => (target = k as 'uri' | 'link')} class="rounded-pill px-3 py-1 {target === k ? 'bg-accent-strong text-white' : 'text-text-muted'}"
						>{l}</button
					>
				{/each}
			</div>
			{/if}
			<div class="mx-auto w-full max-w-[340px]"><Qr fill value={target === 'uri' ? encodePaymentUri(shown.request) : encodePaymentLink(PAY_LINK_ORIGIN, shown.request)} label="Invoice QR code" /></div>
		{/if}

		<p class="text-center text-label text-text-faint">
			<span class="font-mono">{shown.request.id}</span>{shown.request.exp ? ` · valid until ${new Date(shown.request.exp * 1000).toLocaleString()}` : ''}
		</p>

		<div class="mt-auto flex items-center gap-3 pt-4">
			<Button block size="xl" class="flex-1" onclick={() => share(shown!)}>
				{#snippet icon()}{#if copied}<Check size={18} />{:else}<Share2 size={18} />{/if}{/snippet}
				{copied ? 'Copied' : 'Share invoice'}
			</Button>
			<button
				type="button"
				aria-label="Remove invoice"
				onclick={() => removeInvoice(shown!.request.id!).then(() => (id ? close() : (shownId = null)))}
				class="state-layer flex size-14 shrink-0 items-center justify-center rounded-pill bg-surface-3 text-text-muted"
			>
				<Trash2 size={19} />
			</button>
		</div>
	</Modal>
{:else}
	<Modal full title="New invoice" onclose={fromReceive ? () => open({ name: 'receive' }) : close}>
		<div class="flex flex-1 flex-col items-center justify-center">
			<AmountHero bind:amount symbol="sSCRT" fiat />
		</div>

		<input bind:value={message} maxlength="140" placeholder="What is it for? (optional)" aria-label="Description" class="rounded-pill bg-surface px-5 py-3.5 text-base outline-none placeholder:text-text-faint" />

		<div class="flex flex-col gap-1.5">
			<span class="px-5 text-label text-text-faint">Valid for</span>
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

		<Button block size="xl" disabled={!valid} onclick={create}>{valid ? `Ask for ${valid} sSCRT` : 'Enter an amount'}</Button>

	</Modal>
{/if}
