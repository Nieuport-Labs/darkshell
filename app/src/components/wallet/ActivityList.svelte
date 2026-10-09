<script lang="ts">
	import { AlertCircle, ArrowDownLeft, ArrowLeftRight, ChevronRight, Fuel, Landmark, Loader2, Send, ShieldCheck, Vote, Zap } from '@lucide/svelte';
	import type { HistoryItem } from '../../lib/chain/sscrt';
	import { describe, describeLogged, linkOf, unsettled, type Icon } from '../../lib/activity';
	import { loadLnOrders, lnOrders } from '../../lib/ff/orders.svelte';
	import { formatAmount } from '../../lib/format';
	import { open, ui } from '../../lib/ui.svelte';
	import { usdValue } from '../../lib/price.svelte';
	import { txLog, wallet, type LoggedTx } from '../../lib/wallet.svelte';

	let { limit, title = 'Recent activity', onseeall }: { limit?: number; title?: string; onseeall?: () => void } = $props();

	let logged = $state<LoggedTx[]>([]);
	$effect(() => {
		void wallet.history; // re-read the log whenever history or the log changes
		void wallet.logged;
		void txLog().then((l) => (logged = l));
	});
	$effect(() => {
		void wallet.address;
		void loadLnOrders();
	});

	function date(unix?: number): string {
		return unix ? new Date(unix * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '';
	}

	/** A Lightning payment opens on its own progress page; everything else on the detail. */
	function openItem(h: HistoryItem, link?: LoggedTx) {
		const order = link?.kind === 'lightning' ? lnOrders.list.find((o) => o.hash === link.hash) : undefined;
		if (order) open({ name: 'lightning', orderId: order.id });
		else open({ name: 'tx', item: $state.snapshot(h) as HistoryItem });
	}

	function openLogged(l: LoggedTx) {
		const order = l.kind === 'lightning' ? lnOrders.list.find((o) => o.hash === l.hash) : undefined;
		if (order) open({ name: 'lightning', orderId: order.id });
		else open({ name: 'tx', hash: l.hash });
	}

	const inFlight = $derived(unsettled(logged, wallet.history));
	const shown = $derived(limit ? wallet.history.slice(0, Math.max(0, limit - inFlight.length)) : wallet.history);
</script>

{#snippet glyph(icon: Icon)}
	<span class="flex size-10 shrink-0 items-center justify-center rounded-pill bg-surface {icon === 'bolt' ? 'text-accent' : 'text-text-muted'}">
		{#if icon === 'in'}<ArrowDownLeft size={17} />{:else if icon === 'swap'}<ArrowLeftRight size={17} />{:else if icon === 'gas'}<Fuel size={17} />{:else if icon === 'shield'}<ShieldCheck
				size={17}
			/>{:else if icon === 'bolt'}<Zap size={17} />{:else if icon === 'stake'}<Landmark size={17} />{:else if icon === 'vote'}<Vote size={17} />{:else}<Send size={16} />{/if}
	</span>
{/snippet}

<section class="flex flex-col">
	<div class="flex items-center justify-between pb-2">
		<h2 class="text-title">{title}</h2>
		{#if onseeall && (wallet.history.length || inFlight.length)}
			<button type="button" onclick={onseeall} class="state-layer -mr-2 flex items-center gap-0.5 rounded-pill px-2 py-1 text-base text-text-muted">
				See all <ChevronRight size={16} />
			</button>
		{/if}
	</div>

	{#if wallet.balance === null && wallet.history.length === 0}
		{#each [0, 1, 2] as i (i)}
			<div class="flex items-center gap-3 py-3">
				<span class="size-10 shrink-0 animate-pulse rounded-pill bg-surface"></span>
				<span class="h-4 flex-1 animate-pulse rounded-control bg-surface"></span>
			</div>
		{/each}
	{:else if shown.length || inFlight.length}
		<ul class="flex flex-col">
			{#each inFlight as l (l.hash)}
				{@const d = describeLogged(l)}
				{@const amount = BigInt(l.kind === 'vote' ? '0' : l.spent && l.spent !== '0' ? l.spent : (l.amount ?? '0'))}
				<li>
					<button type="button" onclick={() => openLogged(l)} class="state-layer -mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-card px-2 py-3 text-left">
						{@render glyph(d.icon)}
						<span class="min-w-0 flex-1">
							<span class="block truncate text-base font-medium">{l.memo && l.kind === 'send' ? l.memo : d.title}</span>
							<span class="flex items-center gap-1 text-label {l.status === 'failed' ? 'text-negative' : 'text-accent'}">
								{#if l.status === 'failed'}<AlertCircle size={12} class="shrink-0" />{:else}<Loader2 size={12} class="shrink-0 animate-spin" />{/if}
								<span class="truncate">{l.status === 'failed' ? 'Failed' : 'Processing'}{d.detail ? ` · ${d.detail}` : ''}</span>
							</span>
						</span>
						<span class="flex shrink-0 flex-col items-end">
							<span class="whitespace-nowrap text-base font-medium tabular-nums {l.status === 'failed' ? 'text-text-faint line-through' : 'text-text'}">
								{l.kind === 'vote' ? '' : ui.hideBalance ? '••••' : `${d.sign}${formatAmount(amount, 4)}`}
							</span>
							<span class="whitespace-nowrap text-label tabular-nums text-text-faint">{date(Math.floor(l.time / 1000))}</span>
						</span>
					</button>
				</li>
			{/each}
			{#each shown as h, i (`${h.id}-${i}`)}
				{@const d = describe(h, linkOf(h, logged))}
				<li>
					<button type="button" onclick={() => openItem(h, d.link)} class="state-layer -mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-card px-2 py-3 text-left">
						{@render glyph(d.icon)}
						<span class="min-w-0 flex-1">
							<span class="block truncate text-base font-medium">{h.memo || d.title}</span>
							<span class="flex items-center gap-1 text-label text-text-faint">
								<ShieldCheck size={12} aria-hidden="true" class="shrink-0 text-accent" />
								<span class="truncate">Private{d.detail ? ` · ${h.memo ? d.title.toLowerCase() + ' ' : ''}${d.detail}` : ''}</span>
							</span>
						</span>
						<span class="flex shrink-0 flex-col items-end">
							<span class="whitespace-nowrap text-base font-medium tabular-nums {d.sign === '+' ? 'text-positive' : 'text-text'}">
								{ui.hideBalance ? '••••' : `${d.sign}${formatAmount(h.amount, 4)}`}
							</span>
							<span class="whitespace-nowrap text-label tabular-nums text-text-faint"
								>{#if !ui.hideBalance && usdValue(h.amount)}{usdValue(h.amount)}&nbsp;·&nbsp;{/if}{date(h.time)}</span
							>
						</span>
					</button>
				</li>
			{/each}
		</ul>
	{:else}
		<p class="py-3 text-base text-text-muted">Nothing yet. Payments you send and receive appear here.</p>
	{/if}
</section>
