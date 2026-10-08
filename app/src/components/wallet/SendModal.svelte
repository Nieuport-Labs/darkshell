<script lang="ts">
	// After Secret_Dashboard src/components/wallet/SendPanel.tsx.
	import { ArrowLeftRight, Eye, ScanLine, ShieldCheck } from '@lucide/svelte';
	import { fromBaseUnits, toBaseUnits } from 'secret-pay';
	import { untrack } from 'svelte';
	import { BusyError, type TxOutcome } from '../../lib/chain/tx';
	import { SSCRT_ADDRESS } from '../../lib/config';
	import { formatAmount, shortAddress } from '../../lib/format';
	import { NoGasError } from '../../lib/gas/feePayer';
	import { classify, type Target } from '../../lib/pay/classify';
	import { assetOf, buildPlan, quoteFor, type QuoteState } from '../../lib/pay/plan';
	import { close, open, ui } from '../../lib/ui.svelte';
	import { pay, prefetchForPayment, wallet } from '../../lib/wallet.svelte';
	import AmountHero from '../ui/AmountHero.svelte';
	import Button from '../ui/Button.svelte';
	import Modal from '../ui/Modal.svelte';
	import TxResult from './TxResult.svelte';

	let { target: initial, raw: initialRaw = '' }: { target?: Target; raw?: string } = $props();

	let recipient = $state(untrack(() => initialRaw));
	let target = $state<Target | null>(untrack(() => initial ?? null));
	let amount = $state('');
	let memo = $state('');
	let showMemo = $state(false);
	let sending = $state(false);
	let failure = $state('');
	let outcome = $state<TxOutcome | null>(null);
	let quote = $state<QuoteState>({ kind: 'none' });

	const asset = $derived(target ? assetOf(target) : undefined);
	const symbol = $derived(asset?.symbol ?? 'sSCRT');
	const swapping = $derived(!!asset && asset.token.address !== SSCRT_ADDRESS);
	const base = $derived.by(() => {
		if (!amount || !asset) return null;
		try {
			const v = toBaseUnits(amount.replace(',', '.'), asset.decimals);
			return v > 0n ? v : null;
		} catch {
			return null;
		}
	});
	const spends = $derived(quote.kind === 'ready' ? quote.quote.amountIn : swapping ? null : base);
	const amountError = $derived(amount && base === null ? 'Enter a valid amount.' : spends !== null && wallet.balance !== null && spends > wallet.balance ? 'More than your balance.' : '');
	const recipientError = $derived(target?.kind === 'error' ? target.message : target && 'request' in target && target.request.address === wallet.address ? 'This is your own address.' : '');
	const ready = $derived(!!target && (target.kind === 'secret' || target.kind === 'ibc') && base !== null && !amountError && !recipientError && (!swapping || quote.kind === 'ready'));

	function read(value: string) {
		recipient = value;
		failure = '';
		if (!value.trim()) return (target = null);
		const t = classify(value);
		// a request with an amount is an invoice: pay it, don't edit it
		if (t.kind === 'secret' && t.request.amount !== undefined) return open({ name: 'pay', target: t, raw: value });
		if (t.kind === 'lightning') return open({ name: 'lightning', target: t });
		target = t;
		if (t.kind === 'secret' && (t.request.memo || t.request.id)) memo = t.request.memo ?? t.request.id ?? '';
	}

	// re-quote when a swap is needed and the amount changes
	let quoteSeq = 0;
	$effect(() => {
		const a = asset;
		const b = base;
		if (!swapping || !a || b === null) {
			quote = { kind: 'none' };
			return;
		}
		const seq = ++quoteSeq;
		quote = { kind: 'loading' };
		const t = setTimeout(() => void quoteFor(a, b).then((q) => seq === quoteSeq && (quote = q)), 400);
		return () => clearTimeout(t);
	});

	async function submit() {
		if (!ready || !target || base === null || sending) return;
		sending = true;
		failure = '';
		try {
			const plan = await buildPlan(target, base, memo.trim() || undefined, quote.kind === 'ready' ? quote.quote : undefined);
			outcome = await pay(plan, target.kind === 'ibc' ? 'ibc' : 'send', (p) => (outcome = p));
		} catch (e) {
			failure =
				e instanceof NoGasError
					? 'Nothing can pay the network fee: gas credits are empty. See Settings → Gas credits.'
					: e instanceof BusyError
						? e.message
						: e instanceof Error
							? e.message
							: String(e);
		} finally {
			sending = false;
		}
	}

	const label = $derived(
		!recipient.trim()
			? 'Enter a recipient'
			: !amount
				? 'Enter an amount'
				: target?.kind === 'ibc'
					? `Send SCRT to ${target.dest.name}`
					: `Send ${symbol}`,
	);

	prefetchForPayment();
