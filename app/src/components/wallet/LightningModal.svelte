<script lang="ts">
	import { t as tr } from '../../lib/i18n/index.svelte';
	// Pays a Lightning invoice from sSCRT: FixedFloat takes ATOM and pays the
	// invoice; DarkShell swaps sSCRT→ATOM on ShadeSwap and sends it to
	// FixedFloat over IBC — all in one Secret transaction.
	import { AlertTriangle, CheckCircle2, Copy, ExternalLink, Loader2, Zap } from '@lucide/svelte';
	import { toBaseUnits } from 'secret-pay';
	import { onDestroy, untrack } from 'svelte';
	import { BusyError } from '../../lib/chain/tx';
	import { explorerTx, SSCRT_ADDRESS } from '../../lib/config';
	import { createOrder, FfError, ffConfigured, price, refundOrder, satsToBtc, type FfPrice } from '../../lib/ff/fixedfloat';
	import { isFinal, loadLnOrders, lnOrders, saveLnOrder, STATUS_TEXT, syncLnOrder, type LnOrder } from '../../lib/ff/orders.svelte';
	import { formatAmount } from '../../lib/format';
	import { NoGasError } from '../../lib/gas/feePayer';
	import type { Target } from '../../lib/pay/classify';
	import { ATOM_TOKEN, lightningPayment } from '../../lib/pay/payments';
	import { prefetchQuote, quoteInto, type PaddedQuote } from '../../lib/pay/quote';
	import { close, open } from '../../lib/ui.svelte';
	import { client, cosmosAddress, pay, prefetchForPayment, spendable, wallet } from '../../lib/wallet.svelte';
	import Button from '../ui/Button.svelte';
	import Modal from '../ui/Modal.svelte';
	import SwipeConfirm from '../ui/SwipeConfirm.svelte';
	import { fiatValue } from '../../lib/price.svelte';
	import PoweredByFF from './PoweredByFF.svelte';

	let { target: t, orderId }: { target?: Extract<Target, { kind: 'lightning' }>; orderId?: string } = $props();
	const target = untrack(() => t);
	const existing = untrack(() => orderId);

	type Step = 'quote' | 'confirm' | 'sending' | 'progress' | 'error';
	let step = $state<Step>(existing ? 'progress' : 'quote');
	let error = $state('');
	let ffPrice = $state<FfPrice | null>(null);
	let quote = $state<PaddedQuote | null>(null);
	let order = $state<LnOrder | null>(null);
	let copied = $state(false);

	const sats = target?.sats;
	const now = () => Math.floor(Date.now() / 1000);
	/** FixedFloat refuses invoices with less than ~5–8 min left ("Invalid address"); keep a margin. */
	const MIN_LEFT = 12 * 60;
	const secondsLeft = () => (target?.expiresAt ? target.expiresAt - now() : undefined);
	const minutes = (s: number) => Math.max(0, Math.floor(s / 60));

	const atomBase = (amount: string) => {
		// FixedFloat quotes ATOM with up to 6 decimals; round up so the order is covered
		const [i, f = ''] = amount.split('.');
		const base = toBaseUnits(`${i}.${(f + '000000').slice(0, 6)}`.replace(/\.$/, ''), 6);
		return f.length > 6 && /[1-9]/.test(f.slice(6)) ? base + 1n : base;
	};

	async function loadQuote() {
		error = '';
		if (!target) return;
		if (!ffConfigured()) return fail(tr('Lightning payments need a FixedFloat API key. Add one in Settings → Lightning (FixedFloat).'));
		if (sats === undefined || sats <= 0n) return fail(tr('This invoice has no amount. Ask for an invoice with a fixed amount.'));
		if (target.network !== 'mainnet') return fail(tr('This is a testnet Lightning invoice. FixedFloat pays mainnet invoices only (they start with lnbc).'));
		if (target.msat !== undefined && target.msat % 1000n !== 0n) return fail(tr('This invoice asks for a fraction of a satoshi, which FixedFloat cannot pay. Ask for a whole number of sats.'));
		const left = secondsLeft();
		if (left !== undefined && left <= 0) return fail(tr('This Lightning invoice has expired. Ask for a new one.'));
		if (left !== undefined && left < MIN_LEFT) return fail(tr('This invoice expires in {0} min. FixedFloat needs more time to pay it — ask for a new invoice and pay it right away.', { 0: minutes(left) }));
		try {
			prefetchForPayment();
			const pools = prefetchQuote(client(), SSCRT_ADDRESS, ATOM_TOKEN).catch(() => {});
			const p = await price('ATOM', 'BTCLN', satsToBtc(sats));
			await pools;
			ffPrice = p;
			if (p.errors.length) return fail(priceError(p));
			const q = await quoteInto(client(), SSCRT_ADDRESS, ATOM_TOKEN, atomBase(p.from.amount));
			if (!q) return fail(tr('There is no ShadeSwap route from sSCRT to ATOM right now.'));
			quote = q;
			step = 'confirm';
		} catch (e) {
			fail(e instanceof Error ? e.message : String(e));
		}
	}

	function priceError(p: FfPrice): string {
		if (p.errors.includes('LIMIT_MIN')) return tr('Too small for FixedFloat: the minimum is {0} ATOM (about {1} sats).', { 0: p.from.min ?? '≈1.2', 1: minSats(p) });
		if (p.errors.includes('LIMIT_MAX')) return tr('Too large for FixedFloat.');
		if (p.errors.some((e) => e.startsWith('MAINTENANCE') || e.startsWith('OFFLINE'))) return tr('FixedFloat is under maintenance for ATOM or Lightning. Try later.');
		if (p.errors.some((e) => e.startsWith('RESERVE'))) return tr('FixedFloat does not have enough Lightning liquidity right now.');
		return tr('FixedFloat cannot take this order ({0}).', { 0: p.errors.join(', ') });
	}

	function minSats(p: FfPrice): string {
		const rate = Number(p.to.amount) / Number(p.from.amount);
		const min = Number(p.from.min ?? '1.2') * rate * 1e8;
		return Number.isFinite(min) ? Math.ceil(min).toLocaleString() : '?';
	}

	/** FixedFloat's terse errors, explained for this Lightning flow. */
	function ffMessage(e: FfError): string {
		if (e.code === 301)
			return tr('FixedFloat rejected the invoice ({0}). Usually it has expired or expires within a few minutes, was already paid, or is not a mainnet invoice. Ask for a new invoice and pay it right away.', { 0: e.message });
		if (e.code === 304) return tr('FixedFloat cannot reach the recipient\'s Lightning node ({0}). The recipient\'s wallet may be offline or have no inbound liquidity.', { 0: e.message });
		return e.code ? `${e.message} (FixedFloat error ${e.code})` : e.message;
	}

	function fail(msg: string) {
		error = msg;
		step = 'error';
	}

	async function confirm() {
		if (!target || sats === undefined || step !== 'confirm') return;
		const left = secondsLeft();
		if (left !== undefined && left < MIN_LEFT) return fail(tr('This invoice now expires in {0} min — too soon for FixedFloat. Ask for a new invoice.', { 0: minutes(left) }));
		step = 'sending';
		error = '';
		try {
			// 1. the order fixes the exact ATOM amount, deposit address and memo
			const o = await createOrder('ATOM', 'BTCLN', satsToBtc(sats), target.invoice);
			const atom = atomBase(o.from.amount);
			const memo = o.from.tag ?? '';
			const record: LnOrder = {
				id: o.id,
				token: o.token,
				invoice: target.invoice,
				sats: sats.toString(),
				description: target.description,
				atom: atom.toString(),
				status: 'SENDING',
				created: Date.now(),
				expires: o.time.expiration * 1000,
				deposit: o.from.address,
				memo,
			};
			await saveLnOrder(record);
			order = record;

			// 2. send it in one transaction; the quote already shown covers the order
			//    when its padded output is enough (it usually is), else price it again
			const q = quote && quote.amountOut >= atom ? quote : await quoteInto(client(), SSCRT_ADDRESS, ATOM_TOKEN, atom);
			if (!q) throw new Error(tr('There is no ShadeSwap route from sSCRT to ATOM right now.'));
			if (spendable() !== null && q.amountIn > spendable()!) throw new Error(tr('Not enough sSCRT: this needs {0}.', { 0: formatAmount(q.amountIn) }));
			const plan = await lightningPayment(client(), wallet.address, q, atom, o.from.address, memo);
			const out = await pay(plan, 'lightning', (p) => {
				// the network accepted it: show progress at once
				order = { ...record, sscrt: q.amountIn.toString(), hash: p.hash, status: 'NEW' };
				step = 'progress';
			}, { to: o.from.address, amount: atom.toString(), symbol: 'ATOM', memo });
			order = { ...record, sscrt: q.amountIn.toString(), hash: out.hash, status: 'NEW' };
			await saveLnOrder(order);
			step = 'progress';
			startPolling();
		} catch (e) {
			const msg =
				e instanceof NoGasError
					? tr('Nothing can pay the network fee: gas credits are empty. See Settings → Gas credits.')
					: e instanceof FfError
						? ffMessage(e)
						: e instanceof BusyError || e instanceof Error
							? e.message
							: String(e);
			// the FixedFloat order simply expires if nothing was sent
			if (order && !order.hash) order = null;
			fail(msg);
		}
	}

	let timer: ReturnType<typeof setInterval> | undefined;
	function startPolling() {
		clearInterval(timer);
		const tick = async () => {
			if (!order || isFinal(order.status)) return clearInterval(timer);
			try {
				order = await syncLnOrder(order);
			} catch {
				/* keep trying */
			}
		};
		void tick();
		timer = setInterval(tick, 10_000);
	}
	onDestroy(() => clearInterval(timer));

	async function refund() {
		if (!order) return;
		try {
			await refundOrder(order.id, order.token, cosmosAddress());
			error = tr('Refund requested to {0} on the Cosmos Hub (same key as this account).', { 0: cosmosAddress() });
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		}
	}

	let copiedField = $state('');
	async function copyText(text: string, field: string) {
		await navigator.clipboard.writeText(text).catch(() => {});
		copiedField = field;
		setTimeout(() => copiedField === field && (copiedField = ''), 1500);
	}

	const short = (x: string, head = 10, tail = 6) => (x.length > head + tail + 1 ? `${x.slice(0, head)}…${x.slice(-tail)}` : x);

	/** [label, shown, copyable] for each leg of the payment */
	function route(o: LnOrder): [string, string, string?][] {
		return [
			...(o.sscrt ? [['You paid', tr('{0} sSCRT', { 0: formatAmount(BigInt(o.sscrt)) })] as [string, string]] : []),
			['Swapped to', tr('{0} ATOM · ShadeSwap', { 0: formatAmount(BigInt(o.atom)) })],
			['Sent over IBC to', short(o.deposit), o.deposit],
			...(o.memo ? [['IBC memo', o.memo, o.memo] as [string, string, string]] : []),
			['Lightning invoice', short(o.invoice, 14, 8), o.invoice],
			['Order', o.id, o.id],
			['Created', new Date(o.created).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })],
		];
	}

	async function copyId() {
		if (!order) return;
		await navigator.clipboard.writeText(tr('FixedFloat order {0}', { 0: order.id })).catch(() => {});
		copied = true;
		setTimeout(() => (copied = false), 1600);
	}

	if (existing) {
		void loadLnOrders().then(() => {
			order = lnOrders.list.find((o) => o.id === existing) ?? null;
			if (order) startPolling();
			else fail(tr('This Lightning payment is no longer on this device.'));
		});
	} else {
		void loadQuote();
	}

	const STEPS: LnOrder['status'][] = ['NEW', 'PENDING', 'EXCHANGE', 'WITHDRAW', 'DONE'];
