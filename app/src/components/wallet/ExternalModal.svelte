<script lang="ts">
	// Sends ETH, BTC or XMR to an address on another chain, from sSCRT, in one
	// Secret transaction, through FixedFloat (lib/pay/crosschain.ts). Network (for 0x addresses
	// without one) → amount (unless the request has it) → price → recap and
	// swipe → progress, which keeps going after the app is closed.
	import { AlertTriangle, CheckCircle2, Copy, ExternalLink, Eye, Loader2 } from '@lucide/svelte';
	import { onDestroy, untrack } from 'svelte';
	import { BusyError } from '../../lib/chain/tx';
	import { explorerTx } from '../../lib/config';
	import { FfError, refundOrder } from '../../lib/ff/fixedfloat';
	import { formatAmount } from '../../lib/format';
	import { NoGasError } from '../../lib/gas/feePayer';
	import { ffPlan, networkName, quoteCross, type CrossQuote, type Destination } from '../../lib/pay/crosschain';
	import { COIN_NAME, DECIMALS, EVM_NETWORKS, toBase, type EvmNetwork, type ExternalTarget } from '../../lib/pay/external';
	import { isFinalX, loadXOrders, saveXOrder, statusText, syncXOrder, X_STEPS, xOrders, type XOrder } from '../../lib/pay/xorders.svelte';
	import { usdValue } from '../../lib/price.svelte';
	import { close, open } from '../../lib/ui.svelte';
	import { client, cosmosAddress, pay, prefetchForPayment, spendable, wallet } from '../../lib/wallet.svelte';
	import Button from '../ui/Button.svelte';
	import Modal from '../ui/Modal.svelte';
	import SwipeConfirm from '../ui/SwipeConfirm.svelte';
	import PoweredByFF from './PoweredByFF.svelte';

	let { target: t, orderId }: { target?: ExternalTarget; orderId?: string } = $props();
	const target = untrack(() => t);
	const existing = untrack(() => orderId);

	type Step = 'network' | 'amount' | 'quote' | 'confirm' | 'sending' | 'progress' | 'error';
	let network = $state<EvmNetwork | undefined>(target?.network);
	let amountText = $state(target?.amount ?? '');
	let step = $state<Step>(existing ? 'progress' : !target ? 'error' : target.coin === 'ETH' && !target.network ? 'network' : !target.amount ? 'amount' : 'quote');
	let error = $state('');
	let quote = $state<CrossQuote | null>(null);
	let order = $state<XOrder | null>(null);
	let copied = $state('');

	const coin = target?.coin ?? 'ETH';
	const amount = $derived(toBase(amountText, DECIMALS[coin]));
	const dest = $derived<Destination | null>(target && amount ? { coin, network: coin === 'ETH' ? (network ?? 'ethereum') : undefined, address: target.address, amount } : null);
	const where = $derived(networkName({ coin, network }));
	const short = (x: string, head = 10, tail = 6) => (x.length > head + tail + 1 ? `${x.slice(0, head)}…${x.slice(-tail)}` : x);

	prefetchForPayment();

	function fail(msg: string) {
		error = msg;
		step = 'error';
	}

	async function getQuote() {
		if (!dest) return;
		step = 'quote';
		error = '';
		try {
			quote = await quoteCross(client(), dest);
			step = 'confirm';
		} catch (e) {
			fail(e instanceof Error ? e.message : String(e));
		}
	}

	if (untrack(() => step) === 'quote') void getQuote();

	const tooMuch = $derived(!!quote && spendable() !== null && quote.sscrt > spendable()!);

	async function confirm() {
		if (!target || !dest || !quote || step !== 'confirm') return;
		step = 'sending';
		error = '';
		const base: Omit<XOrder, 'id' | 'provider' | 'status'> = { coin, network: dest.network, address: target.address, amount: amountText, note: target.note, created: Date.now() };
		const info = { to: target.address, amount: dest.amount.toString(), symbol: coin };
		try {
			const { order: o, plan, atom, quote: q } = await ffPlan(client(), wallet.address, dest, quote.quote);
			const ff = { token: o.token, deposit: o.from.address, memo: o.from.tag ?? undefined, atom: atom.toString(), expires: o.time.expiration * 1000 };
			order = { ...base, id: o.id, provider: 'ff', status: 'SENDING', ff };
			await saveXOrder(order);
			if (spendable() !== null && q.amountIn > spendable()!) throw new Error(`Not enough sSCRT: this needs ${formatAmount(q.amountIn)}.`);
			const out = await pay(plan, 'external', (p) => {
				order = { ...order!, sscrt: q.amountIn.toString(), hash: p.hash, status: 'NEW' };
				step = 'progress';
			}, { ...info, memo: ff.memo });
			order = { ...order, sscrt: q.amountIn.toString(), hash: out.hash, status: 'NEW' };
			await saveXOrder(order);
			step = 'progress';
			startPolling();
		} catch (e) {
			const msg =
				e instanceof NoGasError
					? 'Nothing can pay the network fee: gas credits are empty. See Settings → Gas credits.'
					: e instanceof FfError
						? e.code
							? `${e.message} (FixedFloat error ${e.code})`
							: e.message
						: e instanceof BusyError || e instanceof Error
							? e.message
							: String(e);
			// a FixedFloat order simply expires if nothing was sent
			if (order && !order.hash) order = null;
			fail(msg);
		}
	}

	let timer: ReturnType<typeof setInterval> | undefined;
	function startPolling() {
		clearInterval(timer);
		const tick = async () => {
			if (!order || isFinalX(order.status)) return clearInterval(timer);
			try {
				order = await syncXOrder(order);
			} catch {
				/* keep trying */
			}
		};
		void tick();
		timer = setInterval(tick, 10_000);
	}
	onDestroy(() => clearInterval(timer));

	if (existing) {
		void loadXOrders().then(() => {
			order = xOrders.list.find((o) => o.id === existing) ?? null;
			if (order) startPolling();
			else fail('This payment is no longer on this device.');
		});
	} else if (!target) fail('Nothing to pay.');

	async function refund() {
		if (!order?.ff) return;
		try {
			await refundOrder(order.id, order.ff.token, cosmosAddress());
			error = `Refund requested to ${cosmosAddress()} on the Cosmos Hub (same key as this account).`;
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		}
	}

	async function copyText(text: string, field: string) {
		await navigator.clipboard.writeText(text).catch(() => {});
		copied = field;
		setTimeout(() => copied === field && (copied = ''), 1500);
	}

	const destExplorer = (o: XOrder) =>
		o.destTx ? ({ ethereum: 'https://etherscan.io/tx/', arbitrum: 'https://arbiscan.io/tx/', base: 'https://basescan.org/tx/', optimism: 'https://optimistic.etherscan.io/tx/' } as const)[o.network ?? 'ethereum'] + o.destTx : null;

	function legs(o: XOrder): [string, string, string?][] {
		return [
			...(o.sscrt ? [['You paid', `${formatAmount(BigInt(o.sscrt))} sSCRT`] as [string, string]] : []),
			['Via', `FixedFloat · ${formatAmount(BigInt(o.ff?.atom ?? '0'))} ATOM`],
			...(o.ff ? [['Deposit address', short(o.ff.deposit), o.ff.deposit] as [string, string, string]] : []),
			...(o.ff?.memo ? [['IBC memo', o.ff.memo, o.ff.memo] as [string, string, string]] : []),
			['To', short(o.address, 10, 8), o.address],
			...(o.provider === 'ff' ? [['Order', o.id, o.id] as [string, string, string]] : []),
			['Created', new Date(o.created).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })],
		];
	}

	const title = $derived(step === 'confirm' || step === 'sending' ? 'Confirm' : `Send ${coin}`);
	const back = $derived(step === 'amount' && coin === 'ETH' && !target?.network ? () => (step = 'network') : step === 'confirm' && !target?.amount ? () => (step = 'amount') : step === 'confirm' && coin === 'ETH' && !target?.network ? () => (step = 'network') : undefined);
