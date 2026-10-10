<script lang="ts">
	// The payment sheet (android PayActivity): a web page or another app asked for
	// a payment, and this slides up over it, like Google Pay. The figure that
	// matters most is first and largest: the sSCRT this payment spends. Confirm
	// asks for the fingerprint (or the PIN), which also opens the wallet for
	// this one payment; then it pays, says so, and goes back to the caller.
	import { App } from '@capacitor/app';
	import { ChevronDown, Eye, Fingerprint, Loader2, ShieldCheck, X } from '@lucide/svelte';
	import { onMount, untrack } from 'svelte';
	import Button from './components/ui/Button.svelte';
	import PinPad from './components/ui/PinPad.svelte';
	import { readClient, resetEndpoint } from './lib/chain/client';
	import { biometricEnabled, biometricInvalidated, confirmPin, disableBiometric } from './lib/crypto/biometric';
	import { WrongPasswordError } from './lib/crypto/vault';
	import { formatAmount, shortAddress, splitAmount } from './lib/format';
	import { classify } from './lib/pay/classify';
	import { blockReason, failureText, invoiceFacts, payInvoice, sscrtCost, type InvoiceFacts, type InvoiceTarget } from './lib/pay/invoicePay';
	import { quoteFor, type QuoteState } from './lib/pay/plan';
	import { fitsSheet, leaveSheet, openInApp, type SheetRequest } from './lib/pay/sheet';
	import { startPrice, usdValue } from './lib/price.svelte';
	import { initTor, tor, torReady } from './lib/tor.svelte';
	import { init, loadForPayment, lock, LockedOutError, spendable, unlock, wallet } from './lib/wallet.svelte';

	let { request }: { request: SheetRequest } = $props();
	const req = untrack(() => request);

	type Phase = 'loading' | 'review' | 'pin' | 'paying' | 'done';
	let phase = $state<Phase>('loading');
	let shown = $state(false);
	let target = $state<InvoiceTarget | null>(null);
	let facts = $state<InvoiceFacts | null>(null);
	let quote = $state<QuoteState>({ kind: 'none' });
	/** a new price arrived: Confirm waits a moment so the new figure is seen */
	let settling = $state(false);
	let failure = $state('');
	let step = $state('');
	let bio = $state(false);
	let pinError = $state('');
	let pinReset = $state(0);
	let password = $state('');
	let details = $state(false);
	let paidHash = '';

	const cost = $derived(facts ? sscrtCost(facts, quote) : null);
	const parts = $derived(splitAmount(cost));
	const why = $derived(target && facts ? blockReason(target, facts, quote, null) : '');
	const canConfirm = $derived(phase === 'review' && cost !== null && !why && !settling);
	/** not enough money: trying again won't help */
	const short = $derived(failure.startsWith('Not enough'));
	const payee = $derived(target ? (target.request.label ?? shortAddress(target.request.address, 10, 6)) : '');

	async function requote() {
		if (!target || !facts?.swapping) return;
		const before = cost;
		const q = await quoteFor(target.asset, facts.amount, await readClient());
		if (phase !== 'review') return;
		quote = q;
		if (before !== null && q.kind === 'ready' && q.quote.amountIn !== before) {
			settling = true;
			setTimeout(() => (settling = false), 1500);
		}
	}

	onMount(() => {
		document.documentElement.classList.add('pay-sheet');
		void initTor(() => resetEndpoint());
		startPrice();
		const back = App.addListener('backButton', () => cancel());
		let timer: ReturnType<typeof setInterval> | undefined;

		void (async () => {
			await init();
			if (wallet.phase === 'onboarding') return openInApp(req.url);
			const t = classify(req.url);
			if (!fitsSheet(t)) return openInApp(req.url);
			target = t;
			facts = invoiceFacts(t);
			bio = wallet.kind === 'pin' && (await biometricEnabled().catch(() => false));
			phase = 'review';
			requestAnimationFrame(() => (shown = true));
			if (facts.swapping) {
				quote = { kind: 'loading' };
				await requote();
				// a swap price is only good for a while: keep it fresh while the sheet is open
				timer = setInterval(() => void requote(), 30_000);
			}
		})();

		return () => {
			clearInterval(timer);
			void back.then((h) => h.remove());
		};
	});

	async function confirm() {
		if (!canConfirm) return;
		failure = '';
		if (!bio) {
			phase = 'pin';
			return;
		}
		try {
			const pin = await confirmPin('Confirm payment', `${formatAmount(cost)} sSCRT to ${payee}`);
			await payWith(pin);
		} catch (e) {
			if (biometricInvalidated(e)) {
				await disableBiometric();
				bio = false;
				pinError = 'Fingerprints changed on this phone. Enter your PIN.';
			}
			// cancelled or "Use PIN"
			if (phase === 'review') phase = 'pin';
		}
	}

	async function payWith(secret: string) {
		if (!target || !facts || phase === 'paying') return;
		const t = target;
		const f = facts;
		const from = phase;
		phase = 'paying';
		step = 'Opening your wallet…';
		try {
			await unlock(secret, { brief: true });
		} catch (e) {
			phase = from === 'review' ? 'pin' : from;
			pinError = e instanceof LockedOutError ? e.message : e instanceof WrongPasswordError ? (wallet.kind === 'pin' ? 'Wrong PIN.' : 'Wrong password.') : failureText(e);
			pinReset++;
			return;
		}
		try {
			step = 'Checking your balance…';
			await loadForPayment();
			const no = blockReason(t, f, quote, spendable());
			if (no) throw new Error(no === 'Not enough sSCRT.' ? `Not enough sSCRT: this needs ${formatAmount(cost)} and the account can spend ${formatAmount(spendable())}.` : no);
			step = 'Paying…';
			const out = await payInvoice(t, f, quote, () => (step = 'Waiting for the block…'));
			paidHash = out.hash;
			phase = 'done';
			setTimeout(() => void finish(), 1800);
		} catch (e) {
			failure = failureText(e);
			lock();
			phase = 'review';
		}
	}

	async function finish() {
		lock();
		await leaveSheet(req, target, 'paid', paidHash);
	}

	function cancel() {
		if (phase === 'paying') return;
		if (phase === 'done') return void finish();
		if (phase === 'pin') {
			phase = 'review';
			return;
		}
		lock();
		shown = false;
		setTimeout(() => void leaveSheet(req, target, 'cancelled'), 180);
	}

	function submitPassword(e: SubmitEvent) {
		e.preventDefault();
		if (password) void payWith(password);
	}