</script>

<Modal full title={tr('Lightning invoice')} onclose={close}>
	{#if order && (step === 'progress' || (step === 'error' && order.hash))}
		<div class="flex flex-col items-center gap-1 text-center">
			<span class="text-[2rem] font-medium leading-tight tabular-nums">{Number(order.sats).toLocaleString()} <span class="text-title text-text-muted">sats</span></span>
			{#if order.sscrt && fiatValue(BigInt(order.sscrt))}<span class="text-base tabular-nums text-text-faint">≈ {fiatValue(BigInt(order.sscrt))}</span>{/if}
			{#if order.description}<p class="text-base text-text-muted">“{order.description}”</p>{/if}
		</div>
		<ol class="flex flex-col gap-2">
			{#each STEPS as s, i (s)}
				{@const reached = STEPS.indexOf(order.status as LnOrder['status']) >= i || order.status === 'DONE'}
				{@const current = order.status === s && s !== 'DONE'}
				<li class="flex items-center gap-3 text-base {reached ? 'text-text' : 'text-text-faint'}">
					{#if current}<Loader2 size={16} class="animate-spin text-accent" />{:else if reached}<CheckCircle2 size={16} class="text-positive" />{:else}<span class="size-4 rounded-pill border border-border-strong"></span>{/if}
					{tr(STATUS_TEXT[s])}
				</li>
			{/each}
		</ol>
		{#if order.status === 'EMERGENCY'}
			<div class="flex items-start gap-2 rounded-card bg-surface p-3 text-label text-text-muted">
				<AlertTriangle size={16} class="mt-px shrink-0 text-[#f5b544]" />
				<span>{tr('FixedFloat could not complete the exchange as ordered (late or different amount). You can ask for a refund to this account\'s Cosmos Hub address.')}</span>
			</div>
			<Button variant="secondary" block size="lg" onclick={refund}>{tr('Request refund')}</Button>
		{/if}
		{#if error}<p class="text-base text-text-muted">{error}</p>{/if}
		<!-- the whole route, step by step -->
		<dl class="flex flex-col divide-y divide-border rounded-card border border-border bg-surface-1 text-base">
			{#each route(order) as [k, v, full] (k)}
				<div class="flex items-start justify-between gap-4 px-4 py-3">
					<dt class="shrink-0 text-text-faint">{tr(k)}</dt>
					<dd class="min-w-0 text-right">
						{#if full}
							<button type="button" onclick={() => copyText(full, k)} class="flex max-w-full items-center gap-1.5">
								<span class="truncate font-mono text-[0.8125rem]">{v}</span>
								{#if copiedField === k}<CheckCircle2 size={13} class="shrink-0 text-positive" />{:else}<Copy size={12} class="shrink-0 text-text-faint" />{/if}
							</button>
						{:else}<span class="tabular-nums">{v}</span>{/if}
					</dd>
				</div>
			{/each}
		</dl>
		<p class="text-label text-text-faint">{tr('If anything goes wrong, FixedFloat support can find the payment by its order ID.')}</p>
		<div class="flex flex-wrap gap-2">
			<Button variant="secondary" shape="control" size="sm" onclick={copyId}>
				{#snippet icon()}<Copy size={14} />{/snippet}
				{copied ? tr('Copied') : tr('Copy order ID')}
			</Button>
			{#if order.hash}
				<a href={explorerTx(order.hash)} target="_blank" rel="noreferrer noopener" class="inline-flex items-center gap-1.5 px-2 text-base text-accent">{tr('Transaction')} <ExternalLink size={14} /></a>
			{/if}
		</div>
		<div class="mt-auto pt-4"><Button block size="xl" onclick={close}>{order.status === 'DONE' ? tr('Done') : tr('Close — it continues in the background')}</Button></div>
	{:else if step === 'quote'}
		<div class="flex items-center justify-center gap-2 py-8 text-base text-text-muted"><Loader2 size={18} class="animate-spin" /> {tr('Getting a price…')}</div>
	{:else if step === 'error'}
		<div class="flex items-start gap-3">
			<Zap size={18} class="mt-0.5 shrink-0 text-accent" />
			<p class="text-base">{error}</p>
		</div>
		<div class="mt-auto pt-4">
			<Button variant="secondary" block size="xl" onclick={() => (error.includes(tr('Settings')) ? open({ name: 'settings', page: 'advanced' }) : close())}>{error.includes(tr('Settings')) ? tr('Open Settings') : tr('Close')}</Button>
		</div>
	{:else if (step === 'confirm' || step === 'sending') && target && ffPrice && quote}
		<div class="flex flex-col items-center gap-1 pt-6 text-center">
			<span class="text-[2.75rem] font-semibold leading-tight tracking-[-0.03em] tabular-nums">{Number(sats).toLocaleString()} <span class="text-title text-text-muted">sats</span></span>
			{#if fiatValue(quote.amountIn)}<span class="text-base tabular-nums text-text-faint">≈ {fiatValue(quote.amountIn)}</span>{/if}
			{#if target.description}<p class="text-base text-text-muted">“{target.description}”</p>{/if}
		</div>
		<dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 rounded-card border border-border bg-surface p-4 text-base">
			<dt class="text-text-faint">{tr('You pay')}</dt>
			<dd class="text-right font-medium tabular-nums">≈ {formatAmount(quote.amountIn)} sSCRT</dd>
			<dt class="text-text-faint">{tr('Via')}</dt>
			<dd class="text-right tabular-nums">{ffPrice.from.amount} ATOM · FixedFloat</dd>
			<dt class="text-text-faint">{tr('Balance')}</dt>
			<dd class="text-right tabular-nums">{formatAmount(spendable())} sSCRT</dd>
		</dl>
		{#if spendable() !== null && quote.amountIn > spendable()!}<p class="text-base text-negative">{tr('Not enough sSCRT.')}</p>{/if}
		<div class="mt-auto pt-4">
			<SwipeConfirm label={tr('Swipe to pay {0} sats', { 0: Number(sats).toLocaleString() })} loading={step === 'sending'} disabled={spendable() !== null && quote.amountIn > spendable()!} onconfirm={confirm} />
		</div>
	{/if}
	<PoweredByFF />
</Modal>