</script>

{#snippet row(label: string, value: string, sub?: string)}
	<div class="flex items-start justify-between gap-4 px-4 py-3.5">
		<dt class="shrink-0 text-text-faint">{label}</dt>
		<dd class="min-w-0 text-right">{value}{#if sub}<span class="block text-label text-text-faint">{sub}</span>{/if}</dd>
	</div>
{/snippet}

<Modal full {title} onclose={close} onback={back}>
	{#if order && (step === 'progress' || (step === 'error' && order.hash))}
		<div class="flex flex-col items-center gap-1 text-center">
			<span class="text-[2rem] font-semibold leading-tight tabular-nums">{order.amount} <span class="text-title text-text-muted">{order.coin}</span></span>
			<span class="text-base text-text-faint">to {short(order.address, 8, 6)} on {networkName(order)}</span>
		</div>
		<ol class="flex flex-col gap-2">
			{#each X_STEPS[order.provider] as s, i (s)}
				{@const steps = X_STEPS[order.provider]}
				{@const reached = steps.indexOf(order.status) >= i || order.status === 'DONE'}
				{@const current = order.status === s && s !== 'DONE'}
				<li class="flex items-center gap-3 text-base {reached ? 'text-text' : 'text-text-faint'}">
					{#if current}<Loader2 size={16} class="animate-spin text-text-muted" />{:else if reached}<CheckCircle2 size={16} class="text-positive" />{:else}<span class="size-4 rounded-pill border border-border-strong"></span>{/if}
					{statusText(order, s)}
				</li>
			{/each}
		</ol>
		{#if order.status === 'FAILED' || order.status === 'EMERGENCY'}
			<div class="flex items-start gap-2 rounded-card bg-surface p-3 text-label text-text-muted">
				<AlertTriangle size={16} class="mt-px shrink-0 text-[#f5b544]" />
				<span>
					FixedFloat could not complete the exchange as ordered. You can ask for a refund to this account's Cosmos Hub address.
				</span>
			</div>
			<Button variant="secondary" block size="lg" onclick={refund}>Request refund</Button>
		{/if}
		{#if error}<p class="text-base text-text-muted">{error}</p>{/if}
		<dl class="flex flex-col divide-y divide-border rounded-card border border-border bg-surface-1 text-base">
			{#each legs(order) as [k, v, full] (k)}
				<div class="flex items-start justify-between gap-4 px-4 py-3">
					<dt class="shrink-0 text-text-faint">{k}</dt>
					<dd class="min-w-0 text-right">
						{#if full}
							<button type="button" onclick={() => copyText(full, k)} class="flex max-w-full items-center gap-1.5">
								<span class="truncate font-mono text-[0.8125rem]">{v}</span>
								{#if copied === k}<CheckCircle2 size={13} class="shrink-0 text-positive" />{:else}<Copy size={12} class="shrink-0 text-text-faint" />{/if}
							</button>
						{:else}<span class="tabular-nums">{v}</span>{/if}
					</dd>
				</div>
			{/each}
		</dl>
		<div class="flex flex-wrap gap-3 px-1">
			{#if order.hash}<a href={explorerTx(order.hash)} target="_blank" rel="noreferrer noopener" class="inline-flex items-center gap-1.5 text-base text-accent">Secret transaction <ExternalLink size={14} /></a>{/if}
			{#if destExplorer(order)}<a href={destExplorer(order)} target="_blank" rel="noreferrer noopener" class="inline-flex items-center gap-1.5 text-base text-accent">On {networkName(order)} <ExternalLink size={14} /></a>{/if}
		</div>
		<div class="mt-auto pt-4"><Button block size="xl" onclick={close}>{order.status === 'DONE' ? 'Done' : 'Close — it continues in the background'}</Button></div>
		<PoweredByFF />
	{:else if step === 'network'}
		<p class="px-1 text-base text-text-muted">An 0x address works on several networks. Which one should receive the ETH?</p>
		<ul class="flex flex-col gap-2" role="radiogroup" aria-label="Network">
			{#each EVM_NETWORKS as n (n.id)}
				<li>
					<button
						type="button"
						role="radio"
						aria-checked={(network ?? 'ethereum') === n.id}
						onclick={() => (network = n.id)}
						class="flex w-full items-center justify-between rounded-control border px-4 py-3.5 text-left text-base transition-colors duration-200 {(network ?? 'ethereum') === n.id ? 'border-text-muted bg-surface-2' : 'border-border bg-surface'}"
					>
						{n.name}
						{#if (network ?? 'ethereum') === n.id}<CheckCircle2 size={18} class="text-text" />{/if}
					</button>
				</li>
			{/each}
		</ul>
		<p class="px-1 text-label text-text-faint">Pick the network the recipient asked for. ETH sent on the wrong one may be hard or impossible for them to get.</p>
		<div class="mt-auto pt-4">
			<Button block size="xl" onclick={() => ((network ??= 'ethereum'), target?.amount ? void getQuote() : (step = 'amount'))}>Continue</Button>
		</div>
	{:else if step === 'amount'}
		<div class="flex items-center justify-between gap-3 rounded-card bg-surface px-4 py-3 text-base">
			<span class="min-w-0 truncate font-mono text-[0.8125rem]">{short(target?.address ?? '', 10, 8)}</span>
			<span class="shrink-0 text-text-faint">{where}</span>
		</div>
		<div class="flex flex-1 flex-col items-center justify-center gap-2">
			<label class="flex max-w-full items-baseline justify-center gap-2">
				<!-- as wide as what is typed, so the figure and its unit stay centred -->
				<input
					bind:value={amountText}
					inputmode="decimal"
					placeholder="0"
					aria-label="Amount in {coin}"
					style="width: {Math.max(1, amountText.length) + 0.5}ch"
					class="min-w-0 max-w-[14ch] bg-transparent text-center text-[2.75rem] font-semibold tabular-nums outline-none placeholder:text-text-faint"
				/>
				<span class="text-title text-text-muted">{coin}</span>
			</label>
			<p class="text-label text-text-faint">{COIN_NAME[coin]} the recipient gets, paid from your sSCRT</p>
			{#if amountText && !amount}<p class="text-label text-negative" role="alert">Enter a valid amount (up to {DECIMALS[coin]} decimals).</p>{/if}
		</div>
		<Button block size="xl" disabled={!amount} onclick={getQuote}>{amount ? 'Get a price' : 'Enter an amount'}</Button>
	{:else if step === 'quote'}
		<div class="flex items-center justify-center gap-2 py-8 text-base text-text-muted"><Loader2 size={18} class="animate-spin" /> Getting a price…</div>
	{:else if step === 'error'}
		<div class="flex items-start gap-3">
			<AlertTriangle size={18} class="mt-0.5 shrink-0 text-[#f5b544]" />
			<p class="text-base">{error}</p>
		</div>
		<div class="mt-auto flex flex-col gap-2 pt-4">
			{#if target && !error.includes('Settings')}<Button variant="secondary" block size="xl" onclick={() => (step = 'amount')}>Change amount</Button>{/if}
			<Button variant="ghost" block onclick={() => (error.includes('Settings') ? open({ name: 'settings' }) : close())}>{error.includes('Settings') ? 'Open Settings' : 'Close'}</Button>
		</div>
	{:else if (step === 'confirm' || step === 'sending') && quote && target && dest}
		<div class="flex flex-col items-center gap-1 pt-6 text-center">
			<span class="text-label text-text-faint">They get</span>
			<div class="flex items-baseline gap-2">
				<span class="text-[2.75rem] font-semibold leading-tight tracking-[-0.03em] tabular-nums">{amountText}</span>
				<span class="text-title text-text-muted">{coin}</span>
			</div>
			{#if usdValue(quote.sscrt)}<span class="text-base tabular-nums text-text-faint">≈ {usdValue(quote.sscrt)}</span>{/if}
			{#if target.note}<p class="text-base text-text-muted">“{target.note}”</p>{/if}
		</div>
		<dl class="flex flex-col divide-y divide-border rounded-card border border-border bg-surface-1 text-base">
			{@render row('To', short(target.address, 10, 8), where)}
			{@render row('You pay', `≈ ${formatAmount(quote.sscrt)} sSCRT`, `balance ${formatAmount(spendable())}`)}
			{@render row('Via', quote.via, 'an exchange makes the payment')}
			{@render row('Arrives', `in about ${quote.minutes} min`)}
			{@render row('Network fee', 'Paid from gas credits')}
		</dl>
		<p class="flex items-start gap-2 px-1 text-label text-text-faint">
			<Eye size={13} class="mt-px shrink-0" />
			Public: the transfer to FixedFloat and the payment on {where} are visible on chain, and FixedFloat sees both sides.{coin === 'XMR' ? ' Once it is Monero, the recipient’s side is private.' : ''}
		</p>
		{#if tooMuch}<p class="text-base text-negative">Not enough sSCRT.</p>{/if}
		<div class="mt-auto pt-4">
			<SwipeConfirm label="Swipe to send {amountText} {coin}" loading={step === 'sending'} disabled={tooMuch} onconfirm={confirm} />
		</div>
		<PoweredByFF />
	{/if}
</Modal>