</script>

<Modal full title="Send" onclose={close}>
	{#if outcome}
		<TxResult {outcome} summary="Sent {amount} {symbol} to {shortAddress(target && 'request' in target ? target.request.address : recipient.trim())}." ondone={close} />
	{:else}
		<div class="flex items-center gap-2 rounded-pill bg-surface py-1.5 pl-5 pr-1.5">
			<input
				value={recipient}
				oninput={(e) => read(e.currentTarget.value)}
				placeholder="Address or invoice"
				aria-label="Recipient"
				spellcheck="false"
				autocomplete="off"
				autocapitalize="none"
				class="min-w-0 flex-1 bg-transparent py-2 font-mono text-sm outline-none placeholder:font-sans placeholder:text-base placeholder:text-text-faint"
			/>
			<button type="button" class="state-layer flex size-10 shrink-0 items-center justify-center rounded-pill bg-surface-3" aria-label="Scan QR code" onclick={() => (ui.scanning = true)}>
				<ScanLine size={18} />
			</button>
		</div>
		{#if recipientError}<p class="-mt-3 px-5 text-label text-negative" role="alert">{recipientError}</p>{/if}

		<div class="flex flex-1 flex-col items-center justify-center gap-2">
			<AmountHero bind:amount {symbol} fiat={symbol === 'sSCRT'} max={swapping ? undefined : () => wallet.balance !== null && (amount = fromBaseUnits(wallet.balance, 6))} />
			<p class="text-label text-text-faint">
				{#if quote.kind === 'ready'}≈ {formatAmount(quote.quote.amountIn)} sSCRT via ShadeSwap
				{:else if quote.kind === 'loading'}Finding a price…
				{:else if quote.kind === 'unavailable'}No ShadeSwap route to {symbol}
				{:else}{formatAmount(wallet.balance)} sSCRT available{/if}
			</p>
			{#if amountError}<p class="text-label text-negative" role="alert">{amountError}</p>{/if}
			{#if target}
				<span class="mt-1 inline-flex items-center gap-1.5 rounded-pill bg-surface px-3 py-1 text-label text-text-muted">
					{#if target.kind === 'ibc'}<ArrowLeftRight size={12} /> Public · to {target.dest.name}
					{:else if target.kind === 'secret' && !target.asset.private}<Eye size={12} /> Public {target.asset.symbol}
					{:else}<ShieldCheck size={12} class="text-accent" /> Private{/if}
				</span>
			{/if}
		</div>

		{#if target?.kind !== 'ibc'}
			{#if showMemo || memo}
				<input bind:value={memo} maxlength="256" placeholder="Private memo" aria-label="Memo" class="rounded-pill bg-surface px-5 py-3 text-base outline-none placeholder:text-text-faint" />
			{:else}
				<button type="button" onclick={() => (showMemo = true)} class="self-center text-label text-text-muted">+ Add memo</button>
			{/if}
		{/if}

		{#if failure}<p class="break-address text-base text-negative" role="alert">{failure}</p>{/if}

		<Button block size="xl" loading={sending} disabled={!ready} onclick={submit}>{label}</Button>
	{/if}
</Modal>