</script>

{#snippet fingerprint()}<Fingerprint size={20} />{/snippet}

<div class="fixed inset-0 flex flex-col justify-end">
	<button
		type="button"
		aria-label="Cancel payment"
		tabindex="-1"
		onclick={cancel}
		class="absolute inset-0 bg-scrim transition-opacity duration-300 {shown ? 'opacity-100' : 'opacity-0'}"
	></button>

	{#if phase === 'loading'}
		<div class="relative mx-auto mb-10 flex items-center gap-2 rounded-pill bg-bg px-4 py-2 text-base text-text-muted">
			<Loader2 size={16} class="animate-spin" /> Opening DarkShell…
		</div>
	{:else}
		<div
			role="dialog"
			aria-modal="true"
			aria-label="Confirm payment"
			class="relative mx-auto flex max-h-[92dvh] w-full max-w-[560px] flex-col overflow-y-auto rounded-t-[1.75rem] border-t border-border bg-bg px-5 pb-safe shadow-[0_-12px_40px_rgb(0_0_0/0.45)] transition-transform duration-[420ms] ease-[cubic-bezier(0.32,0.72,0,1)] {shown
				? 'translate-y-0'
				: 'translate-y-full'}"
		>
			<div class="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-pill bg-border-strong"></div>

			<header class="flex items-center gap-2.5 pt-3">
				<img src="/avatar.webp" alt="" class="size-7 rounded-pill object-cover" />
				<span class="flex-1 text-base font-medium">DarkShell</span>
				{#if tor.enabled && !torReady()}<span class="text-label text-text-faint">Connecting through Tor…</span>{/if}
				{#if phase !== 'paying' && phase !== 'done'}
					<button type="button" onclick={cancel} aria-label="Cancel" class="state-layer -mr-1.5 rounded-pill p-1.5 text-text-muted"><X size={20} /></button>
				{/if}
			</header>

			{#if phase === 'pin'}
				<div class="flex min-h-[540px] flex-col">
					{#if wallet.kind === 'pin'}
						<PinPad title="Enter your PIN" subtitle="to pay {formatAmount(cost)} sSCRT" error={pinError} bind:reset={pinReset} oncomplete={payWith}>
							{#snippet aux()}
								{#if bio}
									<button
										type="button"
										aria-label="Use fingerprint"
										onclick={() => {
											phase = 'review';
											void confirm();
										}}
										class="flex size-[4.75rem] items-center justify-center rounded-pill text-accent outline-none [-webkit-tap-highlight-color:transparent]"
									>
										<Fingerprint size={30} />
									</button>
								{/if}
							{/snippet}
						</PinPad>
					{:else}
						<form class="mt-8 flex flex-col gap-3" onsubmit={submitPassword}>
							<h1 class="text-center text-headline">Enter your password</h1>
							<p class="text-center text-base text-text-muted">to pay {formatAmount(cost)} sSCRT</p>
							<!-- svelte-ignore a11y_autofocus -->
							<input type="password" autocomplete="current-password" autofocus bind:value={password} class="field-input" aria-label="Password" />
							{#if pinError}<p class="text-base text-negative" role="alert">{pinError}</p>{/if}
							<Button type="submit" block size="lg">Pay</Button>
						</form>
					{/if}
				</div>
			{:else if target && facts}
				<!-- what it costs: the figure that matters -->
				<div class="flex flex-col items-center pb-2 pt-7 text-center">
					{#if phase === 'done'}
						<div class="paid-mark is-new mb-3 !size-20" role="img" aria-label="Paid">
							<span class="paid-ring"></span>
							<svg viewBox="0 0 52 52" class="size-full" aria-hidden="true">
								<circle cx="26" cy="26" r="24" class="paid-disc" />
								<path d="M15 27l7 7 15-16" class="paid-check" />
							</svg>
						</div>
					{/if}
					{#if cost === null}
						<span class="flex h-[3.75rem] items-center gap-2 text-base text-text-muted"><Loader2 size={18} class="animate-spin" /> Getting the price…</span>
					{:else}
						<p class="flex items-baseline justify-center tabular-nums" aria-label="{formatAmount(cost)} sSCRT">
							<span class="{parts.int.length > 6 ? 'text-[2.75rem]' : 'text-[3.5rem]'} font-semibold leading-none tracking-[-0.035em]">{parts.int}</span>
							{#if parts.frac}<span class="text-[1.5rem] font-semibold tracking-[-0.02em] text-text-faint">.{parts.frac}</span>{/if}
							<span class="ml-2 text-title text-text-muted">sSCRT</span>
						</p>
					{/if}
					<p class="mt-2 min-h-6 text-base tabular-nums text-text-faint">
						{#if phase === 'done'}Paid{:else if usdValue(cost)}≈ {usdValue(cost)}{/if}
					</p>
					<p class="text-base text-text-muted">to <span class="font-medium text-text">{payee}</span></p>
				</div>

				{#if why || failure}
					<p class="mt-3 break-words text-center text-base text-negative" role="alert">{why || failure}</p>
				{/if}

				<div class="flex flex-col gap-2 pb-4 pt-6">
					{#if phase === 'done'}
						<p class="text-center text-base text-text-muted">{facts.returnHost && !req.forResult ? `Taking you back to ${facts.returnHost}…` : 'Done.'}</p>
					{:else if phase === 'paying'}
						<Button block size="xl" loading disabled>{step}</Button>
					{:else if short}
						<Button block size="xl" variant="secondary" onclick={cancel}>Close</Button>
					{:else}
						<Button block size="xl" disabled={!canConfirm} onclick={confirm} icon={bio ? fingerprint : undefined}>
							{settling ? 'Price updated' : failure ? 'Try again' : 'Confirm'}
						</Button>
					{/if}
					{#if phase !== 'done'}
						<button
							type="button"
							onclick={() => (details = !details)}
							aria-expanded={details}
							class="mx-auto flex items-center gap-1 rounded-pill px-3 py-2 text-label text-text-muted outline-none [-webkit-tap-highlight-color:transparent]"
						>
							Details <ChevronDown size={14} class="transition-transform duration-200 {details ? 'rotate-180' : ''}" />
						</button>
					{/if}
				</div>

				{#if details && phase !== 'done'}
					<dl class="mb-4 flex flex-col divide-y divide-border rounded-card border border-border bg-surface text-base">
						<div class="flex flex-col gap-1 px-4 py-3">
							<div class="flex justify-between gap-4">
								<dt class="text-text-muted">To</dt>
								{#if target.request.label}<dd class="min-w-0 truncate font-medium">{target.request.label}</dd>{/if}
							</div>
							<dd class="break-address font-mono text-xs leading-5 text-text-faint">{target.request.address}</dd>
							{#if target.request.label}<dd class="text-label text-text-faint">The name is what the payee wrote; the address is where the money goes.</dd>{/if}
						</div>
						{#if facts.swapping}
							<div class="flex justify-between gap-4 px-4 py-3">
								<dt class="text-text-muted">They receive</dt>
								<dd class="min-w-0 text-right">
									{target.request.amount} {target.asset.symbol}
									<span class="block text-label text-text-faint">swapped on ShadeSwap{quote.kind === 'ready' ? `, up to ${Number(quote.quote.slippageBps) / 100}% slippage` : ''}</span>
								</dd>
							</div>
						{/if}
						{#if target.request.message}
							<div class="flex justify-between gap-4 px-4 py-3">
								<dt class="text-text-muted">Note</dt>
								<dd class="min-w-0 text-right">{target.request.message}</dd>
							</div>
						{/if}
						{#if facts.memo}
							<div class="flex justify-between gap-4 px-4 py-3">
								<dt class="text-text-muted">Reference</dt>
								<dd class="min-w-0 break-all text-right font-mono text-xs leading-6">{facts.memo}</dd>
							</div>
						{/if}
						<div class="flex justify-between gap-4 px-4 py-3">
							<dt class="text-text-muted">Transfer</dt>
							<dd class="flex items-center gap-1.5 text-right">
								{#if target.asset.private}<ShieldCheck size={14} class="text-accent" /> Private{:else}<Eye size={14} /> Public{/if}
							</dd>
						</div>
						<div class="flex justify-between gap-4 px-4 py-3">
							<dt class="text-text-muted">Network fee</dt>
							<dd class="text-right">From gas credits</dd>
						</div>
						{#if facts.returnHost && !req.forResult}
							<div class="flex justify-between gap-4 px-4 py-3">
								<dt class="text-text-muted">Afterwards</dt>
								<dd class="min-w-0 text-right">back to {facts.returnHost}</dd>
							</div>
						{/if}
					</dl>
				{/if}
			{/if}
		</div>
	{/if}
</div>
